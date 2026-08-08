use crate::player::equalizer::EqualizerHandle;
use crate::player::loudness::{VolumeNormalizer, VolumeNormalizerHandle};
use crate::player::output::{OutputBackend, OutputError};
use crate::player::sound_effect::{SoundEffectHandle, SoundEffectSource};
use crate::player::types::{SharedProgress, TimedSource};
use crate::remote::cache::RemoteStreamSource;
use cpal::traits::{DeviceTrait, HostTrait};
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use std::fs::File;
use std::io::{BufReader, Read, Seek};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

// 链接 winmm.dll 的 multimedia timer API（FFI，避免依赖 windows/windows-sys 的 feature）。
#[cfg(target_os = "windows")]
#[link(name = "winmm")]
extern "system" {
    fn timeBeginPeriod(u_period: u32) -> u32;
}

/// 初始化 Windows 高精度定时器（1ms 精度）。
///
/// `std::thread::sleep` 默认精度 ~15.625ms（系统时钟分辨率），会导致音频线程上的
/// 短 sleep（如 `StreamingTempFileReader::read` 的 3ms 等待）实际阻塞 ~15ms，
/// 引发 underrun → 卡音破音。`timeBeginPeriod(1)` 全局提升精度到 1ms，进程退出时
/// 系统自动恢复。这是音频/游戏软件的标准做法。
#[cfg(target_os = "windows")]
fn init_high_resolution_timer() {
    use std::sync::OnceLock;
    static ONCE: OnceLock<()> = OnceLock::new();
    ONCE.get_or_init(|| {
        // SAFETY: timeBeginPeriod 是线程安全的 Win32 API，参数 1 表示 1ms 精度。
        unsafe {
            let _ = timeBeginPeriod(1);
        }
    });
}

#[cfg(not(target_os = "windows"))]
#[inline]
fn init_high_resolution_timer() {}

/// 组合 Read + Seek 的 trait，用于 trait object（Rust 不允许 `dyn Read + Seek`）。
/// Decoder::new 需要 `R: Read + Seek + Send + Sync + 'static`，
/// `Box<dyn ReadSeek + Send + Sync>` 满足此约束（通过 Box<T> 的 blanket impl）。
pub(crate) trait ReadSeek: Read + Seek {}
impl<T: Read + Seek> ReadSeek for T {}

pub(crate) struct SharedOutputBackend {
    _stream: OutputStream,
    handle: OutputStreamHandle,
    active_device_name: String,
}

impl SharedOutputBackend {
    pub(crate) fn open(host: &cpal::Host, device_name: Option<&str>) -> Result<Self, OutputError> {
        if let Some(name) = device_name {
            if let Ok(mut devices) = host.output_devices() {
                if let Some(device) = devices.find(|d| d.name().map(|n| n == name).unwrap_or(false))
                {
                    if let Ok(output) = Self::from_device(&device, name.to_string()) {
                        return Ok(output);
                    }
                }
            }
        }

        let default_device = host
            .default_output_device()
            .ok_or(OutputError::DeviceUnavailable)?;
        let active_name = default_device
            .name()
            .map_err(|error| OutputError::Stream(error.to_string()))?;

        Self::from_device(&default_device, active_name)
    }

    fn from_device(device: &cpal::Device, active_device_name: String) -> Result<Self, OutputError> {
        init_high_resolution_timer();
        let (stream, handle) = OutputStream::try_from_device(device)
            .map_err(|error| OutputError::Stream(error.to_string()))?;

        Ok(Self {
            _stream: stream,
            handle,
            active_device_name,
        })
    }
}

impl OutputBackend for SharedOutputBackend {
    fn active_device_name(&self) -> &str {
        &self.active_device_name
    }

    fn create_sink(&self) -> Result<Sink, OutputError> {
        Sink::try_new(&self.handle).map_err(|error| OutputError::Sink(error.to_string()))
    }
}

