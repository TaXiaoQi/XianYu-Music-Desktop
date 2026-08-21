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

const EXCLUSIVE_PERIOD_HNS: i64 = 200_000;
const EXCLUSIVE_BUFFER_MULTIPLIER: i64 = 4;

/// DoP 1.0 容器：24-bit 整型，低字节 = DSD 数据，中间字节 = 0，高字节 = 0x05/0xFA 交替。
const DOP_STORE_BITS: usize = 24;
const DOP_VALID_BITS: usize = 24;

pub(crate) struct WasapiExclusivePlayback {
    tx: Sender<ExclusiveCommand>,
    result_rx: Receiver<Result<(), String>>,
    join_handle: Option<JoinHandle<()>>,
    active_device_name: String,
}

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
    /// DSD 原生 DoP 直通开关（.dsf/.dff + WASAPI 独占生效），false 时走常规 PCM 解码
    pub dsd_native_passthrough: bool,
    /// Bit-perfect 输出：跳过响度归一化/EQ/音效/主音量等全部 DSP，仅保留解码 + 安全限幅
    pub bit_perfect: bool,
}

enum ExclusiveCommand {
    Seek { time: Duration, is_playing: bool },
    Stop,
    SetVolumeBalance { enabled: bool, target_gain: f32 },
    SetEqualizerSettings { settings: EqualizerSettings },
    SetSoundEffectSettings { settings: SoundEffectSettings },
}

