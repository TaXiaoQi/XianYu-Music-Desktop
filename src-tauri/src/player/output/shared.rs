// 共享模式输出后端与中断恢复：
// - Windows 下请求 1ms 系统计时精度，降低轮询抖动；
// - 指定设备名优先，失败或未指定时回退系统默认设备；
// - 播放设备切换/异常恢复时，按当前进度重建整条源链并续播。
// 源链组装顺序（下混 → 缓冲 → 归一化 → EQ → 音效 → 插件 → 音量 → 限幅 → 计时）
// 与进度换算公式为既有行为，冻结不改。

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
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[cfg(target_os = "windows")]
#[link(name = "winmm")]
extern "system" {
    fn timeBeginPeriod(u_period: u32) -> u32;
}

/// 请求高精度系统计时器（进程内一次性），非 Windows 平台为空操作。
#[cfg(target_os = "windows")]
fn init_high_resolution_timer() {
    use std::sync::OnceLock;
    static REQUESTED: OnceLock<()> = OnceLock::new();
    REQUESTED.get_or_init(|| unsafe {
        let _ = timeBeginPeriod(1);
    });
}

#[cfg(not(target_os = "windows"))]
#[inline]
fn init_high_resolution_timer() {}

/// 可Seek可读的解码输入约束。
pub(crate) trait ReadSeek: Read + Seek {}
impl<T: Read + Seek> ReadSeek for T {}

/// 大文件读取缓冲统一取 512 KiB。
const READER_BUF_BYTES: usize = 512 * 1024;

/// 共享模式后端：持有输出流与 Sink 工厂。
pub(crate) struct SharedOutputBackend {
    _stream: OutputStream,
    handle: OutputStreamHandle,
    active_device_name: String,
}

impl SharedOutputBackend {
    /// 优先打开与设备名完全一致的设备；失败则回退系统默认设备。
    pub(crate) fn open(host: &cpal::Host, device_name: Option<&str>) -> Result<Self, OutputError> {
        if let Some(name) = device_name {
            if let Ok(devices) = host.output_devices() {
                let wanted = devices
                    .filter_map(|device| device.name().ok().map(|n| (device, n == name)))
                    .find(|(_, matched)| *matched)
                    .map(|(device, _)| device);
                if let Some(device) = wanted {
                    if let Ok(output) = Self::from_device(&device, name.to_string()) {
                        return Ok(output);
                    }
                }
            }
        }

        let fallback = host
            .default_output_device()
            .ok_or(OutputError::DeviceUnavailable)?;
        let active_name = fallback
            .name()
            .map_err(|error| OutputError::Stream(error.to_string()))?;
        Self::from_device(&fallback, active_name)
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

/// 由已播采样数换算播放秒数；格式未知时返回 0。
pub(crate) fn progress_seconds_from_samples(samples: u64, rate: u32, channels: u32) -> f64 {
    if rate == 0 || channels == 0 {
        return 0.0;
    }

    samples as f64 / (rate as u64 * channels as u64) as f64
}

/// 为恢复播放准备解码输入：流式临时文件 / 远端流 / 桥接本地文件 / 普通文件。
fn open_restore_reader(
    current_path: &str,
    remote_stream: Option<&RemoteStreamSource>,
    streaming_state: Option<&crate::player::stream_cache::StreamingTempFileState>,
) -> Result<Box<dyn ReadSeek + Send + Sync>, String> {
    if let Some(state) = streaming_state {
        return state
            .new_reader()
            .map(|reader| Box::new(reader) as Box<dyn ReadSeek + Send + Sync>)
            .map_err(|error| {
                eprintln!("[Audio][rust] restore 重建流式临时文件失败: {error}");
                error.to_string()
            });
    }
    if let Some(stream) = remote_stream {
        return crate::player::remote_reader::RemoteRangeReader::new(stream.clone())
            .map(|reader| Box::new(reader) as Box<dyn ReadSeek + Send + Sync>)
            .map_err(|error| {
                eprintln!("[Audio][rust] restore 重建远程流失败: {error}");
                error.to_string()
            });
    }
    if let Some((bridged, _codec)) =
        crate::player::source_pipeline::bridge_local_file(Path::new(current_path))
    {
        // 桥接读取器自带 Read+Seek，经 blanket impl 直接适配本模块的 ReadSeek。
        return Ok(Box::new(bridged));
    }
    File::open(current_path)
        .map(|file| {
            Box::new(BufReader::with_capacity(READER_BUF_BYTES, file))
                as Box<dyn ReadSeek + Send + Sync>
        })
        .map_err(|error| {
            eprintln!("[Audio][rust] restore 打开本地文件失败: {error}");
            error.to_string()
        })
}

/// 中断后的原地恢复：重建 Sink 与源链，按已播进度跳转后续播或暂停。
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
    let Some(output) = output else { return };

    *current_sink = output.create_sink().ok();

    // 以恢复时刻的进度作为跳转目标。
    let elapsed = progress_seconds_from_samples(
        progress.samples_played.load(Ordering::Relaxed),
        progress.sample_rate.load(Ordering::Relaxed),
        progress.channels.load(Ordering::Relaxed),
    );
    let jump_target = Duration::from_secs_f64(elapsed);

    let Ok(reader) = open_restore_reader(current_path, remote_stream, streaming_state) else {
        return;
    };
    let Ok(decoded) = Decoder::new(reader) else {
        return;
    };

    // 与主播放路径一致：超过双声道先下混为立体声。
    let source_channels = decoded.channels();
    progress.channels.store(
        if source_channels > 2 {
            2
        } else {
            source_channels as u32
        },
        Ordering::Relaxed,
    );
    let raw_source = decoded.convert_samples::<f32>();
    let unified: Box<dyn Source<Item = f32> + Send> = if source_channels > 2 {
        Box::new(crate::player::channel_downmix::DownmixSource::new(
            raw_source,
            source_channels,
        ))
    } else {
        Box::new(raw_source)
    };

    let skipped = unified.skip_duration(jump_target);
    let buffered = crate::player::buffered_source::BufferedSource::new(skipped);

    let (normalized_source, normalizer_handle) =
        VolumeNormalizer::new(buffered, volume_balance_gain, 100);
    *current_normalizer_handle = Some(normalizer_handle);

    let eq_source = crate::player::equalizer::Equalizer::new(normalized_source, equalizer_handle);
    let se_source = SoundEffectSource::new(eq_source, sound_effect_handle);
    let plugin_source = crate::player::plugin_host::wrap(se_source);
    let vol_source = crate::player::equalizer::UserVolumeSource::new(plugin_source, user_volume);
    let clip_source = crate::player::equalizer::ClipGuardSource::new(vol_source);
    let timed_source = TimedSource::new(
        clip_source,
        progress.samples_played.clone(),
        progress.visualizer.clone(),
    );

    if let Some(sink) = current_sink.as_ref() {
        sink.set_volume(1.0);
        sink.append(timed_source);
        if is_playing_flag {
            sink.play();
        } else {
            sink.pause();
        }
    }
}