pub(crate) fn progress_seconds_from_samples(samples: u64, rate: u32, channels: u32) -> f64 {
    if rate == 0 || channels == 0 {
        return 0.0;
    }

    samples as f64 / (rate as u64 * channels as u64) as f64
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn restore_current_playback(
    output: &Option<SharedOutputBackend>,
    current_sink: &mut Option<Sink>,
    current_path: &str,
    is_playing_flag: bool,
    progress: &Arc<SharedProgress>,
    equalizer_handle: Arc<EqualizerHandle>,
    sound_effect_handle: Arc<SoundEffectHandle>,
    user_volume: Arc<AtomicU32>,
    volume_balance_gain: f32,
    current_normalizer_handle: &mut Option<VolumeNormalizerHandle>,
    remote_stream: Option<&RemoteStreamSource>,
    streaming_state: Option<&crate::player::stream_cache::StreamingTempFileState>,
) {
    if current_path.is_empty() {
        return;
    }

    if let Some(output) = output {
        *current_sink = output.create_sink().ok();

        let current_samples = progress.samples_played.load(Ordering::Relaxed);
        let rate = progress.sample_rate.load(Ordering::Relaxed);
        let channels = progress.channels.load(Ordering::Relaxed);
        let time_played = progress_seconds_from_samples(current_samples, rate, channels);
        let jump_target = Duration::from_secs_f64(time_played);

        // [在线播放重构] 优先使用 StreamingTempFileReader 恢复（边下边播）
        // 其次使用 RemoteRangeReader（WebDAV/旧路径）
        // 最后用 File::open（本地文件）
        let reader_result: Result<Box<dyn ReadSeek + Send + Sync>, ()> =
            if let Some(state) = streaming_state {
                match state.new_reader() {
                    Ok(reader) => Ok(Box::new(reader)),
                    Err(e) => {
                        eprintln!("[Audio][rust] restore 重建流式临时文件失败: {e}");
                        Err(())
                    }
                }
            } else if let Some(stream) = remote_stream {
                match crate::player::runtime::RemoteRangeReader::new(stream.clone()) {
                    Ok(reader) => Ok(Box::new(BufReader::with_capacity(512 * 1024, reader))),
                    Err(e) => {
                        eprintln!("[Audio][rust] restore 重建远程流失败: {e}");
                        Err(())
                    }
                }
            } else {
                match File::open(current_path) {
                    Ok(file) => Ok(Box::new(BufReader::with_capacity(512 * 1024, file))),
                    Err(e) => {
                        eprintln!("[Audio][rust] restore 打开本地文件失败: {e}");
                        Err(())
                    }
                }
            };

        if let Ok(reader) = reader_result {
            if let Ok(source) = Decoder::new(reader) {
                let skipped = source.convert_samples::<f32>().skip_duration(jump_target);

                // 0. BufferedSource 预读取缓冲（与 runtime.rs 的 append_decoded_source 保持一致）
                let buffered = crate::player::buffered_source::BufferedSource::new(skipped);

                // 1. VolumeNormalizer 音量平衡节点（与 runtime.rs 的 append_decoded_source 保持一致）
                let (normalized_source, handle) =
                    VolumeNormalizer::new(buffered, volume_balance_gain, 100);
                *current_normalizer_handle = Some(handle);

                // 2. Equalizer
                let eq_source =
                    crate::player::equalizer::Equalizer::new(normalized_source, equalizer_handle);

                // 2.5 SoundEffectSource 音效处理源
                // 注意：必须与 runtime.rs 的 append_decoded_source 保持一致，
                // 否则设备切换恢复后会丢失全部音效（混响/变调/空间/EQ 等）。
                let se_source = SoundEffectSource::new(eq_source, sound_effect_handle);

                // 3. UserVolumeSource
                let vol_source =
                    crate::player::equalizer::UserVolumeSource::new(se_source, user_volume);

                // 4. ClipGuardSource
                let clip_source = crate::player::equalizer::ClipGuardSource::new(vol_source);

                // 5. TimedSource
                let timed_source = TimedSource::new(
                    clip_source,
                    progress.samples_played.clone(),
                    progress.visualizer.clone(),
                );

                if let Some(sink) = current_sink.as_ref() {
                    sink.set_volume(1.0); // 固定共享模式 Sink 音量恒为 1.0
                    sink.append(timed_source);
                    if is_playing_flag {
                        sink.play();
                    } else {
                        sink.pause();
                    }
                }
            }
        }
    }
}
