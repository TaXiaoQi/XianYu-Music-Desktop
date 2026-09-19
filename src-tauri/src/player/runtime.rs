use crate::player::device::{default_output_device_name, emit_output_status};
use crate::player::loudness::{VolumeNormalizer, VolumeNormalizerHandle};
use crate::player::output::shared::progress_seconds_from_samples;
use crate::player::output::shared::{restore_current_playback, SharedOutputBackend};
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

const PLAYER_POLL_INTERVAL: Duration = Duration::from_millis(150);
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(500);
const BUFFER_STARVE_BEFORE_PAUSE: Duration = Duration::from_millis(300);
const BUFFER_RESUME_GRACE: Duration = Duration::from_millis(250);
const OUTPUT_RECOVER_INTERVAL: Duration = Duration::from_millis(1000);

#[allow(clippy::type_complexity)]
fn guard_device_ops<F>(ops: F) -> bool
where
    F: FnOnce(),
{
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(ops)) {
        Ok(()) => true,
        Err(payload) => {
            let reason = payload
                .downcast_ref::<&str>()
                .map(|s| (*s).to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "未知 panic".to_string());
            eprintln!("[Audio][rust] 音频设备相关操作 panic，已隔离（不终止播放线程）: {reason}");
            false
        }
    }
}

fn progress_duration(progress: &Arc<SharedProgress>) -> Duration {
    let current_samples = progress.samples_played.load(Ordering::Relaxed);
    let rate = progress.sample_rate.load(Ordering::Relaxed);
    let channels = progress.channels.load(Ordering::Relaxed);

    Duration::from_secs_f64(progress_seconds_from_samples(
        current_samples,
        rate,
        channels,
    ))
}

fn reset_playback_progress(progress: &Arc<SharedProgress>) {
    progress.samples_played.store(0, Ordering::Relaxed);
    progress.sample_rate.store(0, Ordering::Relaxed);
    progress.channels.store(0, Ordering::Relaxed);
    progress.start_failed.store(false, Ordering::Relaxed);
    if let Ok(mut reason) = progress.start_failed_reason.lock() {
        *reason = None;
    }
    progress.buffered.starved.store(false, Ordering::Relaxed);
    progress.buffered.produced.store(false, Ordering::Relaxed);
    progress.visualizer.reset();
}

fn should_restore_for_default_device_change(
    selected_device_name: &Option<String>,
    last_default_device_name: &Option<String>,
    next_default_device_name: &Option<String>,
    _active_device_name: &Option<String>,
) -> bool {
    selected_device_name.is_none()
        && next_default_device_name.is_some()
        && next_default_device_name != last_default_device_name
}

#[cfg(target_os = "windows")]
fn stop_exclusive_playback(exclusive_playback: &mut Option<WasapiExclusivePlayback>) {
    if let Some(mut playback) = exclusive_playback.take() {
        playback.stop();
    }
}

#[cfg(target_os = "windows")]
fn start_exclusive_playback(
    path: String,
    selected_device_name: Option<String>,
    current_volume: f32,
    is_playing: bool,
    start_time: Duration,
    progress: &Arc<SharedProgress>,
    volume_balance_gain: f32,
    equalizer_handle: Arc<crate::player::equalizer::EqualizerHandle>,
    sound_effect_handle: Arc<crate::player::sound_effect::SoundEffectHandle>,
    user_volume: Arc<std::sync::atomic::AtomicU32>,
    dsd_native_passthrough: bool,
    bit_perfect: bool,
) -> Result<WasapiExclusivePlayback, String> {
    WasapiExclusivePlayback::start(ExclusivePlayRequest {
        path,
        device_name: selected_device_name,
        volume: current_volume,
        is_playing,
        progress: progress.clone(),
        start_time,
        volume_balance_gain,
        equalizer_handle,
        sound_effect_handle,
        user_volume,
        dsd_native_passthrough,
        bit_perfect,
    })
    .map_err(|error| error.to_string())
}

#[allow(clippy::too_many_arguments)]
fn restore_preferred_output(
    selected_device_name: &Option<String>,
    output: &mut Option<SharedOutputBackend>,
    host: &cpal::Host,
    current_sink: &mut Option<Sink>,
    #[cfg(target_os = "windows")] exclusive_playback: &mut Option<WasapiExclusivePlayback>,
    active_device_name: &mut Option<String>,
    active_output_mode: &mut AudioOutputMode,
    fallback_reason: &mut Option<String>,
    requested_output_mode: AudioOutputMode,
    current_path: &str,
    current_volume: f32,
    is_playing_flag: bool,
    progress: &Arc<SharedProgress>,
    volume_balance_gain: f32,
    equalizer_handle: Arc<crate::player::equalizer::EqualizerHandle>,
    sound_effect_handle: Arc<crate::player::sound_effect::SoundEffectHandle>,
    user_volume: Arc<std::sync::atomic::AtomicU32>,
    current_normalizer_handle: &mut Option<VolumeNormalizerHandle>,
    current_remote_stream: Option<&RemoteStreamSource>,
    current_streaming_state: Option<&crate::player::stream_cache::StreamingTempFileState>,
    dsd_native_passthrough: bool,
    bit_perfect: bool,
) {
    *output = None;
    *output = SharedOutputBackend::open(host, selected_device_name.as_deref()).ok();
    *active_device_name = output
        .as_ref()
        .map(|output| output.active_device_name().to_string());

    #[cfg(target_os = "windows")]
    if requested_output_mode == AudioOutputMode::WasapiExclusive && !current_path.is_empty() {
        match start_exclusive_playback(
            current_path.to_string(),
            selected_device_name.clone(),
            current_volume,
            is_playing_flag,
            progress_duration(progress),
            progress,
            volume_balance_gain,
            equalizer_handle.clone(),
            sound_effect_handle.clone(),
            user_volume.clone(),
            dsd_native_passthrough,
            bit_perfect,
        ) {
            Ok(playback) => {
                *active_device_name = Some(playback.active_device_name().to_string());
                *active_output_mode = AudioOutputMode::WasapiExclusive;
                *fallback_reason = None;
                *exclusive_playback = Some(playback);
                *output = None;
                return;
            }
            Err(error) => {
                *active_output_mode = AudioOutputMode::Shared;
                *fallback_reason = Some(error);
            }
        }
    } else {
        *active_output_mode = AudioOutputMode::Shared;
        *fallback_reason = None;
    }

    #[cfg(not(target_os = "windows"))]
    {
        *active_output_mode = AudioOutputMode::Shared;
        *fallback_reason = if requested_output_mode == AudioOutputMode::WasapiExclusive {
            Some("WASAPI exclusive mode is only available on Windows".to_string())
        } else {
            None
        };
    }

    restore_current_playback(
        output,
        current_sink,
        current_path,
        is_playing_flag,
        progress,
        equalizer_handle,
        sound_effect_handle,
        user_volume,
        volume_balance_gain,
        current_normalizer_handle,
        current_remote_stream,
        current_streaming_state,
    );
}

fn restore_shared_output(
    selected_device_name: &Option<String>,
    output: &mut Option<SharedOutputBackend>,
    host: &cpal::Host,
    current_sink: &mut Option<Sink>,
    active_device_name: &mut Option<String>,
    current_path: &str,
    is_playing_flag: bool,
    progress: &Arc<SharedProgress>,
    equalizer_handle: Arc<crate::player::equalizer::EqualizerHandle>,
    sound_effect_handle: Arc<crate::player::sound_effect::SoundEffectHandle>,
    user_volume: Arc<std::sync::atomic::AtomicU32>,
    volume_balance_gain: f32,
    current_normalizer_handle: &mut Option<VolumeNormalizerHandle>,
    current_remote_stream: Option<&RemoteStreamSource>,
    current_streaming_state: Option<&crate::player::stream_cache::StreamingTempFileState>,
) {
    *output = SharedOutputBackend::open(host, selected_device_name.as_deref()).ok();
    *active_device_name = output
        .as_ref()
        .map(|output| output.active_device_name().to_string());
    restore_current_playback(
        output,
        current_sink,
        current_path,
        is_playing_flag,
        progress,
        equalizer_handle,
        sound_effect_handle,
        user_volume,
        volume_balance_gain,
        current_normalizer_handle,
        current_remote_stream,
        current_streaming_state,
    );
}

