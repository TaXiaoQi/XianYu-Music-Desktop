//! USB/WASAPI 独占模式播放
//!
//! 功能：
//! - 通过 WASAPI PollingExclusive 模式独占音频设备（绕过系统混音器）
//! - 支持音效链（EQ/混响/环绕/变调）
//! - 设备冲突检测与详细错误日志
//! - 位完美输出

use crate::player::effects::{EffectChain, EffectParams};
use crate::player::output::OutputError;
use crate::player::types::{SharedProgress, SharedVisualizer};
use rodio::{Decoder, Source};
use std::fs::File;
use std::io::BufReader;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, sync_channel, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use wasapi::{
    deinitialize, initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat,
};

// 独占模式常量
const EXCLUSIVE_PERIOD_HNS: i64 = 200_000;
const EXCLUSIVE_BUFFER_MULTIPLIER: i64 = 4;

// AUDCLNT_E_DEVICE_IN_USE (0x8889000A) — 设备已被其他应用独占
const DEVICE_IN_USE_HRESULT: i32 = 0x8889_000Au32 as i32;

// [测试] 设为 true 时生成 1kHz 正弦波，绕过文件解码和 EffectChain，直接测试 WASAPI 独占路径
const SINE_TEST_MODE: bool = false;
const SINE_FREQ_HZ: f32 = 1000.0;

// ===== 结构体定义 =====

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
    /// [USB 独占模式] 共享音效参数，运行时可通过 set_audio_effects 命令更新
    pub effect_params: Arc<Mutex<EffectParams>>,
}

enum ExclusiveCommand {
    Pause,
    Resume,
    Seek { time: Duration, is_playing: bool },
    Stop,
    SetVolume(f32),
    /// [USB 独占模式] 同步音效参数到 EffectChain
    SyncEffects,
}

// ===== WasapiExclusivePlayback 实现 =====

impl WasapiExclusivePlayback {
    /// 启动 WASAPI 独占播放
    ///
    /// 创建一个独立线程执行播放循环：
    /// 1. 初始化 COM MTA
    /// 2. 打开音频文件并解码
    /// 3. 枚举/选择音频设备
    /// 4. 协商独占格式并初始化客户端
    /// 5. 进入命令处理 + 音频数据推送主循环
    pub(crate) fn start(request: ExclusivePlayRequest) -> Result<Self, OutputError> {
        let (command_tx, command_rx) = channel::<ExclusiveCommand>();
        let (init_tx, init_rx) = sync_channel::<Result<String, String>>(1);
        let (result_tx, result_rx) = channel::<Result<(), String>>();

        let path_debug = request.path.clone();
        let device_debug = request.device_name.clone();

        let join_handle = thread::spawn(move || {
            eprintln!(
                "[WASAPI Exclusive] Playback thread started | path='{path_debug}' | device='{:?}'",
                device_debug
            );
            let result = run_exclusive_playback(request, command_rx, init_tx);
            if let Err(error) = &result {
                eprintln!(
                    "[WASAPI Exclusive] Playback thread FAILED | path='{path_debug}' | error={error}"
                );
            } else {
                eprintln!(
                    "[WASAPI Exclusive] Playback thread ended normally | path='{path_debug}'"
                );
            }
            let _ = result_tx.send(result);
            // SAFETY: deinitialize() 必须在 COM 初始化线程调用
            deinitialize();
            eprintln!("[WASAPI Exclusive] COM deinitialized");
        });

        // 等待播放线程初始化完成，超时 5 秒
        match init_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(active_device_name)) => {
                eprintln!(
                    "[WASAPI Exclusive] Initialization SUCCESS | device='{active_device_name}'"
                );
                Ok(Self {
                    tx: command_tx,
                    result_rx,
                    join_handle: Some(join_handle),
                    active_device_name,
                })
            }
            Ok(Err(error)) => {
                let is_device_in_use = is_device_in_use_error(&error);
                eprintln!(
                    "[WASAPI Exclusive] Initialization FAILED | device_in_use={is_device_in_use} | error='{error}'"
                );
                let _ = command_tx.send(ExclusiveCommand::Stop);
                let _ = join_handle.join();
                Err(OutputError::Exclusive(error))
            }
            Err(RecvTimeoutError::Timeout) => {
                eprintln!("[WASAPI Exclusive] Initialization TIMEOUT (5s)");
                let _ = command_tx.send(ExclusiveCommand::Stop);
                Err(OutputError::Exclusive(
                    "WASAPI exclusive initialization timed out after 5 seconds".to_string(),
                ))
            }
            Err(RecvTimeoutError::Disconnected) => {
                eprintln!("[WASAPI Exclusive] Initialization thread DISCONNECTED");
                let _ = join_handle.join();
                Err(OutputError::Exclusive(
                    "WASAPI exclusive initialization thread disconnected".to_string(),
                ))
            }
        }
    }

    // ── 控制方法 ──

    pub(crate) fn active_device_name(&self) -> &str {
        &self.active_device_name
    }

    pub(crate) fn pause(&self) {
        eprintln!("[WASAPI Exclusive] Command: Pause");
        let _ = self.tx.send(ExclusiveCommand::Pause);
    }

    pub(crate) fn resume(&self) {
        eprintln!("[WASAPI Exclusive] Command: Resume");
        let _ = self.tx.send(ExclusiveCommand::Resume);
    }

    pub(crate) fn seek(&self, time: Duration, is_playing: bool) {
        eprintln!(
            "[WASAPI Exclusive] Command: Seek time={:.3}s is_playing={is_playing}",
            time.as_secs_f64()
        );
        let _ = self.tx.send(ExclusiveCommand::Seek { time, is_playing });
    }

    pub(crate) fn set_volume(&self, volume: f32) {
        let _ = self.tx.send(ExclusiveCommand::SetVolume(volume));
    }

    /// [USB 独占模式] 通知播放线程同步最新的音效参数
    pub(crate) fn sync_effects(&self) {
        let _ = self.tx.send(ExclusiveCommand::SyncEffects);
    }

    pub(crate) fn stop(&mut self) {
        eprintln!("[WASAPI Exclusive] Command: Stop");
        let _ = self.tx.send(ExclusiveCommand::Stop);
        if let Some(join_handle) = self.join_handle.take() {
            let _ = join_handle.join();
        }
    }

    /// 非阻塞检查播放线程是否已结束
    pub(crate) fn try_finished(&self) -> Option<Result<(), String>> {
        match self.result_rx.try_recv() {
            Ok(result) => Some(result),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => {
                eprintln!("[WASAPI Exclusive] Playback thread disconnected");
                Some(Err(
                    "WASAPI exclusive playback thread disconnected".to_string(),
                ))
            }
        }
    }
}

