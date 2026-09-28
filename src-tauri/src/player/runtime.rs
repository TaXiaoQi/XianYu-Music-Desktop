use crate::player::device::{default_output_device_name, emit_output_status};
use crate::player::loudness::{VolumeNormalizer, VolumeNormalizerHandle};
use crate::player::output::shared::{
    progress_seconds_from_samples, restore_current_playback, SharedOutputBackend,
};
#[cfg(target_os = "windows")]
use crate::player::output::wasapi_exclusive::{ExclusivePlayRequest, WasapiExclusivePlayback};
use crate::player::output::OutputBackend;
use crate::player::types::{
    AudioCommand, AudioOutputMode, AudioOutputStatus, AudioSource, BufferedMonitor,
    PlaybackBufferPayload, PlaybackProgressPayload, PlayerState, SeekCompletedPayload,
    SharedProgress, SharedVisualizer, TimedSource,
};
use crate::remote::cache::RemoteStreamSource;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use rodio::{Decoder, Sink, Source};
use souvlaki::{MediaControlEvent, MediaControls, MediaPlayback, MediaPosition, PlatformConfig};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

// 播放线程空转时等待命令的节拍
const COMMAND_WAIT_TICK: Duration = Duration::from_millis(150);
// 进度事件两次广播之间的最小间隔
const PROGRESS_BROADCAST_SPACING: Duration = Duration::from_millis(500);
// 网络断流持续多久后把 sink 压停
const STARVE_PAUSE_THRESHOLD: Duration = Duration::from_millis(300);
// 重新来数后观察多久才放行 sink
const RESUME_GRACE_WINDOW: Duration = Duration::from_millis(250);
// 输出后端丢失后，多久再尝试一次自救
const OUTPUT_RECOVERY_SPACING: Duration = Duration::from_millis(1000);
// 远程流一次预取拉多少字节
const STREAM_SLICE_BYTES: u64 = 2 * 1024 * 1024;

// 把 panic 携带的负载转成可读文本
fn panic_reason_text(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(borrowed) = payload.downcast_ref::<&str>() {
        return (*borrowed).to_string();
    }
    if let Some(owned) = payload.downcast_ref::<String>() {
        return owned.clone();
    }
    "未知 panic".to_string()
}

// 设备层操作包一层 panic 隔离：炸了只记日志，播放线程不许陪葬
#[allow(clippy::type_complexity)]
fn confine_device_fault<F>(device_job: F) -> bool
where
    F: FnOnce(),
{
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(device_job)) {
        Ok(()) => true,
        Err(payload) => {
            let reason = panic_reason_text(payload.as_ref());
            eprintln!("[Audio][rust] 音频设备相关操作 panic，已隔离（不终止播放线程）: {reason}");
            false
        }
    }
}

// 由共享进度原子量折算当前播放到的时间点
fn elapsed_playback_time(progress: &Arc<SharedProgress>) -> Duration {
    let played = progress.samples_played.load(Ordering::Relaxed);
    let hz = progress.sample_rate.load(Ordering::Relaxed);
    let lanes = progress.channels.load(Ordering::Relaxed);
    Duration::from_secs_f64(progress_seconds_from_samples(played, hz, lanes))
}

// 把指定秒数换算成声道交织后的采样序号
fn samples_for_position(at_seconds: f64, progress: &SharedProgress) -> u64 {
    let hz = progress.sample_rate.load(Ordering::Relaxed);
    let lanes = progress.channels.load(Ordering::Relaxed);
    (at_seconds * hz as f64 * lanes as f64).round() as u64
}

// 起播/换曲前清空全部进度簿记，避免上一首的残影
fn wipe_progress_bookkeeping(progress: &Arc<SharedProgress>) {
    let loose = Ordering::Relaxed;
    progress.samples_played.store(0, loose);
    progress.sample_rate.store(0, loose);
    progress.channels.store(0, loose);
    progress.start_failed.store(false, loose);
    progress.buffered.starved.store(false, loose);
    progress.buffered.produced.store(false, loose);
    if let Ok(mut reason_slot) = progress.start_failed_reason.lock() {
        *reason_slot = None;
    }
    progress.visualizer.reset();
}

// 系统默认输出设备变化时是否值得整体重建输出链
fn should_restore_for_default_device_change(
    chosen_device: &Option<String>,
    previous_default: &Option<String>,
    refreshed_default: &Option<String>,
    _active_label: &Option<String>,
) -> bool {
    match (chosen_device, refreshed_default) {
        (None, Some(pending)) => previous_default.as_deref() != Some(pending.as_str()),
        _ => false,
    }
}

#[cfg(target_os = "windows")]
fn teardown_exclusive_session(session_slot: &mut Option<WasapiExclusivePlayback>) {
    if let Some(mut session) = session_slot.take() {
        session.stop();
    }
}

#[cfg(target_os = "windows")]
#[allow(clippy::too_many_arguments)]
fn launch_exclusive_session(
    track_path: String,
    chosen_device: Option<String>,
    speaker_gain: f32,
    should_resume: bool,
    resume_from: Duration,
    progress: &Arc<SharedProgress>,
    balance_gain: f32,
    equalizer_rig: Arc<crate::player::equalizer::EqualizerHandle>,
    effect_rig: Arc<crate::player::sound_effect::SoundEffectHandle>,
    master_volume: Arc<AtomicU32>,
    dsd_passthrough: bool,
    bit_perfect: bool,
) -> Result<WasapiExclusivePlayback, String> {
    WasapiExclusivePlayback::start(ExclusivePlayRequest {
        path: track_path,
        device_name: chosen_device,
        volume: speaker_gain,
        is_playing: should_resume,
        progress: progress.clone(),
        start_time: resume_from,
        volume_balance_gain: balance_gain,
        equalizer_handle: equalizer_rig,
        sound_effect_handle: effect_rig,
        user_volume: master_volume,
        dsd_native_passthrough: dsd_passthrough,
        bit_perfect,
    })
    .map_err(|error| error.to_string())
}

// 统一的输出状态广播入口：先走本地快照再交由 device 模块发事件
#[allow(clippy::too_many_arguments)]
fn broadcast_output_state(
    app: &AppHandle,
    status_slot: &Arc<Mutex<AudioOutputStatus>>,
    chosen_device: &Option<String>,
    live_device_label: &Option<String>,
    wanted_mode: AudioOutputMode,
    live_mode: AudioOutputMode,
    downgrade_note: &Option<String>,
) {
    emit_output_status(
        app,
        status_slot,
        chosen_device.clone(),
        live_device_label.clone(),
        wanted_mode,
        live_mode,
        downgrade_note.clone(),
    );
}

// 按当前请求的输出模式重建整条输出链（独占优先，失败回落共享）
#[allow(clippy::too_many_arguments)]
fn rebuild_output_stack(
    chosen_device: &Option<String>,
    shared_out: &mut Option<SharedOutputBackend>,
    audio_host: &cpal::Host,
    sink_slot: &mut Option<Sink>,
    #[cfg(target_os = "windows")] exclusive_session: &mut Option<WasapiExclusivePlayback>,
    live_device_label: &mut Option<String>,
    live_mode: &mut AudioOutputMode,
    downgrade_note: &mut Option<String>,
    wanted_mode: AudioOutputMode,
    active_file_path: &str,
    speaker_gain: f32,
    audible: bool,
    live_progress: &Arc<SharedProgress>,
    balance_gain: f32,
    equalizer_rig: Arc<crate::player::equalizer::EqualizerHandle>,
    effect_rig: Arc<crate::player::sound_effect::SoundEffectHandle>,
    master_volume: Arc<AtomicU32>,
    loudness_slot: &mut Option<VolumeNormalizerHandle>,
    remote_feed: Option<&RemoteStreamSource>,
    temp_file_feed: Option<&crate::player::stream_cache::StreamingTempFileState>,
    dsd_passthrough: bool,
    bit_perfect: bool,
) {
    // 先把旧后端放掉再开新的，避免设备句柄残留占用
    *shared_out = None;
    *shared_out = SharedOutputBackend::open(audio_host, chosen_device.as_deref()).ok();
    *live_device_label = shared_out
        .as_ref()
        .map(|backend| backend.active_device_name().to_string());

    #[cfg(target_os = "windows")]
    if wanted_mode == AudioOutputMode::WasapiExclusive && !active_file_path.is_empty() {
        match launch_exclusive_session(
            active_file_path.to_string(),
            chosen_device.clone(),
            speaker_gain,
            audible,
            elapsed_playback_time(live_progress),
            live_progress,
            balance_gain,
            equalizer_rig.clone(),
            effect_rig.clone(),
            master_volume.clone(),
            dsd_passthrough,
            bit_perfect,
        ) {
            Ok(session) => {
                *live_device_label = Some(session.active_device_name().to_string());
                *live_mode = AudioOutputMode::WasapiExclusive;
                *downgrade_note = None;
                *exclusive_session = Some(session);
                *shared_out = None;
                return;
            }
            Err(error) => {
                *live_mode = AudioOutputMode::Shared;
                *downgrade_note = Some(error);
            }
        }
    } else {
        *live_mode = AudioOutputMode::Shared;
        *downgrade_note = None;
    }

    #[cfg(not(target_os = "windows"))]
    {
        *live_mode = AudioOutputMode::Shared;
        *downgrade_note = if wanted_mode == AudioOutputMode::WasapiExclusive {
            Some("WASAPI exclusive mode is only available on Windows".to_string())
        } else {
            None
        };
    }

    restore_current_playback(
        shared_out,
        sink_slot,
        active_file_path,
        audible,
        live_progress,
        equalizer_rig,
        effect_rig,
        master_volume,
        balance_gain,
        loudness_slot,
        remote_feed,
        temp_file_feed,
    );
}

// 只重建共享输出链（无独占分支），供超时自救等场景复用
#[allow(clippy::too_many_arguments)]
fn reopen_shared_pipeline(
    chosen_device: &Option<String>,
    shared_out: &mut Option<SharedOutputBackend>,
    audio_host: &cpal::Host,
    sink_slot: &mut Option<Sink>,
    live_device_label: &mut Option<String>,
    active_file_path: &str,
    audible: bool,
    live_progress: &Arc<SharedProgress>,
    equalizer_rig: Arc<crate::player::equalizer::EqualizerHandle>,
    effect_rig: Arc<crate::player::sound_effect::SoundEffectHandle>,
    master_volume: Arc<AtomicU32>,
    balance_gain: f32,
    loudness_slot: &mut Option<VolumeNormalizerHandle>,
    remote_feed: Option<&RemoteStreamSource>,
    temp_file_feed: Option<&crate::player::stream_cache::StreamingTempFileState>,
) {
    *shared_out = SharedOutputBackend::open(audio_host, chosen_device.as_deref()).ok();
    *live_device_label = shared_out
        .as_ref()
        .map(|backend| backend.active_device_name().to_string());
    restore_current_playback(
        shared_out,
        sink_slot,
        active_file_path,
        audible,
        live_progress,
        equalizer_rig,
        effect_rig,
        master_volume,
        balance_gain,
        loudness_slot,
        remote_feed,
        temp_file_feed,
    );
}