#[cfg(target_os = "windows")]
#[allow(clippy::too_many_arguments)]
fn recover_from_exclusive_failure(
    exclusive_playback: &mut Option<WasapiExclusivePlayback>,
    selected_device_name: &Option<String>,
    output: &mut Option<SharedOutputBackend>,
    host: &cpal::Host,
    current_sink: &mut Option<Sink>,
    active_device_name: &mut Option<String>,
    requested_output_mode: &mut AudioOutputMode,
    active_output_mode: &mut AudioOutputMode,
    fallback_reason: &mut Option<String>,
    current_path: &str,
    is_playing_flag: bool,
    progress: &Arc<SharedProgress>,
    equalizer_handle: Arc<crate::player::equalizer::EqualizerHandle>,
    sound_effect_handle: Arc<crate::player::sound_effect::SoundEffectHandle>,
    user_volume: Arc<std::sync::atomic::AtomicU32>,
    volume_balance_gain: f32,
    current_normalizer_handle: &mut Option<VolumeNormalizerHandle>,
    current_remote_stream: Option<&RemoteStreamSource>,
    current_streaming_state: Option<&crate::player::stream_cache::StreamingTempFileState>,
    app: &AppHandle,
    output_status: &Arc<Mutex<AudioOutputStatus>>,
    last_default_device_name: &mut Option<String>,
) -> bool {
    let Some(result) = exclusive_playback
        .as_ref()
        .and_then(|playback| playback.try_finished())
    else {
        return false;
    };

    stop_exclusive_playback(exclusive_playback);

    if let Err(error) = result {
        *active_output_mode = AudioOutputMode::Shared;
        *fallback_reason = Some(format!(
            "WASAPI 独占模式已断开，已自动切回共享模式：{error}"
        ));

        restore_shared_output(
            selected_device_name,
            output,
            host,
            current_sink,
            active_device_name,
            current_path,
            is_playing_flag,
            progress,
            equalizer_handle,
            sound_effect_handle,
            user_volume,
            volume_balance_gain,
            current_normalizer_handle,
            current_remote_stream,
            current_streaming_state,
        );
        if selected_device_name.is_none() {
            *last_default_device_name = default_output_device_name(host);
        }

        emit_output_status(
            app,
            output_status,
            selected_device_name.clone(),
            active_device_name.clone(),
            *requested_output_mode,
            *active_output_mode,
            fallback_reason.clone(),
        );
    }

    true
}

fn attach_media_controls(controls: &mut MediaControls, app: &AppHandle) {
    let app_clone = app.clone();
    let _ = controls.attach(move |event| match event {
        MediaControlEvent::Play => {
            let _ = app_clone.emit("player:play", ());
        }
        MediaControlEvent::Pause => {
            let _ = app_clone.emit("player:pause", ());
        }
        MediaControlEvent::Next => {
            let _ = app_clone.emit("player:next", ());
        }
        MediaControlEvent::Previous => {
            let _ = app_clone.emit("player:prev", ());
        }
        MediaControlEvent::SetPosition(pos) => {
            let secs = pos.0.as_secs_f64();
            let _ = app_clone.emit("player:seek-to", secs);
        }
        MediaControlEvent::Stop => {
            let _ = app_clone.emit("player:stop", ());
        }
        _ => {}
    });
}

fn store_media_controls(controls: &Arc<Mutex<Option<MediaControls>>>, mc: MediaControls) {
    *controls.lock().unwrap_or_else(|e| e.into_inner()) = Some(mc);
}

fn initialize_media_controls(app: &AppHandle) -> Arc<Mutex<Option<MediaControls>>> {
    let controls = Arc::new(Mutex::new(None));

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        let config = PlatformConfig {
            dbus_name: "xy_music",
            display_name: "XY-Music",
            hwnd: None,
        };

        match MediaControls::new(config) {
            Ok(mut mc) => {
                attach_media_controls(&mut mc, app);
                store_media_controls(&controls, mc);
            }
            Err(error) => eprintln!("Error initializing MediaControls: {:?}", error),
        }
    }

    #[cfg(target_os = "windows")]
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(handle) = window.window_handle() {
            if let RawWindowHandle::Win32(h) = handle.as_raw() {
                let hwnd = h.hwnd.get() as *mut std::ffi::c_void;

                let config = PlatformConfig {
                    dbus_name: "xy_music",
                    display_name: "XY-Music",
                    hwnd: Some(hwnd),
                };

                match MediaControls::new(config) {
                    Ok(mut mc) => {
                        attach_media_controls(&mut mc, app);
                        store_media_controls(&controls, mc);
                    }
                    Err(error) => eprintln!("Error initializing MediaControls: {:?}", error),
                }
            }
        }
    }

    controls
}

const REMOTE_STREAM_CHUNK_BYTES: u64 = 2 * 1024 * 1024;

enum PrefetchResult {
    Bytes {
        start: u64,
        data: Vec<u8>,
        total: Option<u64>,
    },
    NoRange {
        data: Vec<u8>,
    },
    Error {
        start: u64,
        message: String,
    },
}

pub(crate) struct RemoteRangeReader {
    client: reqwest::blocking::Client,
    source: RemoteStreamSource,
    pos: u64,
    len: Option<u64>,
    buffer_start: u64,
    buffer: Vec<u8>,
    no_range: bool,
    full_body: Option<Vec<u8>>,
    prefetch_state: Arc<Mutex<Option<PrefetchResult>>>,
    prefetch_in_flight: Arc<AtomicBool>,
    prefetch_start: u64,
}