impl Drop for WasapiExclusivePlayback {
    fn drop(&mut self) {
        self.stop();
    }
}

// ===== ExclusiveSource =====

struct ExclusiveSource {
    source: Box<dyn Source<Item = f32> + Send>,
    progress: Arc<SharedProgress>,
    visualizer: Arc<SharedVisualizer>,
    channels: u16,
    channel_sum: f32,
    channel_samples: u16,
    /// [USB 独占模式] 音效链
    effect_chain: Option<EffectChain>,
    /// [USB 独占模式] 待写入设备的样本缓冲
    pending_samples: Vec<f32>,
    /// [USB 独占模式] pending_samples 的读取位置
    pending_read_pos: usize,
    /// [测试] 正弦波相位累计器
    sine_phase: f32,
    sine_sample_rate: u32,
    sine_samples_generated: u64,
}

#[derive(Clone, Copy, Debug)]
enum ExclusiveSampleFormat {
    Float32,
    Int32,
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
        effect_params: Arc<Mutex<EffectParams>>,
    ) -> Result<(Self, u32, u16), String> {
        eprintln!("[WASAPI Exclusive] Opening audio file: '{path}'");

        let file = File::open(path).map_err(|error| {
            eprintln!("[WASAPI Exclusive] File open FAILED: '{path}' | {error}");
            error.to_string()
        })?;

        let reader = BufReader::with_capacity(512 * 1024, file);
        let decoder = Decoder::new(reader).map_err(|error| {
            eprintln!("[WASAPI Exclusive] Decoder creation FAILED: '{path}' | {error}");
            error.to_string()
        })?;

        let sample_rate = decoder.sample_rate();
        let channels = decoder.channels();

        eprintln!(
            "[WASAPI Exclusive] File opened: sample_rate={sample_rate}Hz channels={channels}"
        );

        let samples_at_target =
            (start_time.as_secs_f64() * sample_rate as f64 * channels as f64).round() as u64;

        progress.sample_rate.store(sample_rate, Ordering::Relaxed);
        progress.channels.store(channels as u32, Ordering::Relaxed);
        progress
            .samples_played
            .store(samples_at_target, Ordering::Relaxed);
        progress.visualizer.reset();

        // [USB 独占模式] 创建音效链
        let _effect_chain = EffectChain::new(effect_params, channels, sample_rate);

        Ok((
            Self {
                source: Box::new(decoder.convert_samples::<f32>().skip_duration(start_time)),
                visualizer: progress.visualizer.clone(),
                progress,
                channels,
                channel_sum: 0.0,
                channel_samples: 0,
                // [测试] 暂时禁用 EffectChain，直通原始音频路径测试 WASAPI 流是否正常
                effect_chain: None,
                pending_samples: Vec::new(),
                pending_read_pos: 0,
                sine_phase: 0.0,
                sine_sample_rate: sample_rate,
                sine_samples_generated: 0,
            },
            sample_rate,
            channels,
        ))
    }

    fn sync_effects(&mut self) {
        if let Some(chain) = &mut self.effect_chain {
            chain.sync_params();
        }
    }

    /// [测试] 生成下一个正弦波采样值 (1kHz @ full scale)
    fn next_sine_sample(&mut self) -> f32 {
        let phase_increment = SINE_FREQ_HZ / self.sine_sample_rate as f32;
        let sample = (self.sine_phase * std::f32::consts::TAU).sin();
        self.sine_phase = (self.sine_phase + phase_increment).fract();
        self.sine_samples_generated += 1;
        // 振幅 0.8，避免削波
        sample * 0.8
    }

    fn read_raw_sample(&mut self) -> Option<f32> {
        let sample = self.source.next();
        if let Some(value) = sample {
            self.progress.samples_played.fetch_add(1, Ordering::Relaxed);
            self.channel_sum += value;
            self.channel_samples += 1;

            if self.channel_samples >= self.channels {
                self.visualizer
                    .push_sample(self.channel_sum / self.channel_samples as f32);
                self.channel_sum = 0.0;
                self.channel_samples = 0;
            }

            // 仅打印首个样本用于诊断
            static FIRST_SAMPLE_LOGGED: AtomicBool = AtomicBool::new(false);
            if !FIRST_SAMPLE_LOGGED.swap(true, Ordering::Relaxed) {
                eprintln!("[WASAPI Exclusive] First raw sample: {value:.6}");
            }
        }
        sample
    }

    fn read_frames_into(
        &mut self,
        frame_count: usize,
        volume: f32,
        sample_format: ExclusiveSampleFormat,
        output: &mut Vec<u8>,
    ) -> bool {
        let channels = self.channels as usize;
        let target_samples = frame_count.saturating_mul(channels);
        let bytes_per_sample = Self::bytes_per_sample(sample_format);
        let target_bytes = target_samples * bytes_per_sample;
        output.clear();

        if self.effect_chain.is_some() {
            let mut source_exhausted = false;

            while output.len() < target_bytes {
                if self.pending_read_pos < self.pending_samples.len() {
                    let remaining_bytes_needed = target_bytes - output.len();
                    let remaining_samples_needed = remaining_bytes_needed / bytes_per_sample;
                    let available = self.pending_samples.len() - self.pending_read_pos;
                    let to_write = remaining_samples_needed.min(available);

                    for i in 0..to_write {
                        let sample = self.pending_samples[self.pending_read_pos + i];
                        push_sample_bytes(output, sample, sample_format);
                    }
                    self.pending_read_pos += to_write;
                    continue;
                }

                let chunk_frames = frame_count.max(64);
                let mut raw_buffer: Vec<f32> = Vec::with_capacity(chunk_frames * channels);
                let mut ended = false;

                for _ in 0..chunk_frames {
                    for _ in 0..channels {
                        match self.read_raw_sample() {
                            Some(sample) => raw_buffer.push(sample),
                            None => {
                                ended = true;
                                raw_buffer.push(0.0);
                            }
                        }
                    }
                    if ended {
                        source_exhausted = true;
                        break;
                    }
                }

                if raw_buffer.is_empty() {
                    return true;
                }

                let processed = if let Some(chain) = &mut self.effect_chain {
                    let result = chain.process(&raw_buffer);
                    result.iter().map(|&s| s * volume).collect::<Vec<f32>>()
                } else {
                    raw_buffer.iter().map(|&s| s * volume).collect()
                };

                self.pending_samples = processed;
                self.pending_read_pos = 0;

                if self.pending_samples.is_empty() && source_exhausted {
                    return true;
                }
            }

            source_exhausted && self.pending_read_pos >= self.pending_samples.len()
        } else if SINE_TEST_MODE {
            // [测试] 生成 1kHz 正弦波，直接写入 WASAPI 缓冲区
            let sample_count = target_samples;
            let max_duration_samples = self.sine_sample_rate as u64 * 10; // 最多 10 秒
            let ended = self.sine_samples_generated >= max_duration_samples;

            for _ in 0..sample_count {
                if ended {
                    push_sample_bytes(output, 0.0, sample_format);
                } else {
                    let sample = self.next_sine_sample();
                    push_sample_bytes(output, sample * volume, sample_format);
                }
            }
            ended
        } else {
            let sample_count = target_samples;
            let mut ended = false;

            for _ in 0..sample_count {
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
                push_sample_bytes(output, sample * volume, sample_format);
            }
            ended
        }
    }

    fn bytes_per_sample(sample_format: ExclusiveSampleFormat) -> usize {
        match sample_format {
            ExclusiveSampleFormat::Float32 => 4,
            ExclusiveSampleFormat::Int32 => 4,
            ExclusiveSampleFormat::Int24 => 3,
            ExclusiveSampleFormat::Int16 => 2,
        }
    }
}