// 独占会话结束后做收尾：正常结束直接清场，异常断开则回落共享并广播
#[cfg(target_os = "windows")]
#[allow(clippy::too_many_arguments)]
fn drain_finished_exclusive(
    exclusive_session: &mut Option<WasapiExclusivePlayback>,
    chosen_device: &Option<String>,
    shared_out: &mut Option<SharedOutputBackend>,
    audio_host: &cpal::Host,
    sink_slot: &mut Option<Sink>,
    live_device_label: &mut Option<String>,
    wanted_mode: &mut AudioOutputMode,
    live_mode: &mut AudioOutputMode,
    downgrade_note: &mut Option<String>,
    active_file_path: &str,
    audible: bool,
    live_progress: &Arc<SharedProgress>,
    equalizer_rig: Arc<crate::player::equalizer::EqualizerHandle>,
    effect_rig: Arc<crate::player::sound_effect::SoundEffectHandle>,
    master_volume: Arc<AtomicU32>,
    balance_gain: f32,
    loudness_slot: &mut Option<VolumeNormalizerHandle>,
    remote_feed: Option<&RemoteStreamSource>,
    temp_file_feed: Option<&crate::player::stream_cache::StreamingTempFileState>,
    app: &AppHandle,
    status_slot: &Arc<Mutex<AudioOutputStatus>>,
    prior_system_default: &mut Option<String>,
) -> bool {
    let Some(outcome) = exclusive_session
        .as_ref()
        .and_then(|session| session.try_finished())
    else {
        return false;
    };

    teardown_exclusive_session(exclusive_session);

    if let Err(error) = outcome {
        *live_mode = AudioOutputMode::Shared;
        *downgrade_note = Some(format!(
            "WASAPI 独占模式已断开，已自动切回共享模式：{error}"
        ));

        reopen_shared_pipeline(
            chosen_device,
            shared_out,
            audio_host,
            sink_slot,
            live_device_label,
            active_file_path,
            audible,
            live_progress,
            equalizer_rig,
            effect_rig,
            master_volume,
            balance_gain,
            loudness_slot,
            remote_feed,
            temp_file_feed,
        );
        if chosen_device.is_none() {
            *prior_system_default = default_output_device_name(audio_host);
        }

        broadcast_output_state(
            app,
            status_slot,
            chosen_device,
            live_device_label,
            *wanted_mode,
            *live_mode,
            downgrade_note,
        );
    }

    true
}

// 把系统媒体键（SMTC/MPRIS）接到前端约定的事件名上
fn wire_media_buttons(hub: &mut MediaControls, app: &AppHandle) {
    let event_target = app.clone();
    let _ = hub.attach(move |button| {
        let plain_action: Option<&str> = match button {
            MediaControlEvent::Play => Some("player:play"),
            MediaControlEvent::Pause => Some("player:pause"),
            MediaControlEvent::Next => Some("player:next"),
            MediaControlEvent::Previous => Some("player:prev"),
            MediaControlEvent::Stop => Some("player:stop"),
            MediaControlEvent::SetPosition(at) => {
                let _ = event_target.emit("player:seek-to", at.0.as_secs_f64());
                None
            }
            _ => None,
        };
        if let Some(event_name) = plain_action {
            let _ = event_target.emit(event_name, ());
        }
    });
}

// 把初始化好的媒体控制实例挂进全局槽位
fn install_controls(hub: &Arc<Mutex<Option<MediaControls>>>, mounted: MediaControls) {
    *hub.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(mounted);
}

fn boot_media_key_hub(app: &AppHandle) -> Arc<Mutex<Option<MediaControls>>> {
    let hub: Arc<Mutex<Option<MediaControls>>> = Arc::new(Mutex::new(None));

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        let platform = PlatformConfig {
            dbus_name: "xianyu_music",
            display_name: "XianYu Music",
            hwnd: None,
        };

        match MediaControls::new(platform) {
            Ok(mut mounted) => {
                wire_media_buttons(&mut mounted, app);
                install_controls(&hub, mounted);
            }
            Err(error) => eprintln!("Error initializing MediaControls: {:?}", error),
        }
    }

    #[cfg(target_os = "windows")]
    if let Some(main_window) = app.get_webview_window("main") {
        if let Ok(window_ref) = main_window.window_handle() {
            if let RawWindowHandle::Win32(win32) = window_ref.as_raw() {
                let platform = PlatformConfig {
                    dbus_name: "xianyu_music",
                    display_name: "XianYu Music",
                    hwnd: Some(win32.hwnd.get() as *mut std::ffi::c_void),
                };

                match MediaControls::new(platform) {
                    Ok(mut mounted) => {
                        wire_media_buttons(&mut mounted, app);
                        install_controls(&hub, mounted);
                    }
                    Err(error) => eprintln!("Error initializing MediaControls: {:?}", error),
                }
            }
        }
    }

    hub
}

// 远程流一次后台预取的产出形态
enum FetchedSlice {
    // 命中 Range：拿到 [offset, offset+SLICE) 的分片，total 是服务器声明的总长
    Slice {
        offset: u64,
        payload: Vec<u8>,
        total: Option<u64>,
    },
    // 服务器无视 Range，整曲一次性返回
    WholeBody {
        payload: Vec<u8>,
    },
    // 预取失败（网络/状态码/IO）
    Failure {
        offset: u64,
        message: String,
    },
}

pub(crate) struct RemoteRangeReader {
    http: reqwest::blocking::Client,
    origin: RemoteStreamSource,
    cursor: u64,
    known_size: Option<u64>,
    slice_base: u64,
    slice: Vec<u8>,
    rangeless: bool,
    whole_payload: Option<Vec<u8>>,
    queued_slice: Arc<Mutex<Option<FetchedSlice>>>,
    slice_pending: Arc<AtomicBool>,
    pending_base: u64,
}

impl RemoteRangeReader {
    pub(crate) fn new(origin_source: RemoteStreamSource) -> Result<Self, String> {
        let http = crate::netproxy::blocking_client_builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .gzip(true)
            .brotli(true)
            .deflate(true)
            .redirect(crate::security::ssrf::ip_literal_redirect_policy())
            .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            http,
            origin: origin_source,
            cursor: 0,
            known_size: None,
            slice_base: 0,
            slice: Vec::new(),
            rangeless: false,
            whole_payload: None,
            queued_slice: Arc::new(Mutex::new(None)),
            slice_pending: Arc::new(AtomicBool::new(false)),
            pending_base: 0,
        })
    }

    // Range 被无视时的兜底：整曲拉回内存
    fn download_entire(&mut self) -> std::io::Result<()> {
        let request = self.http.get(&self.origin.url);
        let mut response = Self::sign_request(request, &self.origin)
            .send()
            .map_err(std::io::Error::other)?;
        if !response.status().is_success() {
            return Err(std::io::Error::other(format!(
                "远程音频下载失败：{}",
                response.status()
            )));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        let looks_like_page = content_type.contains("text/html")
            || content_type.contains("application/json")
            || content_type.contains("text/plain");
        let mut payload = Vec::new();
        response.read_to_end(&mut payload)?;
        if looks_like_page {
            return Err(std::io::Error::other(format!(
                "服务器返回非音频内容 (Content-Type: {})，可能需要防盗链 headers 或 URL 已失效",
                content_type
            )));
        }
        self.known_size = Some(payload.len() as u64);
        self.whole_payload = Some(payload);
        self.rangeless = true;
        Ok(())
    }

    // 按来源配置补齐认证、UA、防盗链与自定义头
    fn sign_request(
        request: reqwest::blocking::RequestBuilder,
        origin: &RemoteStreamSource,
    ) -> reqwest::blocking::RequestBuilder {
        let mut signed = match origin
            .username
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            Some(account) => request.basic_auth(account.to_string(), origin.password.clone()),
            None => request,
        };
        if let Some(agent) = origin
            .user_agent
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            signed = signed.header(reqwest::header::USER_AGENT, agent);
        }
        if let Some(referrer) = origin.referer.as_deref().filter(|value| !value.is_empty()) {
            signed = signed.header(reqwest::header::REFERER, referrer);
        }
        if let Some(extra) = &origin.headers {
            for (key, value) in extra {
                if let (Ok(parsed_name), Ok(parsed_value)) = (
                    reqwest::header::HeaderName::from_bytes(key.as_bytes()),
                    reqwest::header::HeaderValue::from_str(value),
                ) {
                    signed = signed.header(parsed_name, parsed_value);
                }
            }
        }
        signed
    }

    // 从 Content-Range: bytes x-y/total 中抠出总长
    fn response_total_size(response: &reqwest::blocking::Response) -> Option<u64> {
        let raw = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)?
            .to_str()
            .ok()?;
        let tail = raw.rsplit('/').next()?.trim();
        let size: u64 = tail.parse().ok()?;
        (size > 0).then_some(size)
    }

    // 离当前读取位置还有半片时，后台把下一片拉好
    fn queue_slice_prefetch(&mut self, from: u64) {
        if let Some(size) = self.known_size {
            if from >= size {
                return;
            }
        }
        *self
            .queued_slice
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
        self.slice_pending.store(true, Ordering::Relaxed);
        self.pending_base = from;

        let http = self.http.clone();
        let origin = self.origin.clone();
        let slot = self.queued_slice.clone();
        let gate = self.slice_pending.clone();
        let until = from.saturating_add(STREAM_SLICE_BYTES - 1);

        thread::spawn(move || {
            let request = http
                .get(&origin.url)
                .header(reqwest::header::RANGE, format!("bytes={from}-{until}"));
            let result = match Self::sign_request(request, &origin).send() {
                Ok(mut response) => {
                    if response.status() == reqwest::StatusCode::OK {
                        // 服务器无视 Range，整曲读回
                        let mut payload = Vec::new();
                        match response.read_to_end(&mut payload) {
                            Ok(_) => FetchedSlice::WholeBody { payload },
                            Err(e) => FetchedSlice::Failure {
                                offset: from,
                                message: e.to_string(),
                            },
                        }
                    } else if response.status().is_success()
                        || response.status() == reqwest::StatusCode::PARTIAL_CONTENT
                    {
                        let total = Self::response_total_size(&response);
                        let mut capped = response.by_ref().take(STREAM_SLICE_BYTES);
                        let mut payload = Vec::new();
                        match capped.read_to_end(&mut payload) {
                            Ok(_) => FetchedSlice::Slice {
                                offset: from,
                                payload,
                                total,
                            },
                            Err(e) => FetchedSlice::Failure {
                                offset: from,
                                message: e.to_string(),
                            },
                        }
                    } else {
                        FetchedSlice::Failure {
                            offset: from,
                            message: format!("HTTP {}", response.status()),
                        }
                    }
                }
                Err(e) => FetchedSlice::Failure {
                    offset: from,
                    message: e.to_string(),
                },
            };
            *slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(result);
            gate.store(false, Ordering::Relaxed);
        });
    }

    // 预取已落地就取走结果；还在路上则返回 None
    fn collect_finished_prefetch(&mut self) -> Option<FetchedSlice> {
        if self.slice_pending.load(Ordering::Relaxed) {
            return None;
        }
        self.queued_slice
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
    }

    fn prefetch_still_running(&self) -> bool {
        self.slice_pending.load(Ordering::Relaxed)
    }

    fn drop_queued_prefetch(&mut self) {
        self.slice_pending.store(false, Ordering::Relaxed);
        *self
            .queued_slice
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }

    // 确保游标所在分片已就位：优先消费预取，落空则同步拉取
    fn load_slice_at(&mut self, from: u64) -> std::io::Result<()> {
        if let Some(prebuilt) = self.collect_finished_prefetch() {
            match prebuilt {
                FetchedSlice::Slice {
                    offset: slice_offset,
                    payload,
                    total,
                } if slice_offset == from => {
                    if let Some(size) = total {
                        self.known_size = Some(size);
                    } else if payload.len() < STREAM_SLICE_BYTES as usize {
                        self.known_size = Some(from + payload.len() as u64);
                    }
                    self.slice_base = from;
                    self.slice = payload;
                    return Ok(());
                }
                FetchedSlice::WholeBody { payload } => {
                    self.known_size = Some(payload.len() as u64);
                    self.whole_payload = Some(payload);
                    self.rangeless = true;
                    return Ok(());
                }
                FetchedSlice::Failure {
                    offset: failed_at,
                    message,
                } if failed_at == from => {
                    eprintln!("[Audio][remote] 流预取失败 start={failed_at}: {message}");
                }
                _ => {}
            }
        }

        let until = from.saturating_add(STREAM_SLICE_BYTES - 1);
        let request = self
            .http
            .get(&self.origin.url)
            .header(reqwest::header::RANGE, format!("bytes={from}-{until}"));
        let mut response = Self::sign_request(request, &self.origin)
            .send()
            .map_err(std::io::Error::other)?;
        if !(response.status().is_success()
            || response.status() == reqwest::StatusCode::PARTIAL_CONTENT)
        {
            return Err(std::io::Error::other(format!(
                "远程音频播放失败：{}",
                response.status()
            )));
        }
        if response.status() == reqwest::StatusCode::OK {
            // 没拿到 206：整曲读回后走 rangeless 通道
            let mut payload = Vec::new();
            response.read_to_end(&mut payload)?;
            self.known_size = Some(payload.len() as u64);
            self.whole_payload = Some(payload);
            self.rangeless = true;
            return Ok(());
        }

        if let Some(size) = Self::response_total_size(&response) {
            self.known_size = Some(size);
        }

        let mut capped = response.by_ref().take(STREAM_SLICE_BYTES);
        let mut payload = Vec::new();
        capped.read_to_end(&mut payload)?;
        self.slice_base = from;
        if self.known_size.is_none() && payload.len() < STREAM_SLICE_BYTES as usize {
            self.known_size = Some(from + payload.len() as u64);
        }
        self.slice = payload;
        Ok(())
    }

    // 读取前保证游标覆盖在有效分片内，并按余量决定是否提前 prefetch
    fn top_up_slice(&mut self) -> std::io::Result<()> {
        let slice_end = self.slice_base.saturating_add(self.slice.len() as u64);
        if self.cursor >= self.slice_base && self.cursor < slice_end {
            let left = slice_end - self.cursor;
            if left <= STREAM_SLICE_BYTES / 2 && !self.prefetch_still_running() {
                self.queue_slice_prefetch(slice_end);
            }
            return Ok(());
        }
        self.load_slice_at(self.cursor)?;
        let following_base = self.slice_base.saturating_add(self.slice.len() as u64);
        if !self.prefetch_still_running() {
            self.queue_slice_prefetch(following_base);
        }
        Ok(())
    }
}