impl RemoteRangeReader {
    pub(crate) fn new(source: RemoteStreamSource) -> Result<Self, String> {
        let client = reqwest::blocking::Client::builder()
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
            client,
            source,
            pos: 0,
            len: None,
            buffer_start: 0,
            buffer: Vec::new(),
            no_range: false,
            full_body: None,
            prefetch_state: Arc::new(Mutex::new(None)),
            prefetch_in_flight: Arc::new(AtomicBool::new(false)),
            prefetch_start: 0,
        })
    }

    fn download_full(&mut self) -> std::io::Result<()> {
        let request = self.client.get(&self.source.url);
        let mut response = Self::auth(request, &self.source)
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
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        let is_html = content_type.contains("text/html")
            || content_type.contains("application/json")
            || content_type.contains("text/plain");
        let mut bytes = Vec::new();
        response.read_to_end(&mut bytes)?;
        if is_html {
            return Err(std::io::Error::other(format!(
                "服务器返回非音频内容 (Content-Type: {})，可能需要防盗链 headers 或 URL 已失效",
                content_type
            )));
        }
        self.len = Some(bytes.len() as u64);
        self.full_body = Some(bytes);
        self.no_range = true;
        Ok(())
    }

    fn auth(
        request: reqwest::blocking::RequestBuilder,
        source: &RemoteStreamSource,
    ) -> reqwest::blocking::RequestBuilder {
        let mut request =
            if let Some(username) = source.username.as_deref().filter(|value| !value.is_empty()) {
                request.basic_auth(username.to_string(), source.password.clone())
            } else {
                request
            };
        if let Some(ua) = source
            .user_agent
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            request = request.header(reqwest::header::USER_AGENT, ua);
        }
        if let Some(referer) = source.referer.as_deref().filter(|value| !value.is_empty()) {
            request = request.header(reqwest::header::REFERER, referer);
        }
        if let Some(ref headers) = source.headers {
            for (key, value) in headers {
                if let Ok(name) = reqwest::header::HeaderName::from_bytes(key.as_bytes()) {
                    if let Ok(val) = reqwest::header::HeaderValue::from_str(value) {
                        request = request.header(name, val);
                    }
                }
            }
        }
        request
    }

    fn content_range_total(response: &reqwest::blocking::Response) -> Option<u64> {
        response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.rsplit('/').next())
            .and_then(|value| value.trim().parse::<u64>().ok())
            .filter(|len| *len > 0)
    }

    fn start_prefetch(&mut self, start: u64) {
        if let Some(len) = self.len {
            if start >= len {
                return;
            }
        }
        *self
            .prefetch_state
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
        self.prefetch_in_flight.store(true, Ordering::Relaxed);
        self.prefetch_start = start;

        let client = self.client.clone();
        let source = self.source.clone();
        let state = self.prefetch_state.clone();
        let in_flight = self.prefetch_in_flight.clone();
        let end = start.saturating_add(REMOTE_STREAM_CHUNK_BYTES - 1);

        thread::spawn(move || {
            let request = client
                .get(&source.url)
                .header(reqwest::header::RANGE, format!("bytes={start}-{end}"));
            let result = match Self::auth(request, &source).send() {
                Ok(mut response) => {
                    if response.status() == reqwest::StatusCode::OK {
                        let mut bytes = Vec::new();
                        match response.read_to_end(&mut bytes) {
                            Ok(_) => PrefetchResult::NoRange { data: bytes },
                            Err(e) => PrefetchResult::Error {
                                start,
                                message: e.to_string(),
                            },
                        }
                    } else if response.status().is_success()
                        || response.status() == reqwest::StatusCode::PARTIAL_CONTENT
                    {
                        let total = Self::content_range_total(&response);
                        let mut limited = response.by_ref().take(REMOTE_STREAM_CHUNK_BYTES);
                        let mut bytes = Vec::new();
                        match limited.read_to_end(&mut bytes) {
                            Ok(_) => PrefetchResult::Bytes {
                                start,
                                data: bytes,
                                total,
                            },
                            Err(e) => PrefetchResult::Error {
                                start,
                                message: e.to_string(),
                            },
                        }
                    } else {
                        PrefetchResult::Error {
                            start,
                            message: format!("HTTP {}", response.status()),
                        }
                    }
                }
                Err(e) => PrefetchResult::Error {
                    start,
                    message: e.to_string(),
                },
            };
            *state.lock().unwrap_or_else(|e| e.into_inner()) = Some(result);
            in_flight.store(false, Ordering::Relaxed);
        });
    }

    fn try_take_prefetched(&mut self) -> Option<PrefetchResult> {
        if self.prefetch_in_flight.load(Ordering::Relaxed) {
            return None;
        }
        self.prefetch_state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
    }

    fn is_prefetch_in_flight(&self) -> bool {
        self.prefetch_in_flight.load(Ordering::Relaxed)
    }

    fn cancel_prefetch(&mut self) {
        self.prefetch_in_flight.store(false, Ordering::Relaxed);
        *self
            .prefetch_state
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
    }

    fn fetch_at(&mut self, start: u64) -> std::io::Result<()> {
        if let Some(result) = self.try_take_prefetched() {
            match result {
                PrefetchResult::Bytes {
                    start: res_start,
                    data,
                    total,
                } if res_start == start => {
                    if let Some(total) = total {
                        self.len = Some(total);
                    } else if data.len() < REMOTE_STREAM_CHUNK_BYTES as usize {
                        self.len = Some(start + data.len() as u64);
                    }
                    self.buffer_start = start;
                    self.buffer = data;
                    return Ok(());
                }
                PrefetchResult::NoRange { data } => {
                    self.len = Some(data.len() as u64);
                    self.full_body = Some(data);
                    self.no_range = true;
                    return Ok(());
                }
                PrefetchResult::Error {
                    start: res_start, ..
                } if res_start == start => {}
                _ => {}
            }
        }

        let end = start.saturating_add(REMOTE_STREAM_CHUNK_BYTES - 1);
        let request = self
            .client
            .get(&self.source.url)
            .header(reqwest::header::RANGE, format!("bytes={start}-{end}"));
        let mut response = Self::auth(request, &self.source)
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
            let mut bytes = Vec::new();
            response.read_to_end(&mut bytes)?;
            self.len = Some(bytes.len() as u64);
            self.full_body = Some(bytes);
            self.no_range = true;
            return Ok(());
        }

        if let Some(total) = Self::content_range_total(&response) {
            self.len = Some(total);
        }

        let mut limited = response.by_ref().take(REMOTE_STREAM_CHUNK_BYTES);
        let mut bytes = Vec::new();
        limited.read_to_end(&mut bytes)?;
        self.buffer_start = start;
        if self.len.is_none() && bytes.len() < REMOTE_STREAM_CHUNK_BYTES as usize {
            self.len = Some(start + bytes.len() as u64);
        }
        self.buffer = bytes;
        Ok(())
    }

    fn ensure_buffer(&mut self) -> std::io::Result<()> {
        let buffer_end = self.buffer_start.saturating_add(self.buffer.len() as u64);
        if self.pos >= self.buffer_start && self.pos < buffer_end {
            let remaining = buffer_end - self.pos;
            if remaining <= REMOTE_STREAM_CHUNK_BYTES / 2 && !self.is_prefetch_in_flight() {
                self.start_prefetch(buffer_end);
            }
            return Ok(());
        }
        self.fetch_at(self.pos)?;
        let next_start = self.buffer_start.saturating_add(self.buffer.len() as u64);
        if !self.is_prefetch_in_flight() {
            self.start_prefetch(next_start);
        }
        Ok(())
    }
}

impl Read for RemoteRangeReader {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }

        if self.no_range {
            if self.full_body.is_none() {
                self.download_full()?;
            }
            let body = self
                .full_body
                .as_ref()
                .ok_or_else(|| std::io::Error::other("full_body not initialized"))?;
            let pos = self.pos as usize;
            if pos >= body.len() {
                return Ok(0);
            }
            let available = body.len() - pos;
            let count = available.min(output.len());
            output[..count].copy_from_slice(&body[pos..pos + count]);
            self.pos = self.pos.saturating_add(count as u64);
            return Ok(count);
        }

        if self.len.map(|len| self.pos >= len).unwrap_or(false) {
            return Ok(0);
        }

        self.ensure_buffer()?;

        if self.no_range {
            return self.read(output);
        }

        if self.buffer.is_empty() {
            return Ok(0);
        }

        let offset = self.pos.saturating_sub(self.buffer_start) as usize;
        let available = self.buffer.len().saturating_sub(offset);
        let count = available.min(output.len());
        output[..count].copy_from_slice(&self.buffer[offset..offset + count]);
        self.pos = self.pos.saturating_add(count as u64);
        Ok(count)
    }
}

impl Seek for RemoteRangeReader {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let next = match pos {
            SeekFrom::Start(value) => value as i128,
            SeekFrom::Current(value) => self.pos as i128 + value as i128,
            SeekFrom::End(value) => {
                let len = self
                    .len
                    .ok_or_else(|| std::io::Error::other("远程音频长度未知，无法跳转"))?;
                len as i128 + value as i128
            }
        };
        if next < 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "跳转位置不能小于 0",
            ));
        }
        self.cancel_prefetch();
        self.pos = next as u64;
        Ok(self.pos)
    }
}

