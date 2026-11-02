// 独占输出公共层：平台无关的音源装配、进度统计与 PCM 编码。
// 由 WASAPI 独占（Windows）与 Core Audio 独占（macOS）两个实现共同复用。

use crate::player::equalizer::{EqualizerHandle, EqualizerSettings};
use crate::player::sound_effect::{SoundEffectHandle, SoundEffectSettings};
use crate::player::types::{SharedProgress, SharedVisualizer};
use rodio::{Decoder, Source};
use std::fs::File;
use std::io::{BufReader, Read};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// 一次独占播放的全部入参（由播放线程构造）。
pub(crate) struct ExclusivePlayRequest {
  pub path: String,
  pub device_name: Option<String>,
  pub volume: f32,
  pub is_playing: bool,
  pub progress: Arc<SharedProgress>,
  pub start_time: Duration,
  pub volume_balance_gain: f32,
  pub equalizer_handle: Arc<EqualizerHandle>,
  pub sound_effect_handle: Arc<SoundEffectHandle>,
  pub user_volume: Arc<AtomicU32>,
  pub dsd_native_passthrough: bool,
  pub bit_perfect: bool,
}

/// 播放线程消费的控制命令。
pub(crate) enum ExclusiveControl {
  Seek { time: Duration, is_playing: bool },
  Stop,
  SetVolumeBalance { enabled: bool, target_gain: f32 },
  SetEqualizerSettings { settings: EqualizerSettings },
  SetSoundEffectSettings { settings: SoundEffectSettings },
}

/// 独占输出使用的采样编码。
#[derive(Copy, Clone)]
pub(crate) enum ExclusiveEncoding {
  Float32,
  Int32,
  Int32Valid24,
  Int24,
  Int16,
}

/// 独占播放的解码音源：负责进度统计、可视化喂料与逐帧编码。
pub(crate) struct ExclusiveAudioFeed {
  source: Box<dyn Source<Item = f32> + Send>,
  progress: Arc<SharedProgress>,
  visualizer: Arc<SharedVisualizer>,
  channels: u16,
  frame_energy: f32,
  frame_lane: u16,
  pub(crate) normalizer_handle: crate::player::loudness::VolumeNormalizerHandle,
}

impl ExclusiveAudioFeed {
  /// 打开文件并组装源链；bit-perfect 时只保留限幅器与哑归一化句柄。
  #[allow(clippy::too_many_arguments)]
  pub(crate) fn open(
    path: &str,
    start_time: Duration,
    progress: Arc<SharedProgress>,
    volume_balance_gain: f32,
    equalizer_handle: Arc<EqualizerHandle>,
    sound_effect_handle: Arc<SoundEffectHandle>,
    user_volume: Arc<AtomicU32>,
    bit_perfect: bool,
  ) -> Result<(Self, u32, u16, Option<u8>), String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let reader = BufReader::with_capacity(512 * 1024, file);
    let decoder = Decoder::new(reader).map_err(|error| error.to_string())?;
    let sample_rate = decoder.sample_rate();
    let channels = decoder.channels();

    // DSD 容器不走 PCM 位深探测。
    let lower = path.to_lowercase();
    let preferred_depth = if lower.ends_with(".dsf") || lower.ends_with(".dff") {
      None
    } else {
      probe_source_bit_depth(path)
    };

    let samples_at_target =
      (start_time.as_secs_f64() * sample_rate as f64 * channels as f64).round() as u64;
    progress.sample_rate.store(sample_rate, Ordering::Relaxed);
    progress.channels.store(channels as u32, Ordering::Relaxed);
    progress
      .samples_played
      .store(samples_at_target, Ordering::Relaxed);
    progress.visualizer.reset();

    let decoded = decoder.convert_samples::<f32>().skip_duration(start_time);

    let (source, normalizer_handle) = if bit_perfect {
      let clip_source = crate::player::equalizer::ClipGuardSource::new(decoded);
      let placeholder = crate::player::loudness::GainRamp::new(1.0, sample_rate, 100).get_handle();
      (
        Box::new(clip_source) as Box<dyn Source<Item = f32> + Send>,
        placeholder,
      )
    } else {
      let (normalized, handle) =
        crate::player::loudness::VolumeNormalizer::new(decoded, volume_balance_gain, 100);
      let eq_source = crate::player::equalizer::Equalizer::new(normalized, equalizer_handle);
      let se_source =
        crate::player::sound_effect::SoundEffectSource::new(eq_source, sound_effect_handle);
      let plugin_source = crate::player::plugin_host::wrap(se_source);
      let vol_source = crate::player::equalizer::UserVolumeSource::new(plugin_source, user_volume);
      let clip_source = crate::player::equalizer::ClipGuardSource::new(vol_source);
      (
        Box::new(clip_source) as Box<dyn Source<Item = f32> + Send>,
        handle,
      )
    };