impl Read for RemoteRangeReader {
    fn read(&mut self, sink_buf: &mut [u8]) -> std::io::Result<usize> {
        if sink_buf.is_empty() {
            return Ok(0);
        }

        // rangeless 通道：直接在整曲内存体上切片
        if self.rangeless {
            if self.whole_payload.is_none() {
                self.download_entire()?;
            }
            let payload = self
                .whole_payload
                .as_ref()
                .ok_or_else(|| std::io::Error::other("full_body not initialized"))?;
            let at = self.cursor as usize;
            if at >= payload.len() {
                return Ok(0);
            }
            let ready = payload.len() - at;
            let moved = ready.min(sink_buf.len());
            sink_buf[..moved].copy_from_slice(&payload[at..at + moved]);
            self.cursor = self.cursor.saturating_add(moved as u64);
            return Ok(moved);
        }

        if self
            .known_size
            .map(|size| self.cursor >= size)
            .unwrap_or(false)
        {
            return Ok(0);
        }

        self.top_up_slice()?;

        // top_up 可能触发整曲下载并切回 rangeless 通道
        if self.rangeless {
            return self.read(sink_buf);
        }

        if self.slice.is_empty() {
            return Ok(0);
        }

        let within = self.cursor.saturating_sub(self.slice_base) as usize;
        let ready = self.slice.len().saturating_sub(within);
        let moved = ready.min(sink_buf.len());
        sink_buf[..moved].copy_from_slice(&self.slice[within..within + moved]);
        self.cursor = self.cursor.saturating_add(moved as u64);
        Ok(moved)
    }
}

impl Seek for RemoteRangeReader {
    fn seek(&mut self, anchor: SeekFrom) -> std::io::Result<u64> {
        let resolved: i128 = match anchor {
            SeekFrom::Start(offset) => offset as i128,
            SeekFrom::Current(delta) => self.cursor as i128 + delta as i128,
            SeekFrom::End(delta) => {
                let size = match self.known_size {
                    Some(size) => size,
                    None => {
                        return Err(std::io::Error::other("远程音频长度未知，无法跳转"));
                    }
                };
                size as i128 + delta as i128
            }
        };
        if resolved < 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "跳转位置不能小于 0",
            ));
        }
        self.drop_queued_prefetch();
        self.cursor = resolved as u64;
        Ok(self.cursor)
    }
}

// 把 reader 走完解码链后挂上 sink：降混 → 跳过偏移 → 缓冲监视 → 响度 → EQ → 音效 → 插件 → 主音量 → 限幅 → 计量
#[allow(clippy::too_many_arguments)]
fn feed_decoder_chain<R>(
    reader: R,
    backend: &Option<SharedOutputBackend>,
    sink_slot: &mut Option<Sink>,
    live_progress: &Arc<SharedProgress>,
    resume_from: Option<Duration>,
    balance_gain: f32,
    loudness_slot: &mut Option<VolumeNormalizerHandle>,
    equalizer_rig: Arc<crate::player::equalizer::EqualizerHandle>,
    effect_rig: Arc<crate::player::sound_effect::SoundEffectHandle>,
    master_volume: Arc<AtomicU32>,
    origin_note: Option<String>,
) where
    R: Read + Seek + Send + Sync + 'static,
{
    let Some(backend) = backend else {
        return;
    };
    *sink_slot = backend.create_sink().ok();

    let buffered_reader = BufReader::with_capacity(512 * 1024, reader);
    let decoded = Decoder::new(buffered_reader);
    if let Err(e) = &decoded {
        if let Ok(mut reason) = live_progress.start_failed_reason.lock() {
            *reason = Some(match origin_note {
                Some(ctx) => format!("解码器初始化失败: {e}（{ctx}）"),
                None => format!("解码器初始化失败: {e}"),
            });
        }
        live_progress.start_failed.store(true, Ordering::Relaxed);
    }
    if let Ok(source) = decoded {
        let rate = source.sample_rate();
        let channels = source.channels();
        // 超过双声道的流（伪 6ch 全景声之类）rodio 不会自动下混，直接播会炸音，这里在样本层折成立体声
        let downmixed_lanes: u32 = if channels > 2 { 2 } else { channels as u32 };
        live_progress.sample_rate.store(rate, Ordering::Relaxed);
        live_progress
            .channels
            .store(downmixed_lanes, Ordering::Relaxed);

        // rodio 对某些容器会给出 u32::MAX 纳秒哨兵当作"未知时长"，这里识别为 0
        let duration_secs = source
            .total_duration()
            .map(|d| {
                if d.as_nanos() == u32::MAX as u128 {
                    0.0
                } else {
                    d.as_secs_f64()
                }
            })
            .unwrap_or(0.0);
        live_progress
            .total_duration_secs
            .store(duration_secs.to_bits(), Ordering::Relaxed);

        let offset = resume_from.unwrap_or(Duration::ZERO);
        let pre_skip =
            (offset.as_secs_f64() * rate as f64 * downmixed_lanes as f64).round() as u64;
        live_progress
            .samples_played
            .store(pre_skip, Ordering::Relaxed);
        if resume_from.is_none() {
            live_progress.visualizer.reset();
        }

        let f32_source = source.convert_samples::<f32>();
        let unified: Box<dyn Source<Item = f32> + Send> = if channels > 2 {
            crate::player::dolby_bridge::log_bridge(&format!(
                "多声道流下混: {channels}ch → 2ch @ {rate}Hz"
            ));
            Box::new(crate::player::channel_downmix::DownmixSource::new(
                f32_source,
                channels,
            ))
        } else {
            Box::new(f32_source)
        };

        let offset_applied = unified.skip_duration(offset);

        let watched = crate::player::buffered_source::BufferedSource::new_tracked(
            offset_applied,
            Some(live_progress.buffered.clone()),
        );

        let (leveled, handle) = VolumeNormalizer::new(watched, balance_gain, 100);
        *loudness_slot = Some(handle);

        let shaped = crate::player::equalizer::Equalizer::new(leveled, equalizer_rig);

        let flavored = crate::player::sound_effect::SoundEffectSource::new(shaped, effect_rig);

        let extended = crate::player::plugin_host::wrap(flavored);

        let gain_gated = crate::player::equalizer::UserVolumeSource::new(extended, master_volume);

        let safeguarded = crate::player::equalizer::ClipGuardSource::new(gain_gated);

        let metered = TimedSource::new(
            safeguarded,
            live_progress.samples_played.clone(),
            live_progress.visualizer.clone(),
        );

        if let Some(sink) = sink_slot {
            sink.append(metered);
            sink.set_volume(1.0);
            sink.play();
        }
    }
}

// 本地轨道的两种打开形态：普通明文 / QMC 加密需边读边解
enum DiskTrackHandle {
    Raw(File),
    Scrambled(crate::player::qmc2::QmcDecryptReader<File>),
}

impl Read for DiskTrackHandle {
    fn read(&mut self, target: &mut [u8]) -> std::io::Result<usize> {
        match self {
            DiskTrackHandle::Raw(file) => file.read(target),
            DiskTrackHandle::Scrambled(reader) => reader.read(target),
        }
    }
}

impl Seek for DiskTrackHandle {
    fn seek(&mut self, anchor: SeekFrom) -> std::io::Result<u64> {
        match self {
            DiskTrackHandle::Raw(file) => file.seek(anchor),
            DiskTrackHandle::Scrambled(reader) => reader.seek(anchor),
        }
    }
}

fn open_disk_track(track_path: &Path) -> Option<DiskTrackHandle> {
    let opened = File::open(track_path).ok()?;
    match crate::player::qmc2::detect_qmc_crypto(track_path) {
        Some(crypto) => Some(DiskTrackHandle::Scrambled(
            crate::player::qmc2::QmcDecryptReader::new(opened, crypto),
        )),
        None => Some(DiskTrackHandle::Raw(opened)),
    }
}

