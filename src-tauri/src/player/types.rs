// 播放链路共享状态（本文件为全新组织，serde 字段名对前端冻结）：
// - SharedVisualizer：音频线程写入的采样环形窗，可视化侧取快照；
// - TimedSource：播放进度计数，并按帧把声道均值喂给可视化窗；
// - BufferedMonitor / SharedProgress：缓冲与进度的原子快照；
// - AudioCommand / AudioSource：播放线程消费的命令与输入抽象；
// - PlayerState 与对外序列化结构。

use crate::player::equalizer::EqualizerSettings;
use crate::player::sound_effect::SoundEffectSettings;
use rodio::{source::SeekError, Source};
use serde::{Serialize, Deserialize};
use souvlaki::MediaControls;
use std::sync::{atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering}, Arc, Mutex};
use std::sync::mpsc::Sender;
use std::time::Duration;

/// 可视化频段数量。
pub const VISUALIZER_BAND_COUNT: usize = 48; // 与频谱分析约定一致
/// 可视化窗口长度（采样数）。
pub const VISUALIZER_WINDOW_SIZE: usize = 2048; // FFT 窗尺寸

/// 最近采样的环形窗：音频线程负责写，UI 侧读取快照。
pub struct SharedVisualizer {
    cells: Vec<AtomicU32>,
    pub cursor: AtomicU64, // 全局写入游标，单调递增
}

impl SharedVisualizer {
    pub fn new() -> Self {
        let mut cells = Vec::new();
        cells.resize_with(VISUALIZER_WINDOW_SIZE, || AtomicU32::new(0.0_f32.to_bits()));
        Self { cells, cursor: AtomicU64::new(0) }
    }

    /// 清空环形窗并把写入游标归零。
    pub fn reset(&self) {
        for cell in &self.cells {
            cell.store(0.0_f32.to_bits(), Ordering::Relaxed);
        }
        self.cursor.store(0, Ordering::Relaxed);
    }

    /// 追加一个采样：先限幅到 [-1,1] 再按位存入，游标单调递增。
    pub fn push_sample(&self, sample: f32) {
        let slot = (self.cursor.fetch_add(1, Ordering::Relaxed) as usize) % VISUALIZER_WINDOW_SIZE;
        self.cells[slot].store(sample.clamp(-1.0, 1.0).to_bits(), Ordering::Relaxed);
    }

    /// 按时间先后导出窗口内容；不足窗口的部分在队首补零。
    pub fn snapshot(&self) -> Vec<f32> {
        let written = self.cursor.load(Ordering::Relaxed) as usize;
        let valid = written.min(VISUALIZER_WINDOW_SIZE);

        let mut out = vec![0.0_f32; VISUALIZER_WINDOW_SIZE - valid];
        for offset in 0..valid {
            let ring = if written < VISUALIZER_WINDOW_SIZE {
                offset
            } else {
                (written + offset) % VISUALIZER_WINDOW_SIZE
            };
            out.push(f32::from_bits(self.cells[ring].load(Ordering::Relaxed)));
        }

        out
    }
}

/// 计时包装源：统计已播采样数，并按帧把声道均值喂给可视化窗。
pub struct TimedSource<S> {
    pub inner: S,                          // 被包装的上游源
    pub samples_played: Arc<AtomicU64>,    // 已播采样计数
    pub visualizer: Arc<SharedVisualizer>, // 可视化环形窗
    frame_sum: f32,  // 当前帧内采样累加
    frame_lane: u16, // 当前帧内声道位置
}

impl<S> TimedSource<S> where S: Source<Item = f32> {
    pub fn new(
        inner: S,
        samples_played: Arc<AtomicU64>,
        visualizer: Arc<SharedVisualizer>,
    ) -> Self {
        Self {
            inner,
            samples_played,
            visualizer,
            frame_sum: 0.0,
            frame_lane: 0,
        }
    }
}

impl<S> Iterator for TimedSource<S> where S: Source<Item = f32> {
    type Item = S::Item;