    Ok((
      Self {
        source,
        visualizer: progress.visualizer.clone(),
        progress,
        channels,
        frame_energy: 0.0,
        frame_lane: 0,
        normalizer_handle,
      },
      sample_rate,
      channels,
      preferred_depth,
    ))
  }

  /// 读取 frame_count 帧并按目标编码写入缓冲；返回音源是否已耗尽。
  pub(crate) fn read_frames_into(
    &mut self,
    frame_count: usize,
    encoding: ExclusiveEncoding,
    output: &mut Vec<u8>,
  ) -> bool {
    let mut ended = false;
    output.clear();

    for _ in 0..frame_count {
      for _ in 0..self.channels {
        let sample = match self.source.next() {
          Some(sample) => {
            self.progress.samples_played.fetch_add(1, Ordering::Relaxed);
            self.frame_energy += sample;
            self.frame_lane += 1;

            if self.frame_lane >= self.channels {
              self
                .visualizer
                .push_sample(self.frame_energy / self.frame_lane as f32);
              self.frame_energy = 0.0;
              self.frame_lane = 0;
            }

            sample
          }
          None => {
            ended = true;
            0.0
          }
        };

        encode_sample_into(output, sample, encoding);
      }
    }

    ended
  }
}

/// 把 f32 采样编码为目标格式的小端字节序列。
pub(crate) fn encode_sample_into(output: &mut Vec<u8>, sample: f32, encoding: ExclusiveEncoding) {
  let sample = sample.clamp(-1.0, 1.0);

  match encoding {
    ExclusiveEncoding::Float32 => output.extend_from_slice(&sample.to_le_bytes()),
    ExclusiveEncoding::Int32 => {
      let value = (sample * i32::MAX as f32).round() as i32;
      output.extend_from_slice(&value.to_le_bytes());
    }
    // 24bit 有效数据左对齐在 32bit 容器内。
    ExclusiveEncoding::Int32Valid24 => {
      let value = ((sample * 8_388_607.0).round() as i32) << 8;
      output.extend_from_slice(&value.to_le_bytes());
    }
    ExclusiveEncoding::Int24 => {
      let value = (sample * 8_388_607.0).round() as i32;
      output.extend_from_slice(&value.to_le_bytes()[..3]);
    }
    ExclusiveEncoding::Int16 => {
      let value = (sample * i16::MAX as f32).round() as i16;
      output.extend_from_slice(&value.to_le_bytes());
    }
  }
}

/// 从文件头探测 PCM 位深（FLAC STREAMINFO / WAVE fmt / AIFF COMM）。
pub(crate) fn probe_source_bit_depth(path: &str) -> Option<u8> {
  let mut file = File::open(path).ok()?;
  let mut head = [0u8; 64];
  let read_len = file.read(&mut head).ok()?;
  let head = &head[..read_len];
  if head.len() < 12 {
    return None;
  }

  // FLAC：STREAMINFO 的采样率/声道/位深打包字段，位深在 48bit 区域的第 24-28 位。
  if head.starts_with(b"fLaC") {
    if head.len() < 18 {
      return None;
    }
    let mut packed = 0u64;
    for &byte in &head[12..18] {
      packed = (packed << 8) | byte as u64;
    }
    return Some(((packed >> 23) & 0x1F) as u8 + 1);
  }

  // RIFF WAVE：遍历 chunk 找 "fmt "，wBitsPerSample 位于 fmt 数据偏移 14（小端）。
  if head.starts_with(b"RIFF") && &head[8..12] == b"WAVE" {
    return find_chunk_bits(head, b"fmt ", 14, false).map(|bits| bits as u8);
  }

  // AIFF：遍历 chunk 找 "COMM"，sampleSize 位于 COMM 数据偏移 8（大端）。
  if head.starts_with(b"FORM") && &head[8..12] == b"AIFF" {
    return find_chunk_bits(head, b"COMM", 8, true).map(|bits| bits as u8);
  }

  None
}

/// 通用 chunk 遍历：定位 chunk_id 并按指定偏移/字节序读取 16bit 位深字段。
pub(crate) fn find_chunk_bits(
  head: &[u8],
  chunk_id: &[u8; 4],
  field_offset: usize,
  big_endian: bool,
) -> Option<u16> {
  let mut offset = 12usize;
  while offset + 8 <= head.len() {
    if &head[offset..offset + 4] == chunk_id {
      let data = offset + 8;
      if data + field_offset + 2 <= head.len() {
        let raw = [head[data + field_offset], head[data + field_offset + 1]];
        return Some(if big_endian {
          u16::from_be_bytes(raw)
        } else {
          u16::from_le_bytes(raw)
        });
      }
      return None;
    }
    // chunk 长度字段与内容同字节序；RIFF/AIFF 均按 2 字节对齐补齐。
    let size_bytes = [
      head[offset + 4],
      head[offset + 5],
      head[offset + 6],
      head[offset + 7],
    ];
    let size = if big_endian {
      u32::from_be_bytes(size_bytes)
    } else {
      u32::from_le_bytes(size_bytes)
    } as usize;
    offset += 8 + size + (size & 1);
  }
  None
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn int32_valid24_samples_are_left_aligned_in_32_bit_container() {
    let mut output = Vec::new();

    encode_sample_into(&mut output, 0.5, ExclusiveEncoding::Int32Valid24);

    assert_eq!(output, vec![0x00, 0x00, 0x00, 0x40]);
  }
}