/// 本地文件的杜比透传桥：QMC 加密轨道先落成明文再送探，普通明文直接送探。
/// 探测命中 AC-4/EC-3 时交 ffmpeg 转 WAV；未命中返回 None 走常规解码路径。
pub(crate) fn bridge_local_file(
    path: &Path,
) -> Option<(
    Box<dyn crate::player::stream_cache::ReadSeek + Send + Sync + 'static>,
    crate::player::dolby_bridge::DolbyCodec,
)> {
    use crate::player::dolby_bridge::{bridge_if_dolby, materialize_plain_file, PlainTransform};
    let track_label = path.to_str()?;
    match crate::player::qmc2::detect_qmc_crypto(path) {
        Some(crypto) => {
            let plain_copy =
                materialize_plain_file(track_label, &PlainTransform::QmcCrypto(&crypto)).ok()?;
            let mut probe_handle = std::fs::File::open(&plain_copy).ok()?;
            bridge_if_dolby(
                &mut probe_handle,
                Some(plain_copy.to_str()?),
                track_label,
                &PlainTransform::None,
            )
        }
        None => {
            let mut probe_handle = std::fs::File::open(path).ok()?;
            bridge_if_dolby(
                &mut probe_handle,
                Some(track_label),
                track_label,
                &PlainTransform::None,
            )
        }
    }
}

/// 流式临时文件的杜比透传桥：reader 已携带解密后的明文流，直接送探；
/// 命中后按 state 的加密上下文转成明文交给 ffmpeg。
pub(crate) fn bridge_streaming_state(
    state: &crate::player::stream_cache::StreamingTempFileState,
    reader: &mut dyn crate::player::stream_cache::ReadSeek,
) -> Option<(
    Box<dyn crate::player::stream_cache::ReadSeek + Send + Sync + 'static>,
    crate::player::dolby_bridge::DolbyCodec,
)> {
    use crate::player::dolby_bridge::{bridge_if_dolby, PlainTransform};
    let decryption_key = state.ekey();
    let cenc_gate: Option<(String, crate::player::cenc::CencMetadata)> =
        if state.cenc_streaming.load(std::sync::atomic::Ordering::Relaxed) {
            let metadata = state
                .cenc_metadata
                .lock()
                .ok()
                .and_then(|meta| meta.clone());
            match (state.cek(), metadata) {
                (Some(key), Some(meta)) => Some((key, meta)),
                _ => None,
            }
        } else {
            None
        };
    // transform 的生命周期覆盖 bridge 调用；metadata 仅作门控（元数据解析完成前不进桥）
    if let Some((key, _)) = &cenc_gate {
        return bridge_if_dolby(reader, None, &state.path, &PlainTransform::Cenc(key));
    }
    if let Some(key) = &decryption_key {
        return bridge_if_dolby(reader, None, &state.path, &PlainTransform::QmcEkey(key));
    }
    bridge_if_dolby(reader, Some(&state.path), &state.path, &PlainTransform::None)
}

// 起播：记录路径、清簿记，再按来源（本地/WebDAV/流式缓存）接上解码链
#[allow(clippy::too_many_arguments)]
fn handle_play(
    music_source: AudioSource,
    backend: &Option<SharedOutputBackend>,
    sink_slot: &mut Option<Sink>,
    active_file_path: &mut String,
    audible: &mut bool,
    live_progress: &Arc<SharedProgress>,
    begin_at_ms: Option<u64>,
    balance_gain: f32,
    loudness_slot: &mut Option<VolumeNormalizerHandle>,
    equalizer_rig: Arc<crate::player::equalizer::EqualizerHandle>,
    effect_rig: Arc<crate::player::sound_effect::SoundEffectHandle>,
    master_volume: Arc<AtomicU32>,
) {
    *active_file_path = music_source.display_path();
    *audible = true;
    wipe_progress_bookkeeping(live_progress);

    if backend.is_none() {
        if let Ok(mut reason) = live_progress.start_failed_reason.lock() {
            *reason = Some("未检测到可用的音频输出设备，请检查扬声器/耳机是否已连接".to_string());
        }
        live_progress.start_failed.store(true, Ordering::Relaxed);
        return;
    }

    if let Some(sink) = sink_slot {
        sink.stop();
    }

    let resume_from = begin_at_ms.map(Duration::from_millis);

    crate::player::dolby_bridge::log_bridge(&format!(
        "handle_play: source={} path={}",
        match &music_source {
            AudioSource::LocalFile(_) => "LocalFile",
            AudioSource::RemoteWebDav(_) => "RemoteWebDav",
            AudioSource::StreamingTempFile(_) => "StreamingTempFile",
        },
        music_source.display_path()
    ));

    match music_source {
        AudioSource::LocalFile(track) => {
            if let Some((wav_reader, codec)) = bridge_local_file(Path::new(&track)) {
                feed_decoder_chain(
                    wav_reader,
                    backend,
                    sink_slot,
                    live_progress,
                    resume_from,
                    balance_gain,
                    loudness_slot,
                    equalizer_rig,
                    effect_rig,
                    master_volume,
                    Some(format!("dolby {} → wav", codec.as_str())),
                );
            } else if let Some(track_handle) = open_disk_track(Path::new(&track)) {
                feed_decoder_chain(
                    track_handle,
                    backend,
                    sink_slot,
                    live_progress,
                    resume_from,
                    balance_gain,
                    loudness_slot,
                    equalizer_rig,
                    effect_rig,
                    master_volume,
                    None,
                );
            } else if let Ok(mut reason) = live_progress.start_failed_reason.lock() {
                *reason = Some("本地音频文件打开失败".to_string());
                live_progress.start_failed.store(true, Ordering::Relaxed);
            }
        }
        AudioSource::RemoteWebDav(web_stream) => match RemoteRangeReader::new(web_stream) {
            Ok(track_handle) => feed_decoder_chain(
                track_handle,
                backend,
                sink_slot,
                live_progress,
                resume_from,
                balance_gain,
                loudness_slot,
                equalizer_rig,
                effect_rig,
                master_volume,
                None,
            ),
            Err(err) => {
                if let Ok(mut reason) = live_progress.start_failed_reason.lock() {
                    *reason = Some(format!("远程流读取器构建失败: {err}"));
                }
                live_progress.start_failed.store(true, Ordering::Relaxed);
            }
        },
        AudioSource::StreamingTempFile(cache_state) => {
            match cache_state.new_reader_with_decryption() {
                Ok(mut track_handle) => {
                    let size = cache_state.downloaded_bytes();
                    let status = if cache_state.is_download_finished() {
                        if cache_state.download_complete.load(Ordering::Relaxed) {
                            "下载完成".to_string()
                        } else {
                            format!(
                                "下载失败: {}",
                                cache_state
                                    .download_error()
                                    .unwrap_or_else(|| "未知原因".to_string())
                            )
                        }
                    } else {
                        "下载中".to_string()
                    };
                    if let Some((wav_reader, codec)) =
                        bridge_streaming_state(&cache_state, &mut *track_handle)
                    {
                        feed_decoder_chain(
                            wav_reader,
                            backend,
                            sink_slot,
                            live_progress,
                            resume_from,
                            balance_gain,
                            loudness_slot,
                            equalizer_rig,
                            effect_rig,
                            master_volume,
                            Some(format!(
                                "dolby {} → wav，已下载 {size} bytes",
                                codec.as_str()
                            )),
                        );
                    } else {
                        feed_decoder_chain(
                            track_handle,
                            backend,
                            sink_slot,
                            live_progress,
                            resume_from,
                            balance_gain,
                            loudness_slot,
                            equalizer_rig,
                            effect_rig,
                            master_volume,
                            Some(format!("已下载 {size} bytes，{status}")),
                        );
                    }
                }
                Err(err) => {
                    if let Ok(mut reason) = live_progress.start_failed_reason.lock() {
                        *reason = Some(format!("流式临时文件读取器构建失败: {err}"));
                    }
                    live_progress.start_failed.store(true, Ordering::Relaxed);
                }
            }
        }
    }
}

// seek 失败后的重建路径：按当前来源重新打开并从目标位置续播
#[allow(clippy::too_many_arguments)]
fn reposition_playhead(
    requested_time: f64,
    should_resume: bool,
    pending_id: u64,
    backend: &Option<SharedOutputBackend>,
    sink_slot: &mut Option<Sink>,
    active_file_path: &str,
    audible: &mut bool,
    live_progress: &Arc<SharedProgress>,
    app: &AppHandle,
    balance_gain: f32,
    loudness_slot: &mut Option<VolumeNormalizerHandle>,
    equalizer_rig: Arc<crate::player::equalizer::EqualizerHandle>,
    effect_rig: Arc<crate::player::sound_effect::SoundEffectHandle>,
    master_volume: Arc<AtomicU32>,
    remote_feed: Option<&RemoteStreamSource>,
    temp_file_feed: Option<&crate::player::stream_cache::StreamingTempFileState>,
) {
    let landing = requested_time.max(0.0);
    let jump_target = Duration::from_secs_f64(landing);
    *audible = should_resume;
    live_progress.visualizer.reset();

    if let Some(sink) = sink_slot {
        match sink.try_seek(jump_target) {
            Ok(()) => {
                let at_target = samples_for_position(landing, live_progress);
                live_progress
                    .samples_played
                    .store(at_target, Ordering::Relaxed);

                if should_resume {
                    sink.play();
                } else {
                    sink.pause();
                }
            }
            Err(_) => {
                // rodio 拒绝原地 seek：整条解码链推倒重建，从目标位置起播
                sink.stop();

                let resume_from = Some(jump_target);
                if let Some(cache_state) = temp_file_feed {
                    match cache_state.new_reader_with_decryption() {
                        Ok(mut track_handle) => {
                            if let Some((wav_reader, codec)) =
                                bridge_streaming_state(cache_state, &mut *track_handle)
                            {
                                feed_decoder_chain(
                                    wav_reader,
                                    backend,
                                    sink_slot,
                                    live_progress,
                                    resume_from,
                                    balance_gain,
                                    loudness_slot,
                                    equalizer_rig,
                                    effect_rig,
                                    master_volume,
                                    Some(format!(
                                        "dolby {} → wav（seek 重建）",
                                        codec.as_str()
                                    )),
                                );
                            } else {
                                feed_decoder_chain(
                                    track_handle,
                                    backend,
                                    sink_slot,
                                    live_progress,
                                    resume_from,
                                    balance_gain,
                                    loudness_slot,
                                    equalizer_rig,
                                    effect_rig,
                                    master_volume,
                                    None,
                                );
                            }
                        }
                        Err(_) => {}
                    }
                } else if let Some(web_stream) = remote_feed.cloned() {
                    match RemoteRangeReader::new(web_stream) {
                        Ok(track_handle) => feed_decoder_chain(
                            track_handle,
                            backend,
                            sink_slot,
                            live_progress,
                            resume_from,
                            balance_gain,
                            loudness_slot,
                            equalizer_rig,
                            effect_rig,
                            master_volume,
                            None,
                        ),
                        Err(_) => {}
                    }
                } else if !active_file_path.is_empty() {
                    if let Some((wav_reader, codec)) =
                        bridge_local_file(Path::new(active_file_path))
                    {
                        feed_decoder_chain(
                            wav_reader,
                            backend,
                            sink_slot,
                            live_progress,
                            resume_from,
                            balance_gain,
                            loudness_slot,
                            equalizer_rig,
                            effect_rig,
                            master_volume,
                            Some(format!(
                                "dolby {} → wav（seek 重建）",
                                codec.as_str()
                            )),
                        );
                    } else if let Some(track_handle) =
                        open_disk_track(Path::new(active_file_path))
                    {
                        feed_decoder_chain(
                            track_handle,
                            backend,
                            sink_slot,
                            live_progress,
                            resume_from,
                            balance_gain,
                            loudness_slot,
                            equalizer_rig,
                            effect_rig,
                            master_volume,
                            None,
                        );
                    }
                }

                if !should_resume {
                    if let Some(fresh_sink) = sink_slot {
                        fresh_sink.pause();
                    }
                }
            }
        }
    } else {
        // 没有 sink 可 seek 时仅校准计数，保证进度条不回跳
        let at_target = samples_for_position(landing, live_progress);
        live_progress
            .samples_played
            .store(at_target, Ordering::Relaxed);
    }

    let _ = app.emit(
        "seek_completed",
        SeekCompletedPayload {
            request_id: pending_id,
            time: landing,
        },
    );
}