fn append_decoded_source<R>(
    reader: R,
    output: &Option<SharedOutputBackend>,
    current_sink: &mut Option<Sink>,
    progress: &Arc<SharedProgress>,
    start_offset: Option<Duration>,
    volume_balance_gain: f32,
    current_normalizer_handle: &mut Option<VolumeNormalizerHandle>,
    equalizer_handle: Arc<crate::player::equalizer::EqualizerHandle>,
    sound_effect_handle: Arc<crate::player::sound_effect::SoundEffectHandle>,
    user_volume: Arc<std::sync::atomic::AtomicU32>,
    source_ctx: Option<String>,
) where
    R: Read + Seek + Send + Sync + 'static,
{
    if let Some(output) = output {
        *current_sink = output.create_sink().ok();

        let reader = BufReader::with_capacity(512 * 1024, reader);
        let decoded = Decoder::new(reader);
        if let Err(e) = &decoded {
            if let Ok(mut reason) = progress.start_failed_reason.lock() {
                *reason = Some(match source_ctx {
                    Some(ctx) => format!("解码器初始化失败: {e}（{ctx}）"),
                    None => format!("解码器初始化失败: {e}"),
                });
            }
            progress.start_failed.store(true, Ordering::Relaxed);
        }
        if let Ok(source) = decoded {
            let rate = source.sample_rate();
            let channels = source.channels();
            progress.sample_rate.store(rate, Ordering::Relaxed);
            progress.channels.store(channels as u32, Ordering::Relaxed);

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
            progress
                .total_duration_secs
                .store(duration_secs.to_bits(), Ordering::Relaxed);

            let offset = start_offset.unwrap_or(Duration::ZERO);
            let skip_samples =
                (offset.as_secs_f64() * rate as f64 * channels as f64).round() as u64;
            progress
                .samples_played
                .store(skip_samples, Ordering::Relaxed);
            if start_offset.is_none() {
                progress.visualizer.reset();
            }

            let skipped_source = source.convert_samples::<f32>().skip_duration(offset);

            let buffered_source = crate::player::buffered_source::BufferedSource::new_tracked(
                skipped_source,
                Some(progress.buffered.clone()),
            );

            let (normalized_source, handle) =
                VolumeNormalizer::new(buffered_source, volume_balance_gain, 100);
            *current_normalizer_handle = Some(handle);

            let eq_source =
                crate::player::equalizer::Equalizer::new(normalized_source, equalizer_handle);

            let se_source =
                crate::player::sound_effect::SoundEffectSource::new(eq_source, sound_effect_handle);

            let plugin_source = crate::player::plugin_host::wrap(se_source);

            let vol_source =
                crate::player::equalizer::UserVolumeSource::new(plugin_source, user_volume);

            let clip_source = crate::player::equalizer::ClipGuardSource::new(vol_source);

            let timed_source = TimedSource::new(
                clip_source,
                progress.samples_played.clone(),
                progress.visualizer.clone(),
            );

            if let Some(sink) = current_sink {
                sink.append(timed_source);
                sink.set_volume(1.0);
                sink.play();
            }
        }
    }
}

enum LocalAudioReader {
    Plain(File),
    Encrypted(crate::player::qmc2::QmcDecryptReader<File>),
}

impl Read for LocalAudioReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            LocalAudioReader::Plain(file) => file.read(buf),
            LocalAudioReader::Encrypted(reader) => reader.read(buf),
        }
    }
}

impl Seek for LocalAudioReader {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        match self {
            LocalAudioReader::Plain(file) => file.seek(pos),
            LocalAudioReader::Encrypted(reader) => reader.seek(pos),
        }
    }
}

fn open_local_audio_reader(path: &Path) -> Option<LocalAudioReader> {
    let file = File::open(path).ok()?;
    match crate::player::qmc2::detect_qmc_crypto(path) {
        Some(crypto) => Some(LocalAudioReader::Encrypted(
            crate::player::qmc2::QmcDecryptReader::new(file, crypto),
        )),
        None => Some(LocalAudioReader::Plain(file)),
    }
}