    fn next(&mut self) -> Option<f32> {
        let sample = self.inner.next()?;
        self.samples_played.fetch_add(1, Ordering::Relaxed);
        self.frame_sum += sample;
        self.frame_lane += 1;

        let lane_total = Source::channels(&self.inner);
        if self.frame_lane >= lane_total {
            let lane_mean = self.frame_sum / self.frame_lane as f32;
            self.visualizer.push_sample(lane_mean);
            self.frame_sum = 0.0;
            self.frame_lane = 0;
        }
        Some(sample)
    }
}

impl<S> Source for TimedSource<S> where S: Source<Item = f32> {
    fn channels(&self) -> u16 { self.inner.channels() }
    fn sample_rate(&self) -> u32 { self.inner.sample_rate() }
    fn current_frame_len(&self) -> Option<usize> { self.inner.current_frame_len() }
    fn total_duration(&self) -> Option<Duration> { self.inner.total_duration() }
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> { self.inner.try_seek(pos) }
}

/// 网络源缓冲监视：饥饿与是否已产出数据两个标志位。
pub struct BufferedMonitor {
    pub starved: AtomicBool,  // 下游取不到数据
    pub produced: AtomicBool, // 上游已产出过数据
}

impl BufferedMonitor {
    pub fn new() -> Self {
        Self { starved: AtomicBool::new(false), produced: AtomicBool::new(false) }
    }
}

impl Default for BufferedMonitor {
    fn default() -> Self {
        Self { starved: AtomicBool::new(false), produced: AtomicBool::new(false) }
    }
}

/// 播放线程与命令层共享的进度与状态原子快照。
pub struct SharedProgress {
    pub samples_played: Arc<AtomicU64>,                  // 已播采样数
    pub sample_rate: Arc<AtomicU32>,                     // 当前采样率
    pub channels: Arc<AtomicU32>,                        // 当前声道数
    pub visualizer: Arc<SharedVisualizer>,               // 可视化环形窗
    pub start_failed: Arc<AtomicBool>,                   // 起播失败标志
    pub start_failed_reason: Arc<std::sync::Mutex<Option<String>>>, // 失败原因
    pub buffered: Arc<BufferedMonitor>,                  // 网络缓冲监视
    pub total_duration_secs: Arc<AtomicU64>,             // 总时长（f64 位模式）
    pub is_playing: Arc<AtomicBool>,                     // 播放中标志
}

/// 播放线程消费的控制命令集。
pub enum AudioCommand {
    /// 开始播放（带输出模式与增益配置）。
    Play {
        source: AudioSource,          // 输入源
        output_mode: AudioOutputMode, // 请求的输出模式
        start_offset_ms: Option<u64>, // 起播偏移（毫秒）
        volume_balance_gain: f32,     // 音量平衡线性增益
        dsd_native_passthrough: bool, // DSD 原生直通
        bit_perfect: bool,            // 位完美输出
    },
    Pause,  // 暂停
    Stop,   // 停止
    Resume, // 恢复
    /// 跳转播放位置。
    Seek {
        time: f64,        // 目标位置（秒）
        is_playing: bool, // 跳转时是否处于播放
        request_id: u64,  // 请求序号
    },
    SetVolume(f32), // 用户音量
    /// 音量平衡开关与目标增益。
    SetVolumeBalance {
        enabled: bool,    // 是否启用
        target_gain: f32, // 目标线性增益
    },
    SetEqualizerSettings { settings: EqualizerSettings },     // 均衡器参数
    SetSoundEffectSettings { settings: SoundEffectSettings }, // 音效参数
    SetDevice(Option<String>),      // 输出设备切换
    SetOutputMode(AudioOutputMode), // 输出模式切换
}

/// 播放输入的三种落地形态。
#[derive(Clone, Debug)]
pub enum AudioSource {
    LocalFile(String), // 本地文件
    RemoteWebDav(crate::remote::cache::RemoteStreamSource), // 远端直连流
    StreamingTempFile(crate::player::stream_cache::StreamingTempFileState), // 流式临时文件
}