// ===== 辅助函数 =====

fn push_sample_bytes(output: &mut Vec<u8>, sample: f32, sample_format: ExclusiveSampleFormat) {
    let sample = sample.clamp(-1.0, 1.0);

    match sample_format {
        ExclusiveSampleFormat::Float32 => output.extend_from_slice(&sample.to_le_bytes()),
        ExclusiveSampleFormat::Int32 => {
            let value = (sample * i32::MAX as f32).round() as i32;
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

/// 检测错误是否为 "设备被占用" (AUDCLNT_E_DEVICE_IN_USE = 0x8889000A)
pub(crate) fn is_device_in_use_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("device in use")
        || lower.contains("exclusive mode not allowed")
        || error.contains(&format!("{:#x}", DEVICE_IN_USE_HRESULT))
        || error.contains("8889000a")
        || error.contains("8889000A")
}

// ===== 格式协商 =====

fn negotiate_exclusive_format(
    audio_client: &wasapi::AudioClient,
    sample_rate: u32,
    channels: u16,
) -> Result<ExclusiveOutputFormat, String> {
    eprintln!(
        "[WASAPI Exclusive] Negotiating format: sample_rate={sample_rate}Hz channels={channels}"
    );

    // [修复防御] 重排优先级：Float32 → Int16 → Int24 → Int32
    // Int32 在很多 USB DAC 上虽然被 wasapi API 接受，但硬件实际不播放
    let candidates: &[(usize, usize, SampleType, ExclusiveSampleFormat, &str)] = &[
        (32, 32, SampleType::Float, ExclusiveSampleFormat::Float32, "Float32"),
        (16, 16, SampleType::Int, ExclusiveSampleFormat::Int16, "Int16"),
        (24, 24, SampleType::Int, ExclusiveSampleFormat::Int24, "Int24"),
        (32, 32, SampleType::Int, ExclusiveSampleFormat::Int32, "Int32"),
    ];

    for (store_bits, valid_bits, sample_type, sample_format, label) in candidates {
        let requested_format = WaveFormat::new(
            *store_bits,
            *valid_bits,
            sample_type,
            sample_rate as usize,
            channels as usize,
            None,
        );

        match audio_client.is_supported_exclusive_with_quirks(&requested_format) {
            Ok(wave_format) => {
                eprintln!(
                    "[WASAPI Exclusive] Format ACCEPTED: {label} {}bit | block_align={}",
                    valid_bits,
                    wave_format.get_blockalign()
                );
                return Ok(ExclusiveOutputFormat {
                    bytes_per_frame: wave_format.get_blockalign() as usize,
                    wave_format,
                    sample_format: *sample_format,
                });
            }
            Err(e) => {
                eprintln!("[WASAPI Exclusive] Format REJECTED: {label} {}bit — {e}", valid_bits);
            }
        }
    }

    let err = format!(
        "Unsupported WASAPI exclusive format: {sample_rate} Hz, {channels} channels — device may not support exclusive mode or format mismatch"
    );
    eprintln!("[WASAPI Exclusive] {err}");
    Err(err)
}

// ===== 播放主循环 =====

fn run_exclusive_playback(
    request: ExclusivePlayRequest,
    command_rx: Receiver<ExclusiveCommand>,
    init_tx: std::sync::mpsc::SyncSender<Result<String, String>>,
) -> Result<(), String> {
    // ── 1. COM 初始化 ──
    initialize_mta()
        .ok()
        .map_err(|error| {
            let msg = format!("COM MTA initialization failed: {error}");
            eprintln!("[WASAPI Exclusive] {msg}");
            msg
        })?;
    eprintln!("[WASAPI Exclusive] COM MTA initialized");

    // ── 2. 打开音频文件 ──
    let (mut source, sample_rate, channels) = ExclusiveSource::open(
        &request.path,
        request.start_time,
        request.progress.clone(),
        request.effect_params.clone(),
    )
    .map_err(|error| {
        eprintln!("[WASAPI Exclusive] Failed to open source: {error}");
        error
    })?;

    // ── 3. 枚举/选择音频设备 ──
    let enumerator = DeviceEnumerator::new().map_err(|error| {
        let msg = format!("Failed to create DeviceEnumerator: {error}");
        eprintln!("[WASAPI Exclusive] {msg}");
        msg
    })?;

    let device = if let Some(name) = request.device_name.as_deref() {
        eprintln!("[WASAPI Exclusive] Looking for device by name: '{name}'");
        let collection = enumerator
            .get_device_collection(&Direction::Render)
            .map_err(|error| {
                eprintln!("[WASAPI Exclusive] Failed to get device collection: {error}");
                error.to_string()
            })?;
        collection.get_device_with_name(name).map_err(|error| {
            let msg = format!("Device '{name}' not found: {error}");
            eprintln!("[WASAPI Exclusive] {msg}");
            msg
        })?
    } else {
        eprintln!("[WASAPI Exclusive] Using default render device");
        enumerator
            .get_default_device(&Direction::Render)
            .map_err(|error| {
                let msg = format!("No default render device: {error}");
                eprintln!("[WASAPI Exclusive] {msg}");
                msg
            })?
    };

    let active_device_name = device.get_friendlyname().map_err(|error| {
        eprintln!("[WASAPI Exclusive] Failed to get device friendly name: {error}");
        error.to_string()
    })?;
    eprintln!("[WASAPI Exclusive] Device selected: '{active_device_name}'");

    let mut audio_client = device.get_iaudioclient().map_err(|error| {
        let msg = format!("Failed to get IAudioClient for '{active_device_name}': {error}");
        eprintln!("[WASAPI Exclusive] {msg}");
        msg
    })?;

    // ── 4. 格式协商 & 客户端初始化（含重试） ──
    let mut exclusive_format =
        negotiate_exclusive_format(&audio_client, sample_rate, channels).map_err(|error| {
            eprintln!("[WASAPI Exclusive] Format negotiation FAILED: {error}");
            error
        })?;

    let period_hns = audio_client
        .calculate_aligned_period_near(EXCLUSIVE_PERIOD_HNS, None, &exclusive_format.wave_format)
        .unwrap_or(EXCLUSIVE_PERIOD_HNS);
    let mode = StreamMode::PollingExclusive {
        buffer_duration_hns: period_hns * EXCLUSIVE_BUFFER_MULTIPLIER,
        period_hns,
    };

    eprintln!(
        "[WASAPI Exclusive] Initializing client: period={period_hns}hns buffer={}hns mode=PollingExclusive",
        period_hns * EXCLUSIVE_BUFFER_MULTIPLIER
    );

    // [修复防御] 0x8889000F (AUDCLNT_E_ENDPOINT_CREATE_FAILED) 重试机制。
    // cpal 的共享模式 Drop 后，WASAPI 端点可能需要数百毫秒才能完全释放。
    // 直接失败会导致 "没有声音"，重试 3 次间隔 300ms 可覆盖绝大多数情况。
    let mut init_error: Option<String> = None;
    const MAX_INIT_RETRIES: usize = 3;
    for retry in 0..MAX_INIT_RETRIES {
        let result = audio_client
            .initialize_client(&exclusive_format.wave_format, &Direction::Render, &mode);
        match result {
            Ok(()) => {
                if retry > 0 {
                    eprintln!("[WASAPI Exclusive] Client initialized on retry #{retry}");
                }
                init_error = None;
                break;
            }
            Err(error) => {
                let error_str = error.to_string();
                if is_device_in_use_error(&error_str) {
                    let msg = format!(
                        "Device '{active_device_name}' is in use by another application. \n\
                         Please close other audio software and try again. \n\
                         Error detail: {error_str}"
                    );
                    eprintln!("[WASAPI Exclusive] DEVICE_IN_USE: {msg}");
                    init_error = Some(msg);
                    break; // 设备被占用是永久性错误，不重试
                } else {
                    eprintln!(
                        "[WASAPI Exclusive] Init attempt {}/{} FAILED for '{active_device_name}': {error_str}",
                        retry + 1,
                        MAX_INIT_RETRIES
                    );
                    init_error = Some(format!(
                        "WASAPI exclusive client initialization FAILED for '{active_device_name}': {error_str}"
                    ));
                    if retry < MAX_INIT_RETRIES - 1 {
                        // 重新获取 IAudioClient（旧的可能在失败后处于坏状态）
                        eprintln!("[WASAPI Exclusive] Retrying after 300ms...");
                        std::thread::sleep(std::time::Duration::from_millis(300));
                        audio_client = device.get_iaudioclient().map_err(|error| {
                            let msg = format!("Failed to re-get IAudioClient for '{active_device_name}': {error}");
                            eprintln!("[WASAPI Exclusive] {msg}");
                            msg
                        })?;
                    }
                }
            }
        }
    }

    // [修复防御] 全部标准重试失败后，执行完整 COM 重置 + 设备重新枚举的终极重试。
    // 当应用被强制终止（如 Ctrl+C 杀进程）时，Windows 可能残留独占 WASAPI 会话，
    // 导致新进程的 initialize_client 持续返回 0x8889000F (AUDCLNT_E_ENDPOINT_CREATE_FAILED)。
    // COM 的 deinitialize/initialize 循环可以触发 Windows 清理残留端点。
    if init_error.is_some() {
        eprintln!("[WASAPI Exclusive] All {} retries failed — performing full COM reset...", MAX_INIT_RETRIES);

        // 1. 释放所有 COM 对象
        drop(audio_client);
        drop(device);
        drop(enumerator);

        // 2. 完整 COM 重置
        deinitialize();
        std::thread::sleep(std::time::Duration::from_millis(500));
        let _ = initialize_mta(); // 忽略返回值：若失败，后续 DeviceEnumerator::new() 会报明确错误
        eprintln!("[WASAPI Exclusive] COM reset complete — re-enumerating devices...");

        // 3. 重新枚举设备
        let fresh_enumerator = DeviceEnumerator::new().map_err(|error| {
            format!("Failed to create DeviceEnumerator after COM reset: {error}")
        })?;

        let fresh_device = if let Some(name) = request.device_name.as_deref() {
            let collection = fresh_enumerator
                .get_device_collection(&Direction::Render)
                .map_err(|e| e.to_string())?;
            collection.get_device_with_name(name).map_err(|e| e.to_string())?
        } else {
            fresh_enumerator
                .get_default_device(&Direction::Render)
                .map_err(|e| format!("No default render device after COM reset: {e}"))?
        };

        let fresh_device_name = fresh_device.get_friendlyname().map_err(|e| e.to_string())?;
        eprintln!("[WASAPI Exclusive] Device after COM reset: '{fresh_device_name}'");

        // 4. 重新获取 IAudioClient 并协商格式
        let mut fresh_audio_client = fresh_device.get_iaudioclient().map_err(|error| {
            format!("Failed to get IAudioClient after COM reset: {error}")
        })?;

        let fresh_format = negotiate_exclusive_format(&fresh_audio_client, sample_rate, channels)
            .map_err(|error| {
                format!("Format negotiation FAILED after COM reset: {error}")
            })?;

        // 5. 终极初始化尝试
        eprintln!("[WASAPI Exclusive] Final init attempt after COM reset...");
        fresh_audio_client
            .initialize_client(&fresh_format.wave_format, &Direction::Render, &mode)
            .map_err(|error| {
                let error_str = error.to_string();
                let msg = format!(
                    "WASAPI exclusive FATAL: all retries + COM reset FAILED for '{fresh_device_name}': {error_str}\n\
                     \n\
                     The USB DAC endpoint is in a persistent bad state (likely from a previous unclean shutdown).\n\
                     Please try one of the following:\n\
                     1. Replug the USB DAC\n\
                     2. Restart Windows Audio service: net stop audiosrv && net start audiosrv\n\
                     3. Restart your computer"
                );
                eprintln!("[WASAPI Exclusive] {msg}");
                msg
            })?;

        // COM reset succeeded — update all state variables for the rest of the function
        audio_client = fresh_audio_client;
        exclusive_format = fresh_format;
        // Note: enumerator and device are no longer needed after init

        eprintln!("[WASAPI Exclusive] COM reset SUCCESS — client initialized");
    } else if let Some(error) = init_error {
        return Err(error);
    }

    eprintln!("[WASAPI Exclusive] Client initialized successfully in EXCLUSIVE mode");

    // ── 5. 获取渲染客户端 ──
    let render_client = audio_client.get_audiorenderclient().map_err(|error| {
        eprintln!("[WASAPI Exclusive] Failed to get IAudioRenderClient: {error}");
        error.to_string()
    })?;

    let buffer_size = audio_client.get_buffer_size().map_err(|error| {
        eprintln!("[WASAPI Exclusive] Failed to get buffer size: {error}");
        error.to_string()
    })? as usize;

    eprintln!(
        "[WASAPI Exclusive] Buffer: {buffer_size} frames ({} bytes)",
        buffer_size * exclusive_format.bytes_per_frame
    );

    // ── 6. 预填缓冲区 & 启动流 ──
    let volume = request.volume.clamp(0.0, 1.0);
    let mut write_buffer =
        Vec::with_capacity(buffer_size.saturating_mul(exclusive_format.bytes_per_frame));

    let _ = source.read_frames_into(
        buffer_size,
        volume,
        exclusive_format.sample_format,
        &mut write_buffer,
    );

    render_client
        .write_to_device(buffer_size, &write_buffer, None)
        .map_err(|error| {
            eprintln!("[WASAPI Exclusive] Initial buffer write FAILED: {error}");
            error.to_string()
        })?;

    if request.is_playing {
        audio_client.start_stream().map_err(|error| {
            eprintln!("[WASAPI Exclusive] Stream start FAILED: {error}");
            error.to_string()
        })?;
        eprintln!("[WASAPI Exclusive] Stream started — device is NOW EXCLUSIVELY LOCKED");
    }

    // 通知主线程：初始化成功
    let _ = init_tx.send(Ok(active_device_name.clone()));

    let mut is_playing = request.is_playing;
    let mut volume = volume;

    // [定时器] 基于 Instant 的精确写入调度
    let period_frames =
        ((sample_rate as f64 * period_hns as f64) / 10_000_000.0).round() as usize;
    let period_duration = Duration::from_nanos((period_hns * 100) as u64); // hns → nanos
    let mut next_write_deadline = Instant::now() + period_duration;
    let mut last_write_time = Instant::now();

    eprintln!(
        "[WASAPI Exclusive] Entering playback loop | device='{active_device_name}' | sample_rate={sample_rate}Hz | channels={channels} | format={:?}",
        exclusive_format.sample_format
    );

    // ── 7. 主循环 ──
    loop {
        // 7a. 处理所有待处理命令
        while let Ok(command) = command_rx.try_recv() {
            match command {
                ExclusiveCommand::Pause => {
                    if is_playing {
                        let _ = audio_client.stop_stream();
                    }
                    is_playing = false;
                }
                ExclusiveCommand::Resume => {
                    if !is_playing {
                        audio_client
                            .start_stream()
                            .map_err(|error| error.to_string())?;
                    }
                    is_playing = true;
                }
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
                        request.effect_params.clone(),
                    )?
                    .0;
                    let _ = source.read_frames_into(
                        buffer_size,
                        volume,
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
                    eprintln!("[WASAPI Exclusive] Stopped | device='{active_device_name}'");
                    return Ok(());
                }
                ExclusiveCommand::SetVolume(next_volume) => {
                    volume = next_volume.clamp(0.0, 1.0);
                }
                ExclusiveCommand::SyncEffects => {
                    source.sync_effects();
                }
            }
        }

        // 7b. 暂停状态：等待 20ms
        if !is_playing {
            thread::sleep(Duration::from_millis(20));
            // [修复防御] 恢复播放时重置定时器基准，避免积累的时间偏差导致爆音
            next_write_deadline = Instant::now() + period_duration;
            continue;
        }

        // 7c. 定时器驱动写入 — 基于 Instant 精确计时
        // [修复防御] thread::sleep 精度仅 ~15ms，累积偏差会导致 buffer 交叠/撕裂。
        // 使用 Instant::now() 测量真实经过时间，按实际消费帧数写入。
        let now = Instant::now();
        if now < next_write_deadline {
            // 距离下次写入还有时间，短休眠避免忙等
            let remaining = next_write_deadline - now;
            if remaining > Duration::from_millis(1) {
                thread::sleep(Duration::from_millis(1));
            }
            continue;
        }

        // 计算自上次写入后实际经过的周期数（处理调度抖动）
        let elapsed = now.duration_since(last_write_time);
        let periods_elapsed = ((elapsed.as_secs_f64() * sample_rate as f64) / period_frames as f64).round() as usize;
        let frames_to_write = periods_elapsed.max(1).min(buffer_size) * period_frames;

        let ended = source.read_frames_into(
            frames_to_write,
            volume,
            exclusive_format.sample_format,
            &mut write_buffer,
        );
        if write_buffer.len() > 0 {
            // [诊断] 打印前 3 次写入
            static WRITE_COUNT: AtomicBool = AtomicBool::new(false);
            static WRITE_COUNT2: AtomicBool = AtomicBool::new(false);
            static WRITE_COUNT3: AtomicBool = AtomicBool::new(false);
            if !WRITE_COUNT.swap(true, Ordering::Relaxed)
                || !WRITE_COUNT2.swap(true, Ordering::Relaxed)
                || !WRITE_COUNT3.swap(true, Ordering::Relaxed)
            {
                let mut non_zero = 0u32;
                let mut zero = 0u32;
                for &b in write_buffer.iter().take(1024) {
                    if b == 0 { zero += 1; } else { non_zero += 1; }
                }
                let pcm_preview: String = write_buffer
                    .iter()
                    .take(32)
                    .map(|b| format!("{b:02x}"))
                    .collect::<Vec<_>>()
                    .join(" ");
                let write_num = if WRITE_COUNT3.load(Ordering::Relaxed) { 3 }
                    else if WRITE_COUNT2.load(Ordering::Relaxed) { 2 }
                    else { 1 };
                eprintln!(
                    "[WASAPI Exclusive] Write#{write_num}: frames_to_write={frames_to_write} buf_bytes={} volume={volume:.2} ended={ended} format={:?} non_zero={non_zero} zero={zero} first_bytes=[{pcm_preview}]",
                    write_buffer.len(), exclusive_format.sample_format
                );
            }

            // [诊断] 每 100 次写入输出一次心跳
            static WRITE_ITER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let iter = WRITE_ITER.fetch_add(1, Ordering::Relaxed);
            if iter % 100 == 0 {
                eprintln!("[WASAPI Exclusive] Heartbeat: write_iter={iter} frames_to_write={frames_to_write} elapsed_ms={:.1} ended={ended}",
                    elapsed.as_secs_f64() * 1000.0);
            }

            // 对多周期追赶写入，分多次调用 write_to_device 避免单次写入过大
            let frames_per_chunk = period_frames;
            let mut written = 0usize;
            while written < write_buffer.len() {
                let chunk_frames = (frames_per_chunk * exclusive_format.bytes_per_frame).min(write_buffer.len() - written);
                let chunk_buffer = &write_buffer[written..written + chunk_frames];
                let chunk_frame_count = chunk_frames / exclusive_format.bytes_per_frame;
                render_client
                    .write_to_device(chunk_frame_count, chunk_buffer, None)
                    .map_err(|error| {
                        eprintln!("[WASAPI Exclusive] write_to_device FAILED: {error}");
                        error.to_string()
                    })?;
                written += chunk_frames;
            }

            // 推进定时器：按写入帧数计算应推进的时间
            next_write_deadline += Duration::from_secs_f64(
                frames_to_write as f64 / sample_rate as f64
            );
            // [修复防御] 防止定时器落后太多（系统休眠后醒来等极端情况）
            if next_write_deadline < Instant::now() {
                next_write_deadline = Instant::now();
            }
            last_write_time = now;
        }

        // 7d. 音频源耗尽 → 停止
        if ended {
            let _ = audio_client.stop_stream();
            eprintln!(
                "[WASAPI Exclusive] Source exhausted — stopping | device='{active_device_name}'"
            );
            return Ok(());
        }
    }
}