// 每个轮询节拍巡检一次网络缓冲健康度：断流压停、来数放行、广播缓冲状态
#[allow(clippy::too_many_arguments)]
fn survey_stream_health(
    live_progress: &SharedProgress,
    sink_slot: &Option<Sink>,
    stream_over_network: bool,
    audible: bool,
    app: &AppHandle,
    watchdog_held_sink: &mut bool,
    watchdog_buffer_flag: &mut bool,
    watchdog_starve_marker: &mut Option<std::time::Instant>,
    watchdog_grace_marker: &mut Option<std::time::Instant>,
) {
    if !stream_over_network {
        return;
    }

    let now = std::time::Instant::now();
    let starved = live_progress.buffered.starved.load(Ordering::Relaxed);
    let produced = live_progress.buffered.produced.swap(false, Ordering::Relaxed);

    // 压停期间来过数即视为已恢复，本轮不算断流
    let revived = produced && *watchdog_held_sink;
    let starved = starved && !revived;

    if starved && audible && !*watchdog_held_sink {
        let since = watchdog_starve_marker.get_or_insert(now);
        if now.saturating_duration_since(*since) >= STARVE_PAUSE_THRESHOLD {
            if let Some(sink) = sink_slot {
                sink.pause();
            }
            *watchdog_held_sink = true;
            *watchdog_starve_marker = None;
            if !*watchdog_buffer_flag {
                *watchdog_buffer_flag = true;
                let _ =
                    app.emit("playback:buffer", PlaybackBufferPayload { buffering: true });
            }
        }
    } else if starved {
        // 断流但（未在播/已压停）：只记起点，等条件满足再压
        *watchdog_starve_marker = Some(now);
        *watchdog_grace_marker = None;
    } else {
        *watchdog_starve_marker = None;

        if *watchdog_held_sink {
            if !audible {
                if *watchdog_buffer_flag {
                    *watchdog_buffer_flag = false;
                    let _ = app.emit(
                        "playback:buffer",
                        PlaybackBufferPayload { buffering: false },
                    );
                }
                *watchdog_held_sink = false;
                return;
            }
            if watchdog_grace_marker.is_none() {
                *watchdog_grace_marker = Some(now);
            }
            let held = watchdog_grace_marker
                .and_then(|marked| now.checked_duration_since(marked))
                .unwrap_or_default();
            if held >= RESUME_GRACE_WINDOW {
                *watchdog_grace_marker = None;
                if let Some(sink) = sink_slot {
                    sink.play();
                }
                *watchdog_held_sink = false;
                if *watchdog_buffer_flag {
                    *watchdog_buffer_flag = false;
                    let _ = app.emit(
                        "playback:buffer",
                        PlaybackBufferPayload { buffering: false },
                    );
                }
            }
        } else if *watchdog_buffer_flag {
            *watchdog_buffer_flag = false;
            let _ = app.emit(
                "playback:buffer",
                PlaybackBufferPayload { buffering: false },
            );
        }
    }
}