fn handle_play(
    source: AudioSource,
    output: &Option<SharedOutputBackend>,
    current_sink: &mut Option<Sink>,
    current_path: &mut String,
    is_playing_flag: &mut bool,
    progress: &Arc<SharedProgress>,
    start_offset_ms: Option<u64>,
    volume_balance_gain: f32,
    current_normalizer_handle: &mut Option<VolumeNormalizerHandle>,
    equalizer_handle: Arc<crate::player::equalizer::EqualizerHandle>,
    sound_effect_handle: Arc<crate::player::sound_effect::SoundEffectHandle>,
    user_volume: Arc<std::sync::atomic::AtomicU32>,
) {
    *current_path = source.display_path();
    *is_playing_flag = true;
    reset_playback_progress(progress);

    if output.is_none() {
        if let Ok(mut reason) = progress.start_failed_reason.lock() {
            *reason = Some("未检测到可用的音频输出设备，请检查扬声器/耳机是否已连接".to_string());
        }
        progress.start_failed.store(true, Ordering::Relaxed);
        return;
    }

    if let Some(sink) = current_sink {
        sink.stop();
    }

    let start_offset = start_offset_ms.map(Duration::from_millis);

    match source {
        AudioSource::LocalFile(path) => {
            if let Some(reader) = open_local_audio_reader(Path::new(&path)) {
                append_decoded_source(
                    reader,
                    output,
                    current_sink,
                    progress,
                    start_offset,
                    volume_balance_gain,
                    current_normalizer_handle,
                    equalizer_handle,
                    sound_effect_handle,
                    user_volume,
                    None,
                );
            } else if let Ok(mut reason) = progress.start_failed_reason.lock() {
                *reason = Some("本地音频文件打开失败".to_string());
                progress.start_failed.store(true, Ordering::Relaxed);
            }
        }
        AudioSource::RemoteWebDav(stream) => match RemoteRangeReader::new(stream) {
            Ok(reader) => append_decoded_source(
                reader,
                output,
                current_sink,
                progress,
                start_offset,
                volume_balance_gain,
                current_normalizer_handle,
                equalizer_handle,
                sound_effect_handle,
                user_volume,
                None,
            ),
            Err(err) => {
                if let Ok(mut reason) = progress.start_failed_reason.lock() {
                    *reason = Some(format!("远程流读取器构建失败: {err}"));
                }
                progress.start_failed.store(true, Ordering::Relaxed);
            }
        },
        AudioSource::StreamingTempFile(state) => match state.new_reader_with_decryption() {
            Ok(reader) => {
                let size = state.downloaded_bytes();
                let status = if state.is_download_finished() {
                    if state.download_complete.load(Ordering::Relaxed) {
                        "下载完成".to_string()
                    } else {
                        format!(
                            "下载失败: {}",
                            state
                                .download_error()
                                .unwrap_or_else(|| "未知原因".to_string())
                        )
                    }
                } else {
                    "下载中".to_string()
                };
                append_decoded_source(
                    reader,
                    output,
                    current_sink,
                    progress,
                    start_offset,
                    volume_balance_gain,
                    current_normalizer_handle,
                    equalizer_handle,
                    sound_effect_handle,
                    user_volume,
                    Some(format!("已下载 {size} bytes，{status}")),
                )
            }
            Err(err) => {
                if let Ok(mut reason) = progress.start_failed_reason.lock() {
                    *reason = Some(format!("流式临时文件读取器构建失败: {err}"));
                }
                progress.start_failed.store(true, Ordering::Relaxed);
            }
        },
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_seek(
    time: f64,
    is_playing: bool,
    request_id: u64,
    output: &Option<SharedOutputBackend>,
    current_sink: &mut Option<Sink>,
    current_path: &str,
    is_playing_flag: &mut bool,
    progress: &Arc<SharedProgress>,
    app: &AppHandle,
    volume_balance_gain: f32,
    current_normalizer_handle: &mut Option<VolumeNormalizerHandle>,
    equalizer_handle: Arc<crate::player::equalizer::EqualizerHandle>,
    sound_effect_handle: Arc<crate::player::sound_effect::SoundEffectHandle>,
    user_volume: Arc<std::sync::atomic::AtomicU32>,
    remote_stream: Option<&RemoteStreamSource>,
    streaming_state: Option<&crate::player::stream_cache::StreamingTempFileState>,
) {
    let clamped_time = time.max(0.0);
    let jump_target = Duration::from_secs_f64(clamped_time);
    *is_playing_flag = is_playing;
    progress.visualizer.reset();

    if let Some(sink) = current_sink {
        match sink.try_seek(jump_target) {
            Ok(()) => {
                let rate = progress.sample_rate.load(Ordering::Relaxed);
                let channels = progress.channels.load(Ordering::Relaxed);
                let samples_at_target =
                    (clamped_time * rate as f64 * channels as f64).round() as u64;
                progress
                    .samples_played
                    .store(samples_at_target, Ordering::Relaxed);

                if is_playing {
                    sink.play();
                } else {
                    sink.pause();
                }
            }
            Err(_) => {
                sink.stop();

                let start_offset = Some(jump_target);
                if let Some(state) = streaming_state {
                    match state.new_reader_with_decryption() {
                        Ok(reader) => append_decoded_source(
                            reader,
                            output,
                            current_sink,
                            progress,
                            start_offset,
                            volume_balance_gain,
                            current_normalizer_handle,
                            equalizer_handle,
                            sound_effect_handle,
                            user_volume,
                            None,
                        ),
                        Err(_) => {}
                    }
                } else if let Some(stream) = remote_stream.cloned() {
                    match RemoteRangeReader::new(stream) {
                        Ok(reader) => append_decoded_source(
                            reader,
                            output,
                            current_sink,
                            progress,
                            start_offset,
                            volume_balance_gain,
                            current_normalizer_handle,
                            equalizer_handle,
                            sound_effect_handle,
                            user_volume,
                            None,
                        ),
                        Err(_) => {}
                    }
                } else if !current_path.is_empty() {
                    if let Some(reader) = open_local_audio_reader(Path::new(current_path)) {
                        append_decoded_source(
                            reader,
                            output,
                            current_sink,
                            progress,
                            start_offset,
                            volume_balance_gain,
                            current_normalizer_handle,
                            equalizer_handle,
                            sound_effect_handle,
                            user_volume,
                            None,
                        );
                    }
                }

                if !is_playing {
                    if let Some(new_sink) = current_sink {
                        new_sink.pause();
                    }
                }
            }
        }
    } else {
        let rate = progress.sample_rate.load(Ordering::Relaxed);
        let channels = progress.channels.load(Ordering::Relaxed);
        let samples_at_target = (clamped_time * rate as f64 * channels as f64).round() as u64;
        progress
            .samples_played
            .store(samples_at_target, Ordering::Relaxed);
    }

    let _ = app.emit(
        "seek_completed",
        SeekCompletedPayload {
            request_id,
            time: clamped_time,
        },
    );
}

#[allow(clippy::too_many_arguments)]
fn poll_buffering_watchdog(
    progress: &SharedProgress,
    current_sink: &Option<Sink>,
    network_backed: bool,
    is_playing_flag: bool,
    app: &AppHandle,
    sink_paused: &mut bool,
    buffering_active: &mut bool,
    starved_since: &mut Option<std::time::Instant>,
    resume_grace_since: &mut Option<std::time::Instant>,
) {
    if !network_backed {
        return;
    }

    let now = std::time::Instant::now();
    let starved = progress.buffered.starved.load(Ordering::Relaxed);
    let produced = progress.buffered.produced.swap(false, Ordering::Relaxed);

    let recovered = produced && *sink_paused;
    let starved = starved && !recovered;

    if starved && is_playing_flag && !*sink_paused {
        let since = starved_since.get_or_insert(now);
        if now.saturating_duration_since(*since) >= BUFFER_STARVE_BEFORE_PAUSE {
            if let Some(sink) = current_sink {
                sink.pause();
            }
            *sink_paused = true;
            *starved_since = None;
            if !*buffering_active {
                *buffering_active = true;
                let _ = app.emit("playback:buffer", PlaybackBufferPayload { buffering: true });
            }
        }
    } else if starved {
        *starved_since = Some(now);
        *resume_grace_since = None;
    } else {
        *starved_since = None;

        if *sink_paused {
            if !is_playing_flag {
                if *buffering_active {
                    *buffering_active = false;
                    let _ = app.emit(
                        "playback:buffer",
                        PlaybackBufferPayload { buffering: false },
                    );
                }
                *sink_paused = false;
                return;
            }
            if resume_grace_since.is_none() {
                *resume_grace_since = Some(now);
            }
            let elapsed = resume_grace_since
                .and_then(|t| now.checked_duration_since(t))
                .unwrap_or_default();
            if elapsed >= BUFFER_RESUME_GRACE {
                *resume_grace_since = None;
                if let Some(sink) = current_sink {
                    sink.play();
                }
                *sink_paused = false;
                if *buffering_active {
                    *buffering_active = false;
                    let _ = app.emit(
                        "playback:buffer",
                        PlaybackBufferPayload { buffering: false },
                    );
                }
            }
        } else if *buffering_active {
            *buffering_active = false;
            let _ = app.emit(
                "playback:buffer",
                PlaybackBufferPayload { buffering: false },
            );
        }
    }
}

pub fn init_player(app: &AppHandle) -> PlayerState {
    let (tx, rx) = channel::<AudioCommand>();
    let shared_progress = Arc::new(SharedProgress {
        samples_played: Arc::new(AtomicU64::new(0)),
        sample_rate: Arc::new(AtomicU32::new(44100)),
        channels: Arc::new(AtomicU32::new(2)),
        visualizer: Arc::new(SharedVisualizer::new()),
        start_failed: Arc::new(AtomicBool::new(false)),
        start_failed_reason: Arc::new(std::sync::Mutex::new(None)),
        buffered: Arc::new(BufferedMonitor::new()),
        total_duration_secs: Arc::new(AtomicU64::new(0u64)),
        is_playing: Arc::new(AtomicBool::new(false)),
    });
    let thread_progress = shared_progress.clone();
    let thread_app_handle = app.clone();
    let controls = initialize_media_controls(app);
    let output_status = Arc::new(Mutex::new(AudioOutputStatus::default()));
    let thread_output_status = output_status.clone();
    let thread_controls = controls.clone();

    let thread_eq_handle = Arc::new(crate::player::equalizer::EqualizerHandle::new(
        crate::player::equalizer::EqualizerSettings::default(),
    ));
    let thread_se_handle = Arc::new(crate::player::sound_effect::SoundEffectHandle::new(
        crate::player::sound_effect::SoundEffectSettings::default(),
    ));
    let user_volume = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
    let thread_user_volume = user_volume.clone();

    thread::spawn(move || {
        let host = cpal::default_host();
        let mut selected_device_name: Option<String> = None;
        let mut output = SharedOutputBackend::open(&host, None).ok();
        let mut current_sink: Option<Sink> = None;
        #[cfg(target_os = "windows")]
        let mut exclusive_playback: Option<WasapiExclusivePlayback> = None;
        let mut current_path = String::new();
        let mut current_volume = 1.0;
        let mut current_speed = 1.0;
        let mut is_playing_flag = false;
        let mut requested_output_mode = AudioOutputMode::Shared;
        let mut active_output_mode = AudioOutputMode::Shared;
        let mut fallback_reason: Option<String> = None;
        let mut last_default_device_name = default_output_device_name(&host);
        let mut active_device_name = output
            .as_ref()
            .map(|output| output.active_device_name().to_string());
        let mut current_normalizer_handle: Option<VolumeNormalizerHandle> = None;
        let mut current_volume_balance_gain = 1.0;
        let mut current_dsd_native_passthrough = true;
        let mut current_bit_perfect = false;
        let mut last_progress_emit = std::time::Instant::now();
        let mut last_output_recover = std::time::Instant::now();
        let mut current_remote_stream: Option<RemoteStreamSource> = None;
        let mut current_streaming_state: Option<
            crate::player::stream_cache::StreamingTempFileState,
        > = None;
        let mut watchdog_sink_paused = false;
        let mut watchdog_buffering_active = false;
        let mut watchdog_starved_since: Option<std::time::Instant> = None;
        let mut watchdog_resume_grace_since: Option<std::time::Instant> = None;
        let mut network_backed = false;

        if let Some(output) = &output {
            current_sink = output.create_sink().ok();
        }

        emit_output_status(
            &thread_app_handle,
            &thread_output_status,
            selected_device_name.clone(),
            active_device_name.clone(),
            requested_output_mode,
            active_output_mode,
            fallback_reason.clone(),
        );

        loop {
            thread_progress
                .is_playing
                .store(is_playing_flag, Ordering::Relaxed);
            poll_buffering_watchdog(
                &thread_progress,
                &current_sink,
                network_backed,
                is_playing_flag,
                &thread_app_handle,
                &mut watchdog_sink_paused,
                &mut watchdog_buffering_active,
                &mut watchdog_starved_since,
                &mut watchdog_resume_grace_since,
            );

            #[cfg(target_os = "windows")]
            {
                guard_device_ops(|| {
                    recover_from_exclusive_failure(
                        &mut exclusive_playback,
                        &selected_device_name,
                        &mut output,
                        &host,
                        &mut current_sink,
                        &mut active_device_name,
                        &mut requested_output_mode,
                        &mut active_output_mode,
                        &mut fallback_reason,
                        &current_path,
                        is_playing_flag,
                        &thread_progress,
                        thread_eq_handle.clone(),
                        thread_se_handle.clone(),
                        thread_user_volume.clone(),
                        current_volume_balance_gain,
                        &mut current_normalizer_handle,
                        current_remote_stream.as_ref(),
                        current_streaming_state.as_ref(),
                        &thread_app_handle,
                        &thread_output_status,
                        &mut last_default_device_name,
                    );
                });
            }

            match rx.recv_timeout(PLAYER_POLL_INTERVAL) {
                Ok(cmd) => {
                    let cmd_result =
                        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match cmd {
                            AudioCommand::Play {
                                source,
                                output_mode,
                                start_offset_ms,
                                volume_balance_gain,
                                dsd_native_passthrough,
                                bit_perfect,
                            } => {
                                requested_output_mode = output_mode;
                                current_volume_balance_gain = volume_balance_gain;
                                current_dsd_native_passthrough = dsd_native_passthrough;
                                current_bit_perfect = bit_perfect;
                                let source_is_network_backed = source.is_network_backed();
                                let display_path = source.display_path();
                                current_remote_stream = match &source {
                                    AudioSource::RemoteWebDav(stream) => Some(stream.clone()),
                                    AudioSource::LocalFile(_) => None,
                                    AudioSource::StreamingTempFile(_) => None,
                                };
                                current_streaming_state = match &source {
                                    AudioSource::StreamingTempFile(state) => Some(state.clone()),
                                    _ => None,
                                };
                                network_backed = source_is_network_backed;
                                watchdog_sink_paused = false;
                                watchdog_buffering_active = false;
                                watchdog_starved_since = None;
                                watchdog_resume_grace_since = None;

                                if let Some(sink) = &current_sink {
                                    sink.stop();
                                }
                                current_sink = None;
                                #[cfg(target_os = "windows")]
                                stop_exclusive_playback(&mut exclusive_playback);

                                #[cfg(target_os = "windows")]
                                if output_mode == AudioOutputMode::WasapiExclusive
                                    && !source_is_network_backed
                                {
                                    let exclusive_start = start_offset_ms
                                        .map_or(Duration::ZERO, Duration::from_millis);
                                    match start_exclusive_playback(
                                        display_path.clone(),
                                        selected_device_name.clone(),
                                        current_volume,
                                        true,
                                        exclusive_start,
                                        &thread_progress,
                                        current_volume_balance_gain,
                                        thread_eq_handle.clone(),
                                        thread_se_handle.clone(),
                                        thread_user_volume.clone(),
                                        current_dsd_native_passthrough,
                                        current_bit_perfect,
                                    ) {
                                        Ok(playback) => {
                                            if selected_device_name.is_none() {
                                                last_default_device_name =
                                                    default_output_device_name(&host);
                                            }
                                            active_device_name =
                                                Some(playback.active_device_name().to_string());
                                            active_output_mode = AudioOutputMode::WasapiExclusive;
                                            fallback_reason = None;
                                            current_path = display_path;
                                            is_playing_flag = true;
                                            exclusive_playback = Some(playback);
                                            current_sink = None;
                                            output = None;

                                            emit_output_status(
                                                &thread_app_handle,
                                                &thread_output_status,
                                                selected_device_name.clone(),
                                                active_device_name.clone(),
                                                requested_output_mode,
                                                active_output_mode,
                                                fallback_reason.clone(),
                                            );
                                            return;
                                        }
                                        Err(error) => {
                                            active_output_mode = AudioOutputMode::Shared;
                                            fallback_reason = Some(error);
                                        }
                                    }
                                }
                                #[cfg(target_os = "windows")]
                                if output_mode == AudioOutputMode::WasapiExclusive
                                    && source_is_network_backed
                                {
                                    active_output_mode = AudioOutputMode::Shared;
                                    fallback_reason =
                                        Some("网络音频使用共享模式缓冲播放".to_string());
                                }

                                #[cfg(not(target_os = "windows"))]
                                if output_mode == AudioOutputMode::WasapiExclusive {
                                    active_output_mode = AudioOutputMode::Shared;
                                    fallback_reason = Some(
                                        "WASAPI exclusive mode is only available on Windows"
                                            .to_string(),
                                    );
                                }

                                if active_output_mode == AudioOutputMode::Shared {
                                    guard_device_ops(|| {
                                        output = SharedOutputBackend::open(
                                            &host,
                                            selected_device_name.as_deref(),
                                        )
                                        .ok();
                                    });
                                    if selected_device_name.is_none() {
                                        last_default_device_name =
                                            default_output_device_name(&host);
                                    }
                                    active_device_name = output
                                        .as_ref()
                                        .map(|output| output.active_device_name().to_string());
                                }

                                emit_output_status(
                                    &thread_app_handle,
                                    &thread_output_status,
                                    selected_device_name.clone(),
                                    active_device_name.clone(),
                                    requested_output_mode,
                                    active_output_mode,
                                    fallback_reason.clone(),
                                );

                                handle_play(
                                    source,
                                    &output,
                                    &mut current_sink,
                                    &mut current_path,
                                    &mut is_playing_flag,
                                    &thread_progress,
                                    start_offset_ms,
                                    current_volume_balance_gain,
                                    &mut current_normalizer_handle,
                                    thread_eq_handle.clone(),
                                    thread_se_handle.clone(),
                                    thread_user_volume.clone(),
                                );
                                if current_speed != 1.0 {
                                    if let Some(sink) = &current_sink {
                                        sink.set_speed(current_speed);
                                    }
                                }
                            }
                            AudioCommand::Pause => {
                                is_playing_flag = false;
                                if watchdog_buffering_active {
                                    watchdog_buffering_active = false;
                                    let _ = thread_app_handle.emit(
                                        "playback:buffer",
                                        PlaybackBufferPayload { buffering: false },
                                    );
                                }
                                if let Some(sink) = &current_sink {
                                    sink.stop();
                                }
                                current_sink = None;
                                current_normalizer_handle = None;
                                output = None;
                                #[cfg(target_os = "windows")]
                                stop_exclusive_playback(&mut exclusive_playback);
                            }
                            AudioCommand::Stop => {
                                is_playing_flag = false;
                                current_path.clear();
                                reset_playback_progress(&thread_progress);
                                watchdog_sink_paused = false;
                                watchdog_buffering_active = false;
                                watchdog_starved_since = None;
                                watchdog_resume_grace_since = None;
                                let _ = thread_app_handle.emit(
                                    "playback:buffer",
                                    PlaybackBufferPayload { buffering: false },
                                );
                                if let Some(sink) = &current_sink {
                                    sink.stop();
                                }
                                current_sink = None;
                                current_normalizer_handle = None;
                                output = None;
                                #[cfg(target_os = "windows")]
                                stop_exclusive_playback(&mut exclusive_playback);
                            }
                            AudioCommand::Resume => {
                                is_playing_flag = true;
                                if current_path.is_empty() {
                                    return;
                                }
                                #[cfg(target_os = "windows")]
                                let source_is_network_backed = network_backed;
                                #[cfg(target_os = "windows")]
                                if requested_output_mode == AudioOutputMode::WasapiExclusive
                                    && !source_is_network_backed
                                {
                                    stop_exclusive_playback(&mut exclusive_playback);
                                    match start_exclusive_playback(
                                        current_path.clone(),
                                        selected_device_name.clone(),
                                        current_volume,
                                        true,
                                        progress_duration(&thread_progress),
                                        &thread_progress,
                                        current_volume_balance_gain,
                                        thread_eq_handle.clone(),
                                        thread_se_handle.clone(),
                                        thread_user_volume.clone(),
                                        current_dsd_native_passthrough,
                                        current_bit_perfect,
                                    ) {
                                        Ok(playback) => {
                                            if selected_device_name.is_none() {
                                                last_default_device_name =
                                                    default_output_device_name(&host);
                                            }
                                            active_device_name =
                                                Some(playback.active_device_name().to_string());
                                            active_output_mode = AudioOutputMode::WasapiExclusive;
                                            fallback_reason = None;
                                            exclusive_playback = Some(playback);
                                            current_sink = None;
                                            output = None;
                                            current_normalizer_handle = None;
                                            emit_output_status(
                                                &thread_app_handle,
                                                &thread_output_status,
                                                selected_device_name.clone(),
                                                active_device_name.clone(),
                                                requested_output_mode,
                                                active_output_mode,
                                                fallback_reason.clone(),
                                            );
                                            return;
                                        }
                                        Err(error) => {
                                            fallback_reason = Some(error);
                                        }
                                    }
                                }

                                guard_device_ops(|| {
                                    output = SharedOutputBackend::open(
                                        &host,
                                        selected_device_name.as_deref(),
                                    )
                                    .ok();
                                });
                                if selected_device_name.is_none() {
                                    last_default_device_name = default_output_device_name(&host);
                                }
                                active_device_name = output
                                    .as_ref()
                                    .map(|output| output.active_device_name().to_string());
                                active_output_mode = AudioOutputMode::Shared;
                                restore_current_playback(
                                    &output,
                                    &mut current_sink,
                                    &current_path,
                                    true,
                                    &thread_progress,
                                    thread_eq_handle.clone(),
                                    thread_se_handle.clone(),
                                    thread_user_volume.clone(),
                                    current_volume_balance_gain,
                                    &mut current_normalizer_handle,
                                    current_remote_stream.as_ref(),
                                    current_streaming_state.as_ref(),
                                );
                                if current_speed != 1.0 {
                                    if let Some(sink) = &current_sink {
                                        sink.set_speed(current_speed);
                                    }
                                }
                                emit_output_status(
                                    &thread_app_handle,
                                    &thread_output_status,
                                    selected_device_name.clone(),
                                    active_device_name.clone(),
                                    requested_output_mode,
                                    active_output_mode,
                                    fallback_reason.clone(),
                                );
                            }
                            AudioCommand::Seek {
                                time,
                                is_playing,
                                request_id,
                            } => {
                                #[cfg(target_os = "windows")]
                                if let Some(playback) = &exclusive_playback {
                                    let clamped_time = time.max(0.0);
                                    is_playing_flag = is_playing;
                                    playback
                                        .seek(Duration::from_secs_f64(clamped_time), is_playing);
                                    let _ = thread_app_handle.emit(
                                        "seek_completed",
                                        SeekCompletedPayload {
                                            request_id,
                                            time: clamped_time,
                                        },
                                    );
                                    return;
                                }

                                watchdog_sink_paused = false;
                                watchdog_buffering_active = false;
                                watchdog_starved_since = None;
                                watchdog_resume_grace_since = None;

                                handle_seek(
                                    time,
                                    is_playing,
                                    request_id,
                                    &output,
                                    &mut current_sink,
                                    &current_path,
                                    &mut is_playing_flag,
                                    &thread_progress,
                                    &thread_app_handle,
                                    current_volume_balance_gain,
                                    &mut current_normalizer_handle,
                                    thread_eq_handle.clone(),
                                    thread_se_handle.clone(),
                                    thread_user_volume.clone(),
                                    current_remote_stream.as_ref(),
                                    current_streaming_state.as_ref(),
                                )
                            }
                            AudioCommand::SetVolume(vol) => {
                                current_volume = vol;
                                thread_user_volume.store(vol.to_bits(), Ordering::Relaxed);
                            }
                            AudioCommand::SetSpeed(speed) => {
                                current_speed = speed;
                                if let Some(sink) = &current_sink {
                                    sink.set_speed(speed);
                                }
                            }
                            AudioCommand::SetDevice(device_name) => {
                                selected_device_name = device_name;

                                if let Some(sink) = &current_sink {
                                    sink.stop();
                                }
                                current_sink = None;
                                #[cfg(target_os = "windows")]
                                stop_exclusive_playback(&mut exclusive_playback);

                                guard_device_ops(|| {
                                    restore_preferred_output(
                                        &selected_device_name,
                                        &mut output,
                                        &host,
                                        &mut current_sink,
                                        #[cfg(target_os = "windows")]
                                        &mut exclusive_playback,
                                        &mut active_device_name,
                                        &mut active_output_mode,
                                        &mut fallback_reason,
                                        requested_output_mode,
                                        &current_path,
                                        current_volume,
                                        is_playing_flag,
                                        &thread_progress,
                                        current_volume_balance_gain,
                                        thread_eq_handle.clone(),
                                        thread_se_handle.clone(),
                                        thread_user_volume.clone(),
                                        &mut current_normalizer_handle,
                                        current_remote_stream.as_ref(),
                                        current_streaming_state.as_ref(),
                                        current_dsd_native_passthrough,
                                        current_bit_perfect,
                                    );
                                });
                                if current_speed != 1.0 {
                                    if let Some(sink) = &current_sink {
                                        sink.set_speed(current_speed);
                                    }
                                }
                                if selected_device_name.is_none() {
                                    last_default_device_name = default_output_device_name(&host);
                                }

                                emit_output_status(
                                    &thread_app_handle,
                                    &thread_output_status,
                                    selected_device_name.clone(),
                                    active_device_name.clone(),
                                    requested_output_mode,
                                    active_output_mode,
                                    fallback_reason.clone(),
                                );
                            }
                            AudioCommand::SetOutputMode(output_mode) => {
                                requested_output_mode = output_mode;

                                if let Some(sink) = &current_sink {
                                    sink.stop();
                                }
                                current_sink = None;
                                #[cfg(target_os = "windows")]
                                stop_exclusive_playback(&mut exclusive_playback);

                                guard_device_ops(|| {
                                    restore_preferred_output(
                                        &selected_device_name,
                                        &mut output,
                                        &host,
                                        &mut current_sink,
                                        #[cfg(target_os = "windows")]
                                        &mut exclusive_playback,
                                        &mut active_device_name,
                                        &mut active_output_mode,
                                        &mut fallback_reason,
                                        requested_output_mode,
                                        &current_path,
                                        current_volume,
                                        is_playing_flag,
                                        &thread_progress,
                                        current_volume_balance_gain,
                                        thread_eq_handle.clone(),
                                        thread_se_handle.clone(),
                                        thread_user_volume.clone(),
                                        &mut current_normalizer_handle,
                                        current_remote_stream.as_ref(),
                                        current_streaming_state.as_ref(),
                                        current_dsd_native_passthrough,
                                        current_bit_perfect,
                                    );
                                });
                                if current_speed != 1.0 {
                                    if let Some(sink) = &current_sink {
                                        sink.set_speed(current_speed);
                                    }
                                }
                                if selected_device_name.is_none() {
                                    last_default_device_name = default_output_device_name(&host);
                                }

                                emit_output_status(
                                    &thread_app_handle,
                                    &thread_output_status,
                                    selected_device_name.clone(),
                                    active_device_name.clone(),
                                    requested_output_mode,
                                    active_output_mode,
                                    fallback_reason.clone(),
                                );
                            }
                            AudioCommand::SetVolumeBalance {
                                enabled,
                                target_gain,
                            } => {
                                let next_gain = if enabled { target_gain } else { 1.0 };
                                current_volume_balance_gain = next_gain;

                                if let Some(ref handle) = current_normalizer_handle {
                                    handle.set_target_gain(next_gain);
                                }

                                #[cfg(target_os = "windows")]
                                if let Some(ref playback) = exclusive_playback {
                                    playback.set_volume_balance(enabled, target_gain);
                                }
                            }
                            AudioCommand::SetEqualizerSettings { settings } => {
                                thread_eq_handle.set_settings(settings.clone());
                                #[cfg(target_os = "windows")]
                                if let Some(ref playback) = exclusive_playback {
                                    playback.set_equalizer_settings(settings);
                                }
                            }
                            AudioCommand::SetSoundEffectSettings { settings } => {
                                thread_se_handle.set_settings(settings.clone());
                                #[cfg(target_os = "windows")]
                                if let Some(ref playback) = exclusive_playback {
                                    playback.set_sound_effect_settings(settings);
                                }
                            }
                        }));
                    if cmd_result.is_err() {
                        eprintln!(
                            "[Audio][rust] 播放命令处理 panic，已隔离（不终止播放线程，命令通道保持存活）"
                        );
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if selected_device_name.is_none() {
                        let next_default_name = default_output_device_name(&host);

                        let missing_output = is_playing_flag
                            && output.is_none()
                            && active_output_mode == AudioOutputMode::Shared
                            && last_output_recover.elapsed() >= OUTPUT_RECOVER_INTERVAL;
                        if missing_output {
                            last_output_recover = std::time::Instant::now();
                            if let Some(sink) = &current_sink {
                                sink.stop();
                            }
                            current_sink = None;
                            guard_device_ops(|| {
                                restore_shared_output(
                                    &selected_device_name,
                                    &mut output,
                                    &host,
                                    &mut current_sink,
                                    &mut active_device_name,
                                    &current_path,
                                    is_playing_flag,
                                    &thread_progress,
                                    thread_eq_handle.clone(),
                                    thread_se_handle.clone(),
                                    thread_user_volume.clone(),
                                    current_volume_balance_gain,
                                    &mut current_normalizer_handle,
                                    current_remote_stream.as_ref(),
                                    current_streaming_state.as_ref(),
                                );
                            });
                            if output.is_some() {
                                fallback_reason = None;
                                thread_progress.start_failed.store(false, Ordering::Relaxed);
                                if let Ok(mut reason) = thread_progress.start_failed_reason.lock() {
                                    *reason = None;
                                }
                                last_default_device_name = next_default_name.clone();
                            } else {
                                fallback_reason = Some(
                                    "未检测到可用的音频输出设备，请检查扬声器/耳机是否已连接"
                                        .to_string(),
                                );
                            }
                            emit_output_status(
                                &thread_app_handle,
                                &thread_output_status,
                                selected_device_name.clone(),
                                active_device_name.clone(),
                                requested_output_mode,
                                active_output_mode,
                                fallback_reason.clone(),
                            );
                        }

                        if is_playing_flag
                            && should_restore_for_default_device_change(
                                &selected_device_name,
                                &last_default_device_name,
                                &next_default_name,
                                &active_device_name,
                            )
                        {
                            last_default_device_name = next_default_name;
                            if let Some(sink) = &current_sink {
                                sink.stop();
                            }
                            current_sink = None;
                            output = None;
                            #[cfg(target_os = "windows")]
                            stop_exclusive_playback(&mut exclusive_playback);

                            #[cfg(target_os = "windows")]
                            guard_device_ops(|| {
                                restore_preferred_output(
                                    &selected_device_name,
                                    &mut output,
                                    &host,
                                    &mut current_sink,
                                    &mut exclusive_playback,
                                    &mut active_device_name,
                                    &mut active_output_mode,
                                    &mut fallback_reason,
                                    requested_output_mode,
                                    &current_path,
                                    current_volume,
                                    is_playing_flag,
                                    &thread_progress,
                                    current_volume_balance_gain,
                                    thread_eq_handle.clone(),
                                    thread_se_handle.clone(),
                                    thread_user_volume.clone(),
                                    &mut current_normalizer_handle,
                                    current_remote_stream.as_ref(),
                                    current_streaming_state.as_ref(),
                                    current_dsd_native_passthrough,
                                    current_bit_perfect,
                                );
                            });
                            #[cfg(not(target_os = "windows"))]
                            guard_device_ops(|| {
                                restore_preferred_output(
                                    &selected_device_name,
                                    &mut output,
                                    &host,
                                    &mut current_sink,
                                    &mut active_device_name,
                                    &mut active_output_mode,
                                    &mut fallback_reason,
                                    requested_output_mode,
                                    &current_path,
                                    current_volume,
                                    is_playing_flag,
                                    &thread_progress,
                                    current_volume_balance_gain,
                                    thread_eq_handle.clone(),
                                    thread_se_handle.clone(),
                                    thread_user_volume.clone(),
                                    &mut current_normalizer_handle,
                                    current_remote_stream.as_ref(),
                                    current_streaming_state.as_ref(),
                                    current_dsd_native_passthrough,
                                    current_bit_perfect,
                                );
                            });

                            emit_output_status(
                                &thread_app_handle,
                                &thread_output_status,
                                None,
                                active_device_name.clone(),
                                requested_output_mode,
                                active_output_mode,
                                fallback_reason.clone(),
                            );
                        }
                    }

                    if is_playing_flag && last_progress_emit.elapsed() >= PROGRESS_EMIT_INTERVAL {
                        last_progress_emit = std::time::Instant::now();
                        let position = progress_duration(&thread_progress).as_secs_f64();
                        let duration_bits =
                            thread_progress.total_duration_secs.load(Ordering::Relaxed);
                        let duration = f64::from_bits(duration_bits);
                        let _ = thread_app_handle.emit(
                            "playback:progress",
                            PlaybackProgressPayload {
                                position,
                                duration,
                                is_playing: true,
                            },
                        );

                        if let Ok(mut controls) = thread_controls.lock() {
                            if let Some(mc) = controls.as_mut() {
                                let pos = MediaPosition(Duration::from_secs_f64(position.max(0.0)));
                                let _ = mc.set_playback(MediaPlayback::Playing {
                                    progress: Some(pos),
                                });
                            }
                        }
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    PlayerState {
        tx: Mutex::new(tx),
        progress: shared_progress,
        playback_id: Arc::new(AtomicU64::new(0)),
        controls,
        output_status,
        user_volume,
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
            "C:\\Users\\小奇\\AppData\\Local\\Temp\\xy_music_1787144280366.m4s".to_string()
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
