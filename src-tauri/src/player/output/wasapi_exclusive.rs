// WASAPI 独占输出：轮询独占模式，含 DSD (DoP) 原生直通尝试与 PCM 位深协商回退。
// 冻结行为：200000 hns 周期目标、4 倍缓冲、候选格式顺序、按文件头探测位深优先协商、
// DoP 失败回退 PCM、seek 重建音源失败时保留当前播放。

use crate::player::dsd_dop::{dop_pcm_rate, parse_dsd_info, DopStreamSource};
use crate::player::equalizer::{EqualizerHandle, EqualizerSettings};
use crate::player::output::OutputError;
use crate::player::sound_effect::{SoundEffectHandle, SoundEffectSettings};
use crate::player::types::{SharedProgress, SharedVisualizer};
use rodio::{Decoder, Source};
use std::fs::File;
use std::io::BufReader;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{channel, sync_channel, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use wasapi::{
    deinitialize, initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat,
};

/// 独占模式的目标周期（百纳秒单位，20ms）。
const PERIOD_TARGET_HNS: i64 = 200_000;
/// 独占缓冲长度 = 周期 × 该倍数。
const BUFFER_PERIOD_FACTOR: i64 = 4;

/// DoP 打包用的存储/有效位深（24bit PCM 容器）。
const DOP_STORE_BITS: usize = 24;
const DOP_VALID_BITS: usize = 24;

/// 初始化握手的超时秒数。
const STARTUP_HANDSHAKE_SECS: u64 = 3;

// ---------------------------------------------------------------------------
// 对外控制面
// ---------------------------------------------------------------------------

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
enum ExclusiveControl {
    Seek {
        time: Duration,
        is_playing: bool,
    },
    Stop,
    SetVolumeBalance {
        enabled: bool,
        target_gain: f32,
    },
    SetEqualizerSettings {
        settings: EqualizerSettings,
    },
    SetSoundEffectSettings {
        settings: SoundEffectSettings,
    },
}

/// 独占播放会话：命令通道 + 结果通道 + 后台线程句柄。
pub(crate) struct WasapiExclusivePlayback {
    tx: Sender<ExclusiveControl>,
    result_rx: Receiver<Result<(), String>>,
    join_handle: Option<JoinHandle<()>>,
    active_device_name: String,
}

impl WasapiExclusivePlayback {
    /// 启动独占播放线程并等待初始化握手（3 秒超时）。
    pub(crate) fn start(request: ExclusivePlayRequest) -> Result<Self, OutputError> {
        let (control_tx, control_rx) = channel::<ExclusiveControl>();
        let (init_tx, init_rx) = sync_channel::<Result<String, String>>(1);
        let (result_tx, result_rx) = channel::<Result<(), String>>();

        let join_handle = thread::spawn(move || {
            let outcome = run_exclusive_playback(request, control_rx, init_tx);
            if let Err(error) = &outcome {
                eprintln!("WASAPI exclusive playback failed: {error}");
            }
            let _ = result_tx.send(outcome);
            deinitialize();
        });

        match init_rx.recv_timeout(Duration::from_secs(STARTUP_HANDSHAKE_SECS)) {
            Ok(Ok(active_device_name)) => Ok(Self {
                tx: control_tx,
                result_rx,
                join_handle: Some(join_handle),
                active_device_name,
            }),
            Ok(Err(error)) => {
                let _ = control_tx.send(ExclusiveControl::Stop);
                let _ = join_handle.join();
                Err(OutputError::Exclusive(error))
            }
            Err(RecvTimeoutError::Timeout) => {
                let _ = control_tx.send(ExclusiveControl::Stop);
                Err(OutputError::Exclusive(format!(
                    "WASAPI exclusive initialization timed out after {STARTUP_HANDSHAKE_SECS} seconds"
                )))
            }
            Err(RecvTimeoutError::Disconnected) => {
                let _ = join_handle.join();
                Err(OutputError::Exclusive(
                    "WASAPI exclusive initialization thread disconnected".to_string(),
                ))
            }
        }
    }

    pub(crate) fn active_device_name(&self) -> &str {
        &self.active_device_name
    }

    pub(crate) fn seek(&self, time: Duration, is_playing: bool) {
        let _ = self.tx.send(ExclusiveControl::Seek { time, is_playing });
    }

    pub(crate) fn set_volume_balance(&self, enabled: bool, target_gain: f32) {
        let _ = self.tx.send(ExclusiveControl::SetVolumeBalance {
            enabled,
            target_gain,
        });
    }

    pub(crate) fn set_equalizer_settings(&self, settings: EqualizerSettings) {
        let _ = self.tx.send(ExclusiveControl::SetEqualizerSettings { settings });
    }

    pub(crate) fn set_sound_effect_settings(&self, settings: SoundEffectSettings) {
        let _ = self
            .tx
            .send(ExclusiveControl::SetSoundEffectSettings { settings });
    }

    /// 请求停止并等待线程退出。
    pub(crate) fn stop(&mut self) {
        let _ = self.tx.send(ExclusiveControl::Stop);
        if let Some(join_handle) = self.join_handle.take() {
            let _ = join_handle.join();
        }
    }

    /// 非阻塞探测播放线程是否已结束（Err 表示异常退出）。
    pub(crate) fn try_finished(&self) -> Option<Result<(), String>> {
        match self.result_rx.try_recv() {
            Ok(result) => Some(result),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => Some(Err(
                "WASAPI exclusive playback thread disconnected".to_string(),
            )),
        }
    }
}

impl Drop for WasapiExclusivePlayback {
    fn drop(&mut self) {
        self.stop();
    }
}

// ---------------------------------------------------------------------------
// PCM 音源装配
// ---------------------------------------------------------------------------

/// 独占输出使用的采样编码。
#[derive(Clone, Copy)]
enum ExclusiveEncoding {
    Float32,
    Int32,
    Int32Valid24,
    Int24,
    Int16,
}

/// 协商成功后的输出格式描述。
struct NegotiatedFormat {
    wave_format: WaveFormat,
    encoding: ExclusiveEncoding,
    bytes_per_frame: usize,
}

/// 独占播放的解码音源：负责进度统计、可视化喂料与逐帧编码。
struct ExclusiveAudioFeed {
    source: Box<dyn Source<Item = f32> + Send>,
    progress: Arc<SharedProgress>,
    visualizer: Arc<SharedVisualizer>,
    channels: u16,
    frame_energy: f32,
    frame_lane: u16,
    normalizer_handle: crate::player::loudness::VolumeNormalizerHandle,
}

impl ExclusiveAudioFeed {
    /// 打开文件并组装源链；bit-perfect 时只保留限幅器与哑归一化句柄。
    #[allow(clippy::too_many_arguments)]
    fn open(
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
            let placeholder =
                crate::player::loudness::GainRamp::new(1.0, sample_rate, 100).get_handle();
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
            let vol_source =
                crate::player::equalizer::UserVolumeSource::new(plugin_source, user_volume);
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
    fn read_frames_into(
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
                            self.visualizer
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
fn encode_sample_into(output: &mut Vec<u8>, sample: f32, encoding: ExclusiveEncoding) {
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

// ---------------------------------------------------------------------------
// 格式协商
// ---------------------------------------------------------------------------

/// 位深候选表：(存储位深, 有效位深, 采样类型, 编码)。
type EncodingCandidate = (usize, usize, SampleType, ExclusiveEncoding);

/// 全量候选顺序：浮点 → 32bit 容器 24 有效 → 24bit → 32bit 整型 → 16bit。
fn full_candidate_table() -> [EncodingCandidate; 5] {
    [
        (32, 32, SampleType::Float, ExclusiveEncoding::Float32),
        (32, 24, SampleType::Int, ExclusiveEncoding::Int32Valid24),
        (24, 24, SampleType::Int, ExclusiveEncoding::Int24),
        (32, 32, SampleType::Int, ExclusiveEncoding::Int32),
        (16, 16, SampleType::Int, ExclusiveEncoding::Int16),
    ]
}

/// 依源文件位深挑选的优先候选。
fn depth_candidate_list(depth: u8) -> Vec<EncodingCandidate> {
    match depth {
        16 => vec![
            (16, 16, SampleType::Int, ExclusiveEncoding::Int16),
            (32, 32, SampleType::Float, ExclusiveEncoding::Float32),
        ],
        24 => vec![
            (24, 24, SampleType::Int, ExclusiveEncoding::Int24),
            (32, 24, SampleType::Int, ExclusiveEncoding::Int32Valid24),
            (32, 32, SampleType::Int, ExclusiveEncoding::Int32),
            (32, 32, SampleType::Float, ExclusiveEncoding::Float32),
        ],
        32 => vec![
            (32, 32, SampleType::Int, ExclusiveEncoding::Int32),
            (32, 32, SampleType::Float, ExclusiveEncoding::Float32),
        ],
        _ => vec![],
    }
}

/// 依序尝试候选格式，返回首个被设备接受的。
fn try_candidate_list(
    audio_client: &wasapi::AudioClient,
    sample_rate: u32,
    channels: u16,
    candidates: &[EncodingCandidate],
) -> Option<NegotiatedFormat> {
    for &(store_bits, valid_bits, sample_type, encoding) in candidates {
        let requested = WaveFormat::new(
            store_bits,
            valid_bits,
            &sample_type,
            sample_rate as usize,
            channels as usize,
            None,
        );

        if let Ok(wave_format) = audio_client.is_supported_exclusive_with_quirks(&requested) {
            return Some(NegotiatedFormat {
                bytes_per_frame: wave_format.get_blockalign() as usize,
                wave_format,
                encoding,
            });
        }
    }
    None
}

/// 先按源位深候选协商，失败再退回全量候选表。
fn negotiate_exclusive_format(
    audio_client: &wasapi::AudioClient,
    sample_rate: u32,
    channels: u16,
    preferred_depth: Option<u8>,
) -> Result<NegotiatedFormat, String> {
    if let Some(depth) = preferred_depth {
        if let Some(found) = try_candidate_list(
            audio_client,
            sample_rate,
            channels,
            &depth_candidate_list(depth),
        ) {
            return Ok(found);
        }
    }

    try_candidate_list(
        audio_client,
        sample_rate,
        channels,
        &full_candidate_table(),
    )
    .ok_or_else(|| {
        format!("Unsupported WASAPI exclusive format: {sample_rate} Hz, {channels} channels")
    })
}

/// 从文件头探测 PCM 位深（FLAC STREAMINFO / WAVE fmt / AIFF COMM）。
fn probe_source_bit_depth(path: &str) -> Option<u8> {
    use std::io::Read;
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
fn find_chunk_bits(head: &[u8], chunk_id: &[u8; 4], field_offset: usize, big_endian: bool) -> Option<u16> {
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
        let size_bytes = [head[offset + 4], head[offset + 5], head[offset + 6], head[offset + 7]];
        let size = if big_endian {
            u32::from_be_bytes(size_bytes)
        } else {
            u32::from_le_bytes(size_bytes)
        } as usize;
        offset += 8 + size + (size & 1);
    }
    None
}

// ---------------------------------------------------------------------------
// DoP 原生直通
// ---------------------------------------------------------------------------

/// DSD 文件的 DoP 直通尝试。返回 Ok(true) 表示已由本路径完整接管播放。
fn attempt_dop_playback(
    request: &ExclusivePlayRequest,
    control_rx: &Receiver<ExclusiveControl>,
    init_tx: &std::sync::mpsc::SyncSender<Result<String, String>>,
) -> Result<bool, String> {
    let lower = request.path.to_lowercase();
    if !lower.ends_with(".dsf") && !lower.ends_with(".dff") {
        return Ok(false);
    }
    let info = match parse_dsd_info(&request.path) {
        Ok(info) if !info.is_dst => info,
        _ => return Ok(false),
    };
    let Some(dop_rate) = dop_pcm_rate(info.dsd_rate) else {
        return Ok(false);
    };

    let enumerator = DeviceEnumerator::new().map_err(|e| e.to_string())?;
    let device = open_render_device(&enumerator, request.device_name.as_deref())?;
    let active_device_name = device.get_friendlyname().map_err(|e| e.to_string())?;
    let mut audio_client = device.get_iaudioclient().map_err(|e| e.to_string())?;

    let requested = WaveFormat::new(
        DOP_STORE_BITS,
        DOP_VALID_BITS,
        &SampleType::Int,
        dop_rate as usize,
        info.channels as usize,
        None,
    );
    // 设备不支持该 DoP 速率时放弃直通，交回 PCM 路径。
    let Ok(wave_format) = audio_client.is_supported_exclusive_with_quirks(&requested) else {
        return Ok(false);
    };
    let bytes_per_frame = wave_format.get_blockalign() as usize;
    let (period_hns, buffer_hns) = aligned_period(&audio_client, &wave_format);
    let mode = StreamMode::PollingExclusive {
        buffer_duration_hns: buffer_hns,
        period_hns,
    };
    audio_client
        .initialize_client(&wave_format, &Direction::Render, &mode)
        .map_err(|e| e.to_string())?;
    let render_client = audio_client
        .get_audiorenderclient()
        .map_err(|e| e.to_string())?;
    let buffer_size = audio_client.get_buffer_size().map_err(|e| e.to_string())? as usize;

    let mut source = DopStreamSource::open(&request.path, &info)?;
    let skip_frames = (request.start_time.as_secs_f64() * dop_rate as f64).round() as u64;
    let actual_start_frame = source.seek_to_frame(skip_frames)?;

    request
        .progress
        .sample_rate
        .store(dop_rate, Ordering::Relaxed);
    request
        .progress
        .channels
        .store(info.channels as u32, Ordering::Relaxed);
    request
        .progress
        .samples_played
        .store(actual_start_frame * info.channels as u64, Ordering::Relaxed);
    request.progress.visualizer.reset();

    let mut write_buffer = Vec::with_capacity(
        buffer_size.saturating_mul(bytes_per_frame) + info.channels as usize * 3,
    );
    prime_dop_buffer(&mut source, &render_client, buffer_size, &mut write_buffer)?;

    if request.is_playing {
        audio_client.start_stream().map_err(|e| e.to_string())?;
    }
    let _ = init_tx.send(Ok(active_device_name));

    let mut is_playing = request.is_playing;
    loop {
        while let Ok(command) = control_rx.try_recv() {
            match command {
                ExclusiveControl::Seek {
                    time,
                    is_playing: next_playing,
                } => {
                    if is_playing {
                        let _ = audio_client.stop_stream();
                    }
                    audio_client.reset_stream().map_err(|e| e.to_string())?;
                    let target_frame = (time.as_secs_f64() * dop_rate as f64).round() as u64;
                    let frame = source.seek_to_frame(target_frame)?;
                    request
                        .progress
                        .samples_played
                        .store(frame * info.channels as u64, Ordering::Relaxed);
                    prime_dop_buffer(&mut source, &render_client, buffer_size, &mut write_buffer)?;
                    if next_playing {
                        audio_client.start_stream().map_err(|e| e.to_string())?;
                    }
                    is_playing = next_playing;
                }
                ExclusiveControl::Stop => {
                    let _ = audio_client.stop_stream();
                    let _ = audio_client.reset_stream();
                    return Ok(true);
                }
                // DoP 直通不经过 DSP 链，参数类命令忽略。
                ExclusiveControl::SetVolumeBalance { .. } => {}
                ExclusiveControl::SetEqualizerSettings { .. } => {}
                ExclusiveControl::SetSoundEffectSettings { .. } => {}
            }
        }

        if !is_playing {
            thread::sleep(Duration::from_millis(20));
            continue;
        }

        let available = audio_client
            .get_available_space_in_frames()
            .map_err(|e| e.to_string())? as usize;
        if available == 0 {
            thread::sleep(Duration::from_millis(5));
            continue;
        }

        write_buffer.clear();
        let (wrote, ended) = {
            let frames = source.next_frames(&mut write_buffer, available)?;
            if frames > 0 {
                render_client
                    .write_to_device(frames, &write_buffer, None)
                    .map_err(|e| e.to_string())?;
            }
            (frames, frames < available)
        };
        request
            .progress
            .samples_played
            .fetch_add(wrote as u64 * info.channels as u64, Ordering::Relaxed);

        if ended {
            let _ = audio_client.stop_stream();
            return Ok(true);
        }
    }
}

/// 预填一轮独占缓冲。
fn prime_dop_buffer(
    source: &mut DopStreamSource,
    render_client: &wasapi::AudioRenderClient,
    buffer_size: usize,
    write_buffer: &mut Vec<u8>,
) -> Result<(), String> {
    write_buffer.clear();
    let frames = source.next_frames(write_buffer, buffer_size)?;
    if frames > 0 {
        render_client
            .write_to_device(frames, write_buffer, None)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 按名称或默认规则挑选渲染设备。
fn open_render_device(
    enumerator: &DeviceEnumerator,
    device_name: Option<&str>,
) -> Result<wasapi::Device, String> {
    if let Some(name) = device_name {
        let collection = enumerator
            .get_device_collection(&Direction::Render)
            .map_err(|error| error.to_string())?;
        collection
            .get_device_with_name(name)
            .map_err(|error| error.to_string())
    } else {
        enumerator
            .get_default_device(&Direction::Render)
            .map_err(|error| error.to_string())
    }
}

/// 计算对齐后的周期与缓冲时长；失败时退回目标周期常量。
fn aligned_period(audio_client: &wasapi::AudioClient, wave_format: &WaveFormat) -> (i64, i64) {
    let period = audio_client
        .calculate_aligned_period_near(PERIOD_TARGET_HNS, Some(128), wave_format)
        .unwrap_or(PERIOD_TARGET_HNS);
    (period, period * BUFFER_PERIOD_FACTOR)
}

// ---------------------------------------------------------------------------
// 主播放循环
// ---------------------------------------------------------------------------

fn run_exclusive_playback(
    request: ExclusivePlayRequest,
    control_rx: Receiver<ExclusiveControl>,
    init_tx: std::sync::mpsc::SyncSender<Result<String, String>>,
) -> Result<(), String> {
    initialize_mta()
        .ok()
        .map_err(|error| format!("COM initialization failed: {error}"))?;

    request
        .user_volume
        .store(request.volume.to_bits(), Ordering::Relaxed);

    // DSD 原生直通优先；成功接管则直接返回。
    if request.dsd_native_passthrough && attempt_dop_playback(&request, &control_rx, &init_tx)? {
        return Ok(());
    }

    let mut current_volume_balance_gain = request.volume_balance_gain;
    let (mut feed, sample_rate, channels, preferred_depth) = ExclusiveAudioFeed::open(
        &request.path,
        request.start_time,
        request.progress.clone(),
        current_volume_balance_gain,
        request.equalizer_handle.clone(),
        request.sound_effect_handle.clone(),
        request.user_volume.clone(),
        request.bit_perfect,
    )?;

    let enumerator = DeviceEnumerator::new().map_err(|error| error.to_string())?;
    let device = open_render_device(&enumerator, request.device_name.as_deref())?;
    let active_device_name = device
        .get_friendlyname()
        .map_err(|error| error.to_string())?;
    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|error| error.to_string())?;
    let negotiated = negotiate_exclusive_format(&audio_client, sample_rate, channels, preferred_depth)?;
    let (period_hns, buffer_hns) = aligned_period(&audio_client, &negotiated.wave_format);
    let mode = StreamMode::PollingExclusive {
        buffer_duration_hns: buffer_hns,
        period_hns,
    };

    audio_client
        .initialize_client(&negotiated.wave_format, &Direction::Render, &mode)
        .map_err(|error| error.to_string())?;
    let render_client = audio_client
        .get_audiorenderclient()
        .map_err(|error| error.to_string())?;
    let buffer_size = audio_client
        .get_buffer_size()
        .map_err(|error| error.to_string())? as usize;

    let mut write_buffer =
        Vec::with_capacity(buffer_size.saturating_mul(negotiated.bytes_per_frame));
    // 首轮预填失败可容忍（缓冲内含静音也能起播）。
    let _ = feed.read_frames_into(buffer_size, negotiated.encoding, &mut write_buffer);
    render_client
        .write_to_device(buffer_size, &write_buffer, None)
        .map_err(|error| error.to_string())?;

    if request.is_playing {
        audio_client
            .start_stream()
            .map_err(|error| error.to_string())?;
    }

    let _ = init_tx.send(Ok(active_device_name));

    let mut is_playing = request.is_playing;

    loop {
        while let Ok(command) = control_rx.try_recv() {
            match command {
                ExclusiveControl::Seek {
                    time,
                    is_playing: next_playing,
                } => {
                    // seek 通过整体重建音源实现，重建失败则维持现状继续播。
                    let reopened = ExclusiveAudioFeed::open(
                        &request.path,
                        time,
                        request.progress.clone(),
                        current_volume_balance_gain,
                        request.equalizer_handle.clone(),
                        request.sound_effect_handle.clone(),
                        request.user_volume.clone(),
                        request.bit_perfect,
                    );
                    match reopened {
                        Ok((next_feed, _, _, _)) => {
                            if is_playing {
                                let _ = audio_client.stop_stream();
                            }
                            audio_client
                                .reset_stream()
                                .map_err(|error| error.to_string())?;
                            feed = next_feed;
                            let _ =
                                feed.read_frames_into(buffer_size, negotiated.encoding, &mut write_buffer);
                            render_client
                                .write_to_device(buffer_size, &write_buffer, None)
                                .map_err(|error| error.to_string())?;
                            if next_playing {
                                audio_client
                                    .start_stream()
                                    .map_err(|error| error.to_string())?;
                            }
                            is_playing = next_playing;
                        }
                        Err(error) => {
                            eprintln!(
                                "[wasapi_exclusive] seek 打开新音源失败，保留当前播放: {error}"
                            );
                        }
                    }
                }
                ExclusiveControl::Stop => {
                    let _ = audio_client.stop_stream();
                    let _ = audio_client.reset_stream();
                    return Ok(());
                }
                ExclusiveControl::SetVolumeBalance {
                    enabled,
                    target_gain,
                } => {
                    let next_gain = if enabled { target_gain } else { 1.0 };
                    current_volume_balance_gain = next_gain;
                    feed.normalizer_handle.set_target_gain(next_gain);
                }
                ExclusiveControl::SetEqualizerSettings { settings } => {
                    request.equalizer_handle.set_settings(settings);
                }
                ExclusiveControl::SetSoundEffectSettings { settings } => {
                    request.sound_effect_handle.set_settings(settings);
                }
            }
        }

        if !is_playing {
            thread::sleep(Duration::from_millis(20));
            continue;
        }

        let available_frames = audio_client
            .get_available_space_in_frames()
            .map_err(|error| error.to_string())? as usize;
        if available_frames == 0 {
            thread::sleep(Duration::from_millis(5));
            continue;
        }

        let ended = feed.read_frames_into(
            available_frames,
            negotiated.encoding,
            &mut write_buffer,
        );
        render_client
            .write_to_device(available_frames, &write_buffer, None)
            .map_err(|error| error.to_string())?;

        if ended {
            let _ = audio_client.stop_stream();
            return Ok(());
        }
    }
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

    #[test]
    fn format_candidates_prefer_32_bit_container_with_24_valid_bits() {
        let candidates = full_candidate_table();

        assert_eq!(candidates[1].0, 32);
        assert_eq!(candidates[1].1, 24);
        assert!(matches!(
            candidates[1].3,
            ExclusiveEncoding::Int32Valid24
        ));
    }
}