pub fn init_player(app: &AppHandle) -> PlayerState {
    let (command_tx, command_rx) = channel::<AudioCommand>();
    let runtime_progress = Arc::new(SharedProgress {
        is_playing: Arc::new(AtomicBool::new(false)),
        total_duration_secs: Arc::new(AtomicU64::default()),
        buffered: Arc::new(BufferedMonitor::new()),
        start_failed_reason: Arc::new(std::sync::Mutex::new(None)),
        start_failed: Arc::new(AtomicBool::new(false)),
        visualizer: Arc::new(SharedVisualizer::new()),
        channels: Arc::new(AtomicU32::from(2)),
        sample_rate: Arc::new(AtomicU32::from(44_100)),
        samples_played: Arc::new(AtomicU64::default()),
    });
    let live_progress = runtime_progress.clone();
    let worker_app = app.clone();
    let media_hub = boot_media_key_hub(app);
    let output_status_slot = Arc::new(Mutex::new(AudioOutputStatus::default()));
    let worker_status = output_status_slot.clone();
    let worker_controls = media_hub.clone();

    let worker_eq = Arc::new(crate::player::equalizer::EqualizerHandle::new(
        crate::player::equalizer::EqualizerSettings::default(),
    ));
    let worker_se = Arc::new(crate::player::sound_effect::SoundEffectHandle::new(
        crate::player::sound_effect::SoundEffectSettings::default(),
    ));
    let master_volume = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
    let worker_master_volume = master_volume.clone();

    std::thread::spawn(move || {
        let audio_host = cpal::default_host();
        let mut chosen_device: Option<String> = None;
        let mut shared_out = SharedOutputBackend::open(&audio_host, None).ok();
        let mut sink_slot: Option<Sink> = None;
        #[cfg(target_os = "windows")]
        let mut exclusive_session: Option<WasapiExclusivePlayback> = None;
        let mut active_file_path = String::new();
        let mut speaker_gain = 1.0_f32;
        let tempo_scale = 1.0_f32;
        let mut audible = false;
        let mut wanted_mode = AudioOutputMode::Shared;
        let mut live_mode = AudioOutputMode::Shared;
        let mut downgrade_note: Option<String> = None;
        let mut prior_system_default = default_output_device_name(&audio_host);
        let mut live_device_label = shared_out
            .as_ref()
            .map(|backend| backend.active_device_name().to_string());
        let mut loudness_slot: Option<VolumeNormalizerHandle> = None;
        let mut balance_gain_live = 1.0_f32;
        let mut dsd_passthrough_live = true;
        let mut bit_perfect_live = false;
        let mut last_progress_burst = std::time::Instant::now();
        let mut last_output_salvage = std::time::Instant::now();
        let mut remote_feed: Option<RemoteStreamSource> = None;
        let mut temp_file_feed: Option<crate::player::stream_cache::StreamingTempFileState> =
            None;
        let mut watchdog_held_sink = false;
        let mut watchdog_buffer_flag = false;
        let mut watchdog_starve_marker: Option<std::time::Instant> = None;
        let mut watchdog_grace_marker: Option<std::time::Instant> = None;
        let mut stream_over_network = false;

        if let Some(backend) = &shared_out {
            sink_slot = backend.create_sink().ok();
        }

        broadcast_output_state(
            &worker_app,
            &worker_status,
            &chosen_device,
            &live_device_label,
            wanted_mode,
            live_mode,
            &downgrade_note,
        );

        'command_pump: loop {
            live_progress
                .is_playing
                .store(audible, Ordering::Relaxed);
            survey_stream_health(
                &live_progress,
                &sink_slot,
                stream_over_network,
                audible,
                &worker_app,
                &mut watchdog_held_sink,
                &mut watchdog_buffer_flag,
                &mut watchdog_starve_marker,
                &mut watchdog_grace_marker,
            );

            #[cfg(target_os = "windows")]
            {
                confine_device_fault(|| {
                    drain_finished_exclusive(
                        &mut exclusive_session,
                        &chosen_device,
                        &mut shared_out,
                        &audio_host,
                        &mut sink_slot,
                        &mut live_device_label,
                        &mut wanted_mode,
                        &mut live_mode,
                        &mut downgrade_note,
                        &active_file_path,
                        audible,
                        &live_progress,
                        worker_eq.clone(),
                        worker_se.clone(),
                        worker_master_volume.clone(),
                        balance_gain_live,
                        &mut loudness_slot,
                        remote_feed.as_ref(),
                        temp_file_feed.as_ref(),
                        &worker_app,
                        &worker_status,
                        &mut prior_system_default,
                    );
                });
            }

            match command_rx.recv_timeout(COMMAND_WAIT_TICK) {
                Ok(incoming) => {
                    let outcome =
                        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match incoming {
                            AudioCommand::Play {
                                source: music_source,
                                output_mode: requested_mode,
                                start_offset_ms: begin_at_ms,
                                volume_balance_gain: requested_balance,
                                dsd_native_passthrough,
                                bit_perfect,
                            } => {
                                wanted_mode = requested_mode;
                                balance_gain_live = requested_balance;
                                dsd_passthrough_live = dsd_native_passthrough;
                                bit_perfect_live = bit_perfect;
                                let stream_backed = music_source.is_network_backed();
                                let track_label = music_source.display_path();
                                remote_feed = match &music_source {
                                    AudioSource::RemoteWebDav(web) => Some(web.clone()),
                                    AudioSource::LocalFile(_) => None,
                                    AudioSource::StreamingTempFile(_) => None,
                                };
                                temp_file_feed = match &music_source {
                                    AudioSource::StreamingTempFile(cache) => Some(cache.clone()),
                                    _ => None,
                                };
                                stream_over_network = stream_backed;
                                watchdog_held_sink = false;
                                watchdog_buffer_flag = false;
                                watchdog_starve_marker = None;
                                watchdog_grace_marker = None;

                                if let Some(sink) = &sink_slot {
                                    sink.stop();
                                }
                                sink_slot = None;
                                #[cfg(target_os = "windows")]
                                teardown_exclusive_session(&mut exclusive_session);

                                #[cfg(target_os = "windows")]
                                if requested_mode == AudioOutputMode::WasapiExclusive
                                    && !stream_backed
                                {
                                    let exclusive_start = begin_at_ms
                                        .map(Duration::from_millis)
                                        .unwrap_or(Duration::ZERO);
                                    match launch_exclusive_session(
                                        track_label.clone(),
                                        chosen_device.clone(),
                                        speaker_gain,
                                        true,
                                        exclusive_start,
                                        &live_progress,
                                        balance_gain_live,
                                        worker_eq.clone(),
                                        worker_se.clone(),
                                        worker_master_volume.clone(),
                                        dsd_passthrough_live,
                                        bit_perfect_live,
                                    ) {
                                        Ok(session) => {
                                            if chosen_device.is_none() {
                                                prior_system_default =
                                                    default_output_device_name(&audio_host);
                                            }
                                            live_device_label =
                                                Some(session.active_device_name().to_string());
                                            live_mode = AudioOutputMode::WasapiExclusive;
                                            downgrade_note = None;
                                            active_file_path = track_label;
                                            audible = true;
                                            exclusive_session = Some(session);
                                            sink_slot = None;
                                            shared_out = None;

                                            broadcast_output_state(
                                                &worker_app,
                                                &worker_status,
                                                &chosen_device,
                                                &live_device_label,
                                                wanted_mode,
                                                live_mode,
                                                &downgrade_note,
                                            );
                                            return;
                                        }
                                        Err(error) => {
                                            live_mode = AudioOutputMode::Shared;
                                            downgrade_note = Some(error);
                                        }
                                    }
                                }
                                #[cfg(target_os = "windows")]
                                if requested_mode == AudioOutputMode::WasapiExclusive
                                    && stream_backed
                                {
                                    live_mode = AudioOutputMode::Shared;
                                    downgrade_note =
                                        Some("网络音频使用共享模式缓冲播放".to_string());
                                }

                                #[cfg(not(target_os = "windows"))]
                                if requested_mode == AudioOutputMode::WasapiExclusive {
                                    live_mode = AudioOutputMode::Shared;
                                    downgrade_note = Some(
                                        "WASAPI exclusive mode is only available on Windows"
                                            .to_string(),
                                    );
                                }

                                if live_mode == AudioOutputMode::Shared {
                                    confine_device_fault(|| {
                                        shared_out = SharedOutputBackend::open(
                                            &audio_host,
                                            chosen_device.as_deref(),
                                        )
                                        .ok();
                                    });
                                    if chosen_device.is_none() {
                                        prior_system_default =
                                            default_output_device_name(&audio_host);
                                    }
                                    live_device_label = shared_out
                                        .as_ref()
                                        .map(|backend| backend.active_device_name().to_string());
                                }

                                broadcast_output_state(
                                    &worker_app,
                                    &worker_status,
                                    &chosen_device,
                                    &live_device_label,
                                    wanted_mode,
                                    live_mode,
                                    &downgrade_note,
                                );

                                handle_play(
                                    music_source,
                                    &shared_out,
                                    &mut sink_slot,
                                    &mut active_file_path,
                                    &mut audible,
                                    &live_progress,
                                    begin_at_ms,
                                    balance_gain_live,
                                    &mut loudness_slot,
                                    worker_eq.clone(),
                                    worker_se.clone(),
                                    worker_master_volume.clone(),
                                );
                                if tempo_scale != 1.0 {
                                    if let Some(sink) = &sink_slot {
                                        sink.set_speed(tempo_scale);
                                    }
                                }
                            }
                            AudioCommand::Pause => {
                                audible = false;
                                if watchdog_buffer_flag {
                                    watchdog_buffer_flag = false;
                                    let _ = worker_app.emit(
                                        "playback:buffer",
                                        PlaybackBufferPayload { buffering: false },
                                    );
                                }
                                if let Some(sink) = &sink_slot {
                                    sink.stop();
                                }
                                sink_slot = None;
                                loudness_slot = None;
                                shared_out = None;
                                #[cfg(target_os = "windows")]
                                teardown_exclusive_session(&mut exclusive_session);
                            }
                            AudioCommand::Stop => {
                                audible = false;
                                active_file_path.clear();
                                wipe_progress_bookkeeping(&live_progress);
                                watchdog_held_sink = false;
                                watchdog_buffer_flag = false;
                                watchdog_starve_marker = None;
                                watchdog_grace_marker = None;
                                let _ = worker_app.emit(
                                    "playback:buffer",
                                    PlaybackBufferPayload { buffering: false },
                                );
                                if let Some(sink) = &sink_slot {
                                    sink.stop();
                                }
                                sink_slot = None;
                                loudness_slot = None;
                                shared_out = None;
                                #[cfg(target_os = "windows")]
                                teardown_exclusive_session(&mut exclusive_session);
                            }
                            AudioCommand::Resume => {
                                audible = true;
                                if active_file_path.is_empty() {
                                    return;
                                }
                                #[cfg(target_os = "windows")]
                                let stream_backed = stream_over_network;
                                #[cfg(target_os = "windows")]
                                if wanted_mode == AudioOutputMode::WasapiExclusive
                                    && !stream_backed
                                {
                                    teardown_exclusive_session(&mut exclusive_session);
                                    match launch_exclusive_session(
                                        active_file_path.clone(),
                                        chosen_device.clone(),
                                        speaker_gain,
                                        true,
                                        elapsed_playback_time(&live_progress),
                                        &live_progress,
                                        balance_gain_live,
                                        worker_eq.clone(),
                                        worker_se.clone(),
                                        worker_master_volume.clone(),
                                        dsd_passthrough_live,
                                        bit_perfect_live,
                                    ) {
                                        Ok(session) => {
                                            if chosen_device.is_none() {
                                                prior_system_default =
                                                    default_output_device_name(&audio_host);
                                            }
                                            live_device_label =
                                                Some(session.active_device_name().to_string());
                                            live_mode = AudioOutputMode::WasapiExclusive;
                                            downgrade_note = None;
                                            exclusive_session = Some(session);
                                            sink_slot = None;
                                            shared_out = None;
                                            loudness_slot = None;
                                            broadcast_output_state(
                                                &worker_app,
                                                &worker_status,
                                                &chosen_device,
                                                &live_device_label,
                                                wanted_mode,
                                                live_mode,
                                                &downgrade_note,
                                            );
                                            return;
                                        }
                                        Err(error) => {
                                            downgrade_note = Some(error);
                                        }
                                    }
                                }

                                confine_device_fault(|| {
                                    shared_out = SharedOutputBackend::open(
                                        &audio_host,
                                        chosen_device.as_deref(),
                                    )
                                    .ok();
                                });
                                if chosen_device.is_none() {
                                    prior_system_default =
                                        default_output_device_name(&audio_host);
                                }
                                live_device_label = shared_out
                                    .as_ref()
                                    .map(|backend| backend.active_device_name().to_string());
                                live_mode = AudioOutputMode::Shared;
                                restore_current_playback(
                                    &shared_out,
                                    &mut sink_slot,
                                    &active_file_path,
                                    true,
                                    &live_progress,
                                    worker_eq.clone(),
                                    worker_se.clone(),
                                    worker_master_volume.clone(),
                                    balance_gain_live,
                                    &mut loudness_slot,
                                    remote_feed.as_ref(),
                                    temp_file_feed.as_ref(),
                                );
                                if tempo_scale != 1.0 {
                                    if let Some(sink) = &sink_slot {
                                        sink.set_speed(tempo_scale);
                                    }
                                }
                                broadcast_output_state(
                                    &worker_app,
                                    &worker_status,
                                    &chosen_device,
                                    &live_device_label,
                                    wanted_mode,
                                    live_mode,
                                    &downgrade_note,
                                );
                            }
                            AudioCommand::Seek {
                                time: requested_time,
                                is_playing: should_resume,
                                request_id: pending_id,
                            } => {
                                #[cfg(target_os = "windows")]
                                if let Some(session) = &exclusive_session {
                                    let landing = requested_time.max(0.0);
                                    audible = should_resume;
                                    session
                                        .seek(Duration::from_secs_f64(landing), should_resume);
                                    let _ = worker_app.emit(
                                        "seek_completed",
                                        SeekCompletedPayload {
                                            request_id: pending_id,
                                            time: landing,
                                        },
                                    );
                                    return;
                                }

                                watchdog_held_sink = false;
                                watchdog_buffer_flag = false;
                                watchdog_starve_marker = None;
                                watchdog_grace_marker = None;

                                reposition_playhead(
                                    requested_time,
                                    should_resume,
                                    pending_id,
                                    &shared_out,
                                    &mut sink_slot,
                                    &active_file_path,
                                    &mut audible,
                                    &live_progress,
                                    &worker_app,
                                    balance_gain_live,
                                    &mut loudness_slot,
                                    worker_eq.clone(),
                                    worker_se.clone(),
                                    worker_master_volume.clone(),
                                    remote_feed.as_ref(),
                                    temp_file_feed.as_ref(),
                                )
                            }
                            AudioCommand::SetVolume(target_bits) => {
                                speaker_gain = target_bits;
                                worker_master_volume
                                    .store(target_bits.to_bits(), Ordering::Relaxed);
                            }
                            AudioCommand::SetDevice(picked_device) => {
                                chosen_device = picked_device;

                                if let Some(sink) = &sink_slot {
                                    sink.stop();
                                }
                                sink_slot = None;
                                #[cfg(target_os = "windows")]
                                teardown_exclusive_session(&mut exclusive_session);

                                confine_device_fault(|| {
                                    rebuild_output_stack(
                                        &chosen_device,
                                        &mut shared_out,
                                        &audio_host,
                                        &mut sink_slot,
                                        #[cfg(target_os = "windows")]
                                        &mut exclusive_session,
                                        &mut live_device_label,
                                        &mut live_mode,
                                        &mut downgrade_note,
                                        wanted_mode,
                                        &active_file_path,
                                        speaker_gain,
                                        audible,
                                        &live_progress,
                                        balance_gain_live,
                                        worker_eq.clone(),
                                        worker_se.clone(),
                                        worker_master_volume.clone(),
                                        &mut loudness_slot,
                                        remote_feed.as_ref(),
                                        temp_file_feed.as_ref(),
                                        dsd_passthrough_live,
                                        bit_perfect_live,
                                    );
                                });
                                if tempo_scale != 1.0 {
                                    if let Some(sink) = &sink_slot {
                                        sink.set_speed(tempo_scale);
                                    }
                                }
                                if chosen_device.is_none() {
                                    prior_system_default =
                                        default_output_device_name(&audio_host);
                                }

                                broadcast_output_state(
                                    &worker_app,
                                    &worker_status,
                                    &chosen_device,
                                    &live_device_label,
                                    wanted_mode,
                                    live_mode,
                                    &downgrade_note,
                                );
                            }
                            AudioCommand::SetOutputMode(switch_to) => {
                                wanted_mode = switch_to;

                                if let Some(sink) = &sink_slot {
                                    sink.stop();
                                }
                                sink_slot = None;
                                #[cfg(target_os = "windows")]
                                teardown_exclusive_session(&mut exclusive_session);

                                confine_device_fault(|| {
                                    rebuild_output_stack(
                                        &chosen_device,
                                        &mut shared_out,
                                        &audio_host,
                                        &mut sink_slot,
                                        #[cfg(target_os = "windows")]
                                        &mut exclusive_session,
                                        &mut live_device_label,
                                        &mut live_mode,
                                        &mut downgrade_note,
                                        wanted_mode,
                                        &active_file_path,
                                        speaker_gain,
                                        audible,
                                        &live_progress,
                                        balance_gain_live,
                                        worker_eq.clone(),
                                        worker_se.clone(),
                                        worker_master_volume.clone(),
                                        &mut loudness_slot,
                                        remote_feed.as_ref(),
                                        temp_file_feed.as_ref(),
                                        dsd_passthrough_live,
                                        bit_perfect_live,
                                    );
                                });
                                if tempo_scale != 1.0 {
                                    if let Some(sink) = &sink_slot {
                                        sink.set_speed(tempo_scale);
                                    }
                                }
                                if chosen_device.is_none() {
                                    prior_system_default =
                                        default_output_device_name(&audio_host);
                                }

                                broadcast_output_state(
                                    &worker_app,
                                    &worker_status,
                                    &chosen_device,
                                    &live_device_label,
                                    wanted_mode,
                                    live_mode,
                                    &downgrade_note,
                                );
                            }
                            AudioCommand::SetVolumeBalance {
                                enabled: balance_on,
                                target_gain: requested_gain,
                            } => {
                                let effective_gain = if balance_on { requested_gain } else { 1.0 };
                                balance_gain_live = effective_gain;

                                if let Some(ref leveler) = loudness_slot {
                                    leveler.set_target_gain(effective_gain);
                                }

                                #[cfg(target_os = "windows")]
                                if let Some(ref session) = exclusive_session {
                                    session.set_volume_balance(balance_on, requested_gain);
                                }
                            }
                            AudioCommand::SetEqualizerSettings { settings: curve } => {
                                worker_eq.set_settings(curve.clone());
                                #[cfg(target_os = "windows")]
                                if let Some(ref session) = exclusive_session {
                                    session.set_equalizer_settings(curve);
                                }
                            }
                            AudioCommand::SetSoundEffectSettings { settings: flavor } => {
                                worker_se.set_settings(flavor.clone());
                                #[cfg(target_os = "windows")]
                                if let Some(ref session) = exclusive_session {
                                    session.set_sound_effect_settings(flavor);
                                }
                            }
                        }));
                    if outcome.is_err() {
                        eprintln!(
                            "[Audio][rust] 播放命令处理 panic，已隔离（不终止播放线程，命令通道保持存活）"
                        );
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if chosen_device.is_none() {
                        let refreshed_default = default_output_device_name(&audio_host);

                        // 播放中却连共享后端都没有：周期性尝试自救
                        let needs_output_salvage = audible
                            && shared_out.is_none()
                            && live_mode == AudioOutputMode::Shared
                            && last_output_salvage.elapsed() >= OUTPUT_RECOVERY_SPACING;
                        if needs_output_salvage {
                            last_output_salvage = std::time::Instant::now();
                            if let Some(sink) = &sink_slot {
                                sink.stop();
                            }
                            sink_slot = None;
                            confine_device_fault(|| {
                                reopen_shared_pipeline(
                                    &chosen_device,
                                    &mut shared_out,
                                    &audio_host,
                                    &mut sink_slot,
                                    &mut live_device_label,
                                    &active_file_path,
                                    audible,
                                    &live_progress,
                                    worker_eq.clone(),
                                    worker_se.clone(),
                                    worker_master_volume.clone(),
                                    balance_gain_live,
                                    &mut loudness_slot,
                                    remote_feed.as_ref(),
                                    temp_file_feed.as_ref(),
                                );
                            });
                            if shared_out.is_some() {
                                downgrade_note = None;
                                live_progress.start_failed.store(false, Ordering::Relaxed);
                                if let Ok(mut reason) = live_progress.start_failed_reason.lock() {
                                    *reason = None;
                                }
                                prior_system_default = refreshed_default.clone();
                            } else {
                                downgrade_note = Some(
                                    "未检测到可用的音频输出设备，请检查扬声器/耳机是否已连接"
                                        .to_string(),
                                );
                            }
                            broadcast_output_state(
                                &worker_app,
                                &worker_status,
                                &chosen_device,
                                &live_device_label,
                                wanted_mode,
                                live_mode,
                                &downgrade_note,
                            );
                        }

                        // 系统默认设备换了且我们在裸奔跟随：整体重建输出链
                        if audible
                            && should_restore_for_default_device_change(
                                &chosen_device,
                                &prior_system_default,
                                &refreshed_default,
                                &live_device_label,
                            )
                        {
                            prior_system_default = refreshed_default;
                            if let Some(sink) = &sink_slot {
                                sink.stop();
                            }
                            sink_slot = None;
                            shared_out = None;
                            #[cfg(target_os = "windows")]
                            teardown_exclusive_session(&mut exclusive_session);

                            #[cfg(target_os = "windows")]
                            confine_device_fault(|| {
                                rebuild_output_stack(
                                    &chosen_device,
                                    &mut shared_out,
                                    &audio_host,
                                    &mut sink_slot,
                                    &mut exclusive_session,
                                    &mut live_device_label,
                                    &mut live_mode,
                                    &mut downgrade_note,
                                    wanted_mode,
                                    &active_file_path,
                                    speaker_gain,
                                    audible,
                                    &live_progress,
                                    balance_gain_live,
                                    worker_eq.clone(),
                                    worker_se.clone(),
                                    worker_master_volume.clone(),
                                    &mut loudness_slot,
                                    remote_feed.as_ref(),
                                    temp_file_feed.as_ref(),
                                    dsd_passthrough_live,
                                    bit_perfect_live,
                                );
                            });
                            #[cfg(not(target_os = "windows"))]
                            confine_device_fault(|| {
                                rebuild_output_stack(
                                    &chosen_device,
                                    &mut shared_out,
                                    &audio_host,
                                    &mut sink_slot,
                                    &mut live_device_label,
                                    &mut live_mode,
                                    &mut downgrade_note,
                                    wanted_mode,
                                    &active_file_path,
                                    speaker_gain,
                                    audible,
                                    &live_progress,
                                    balance_gain_live,
                                    worker_eq.clone(),
                                    worker_se.clone(),
                                    worker_master_volume.clone(),
                                    &mut loudness_slot,
                                    remote_feed.as_ref(),
                                    temp_file_feed.as_ref(),
                                    dsd_passthrough_live,
                                    bit_perfect_live,
                                );
                            });

                            broadcast_output_state(
                                &worker_app,
                                &worker_status,
                                &None,
                                &live_device_label,
                                wanted_mode,
                                live_mode,
                                &downgrade_note,
                            );
                        }
                    }

                    if audible && last_progress_burst.elapsed() >= PROGRESS_BROADCAST_SPACING {
                        last_progress_burst = std::time::Instant::now();
                        let position = elapsed_playback_time(&live_progress).as_secs_f64();
                        let duration_bits =
                            live_progress.total_duration_secs.load(Ordering::Relaxed);
                        let duration = f64::from_bits(duration_bits);
                        let _ = worker_app.emit(
                            "playback:progress",
                            PlaybackProgressPayload {
                                position,
                                duration,
                                is_playing: true,
                            },
                        );

                        if let Ok(mut hub_guard) = worker_controls.lock() {
                            if let Some(mounted) = hub_guard.as_mut() {
                                let marker =
                                    MediaPosition(Duration::from_secs_f64(position.max(0.0)));
                                let _ = mounted.set_playback(MediaPlayback::Playing {
                                    progress: Some(marker),
                                });
                            }
                        }
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break 'command_pump,
            }
        }
    });

    PlayerState {
        tx: Mutex::new(command_tx),
        progress: runtime_progress,
        playback_id: Arc::new(AtomicU64::default()),
        controls: media_hub,
        output_status: output_status_slot,
        user_volume: master_volume,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use std::net::TcpListener;

    fn spawn_mock_server(
        body: Vec<u8>,
        support_range: bool,
    ) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{addr}/audio");

        let handle = std::thread::spawn(move || {
            for _ in 0..32 {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                let mut buf = [0u8; 2048];
                let n = stream.read(&mut buf).unwrap_or(0);
                if n == 0 {
                    continue;
                }
                let req = String::from_utf8_lossy(&buf[..n]);
                let is_head = req.starts_with("HEAD");
                let range = req
                    .lines()
                    .find(|l| l.to_ascii_lowercase().starts_with("range:"))
                    .map(|l| l.to_string());
                let total = body.len();

                if is_head {
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {total}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n"
                    );
                    let _ = stream.write_all(resp.as_bytes());
                    continue;
                }

                if support_range {
                    if let Some(range) = range {
                        let spec = range.split('=').nth(1).unwrap_or("").trim().to_string();
                        let mut parts = spec.split('-');
                        let start: usize = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
                        if start >= total {
                            let resp = format!(
                                "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{total}\r\nConnection: close\r\n\r\n"
                            );
                            let _ = stream.write_all(resp.as_bytes());
                            continue;
                        }
                        let end: usize = parts
                            .next()
                            .and_then(|v| v.trim().parse().ok())
                            .unwrap_or(total - 1)
                            .min(total - 1);
                        let slice = &body[start..=end];
                        let header = format!(
                            "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                            slice.len(), start, end, total
                        );
                        let _ = stream.write_all(header.as_bytes());
                        let _ = stream.write_all(slice);
                        continue;
                    }
                }

                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n"
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(&body);
            }
        });

        (url, handle)
    }

    fn read_all_via_reader(url: &str) -> Vec<u8> {
        let source = RemoteStreamSource {
            remote_uri: url.to_string(),
            url: url.to_string(),
            ..Default::default()
        };
        let mut reader = RemoteRangeReader::new(source).expect("reader 创建失败");
        let mut out = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let n = reader.read(&mut chunk).expect("读取失败");
            if n == 0 {
                break;
            }
            out.extend_from_slice(&chunk[..n]);
        }
        out
    }

    #[test]
    fn remote_reader_reads_full_body_with_range_support() {
        let body: Vec<u8> = (0..(2_500_000_usize)).map(|i| (i % 251) as u8).collect();
        let (url, handle) = spawn_mock_server(body.clone(), true);
        let got = read_all_via_reader(&url);
        assert_eq!(got.len(), body.len(), "支持 Range 时应完整读取");
        assert_eq!(got, body, "支持 Range 时内容应一致");
        drop(handle);
    }

    #[test]
    fn remote_reader_reads_full_body_when_range_ignored() {
        let body: Vec<u8> = (0..(2_500_000_usize)).map(|i| (i % 251) as u8).collect();
        let (url, handle) = spawn_mock_server(body.clone(), false);
        let got = read_all_via_reader(&url);
        assert_eq!(got.len(), body.len(), "忽略 Range 时应通过整曲下载完整读取");
        assert_eq!(got, body, "忽略 Range 时内容应一致");
        drop(handle);
    }

    fn assert_seek_correct(support_range: bool) {
        let body: Vec<u8> = (0..(2_500_000_usize)).map(|i| (i % 251) as u8).collect();
        let (url, handle) = spawn_mock_server(body.clone(), support_range);
        let source = RemoteStreamSource {
            remote_uri: url.clone(),
            url: url.clone(),
            ..Default::default()
        };
        let mut reader = RemoteRangeReader::new(source).expect("reader 创建失败");

        let mut head = [0u8; 16];
        reader.read_exact(&mut head).expect("读开头失败");
        assert_eq!(&head[..], &body[..16], "开头字节应正确");

        let target = 1_500_003_u64;
        reader
            .seek(SeekFrom::Start(target))
            .expect("seek 到中段失败");
        let mut mid = [0u8; 32];
        reader.read_exact(&mut mid).expect("中段读失败");
        assert_eq!(
            &mid[..],
            &body[target as usize..target as usize + 32],
            "seek 后中段字节应正确"
        );

        reader.seek(SeekFrom::Start(100)).expect("seek 回退失败");
        let mut back = [0u8; 8];
        reader.read_exact(&mut back).expect("回退读失败");
        assert_eq!(&back[..], &body[100..108], "seek 回退后字节应正确");

        drop(handle);
    }

    #[test]
    fn remote_reader_seek_correct_with_range_support() {
        assert_seek_correct(true);
    }

    #[test]
    fn remote_reader_seek_correct_when_range_ignored() {
        assert_seek_correct(false);
    }

    fn build_wav(sample_rate: u32, channels: u16, seconds: u32) -> Vec<u8> {
        let bits_per_sample: u16 = 16;
        let num_samples = sample_rate * seconds;
        let block_align = channels * bits_per_sample / 8;
        let byte_rate = sample_rate * block_align as u32;
        let data_len = num_samples * block_align as u32;

        let mut buf = Vec::new();
        buf.extend_from_slice(b"RIFF");
        buf.extend_from_slice(&(36 + data_len).to_le_bytes());
        buf.extend_from_slice(b"WAVE");
        buf.extend_from_slice(b"fmt ");
        buf.extend_from_slice(&16u32.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&channels.to_le_bytes());
        buf.extend_from_slice(&sample_rate.to_le_bytes());
        buf.extend_from_slice(&byte_rate.to_le_bytes());
        buf.extend_from_slice(&block_align.to_le_bytes());
        buf.extend_from_slice(&bits_per_sample.to_le_bytes());
        buf.extend_from_slice(b"data");
        buf.extend_from_slice(&data_len.to_le_bytes());
        for i in 0..num_samples {
            let t = i as f32 / sample_rate as f32;
            let value = (t * 440.0 * std::f32::consts::TAU).sin();
            let sample = (value * 16000.0) as i16;
            for _ in 0..channels {
                buf.extend_from_slice(&sample.to_le_bytes());
            }
        }
        buf
    }

    fn assert_decodes(support_range: bool) {
        let wav = build_wav(44_100, 2, 1);
        let (url, handle) = spawn_mock_server(wav.clone(), support_range);
        let source = RemoteStreamSource {
            remote_uri: url.clone(),
            url: url.clone(),
            ..Default::default()
        };
        let reader = RemoteRangeReader::new(source).expect("reader 创建失败");
        let buffered = BufReader::with_capacity(512 * 1024, reader);
        let decoder = Decoder::new(buffered).expect("rodio 应能解码在线 WAV 流");
        assert_eq!(decoder.sample_rate(), 44_100, "解码采样率应为 44100");
        assert_eq!(decoder.channels(), 2, "解码声道数应为 2");
        let produced = decoder.take(1000).count();
        assert!(produced > 0, "解码器应产出音频样本");
        drop(handle);
    }

    fn assert_seek_rebuild_produces_audio(support_range: bool) {
        let wav = build_wav(44_100, 2, 10);
        let (url, handle) = spawn_mock_server(wav.clone(), support_range);
        let source = RemoteStreamSource {
            remote_uri: url.clone(),
            url: url.clone(),
            ..Default::default()
        };

        let reader = RemoteRangeReader::new(source).expect("重建 reader 应成功");
        let buffered = BufReader::with_capacity(512 * 1024, reader);
        let decoder = Decoder::new(buffered).expect("重建后应能解码");
        assert_eq!(decoder.sample_rate(), 44_100);

        let jump_target = Duration::from_secs(8);
        let mut skipped = decoder.convert_samples::<f32>().skip_duration(jump_target);
        let produced = (0..1000).filter_map(|_| skipped.next()).count();
        assert!(
            produced > 0,
            "seek 到靠后位置重建后应仍能产出音频样本（support_range={support_range}）"
        );

        drop(handle);
    }

    #[test]
    fn seek_rebuild_produces_audio_with_range_support() {
        assert_seek_rebuild_produces_audio(true);
    }

    #[test]
    fn seek_rebuild_produces_audio_when_range_ignored() {
        assert_seek_rebuild_produces_audio(false);
    }

    #[test]
    fn rodio_decodes_online_wav_with_range_support() {
        assert_decodes(true);
    }

    #[test]
    fn rodio_decodes_online_wav_when_range_ignored() {
        assert_decodes(false);
    }

    #[test]
    fn rodio_decodes_and_seeks_wavpack() {
        let params = wavicle::EncodeParams {
            channels: 2,
            sample_rate: 44_100,
            bits_per_sample: 16,
        };
        let frames: Vec<i32> = (0..4410)
            .flat_map(|i| {
                let l = (i % 1000) * 30 - 15000;
                let r = 15000 - (i % 700) * 40;
                [l, r]
            })
            .collect();
        let bytes = wavicle::encode_int(params, &frames).expect("编码 wv 流失败");

        let cursor = std::io::Cursor::new(bytes);
        let mut decoder = Decoder::new(cursor).expect("rodio 应能解码 wv 流");
        assert_eq!(decoder.sample_rate(), 44_100, "wv 采样率应为 44100");
        assert_eq!(decoder.channels(), 2, "wv 声道数应为 2");
        assert_eq!(
            decoder.total_duration().map(|d| d.as_millis()),
            Some(100),
            "wv 总时长应为 100ms"
        );

        let samples: Vec<f32> = decoder.by_ref().collect();
        assert_eq!(samples.len(), frames.len(), "wv 应解码出全部交错样本");
        for (got, want) in samples.iter().zip(frames.iter()) {
            assert!(
                (got - *want as f32 / 32768.0).abs() < 1e-6,
                "wv 样本数值不符：{got} vs {want}"
            );
        }

        decoder
            .try_seek(Duration::from_millis(50))
            .expect("wv 应支持 seek");
        let remaining = decoder.count();
        assert_eq!(remaining, 2205 * 2, "seek 到 50ms 后应剩余一半样本");
    }

    fn test_progress_at(seconds: f64) -> Arc<SharedProgress> {
        let sample_rate = 44_100_u32;
        let channels = 2_u32;
        let samples = (seconds * sample_rate as f64 * channels as f64).round() as u64;

        Arc::new(SharedProgress {
            samples_played: Arc::new(AtomicU64::new(samples)),
            sample_rate: Arc::new(AtomicU32::new(sample_rate)),
            channels: Arc::new(AtomicU32::new(channels)),
            visualizer: Arc::new(SharedVisualizer::new()),
            start_failed: Arc::new(AtomicBool::new(false)),
            start_failed_reason: Arc::new(std::sync::Mutex::new(None)),
            buffered: Arc::new(BufferedMonitor::new()),
            total_duration_secs: Arc::new(AtomicU64::new(0u64)),
            is_playing: Arc::new(AtomicBool::new(false)),
        })
    }

    #[test]
    fn handle_play_resets_progress_even_when_new_source_cannot_open() {
        let progress = test_progress_at(206.0);
        let mut current_sink = None;
        let mut current_path = String::new();
        let mut is_playing_flag = false;
        let mut current_normalizer_handle = None;

        let eq_handle = Arc::new(crate::player::equalizer::EqualizerHandle::new(
            crate::player::equalizer::EqualizerSettings::default(),
        ));
        let se_handle = Arc::new(crate::player::sound_effect::SoundEffectHandle::new(
            crate::player::sound_effect::SoundEffectSettings::default(),
        ));
        let user_volume = Arc::new(std::sync::atomic::AtomicU32::new(1.0_f32.to_bits()));

        handle_play(
            AudioSource::LocalFile("Z:\\missing\\song.flac".to_string()),
            &None,
            &mut current_sink,
            &mut current_path,
            &mut is_playing_flag,
            &progress,
            None,
            1.0,
            &mut current_normalizer_handle,
            eq_handle,
            se_handle,
            user_volume,
        );

        assert_eq!(progress.samples_played.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn default_device_monitor_ignores_active_output_display_name() {
        let selected_device_name = None;
        let last_default_device_name = Some("CPAL default device".to_string());
        let next_default_device_name = Some("CPAL default device".to_string());
        let active_device_name = Some("WASAPI friendly device".to_string());

        assert!(!should_restore_for_default_device_change(
            &selected_device_name,
            &last_default_device_name,
            &next_default_device_name,
            &active_device_name,
        ));
    }

    #[test]
    fn default_device_monitor_ignores_transient_enumeration_failure() {
        let selected_device_name = None;
        let last_default_device_name = Some("扬声器".to_string());
        let next_default_device_name: Option<String> = None;
        let active_device_name = Some("扬声器".to_string());

        assert!(!should_restore_for_default_device_change(
            &selected_device_name,
            &last_default_device_name,
            &next_default_device_name,
            &active_device_name,
        ));
    }

    #[test]
    #[ignore = "依赖本地 m4s 临时文件（XY_M4S_PATH 可指定），手动 --ignored 运行"]
    fn debug_decode_bilibili_m4s() {
        let path = std::env::var("XY_M4S_PATH").unwrap_or_else(|_| {
            "C:\\Users\\小奇\\AppData\\Local\\Temp\\xianyu_music_1787144280366.m4s".to_string()
        });
        let file = std::fs::File::open(&path).expect("open m4s");
        let reader = std::io::BufReader::with_capacity(512 * 1024, file);
        let decoder = rodio::Decoder::new(reader).expect("rodio 应能解码 m4s");
        let rate = decoder.sample_rate();
        let channels = decoder.channels();
        let total = decoder.total_duration();
        eprintln!("[debug-m4s] rate={rate} channels={channels} total_duration={total:?}");
        if let Some(t) = total {
            eprintln!(
                "[debug-m4s] dur secs={} nanos={} as_nanos={} as_secs_f64={}",
                t.as_secs(),
                t.subsec_nanos(),
                t.as_nanos(),
                t.as_secs_f64()
            );
        }
        let mut source = decoder.convert_samples::<f32>();
        let mut count: u64 = 0;
        for _ in 0..(rate as u64 * channels as u64 * 300) {
            match source.next() {
                Some(_) => count += 1,
                None => break,
            }
        }
        let seconds = count as f64 / (rate as u64 * channels as u64) as f64;
        eprintln!("[debug-m4s] decoded_samples={count} decoded_seconds={seconds:.2}");
        assert!(seconds > 60.0, "应能解码超过 60 秒，实际 {seconds:.2} 秒");
    }

    #[test]
    fn m4s_sentinel_duration_detection() {
        let sentinel = std::time::Duration::new(0, u32::MAX);
        assert_eq!(
            sentinel.as_secs(),
            4,
            "Duration::new(0, u32::MAX) 会被规范化"
        );
        assert_eq!(sentinel.subsec_nanos(), 294967295);
        assert_eq!(
            sentinel.as_nanos(),
            u32::MAX as u128,
            "as_nanos 应精确等于 u32::MAX"
        );

        let is_sentinel = |d: std::time::Duration| d.as_nanos() == u32::MAX as u128;
        assert!(is_sentinel(sentinel), "哨兵值应被识别为误报");

        let normal = std::time::Duration::from_secs_f64(278.0);
        assert!(!is_sentinel(normal), "正常时长不应被误判为哨兵");
        let exactly = std::time::Duration::from_secs_f64(4.294967295);
        assert!(is_sentinel(exactly));
    }
}