impl WasapiExclusivePlayback {
    pub(crate) fn start(request: ExclusivePlayRequest) -> Result<Self, OutputError> {
        let (command_tx, command_rx) = channel::<ExclusiveCommand>();
        let (init_tx, init_rx) = sync_channel::<Result<String, String>>(1);
        let (result_tx, result_rx) = channel::<Result<(), String>>(); // 独占模式的退出消息类型

        let join_handle = thread::spawn(move || {
            let result = run_exclusive_playback(request, command_rx, init_tx);
            if let Err(error) = &result {
                eprintln!("WASAPI exclusive playback failed: {error}");
            }
            let _ = result_tx.send(result);
            deinitialize();
        });

        match init_rx.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(active_device_name)) => Ok(Self {
                tx: command_tx,
                result_rx,
                join_handle: Some(join_handle),
                active_device_name,
            }),
            Ok(Err(error)) => {
                let _ = command_tx.send(ExclusiveCommand::Stop);
                let _ = join_handle.join();
                Err(OutputError::Exclusive(error))
            }
            Err(RecvTimeoutError::Timeout) => {
                let _ = command_tx.send(ExclusiveCommand::Stop);
                Err(OutputError::Exclusive(format!(
                    "WASAPI exclusive initialization timed out after 3 seconds"
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
        let _ = self.tx.send(ExclusiveCommand::Seek { time, is_playing });
    }

    pub(crate) fn set_volume_balance(&self, enabled: bool, target_gain: f32) {
        let _ = self.tx.send(ExclusiveCommand::SetVolumeBalance {
            enabled,
            target_gain,
        });
    }

    pub(crate) fn set_equalizer_settings(&self, settings: EqualizerSettings) {
        let _ = self
            .tx
            .send(ExclusiveCommand::SetEqualizerSettings { settings });
    }

    pub(crate) fn set_sound_effect_settings(&self, settings: SoundEffectSettings) {
        let _ = self
            .tx
            .send(ExclusiveCommand::SetSoundEffectSettings { settings });
    }

    pub(crate) fn stop(&mut self) {
        let _ = self.tx.send(ExclusiveCommand::Stop);
        if let Some(join_handle) = self.join_handle.take() {
            let _ = join_handle.join();
        }
    }

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

struct ExclusiveSource {
    source: Box<dyn Source<Item = f32> + Send>,
    progress: Arc<SharedProgress>,
    visualizer: Arc<SharedVisualizer>,
    channels: u16,
    channel_sum: f32,
    channel_samples: u16,
    normalizer_handle: crate::player::loudness::VolumeNormalizerHandle,
}

#[derive(Clone, Copy)]
enum ExclusiveSampleFormat {
    Float32,
    Int32,
    Int32Valid24,
    Int24,
    Int16,
}

struct ExclusiveOutputFormat {
    wave_format: WaveFormat,
    sample_format: ExclusiveSampleFormat,
    bytes_per_frame: usize,
}

impl ExclusiveSource {
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
        // DSD 已降采样为 PCM，其逻辑位深是 32f，不参与整数直出
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
            // Bit-perfect: 跳过响度归一化/EQ/音效/主音量，仅保留解码 + 安全限幅
            let clip_source = crate::player::equalizer::ClipGuardSource::new(decoded);
            let dummy_handle =
                crate::player::loudness::GainRamp::new(1.0, sample_rate, 100).get_handle();
            (Box::new(clip_source) as Box<dyn Source<Item = f32> + Send>, dummy_handle)
        } else {
            // 常规管线: Decoder -> VolumeNormalizer -> Equalizer -> SoundEffect -> PluginHost -> UserVolumeSource -> ClipGuardSource
            let (normalized, normalizer_handle) =
                crate::player::loudness::VolumeNormalizer::new(decoded, volume_balance_gain, 100);
            let eq_source = crate::player::equalizer::Equalizer::new(normalized, equalizer_handle);
            let se_source =
                crate::player::sound_effect::SoundEffectSource::new(eq_source, sound_effect_handle);
            // VST3/CLAP 插件机架（空机架硬旁路零开销）；bit-perfect 分支不走此处
            let plugin_source = crate::player::plugin_host::wrap(se_source);
            let vol_source =
                crate::player::equalizer::UserVolumeSource::new(plugin_source, user_volume);
            let clip_source = crate::player::equalizer::ClipGuardSource::new(vol_source);
            (Box::new(clip_source) as Box<dyn Source<Item = f32> + Send>, normalizer_handle)
        };

        Ok((
            Self {
                source,
                visualizer: progress.visualizer.clone(),
                progress,
                channels,
                channel_sum: 0.0,
                channel_samples: 0,
                normalizer_handle,
            },
            sample_rate,
            channels,
            preferred_depth,
        ))
    }

    fn read_frames_into(
        &mut self,
        frame_count: usize,
        sample_format: ExclusiveSampleFormat,
        output: &mut Vec<u8>,
    ) -> bool {
        let mut ended = false;
        output.clear();

        for _ in 0..frame_count {
            for _ in 0..self.channels {
                let sample = match self.source.next() {
                    Some(sample) => {
                        self.progress.samples_played.fetch_add(1, Ordering::Relaxed);
                        self.channel_sum += sample;
                        self.channel_samples += 1;

                        if self.channel_samples >= self.channels {
                            self.visualizer
                                .push_sample(self.channel_sum / self.channel_samples as f32);
                            self.channel_sum = 0.0;
                            self.channel_samples = 0;
                        }

                        sample
                    }
                    None => {
                        ended = true;
                        0.0
                    }
                };

                // 音量平衡（VolumeNormalizer）已被移至管线最前端，
                // 在这里我们无需再做任何额外乘以 volume_balance_gain 的操作，直接将样本安全写入 WASAPI
                push_sample_bytes(output, sample, sample_format);
            }
        }

        ended
    }
}

fn push_sample_bytes(output: &mut Vec<u8>, sample: f32, sample_format: ExclusiveSampleFormat) {
    let sample = sample.clamp(-1.0, 1.0);

    match sample_format {
        ExclusiveSampleFormat::Float32 => output.extend_from_slice(&sample.to_le_bytes()),
        ExclusiveSampleFormat::Int32 => {
            let value = (sample * i32::MAX as f32).round() as i32;
            output.extend_from_slice(&value.to_le_bytes());
        }
        ExclusiveSampleFormat::Int32Valid24 => {
            let value = ((sample * 8_388_607.0).round() as i32) << 8;
            output.extend_from_slice(&value.to_le_bytes());
        }
        ExclusiveSampleFormat::Int24 => {
            let value = (sample * 8_388_607.0).round() as i32;
            output.extend_from_slice(&value.to_le_bytes()[..3]);
        }
        ExclusiveSampleFormat::Int16 => {
            let value = (sample * i16::MAX as f32).round() as i16;
            output.extend_from_slice(&value.to_le_bytes());
        }
    }
}

fn exclusive_format_candidates() -> [(usize, usize, SampleType, ExclusiveSampleFormat); 5] {
    [
        (32, 32, SampleType::Float, ExclusiveSampleFormat::Float32),
        (32, 24, SampleType::Int, ExclusiveSampleFormat::Int32Valid24),
        (24, 24, SampleType::Int, ExclusiveSampleFormat::Int24),
        (32, 32, SampleType::Int, ExclusiveSampleFormat::Int32),
        (16, 16, SampleType::Int, ExclusiveSampleFormat::Int16),
    ]
}

type ExclusiveCandidate = (usize, usize, SampleType, ExclusiveSampleFormat);

/// bit-perfect：优先按源位深尝试整数直出；fallback 到通用 Float32 优先列表。
fn negotiate_exclusive_format(
    audio_client: &wasapi::AudioClient,
    sample_rate: u32,
    channels: u16,
    preferred_depth: Option<u8>,
) -> Result<ExclusiveOutputFormat, String> {
    if let Some(depth) = preferred_depth {
        if let Some(fmt) = try_exclusive_candidates(
            audio_client,
            sample_rate,
            channels,
            &candidates_for_depth(depth),
        ) {
            return Ok(fmt);
        }
    }

    try_exclusive_candidates(
        audio_client,
        sample_rate,
        channels,
        &exclusive_format_candidates(),
    )
    .ok_or_else(|| {
        format!(
            "Unsupported WASAPI exclusive format: {sample_rate} Hz, {channels} channels"
        )
    })
}

fn try_exclusive_candidates(
    audio_client: &wasapi::AudioClient,
    sample_rate: u32,
    channels: u16,
    candidates: &[ExclusiveCandidate],
) -> Option<ExclusiveOutputFormat> {
    for (store_bits, valid_bits, sample_type, sample_format) in candidates {
        let requested_format = WaveFormat::new(
            *store_bits,
            *valid_bits,
            sample_type,
            sample_rate as usize,
            channels as usize,
            None,
        );

        if let Ok(wave_format) = audio_client.is_supported_exclusive_with_quirks(&requested_format) {
            return Some(ExclusiveOutputFormat {
                bytes_per_frame: wave_format.get_blockalign() as usize,
                wave_format,
                sample_format: *sample_format,
            });
        }
    }
    None
}

fn candidates_for_depth(depth: u8) -> Vec<ExclusiveCandidate> {
    match depth {
        16 => vec![
            (16, 16, SampleType::Int, ExclusiveSampleFormat::Int16),
            (32, 32, SampleType::Float, ExclusiveSampleFormat::Float32),
        ],
        24 => vec![
            (24, 24, SampleType::Int, ExclusiveSampleFormat::Int24),
            (32, 24, SampleType::Int, ExclusiveSampleFormat::Int32Valid24),
            (32, 32, SampleType::Int, ExclusiveSampleFormat::Int32),
            (32, 32, SampleType::Float, ExclusiveSampleFormat::Float32),
        ],
        32 => vec![
            (32, 32, SampleType::Int, ExclusiveSampleFormat::Int32),
            (32, 32, SampleType::Float, ExclusiveSampleFormat::Float32),
        ],
        _ => vec![],
    }
}

/// 探测无损容器的原生位深（FLAC/WAV/AIFF）。mp3/aac/m4a/ogg 等有损默认按 16-bit；
/// 返回 None 时走通用 Float32 优先输出。m4a(ALAC) 的 esds 嵌套解析未内置，会走默认路径。
fn probe_source_bit_depth(path: &str) -> Option<u8> {
    use std::io::Read;
    let mut file = File::open(path).ok()?;
    let mut head = [0u8; 64];
    let n = file.read(&mut head).ok()?;
    let head = &head[..n];
    if head.len() < 12 {
        return None;
    }

    // FLAC: "fLaC"，STREAMINFO 的 bits-per-sample 位于字节 12..18 的第 23..27 位
    if head.starts_with(b"fLaC") {
        if head.len() < 18 {
            return None;
        }
        let mut u = 0u64;
        for &b in &head[12..18] {
            u = (u << 8) | b as u64;
        }
        let bits = ((u >> 23) & 0x1F) as u8 + 1;
        return Some(bits);
    }

    // WAVE: RIFF....WAVE，扫 fmt 子块取每样本位数
    if head.starts_with(b"RIFF") && &head[8..12] == b"WAVE" {
        let mut off = 12usize;
        while off + 8 <= head.len() {
            if &head[off..off + 4] == b"fmt " {
                let data = off + 8;
                if data + 16 <= head.len() {
                    let bits = u16::from_le_bytes([head[data + 14], head[data + 15]]);
                    return Some(bits as u8);
                }
                return None;
            }
            let size = u32::from_le_bytes([head[off + 4], head[off + 5], head[off + 6], head[off + 7]])
                as usize;
            off += 8 + size + (size & 1);
        }
        return None;
    }

    // AIFF: FORM....AIFF，COMM 块的 sampleSize（每样本位数）
    if head.starts_with(b"FORM") && &head[8..12] == b"AIFF" {
        let mut off = 12usize;
        while off + 8 <= head.len() {
            if &head[off..off + 4] == b"COMM" {
                let data = off + 8;
                if data + 10 <= head.len() {
                    let bits = u16::from_be_bytes([head[data + 8], head[data + 9]]);
                    return Some(bits as u8);
                }
                return None;
            }
            let size = u32::from_be_bytes([head[off + 4], head[off + 5], head[off + 6], head[off + 7]])
                as usize;
            off += 8 + size + (size & 1);
        }
        return None;
    }

    None
}

/// 尝试对未压缩 DSF/DFF 走 DSD 原生 DoP 直出（WASAPI 独占、24-bit 整型、位真）。
///
/// 返回 `Ok(true)` 表示已接管并完成播放（调用方应直接返回）；`Ok(false)` 表示
/// 本文件不是 DSF/DFF / DST 压缩 / 设备不支持所需 DoP 采样率，调用方应回退到常规 PCM 路径。
///
/// DoP 是位真直出：绕过音量平衡、EQ 与音效管线，按 DoP PCM 率做计时与进度结算
/// （每 DoP 帧 = 每通道 8 个 DSD bit，帧率 = DSD 率 / 8）。
fn attempt_dop_playback(
    request: &ExclusivePlayRequest,
    command_rx: &Receiver<ExclusiveCommand>,
    init_tx: &std::sync::mpsc::SyncSender<Result<String, String>>,
) -> Result<bool, String> {
    let lower = request.path.to_lowercase();
    if !lower.ends_with(".dsf") && !lower.ends_with(".dff") {
        return Ok(false);
    }
    let info = match parse_dsd_info(&request.path) {
        Ok(info) if !info.is_dst => info,
        _ => return Ok(false), // 非 DSF/DFF / DST 压缩 / 损坏 → 回退 PCM
    };
    let dop_rate = match dop_pcm_rate(info.dsd_rate) {
        Some(rate) => rate,
        None => return Ok(false),
    };

    let enumerator = DeviceEnumerator::new().map_err(|e| e.to_string())?;
    let device = if let Some(name) = request.device_name.as_deref() {
        let collection = enumerator
            .get_device_collection(&Direction::Render)
            .map_err(|e| e.to_string())?;
        collection.get_device_with_name(name).map_err(|e| e.to_string())?
    } else {
        enumerator
            .get_default_device(&Direction::Render)
            .map_err(|e| e.to_string())?
    };
    let active_device_name = device.get_friendlyname().map_err(|e| e.to_string())?;
    let mut audio_client = device.get_iaudioclient().map_err(|e| e.to_string())?;

    // 协商 24-bit 整型 @ DoP PCM 率的独占格式（DoP 1.0 容器）
    let requested = WaveFormat::new(
        DOP_STORE_BITS,
        DOP_VALID_BITS,
        &SampleType::Int,
        dop_rate as usize,
        info.channels as usize,
        None,
    );
    let wave_format = match audio_client.is_supported_exclusive_with_quirks(&requested) {
        Ok(fmt) => fmt,
        Err(_) => return Ok(false), // 设备不支持该 DoP 采样率 → 回退 PCM
    };
    let bytes_per_frame = wave_format.get_blockalign() as usize;
    let period_hns = audio_client
        .calculate_aligned_period_near(EXCLUSIVE_PERIOD_HNS, Some(128), &wave_format)
        .unwrap_or(EXCLUSIVE_PERIOD_HNS);
    let mode = StreamMode::PollingExclusive {
        buffer_duration_hns: period_hns * EXCLUSIVE_BUFFER_MULTIPLIER,
        period_hns,
    };
    audio_client
        .initialize_client(&wave_format, &Direction::Render, &mode)
        .map_err(|e| e.to_string())?;
    let render_client = audio_client.get_audiorenderclient().map_err(|e| e.to_string())?;
    let buffer_size = audio_client.get_buffer_size().map_err(|e| e.to_string())? as usize;

    let mut source = DopStreamSource::open(&request.path, &info)?;
    let skip_frames = (request.start_time.as_secs_f64() * dop_rate as f64).round() as u64;
    let actual_start_frame = source.seek_to_frame(skip_frames)?;

    // 进度结算按 DoP PCM 率：全局位置 = samples_played / (rate × channels)
    request.progress.sample_rate.store(dop_rate, Ordering::Relaxed);
    request.progress.channels.store(info.channels as u32, Ordering::Relaxed);
    request
        .progress
        .samples_played
        .store(actual_start_frame * info.channels as u64, Ordering::Relaxed);
    request.progress.visualizer.reset();

    let mut write_buffer =
        Vec::with_capacity(buffer_size.saturating_mul(bytes_per_frame) + info.channels as usize * 3);
    initial_dop_fill(&mut source, &render_client, buffer_size, &mut write_buffer)?;

    if request.is_playing {
        audio_client.start_stream().map_err(|e| e.to_string())?;
    }
    let _ = init_tx.send(Ok(active_device_name));

    let mut is_playing = request.is_playing;
    loop {
        while let Ok(command) = command_rx.try_recv() {
            match command {
                ExclusiveCommand::Seek { time, is_playing: next_playing } => {
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
                    initial_dop_fill(&mut source, &render_client, buffer_size, &mut write_buffer)?;
                    if next_playing {
                        audio_client.start_stream().map_err(|e| e.to_string())?;
                    }
                    is_playing = next_playing;
                }
                ExclusiveCommand::Stop => {
                    let _ = audio_client.stop_stream();
                    let _ = audio_client.reset_stream();
                    return Ok(true);
                }
                // DSD 位真直出：音量平衡 / EQ / 音效均绕过，不产生实际影响，忽略。
                ExclusiveCommand::SetVolumeBalance { .. } => {}
                ExclusiveCommand::SetEqualizerSettings { .. } => {}
                ExclusiveCommand::SetSoundEffectSettings { .. } => {}
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
            let n = source.next_frames(&mut write_buffer, available)?;
            if n > 0 {
                render_client
                    .write_to_device(n, &write_buffer, None)
                    .map_err(|e| e.to_string())?;
            }
            (n, n < available)
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

/// 起播/seek 时首写一次 buffer_size 帧，确保独占流事件驱动前罐内有数据。
fn initial_dop_fill(
    source: &mut DopStreamSource,
    render_client: &wasapi::AudioRenderClient,
    buffer_size: usize,
    write_buffer: &mut Vec<u8>,
) -> Result<(), String> {
    write_buffer.clear();
    let n = source.next_frames(write_buffer, buffer_size)?;
    if n > 0 {
        render_client
            .write_to_device(n, write_buffer, None)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn run_exclusive_playback(
    request: ExclusivePlayRequest,
    command_rx: Receiver<ExclusiveCommand>,
    init_tx: std::sync::mpsc::SyncSender<Result<String, String>>,
) -> Result<(), String> {
    initialize_mta()
        .ok()
        .map_err(|error| format!("COM initialization failed: {error}"))?;

    // 初始化主音量原子浮点数快照
    request
        .user_volume
        .store(request.volume.to_bits(), Ordering::Relaxed);

    // DSD(.dsf/.dff) 原生 DoP 直出；关闭直通或不满足条件时回退到常规 PCM 路径
    if request.dsd_native_passthrough && attempt_dop_playback(&request, &command_rx, &init_tx)? {
        return Ok(());
    }

    let mut current_volume_balance_gain = request.volume_balance_gain;
    let (mut source, sample_rate, channels, preferred_depth) = ExclusiveSource::open(
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
    let device = if let Some(name) = request.device_name.as_deref() {
        let collection = enumerator
            .get_device_collection(&Direction::Render)
            .map_err(|error| error.to_string())?;
        collection
            .get_device_with_name(name)
            .map_err(|error| error.to_string())?
    } else {
        enumerator
            .get_default_device(&Direction::Render)
            .map_err(|error| error.to_string())?
    };
    let active_device_name = device
        .get_friendlyname()
        .map_err(|error| error.to_string())?;
    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|error| error.to_string())?;
    let exclusive_format =
        negotiate_exclusive_format(&audio_client, sample_rate, channels, preferred_depth)?;
    let period_hns = audio_client
        .calculate_aligned_period_near(
            EXCLUSIVE_PERIOD_HNS,
            Some(128),
            &exclusive_format.wave_format,
        )
        .unwrap_or(EXCLUSIVE_PERIOD_HNS);
    let mode = StreamMode::PollingExclusive {
        buffer_duration_hns: period_hns * EXCLUSIVE_BUFFER_MULTIPLIER,
        period_hns,
    };

    audio_client
        .initialize_client(&exclusive_format.wave_format, &Direction::Render, &mode)
        .map_err(|error| error.to_string())?;
    let render_client = audio_client
        .get_audiorenderclient()
        .map_err(|error| error.to_string())?;
    let buffer_size = audio_client
        .get_buffer_size()
        .map_err(|error| error.to_string())? as usize;

    let mut write_buffer =
        Vec::with_capacity(buffer_size.saturating_mul(exclusive_format.bytes_per_frame));
    let _ = source.read_frames_into(
        buffer_size,
        exclusive_format.sample_format,
        &mut write_buffer,
    );
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
        while let Ok(command) = command_rx.try_recv() {
            match command {
                ExclusiveCommand::Seek {
                    time,
                    is_playing: next_playing,
                } => {
                    if is_playing {
                        let _ = audio_client.stop_stream();
                    }
                    audio_client
                        .reset_stream()
                        .map_err(|error| error.to_string())?;
                    source = ExclusiveSource::open(
                        &request.path,
                        time,
                        request.progress.clone(),
                        current_volume_balance_gain,
                        request.equalizer_handle.clone(),
                        request.sound_effect_handle.clone(),
                        request.user_volume.clone(),
                        request.bit_perfect,
                    )?
                    .0;
                    let _ = source.read_frames_into(
                        buffer_size,
                        exclusive_format.sample_format,
                        &mut write_buffer,
                    );
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
                ExclusiveCommand::Stop => {
                    let _ = audio_client.stop_stream();
                    let _ = audio_client.reset_stream();
                    return Ok(());
                }
                ExclusiveCommand::SetVolumeBalance {
                    enabled,
                    target_gain,
                } => {
                    let next_gain = if enabled { target_gain } else { 1.0 };
                    current_volume_balance_gain = next_gain;
                    source.normalizer_handle.set_target_gain(next_gain);
                }
                ExclusiveCommand::SetEqualizerSettings { settings } => {
                    request.equalizer_handle.set_settings(settings);
                }
                ExclusiveCommand::SetSoundEffectSettings { settings } => {
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

        let ended = source.read_frames_into(
            available_frames,
            exclusive_format.sample_format,
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

        push_sample_bytes(&mut output, 0.5, ExclusiveSampleFormat::Int32Valid24);

        assert_eq!(output, vec![0x00, 0x00, 0x00, 0x40]);
    }

    #[test]
    fn format_candidates_prefer_32_bit_container_with_24_valid_bits() {
        let candidates = exclusive_format_candidates();

        assert_eq!(candidates[1].0, 32);
        assert_eq!(candidates[1].1, 24);
        assert!(matches!(
            candidates[1].3,
            ExclusiveSampleFormat::Int32Valid24
        ));
    }
}