impl AudioSource {
    /// 日志与会话恢复用的可读路径标识。
    pub fn display_path(&self) -> String {
        match self {
            AudioSource::LocalFile(path) => path.clone(),
            AudioSource::RemoteWebDav(stream) => stream.remote_uri.clone(),
            AudioSource::StreamingTempFile(cache) => cache.path.clone(),
        }
    }

    /// 是否依赖网络（决定缓冲与恢复策略）。
    pub fn is_network_backed(&self) -> bool {
        match self {
            AudioSource::LocalFile(path) => {
                crate::music::utils::is_network_share_path(path)
            }
            AudioSource::RemoteWebDav(_) => true,
            AudioSource::StreamingTempFile(_) => true,
        }
    }
}

#[cfg(test)]
mod network_path_tests {
    use super::AudioSource;

    #[test]
    fn unc_shares_are_network_backed_but_drive_letters_are_not() {
        let unc_share = AudioSource::LocalFile(r"\\NAS\Music\song.flac".to_string());
        let drive_letter = AudioSource::LocalFile(r"C:\Music\song.flac".to_string());
        assert!(unc_share.is_network_backed());
        assert!(!drive_letter.is_network_backed());
    }
}

/// 播放器全局托管状态（tauri State）。
pub struct PlayerState {
    pub tx: Mutex<Sender<AudioCommand>>,        // 命令通道
    pub progress: Arc<SharedProgress>,          // 进度快照
    pub playback_id: Arc<AtomicU64>,            // 播放会话序号
    pub controls: Arc<Mutex<Option<MediaControls>>>, // SMTC 控制器
    pub output_status: Arc<Mutex<AudioOutputStatus>>, // 输出状态槽
    pub user_volume: Arc<AtomicU32>,            // 用户音量（f32 位模式）
}

/// 输出设备条目（设备 id 即系统设备名）。
#[derive(Serialize, Clone)]
pub struct AudioDevice {
    pub id: String,   // 设备标识
    pub name: String, // 设备名
}

/// 单个设备支持的采样格式区间。
#[derive(Serialize, Clone)]
pub struct AudioDeviceFormat {
    pub sample_format: String,    // 采样格式名
    pub min_sample_rate: u32,     // 最低采样率
    pub max_sample_rate: u32,     // 最高采样率
    pub channels: u16,            // 声道数
}

/// 设备与支持格式列表的聚合。
#[derive(Serialize, Clone)]
pub struct AudioDeviceFormats {
    pub id: String,                  // 设备标识
    pub name: String,                // 设备名
    pub formats: Vec<AudioDeviceFormat>, // 支持格式
}

/// 当前输出链状态快照（字段名对前端冻结）。
#[derive(Serialize, Clone, Default)]
pub struct AudioOutputStatus {
    pub selected_device_id: Option<String>,  // 用户选择的设备
    pub active_device_name: Option<String>,  // 实际生效设备
    pub follows_system_default: bool,        // 是否跟随系统默认
    pub requested_output_mode: AudioOutputMode, // 请求的输出模式
    pub active_output_mode: AudioOutputMode,    // 实际输出模式
    pub fallback_reason: Option<String>,     // 降级原因
}

/// 输出模式：共享混音或 WASAPI 独占。
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioOutputMode {
    #[default]
    Shared,          // 共享混音
    WasapiExclusive, // WASAPI 独占
}

/// seek 完成事件负载（字段名冻结）。
#[derive(Serialize, Clone)]
pub(crate) struct SeekCompletedPayload {
    pub request_id: u64, // 请求序号
    pub time: f64,       // 目标位置（秒）
}

/// 进度事件负载（字段名冻结）。
#[derive(Serialize, Clone)]
pub(crate) struct PlaybackProgressPayload {
    pub position: f64,    // 当前位置（秒）
    pub duration: f64,    // 总时长（秒）
    pub is_playing: bool, // 是否播放中
}

/// 缓冲状态事件负载（字段名冻结）。
#[derive(Serialize, Clone)]
pub(crate) struct PlaybackBufferPayload {
    pub buffering: bool, // 是否缓冲中
}
