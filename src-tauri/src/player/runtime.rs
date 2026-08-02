use crate::player::device::{default_output_device_name, emit_output_status};
use crate::player::loudness::{VolumeNormalizer, VolumeNormalizerHandle};
use crate::player::output::shared::progress_seconds_from_samples;
use crate::player::output::shared::{restore_current_playback, SharedOutputBackend};
#[cfg(target_os = "windows")]
use crate::player::output::wasapi_exclusive::{ExclusivePlayRequest, WasapiExclusivePlayback};
use crate::player::output::OutputBackend;
use crate::player::types::{
    AudioCommand, AudioOutputMode, AudioOutputStatus, AudioSource, PlayerState,
    SeekCompletedPayload, SharedProgress, SharedVisualizer, TimedSource,
};
use crate::remote::cache::RemoteStreamSource;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use rodio::{Decoder, Sink, Source};
use souvlaki::{MediaControlEvent, MediaControls, PlatformConfig};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const PLAYER_POLL_INTERVAL: Duration = Duration::from_millis(150);

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
    // 同时清零采样率/声道，避免上一首的残留值让 get_playback_ready（判据 sample_rate>0）
    // 在新歌尚未解码成功时就误报“已就绪”。解码成功后 append_decoded_source 会重新写入正确值。
    progress.sample_rate.store(0, Ordering::Relaxed);
    progress.channels.store(0, Ordering::Relaxed);
    progress.start_failed.store(false, Ordering::Relaxed);
    progress.visualizer.reset();
}

fn should_restore_for_default_device_change(
    selected_device_name: &Option<String>,
    last_default_device_name: &Option<String>,
    next_default_device_name: &Option<String>,
    _active_device_name: &Option<String>,
) -> bool {
    selected_device_name.is_none() && next_default_device_name != last_default_device_name
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
    user_volume: Arc<std::sync::atomic::AtomicU32>,
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
        user_volume,
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
    current_remote_stream: Option<&RemoteStreamSource>,
    current_streaming_state: Option<&crate::player::stream_cache::StreamingTempFileState>,
) {
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
            user_volume.clone(),
        ) {
            Ok(playback) => {
                *active_device_name = Some(playback.active_device_name().to_string());
                *active_output_mode = AudioOutputMode::WasapiExclusive;
                *fallback_reason = None;
                *exclusive_playback = Some(playback);
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
        current_remote_stream,
        current_streaming_state,
    );
}

fn initialize_media_controls(app: &AppHandle) -> Arc<Mutex<Option<MediaControls>>> {
    let controls = Arc::new(Mutex::new(None));

    if let Some(window) = app.get_webview_window("main") {
        if let Ok(handle) = window.window_handle() {
            let raw_handle = handle.as_raw();

            #[cfg(target_os = "windows")]
            {
                if let RawWindowHandle::Win32(h) = raw_handle {
                    let hwnd = h.hwnd.get() as *mut std::ffi::c_void;

                    let config = PlatformConfig {
                        dbus_name: "xy_music",
                        display_name: "XY-Music",
                        hwnd: Some(hwnd),
                    };

                    match MediaControls::new(config) {
                        Ok(mut mc) => {
                            let app_clone = app.clone();
                            let _ = mc.attach(move |event| match event {
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
                                _ => {}
                            });
                            *controls.lock().unwrap() = Some(mc);
                        }
                        Err(error) => println!("Error initializing MediaControls: {:?}", error),
                    }
                }
            }
        }
    }

    controls
}

const REMOTE_STREAM_CHUNK_BYTES: u64 = 2 * 1024 * 1024;

/// 后台预读线程返回的结果。start 用于校验结果是否对应当前需要的位置，
/// 避免旧线程的过期结果被误用（seek 后 start 不匹配会被丢弃）。
enum PrefetchResult {
    Bytes { start: u64, data: Vec<u8> },
    NoRange { data: Vec<u8> },
    Error { start: u64, message: String },
}

pub(crate) struct RemoteRangeReader {
    client: reqwest::blocking::Client,
    source: RemoteStreamSource,
    pos: u64,
    len: Option<u64>,
    buffer_start: u64,
    buffer: Vec<u8>,
    /// 服务器不支持 Range（对 Range 请求返回 200 全量）时置 true：
    /// 一次性把整首歌下载进 full_body，之后全部从内存服务，不再发分块请求。
    /// 这修复了「不支持 Range 的 CDN 直链只能播首个 1MB 块后中断」的问题。
    no_range: bool,
    full_body: Option<Vec<u8>>,
    /// [预读] 在当前 buffer 消耗过半时，后台线程提前下载下一块。
    /// 避免 buffer 耗尽时同步阻塞导致音频卡顿（每块的 HTTP 请求耗时数百毫秒到数秒）。
    /// prefetch_state 存储结果，prefetch_in_flight 标记线程是否仍在运行。
    /// 不存储 JoinHandle（它不是 Sync），改为 detach 线程——结果通过 Arc 共享。
    prefetch_state: Arc<Mutex<Option<PrefetchResult>>>,
    prefetch_in_flight: Arc<AtomicBool>,
    /// 当前预读请求的起始位置，用于校验结果是否对应当前需要的 pos
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
            .build()
            .map_err(|error| error.to_string())?;
        // content_len 失败时不阻塞，返回 None 继续播放
        let len = Self::content_len(&client, &source);
        Ok(Self {
            client,
            source,
            pos: 0,
            len,
            buffer_start: 0,
            buffer: Vec::new(),
            no_range: false,
            full_body: None,
            prefetch_state: Arc::new(Mutex::new(None)),
            prefetch_in_flight: Arc::new(AtomicBool::new(false)),
            prefetch_start: 0,
        })
    }

    /// 一次性下载整首歌到内存（用于服务器不支持 Range 的情况）。
    fn download_full(&mut self) -> std::io::Result<()> {
        let request = self.client.get(&self.source.url);
        let mut response = Self::auth(request, &self.source)
            .send()
            .map_err(std::io::Error::other)?;
        if !response.status().is_success() {
            eprintln!(
                "[Audio][rust] 整曲下载失败 status={} url={}",
                response.status(),
                self.source.url
            );
            return Err(std::io::Error::other(format!(
                "远程音频下载失败：{}",
                response.status()
            )));
        }
        // 检查 Content-Type：部分音源在 URL 失效或需要特定 headers 时返回 HTML 错误页，
        // 直接当作音频解码会报 "Unrecognized format"。提前检测并给出更明确的错误信息。
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
            let preview = String::from_utf8_lossy(&bytes[..bytes.len().min(200)]);
            eprintln!(
                "[Audio][rust] 服务器返回非音频内容 (Content-Type: {})，可能为错误页面或试听片段 url={}\n  内容预览: {}",
                content_type,
                self.source.url,
                preview.chars().take(200).collect::<String>()
            );
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
        // 认证：仅在有用户名时加 Basic Auth（WebDAV）
        let mut request =
            if let Some(username) = source.username.as_deref().filter(|value| !value.is_empty()) {
                request.basic_auth(username.to_string(), source.password.clone())
            } else {
                request
            };
        // 自定义请求头：在线直链防盗链常需要浏览器 UA / Referer
        if let Some(ua) = source.user_agent.as_deref().filter(|value| !value.is_empty()) {
            request = request.header(reqwest::header::USER_AGENT, ua);
        }
        if let Some(referer) = source.referer.as_deref().filter(|value| !value.is_empty()) {
            request = request.header(reqwest::header::REFERER, referer);
        }
        // 插件返回的自定义请求头（如 Cookie、Referer 等防盗链 headers）
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

    /// 从响应的 Content-Length 头显式解析长度。
    /// 注意：不能用 reqwest 的 `response.content_length()`——对 HEAD 等无 body 响应它可能返回
    /// 已读取 body 的长度（0），而非头部声明的值，导致误判文件长度为 0、整个流读不出。
    fn content_length_header(response: &reqwest::blocking::Response) -> Option<u64> {
        response
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<u64>().ok())
            .filter(|len| *len > 0)
    }

    fn content_len(client: &reqwest::blocking::Client, source: &RemoteStreamSource) -> Option<u64> {
        // 使用更短的超时，避免 B站 CDN 不响应 HEAD 请求时卡死
        let timeout_client = match reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(5))
            .gzip(true)
            .build() {
            Ok(c) => c,
            Err(_) => return None,
        };
        if let Ok(response) = Self::auth(timeout_client.head(&source.url), source).send() {
            if response.status().is_success() {
                if let Some(length) = Self::content_length_header(&response) {
                    return Some(length);
                }
            }
        }

        let response = Self::auth(
            client
                .get(&source.url)
                .header(reqwest::header::RANGE, "bytes=0-0"),
            source,
        )
        .send()
        .ok()?;
        if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            response
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.rsplit('/').next())
                .and_then(|value| value.parse::<u64>().ok())
        } else if response.status().is_success() {
            Self::content_length_header(&response)
        } else {
            None
        }
    }

    /// 在后台线程提前下载从 start 位置开始的下一块数据。
    /// 不阻塞当前线程——结果通过 prefetch_state 传递，ensure_buffer 在需要时取用。
    /// 不存储 JoinHandle（非 Sync），改为 detach 线程，用 AtomicBool 跟踪完成状态。
    fn start_prefetch(&mut self, start: u64) {
        // 已知文件长度时，不预读超出末尾的范围（避免无意义的 HTTP 请求）
        if let Some(len) = self.len {
            if start >= len {
                return;
            }
        }
        // 清除旧结果，标记新预读进行中
        *self.prefetch_state.lock().unwrap() = None;
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
                        // 服务器忽略 Range 直接返回 200 全量
                        let mut bytes = Vec::new();
                        match response.read_to_end(&mut bytes) {
                            Ok(_) => PrefetchResult::NoRange { data: bytes },
                            Err(e) => PrefetchResult::Error { start, message: e.to_string() },
                        }
                    } else if response.status().is_success()
                        || response.status() == reqwest::StatusCode::PARTIAL_CONTENT
                    {
                        let mut limited = response.by_ref().take(REMOTE_STREAM_CHUNK_BYTES);
                        let mut bytes = Vec::new();
                        match limited.read_to_end(&mut bytes) {
                            Ok(_) => PrefetchResult::Bytes { start, data: bytes },
                            Err(e) => PrefetchResult::Error { start, message: e.to_string() },
                        }
                    } else {
                        PrefetchResult::Error {
                            start,
                            message: format!("HTTP {}", response.status()),
                        }
                    }
                }
                Err(e) => PrefetchResult::Error { start, message: e.to_string() },
            };
            *state.lock().unwrap() = Some(result);
            in_flight.store(false, Ordering::Relaxed);
        });
    }

    /// 尝试获取已完成的后台预读结果。如果预读线程尚未完成则返回 None（不阻塞）。
    fn try_take_prefetched(&mut self) -> Option<PrefetchResult> {
        // in_flight 为 true 表示线程仍在运行，结果尚未就绪
        if self.prefetch_in_flight.load(Ordering::Relaxed) {
            return None;
        }
        self.prefetch_state.lock().unwrap().take()
    }

    /// 是否有预读正在进行
    fn is_prefetch_in_flight(&self) -> bool {
        self.prefetch_in_flight.load(Ordering::Relaxed)
    }

    /// 取消未完成的预读（seek 后旧结果不再有用）
    fn cancel_prefetch(&mut self) {
        self.prefetch_in_flight.store(false, Ordering::Relaxed);
        *self.prefetch_state.lock().unwrap() = None;
    }

    fn fetch_at(&mut self, start: u64) -> std::io::Result<()> {
        // 优先使用后台预读结果（位置匹配且已完成）
        if let Some(result) = self.try_take_prefetched() {
            match result {
                PrefetchResult::Bytes { start: res_start, data } if res_start == start => {
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
                PrefetchResult::Error { start: res_start, message } if res_start == start => {
                    eprintln!("[Audio][rust] 预读失败，回退同步下载: {}", message);
                    // 继续走同步下载
                }
                _ => {
                    // 旧预读结果（start 不匹配），丢弃并同步下载
                }
            }
        }

        // 同步下载（原始逻辑）
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
            eprintln!(
                "[Audio][rust] 远程流请求非成功状态 status={} url={}（可能防盗链 403/鉴权失败）",
                response.status(),
                self.source.url
            );
            return Err(std::io::Error::other(format!(
                "远程音频播放失败：{}",
                response.status()
            )));
        }
        if response.status() == reqwest::StatusCode::OK {
            // 服务器忽略 Range 直接返回 200 全量 → 不支持 Range。
            // 直接把整个响应体读入 full_body，后续从内存服务，避免只播首块就中断。
            eprintln!(
                "[Audio][rust] 服务器忽略 Range 返回 200，改为整曲下载到内存 url={}",
                self.source.url
            );
            let mut bytes = Vec::new();
            response.read_to_end(&mut bytes)?;
            self.len = Some(bytes.len() as u64);
            self.full_body = Some(bytes);
            self.no_range = true;
            return Ok(());
        }

        let mut limited = response.by_ref().take(REMOTE_STREAM_CHUNK_BYTES);
        let mut bytes = Vec::new();
        limited.read_to_end(&mut bytes)?;
        self.buffer_start = start;
        self.buffer = bytes;
        Ok(())
    }

    fn ensure_buffer(&mut self) -> std::io::Result<()> {
        let buffer_end = self.buffer_start.saturating_add(self.buffer.len() as u64);
        if self.pos >= self.buffer_start && self.pos < buffer_end {
            // buffer 仍有效：当剩余数据不足一半时，提前在后台下载下一块
            let remaining = buffer_end - self.pos;
            if remaining <= REMOTE_STREAM_CHUNK_BYTES / 2 && !self.is_prefetch_in_flight() {
                self.start_prefetch(buffer_end);
            }
            return Ok(());
        }
        // buffer 已耗尽：fetch_at 会优先取用已完成的后台预读结果，
        // 没有命中才同步阻塞下载
        self.fetch_at(self.pos)?;
        // 同步下载完成后，立刻预读下一块，为后续播放做准备
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

        // 不支持 Range：整曲已下载进 full_body，直接从内存按 pos 服务
        if self.no_range {
            if self.full_body.is_none() {
                self.download_full()?;
            }
            let body = self.full_body.as_ref().unwrap();
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

        // fetch_at 可能在过程中发现服务器不支持 Range 而切到 full_body 模式
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
        // seek 后旧的预读结果不再有用，取消后台预读线程
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
) where
    R: Read + Seek + Send + Sync + 'static,
{
    if let Some(output) = output {
        *current_sink = output.create_sink().ok();

        let reader = BufReader::with_capacity(512 * 1024, reader);
        let decoded = Decoder::new(reader);
        if let Err(ref e) = decoded {
            eprintln!("[Audio][rust] Decoder::new 解码失败（无法识别音频格式或流读取失败）: {e}");
            progress.start_failed.store(true, Ordering::Relaxed);
        }
        if let Ok(source) = decoded {
            let rate = source.sample_rate();
            let channels = source.channels();
            progress.sample_rate.store(rate, Ordering::Relaxed);
            progress.channels.store(channels as u32, Ordering::Relaxed);

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

            // 0. BufferedSource 预读取缓冲：后台线程解码（含网络流式 sleep、解码瞬时慢帧），
            //    cpal 回调仅做 O(1) 通道读取，隔离系统调度抢占对音频线程的影响。
            //    配合较大 cpal 输出缓冲（stream.rs），可容忍数十~百毫秒线程抢占而不断音。
            //    seek 由 handle_seek 的重建路径处理（try_seek 同步 rendezvous 到后台线程）。
            let buffered_source =
                crate::player::buffered_source::BufferedSource::new(skipped_source);

            // 1. VolumeNormalizer 音量平衡节点
            let (normalized_source, handle) = VolumeNormalizer::new(
                buffered_source,
                volume_balance_gain,
                100, // ramp 100ms
            );
            *current_normalizer_handle = Some(handle);

            // 2. Equalizer 10段级联滤波器组
            let eq_source =
                crate::player::equalizer::Equalizer::new(normalized_source, equalizer_handle);

            // 2.5 SoundEffectSource 音效处理源
            let se_source = crate::player::sound_effect::SoundEffectSource::new(
                eq_source,
                sound_effect_handle,
            );

            // 3. UserVolumeSource 自定义主音量节点
            let vol_source =
                crate::player::equalizer::UserVolumeSource::new(se_source, user_volume);

            // 4. ClipGuardSource 最终安全限幅源
            let clip_source = crate::player::equalizer::ClipGuardSource::new(vol_source);

            // 5. TimedSource 可视化进度节点
            let timed_source = TimedSource::new(
                clip_source,
                progress.samples_played.clone(),
                progress.visualizer.clone(),
            );

            if let Some(sink) = current_sink {
                sink.append(timed_source);
                sink.set_volume(1.0); // 必须固定共享模式 Sink 自身音量恒为 1.0，由 UserVolumeSource 接管主音量
                sink.play();
            }
        }
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

    if let Some(sink) = current_sink {
        sink.stop();
    }

    let start_offset = start_offset_ms.map(Duration::from_millis);

    match source {
        AudioSource::LocalFile(path) => {
            if let Ok(file) = File::open(path) {
                append_decoded_source(
                    file,
                    output,
                    current_sink,
                    progress,
                    start_offset,
                    volume_balance_gain,
                    current_normalizer_handle,
                    equalizer_handle,
                    sound_effect_handle,
                    user_volume,
                );
            }
        }
        AudioSource::RemoteWebDav(stream) => {
            let stream_url = stream.url.clone();
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
                ),
                Err(e) => {
                    eprintln!("[Audio][rust] 远程流 RemoteRangeReader 创建失败 url={stream_url}: {e}");
                    progress.start_failed.store(true, Ordering::Relaxed);
                }
            }
        }
        AudioSource::StreamingTempFile(state) => {
            // [在线播放重构] 从流式临时文件创建 reader，边下边播
            match state.new_reader() {
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
                ),
                Err(e) => {
                    eprintln!(
                        "[Audio][rust] 流式临时文件 reader 创建失败 path={}: {e}",
                        state.path
                    );
                    progress.start_failed.store(true, Ordering::Relaxed);
                }
            }
        }
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
                // try_seek 失败（流式音频跳转到靠后位置时常见）：停掉旧 sink 并重建解码链，
                // 用 skip_duration 跳到目标位置。
                //
                // 关键：远程流（在线直链/WebDAV）的 current_path 是 URL，不能用 File::open 打开，
                // 必须用 RemoteRangeReader 重建；否则这里会静默失败，导致 sink 已停但没有新音源
                // ——表现为"拖动进度条后没声音，进度条却继续走"。
                sink.stop();

                // append_decoded_source 内部会重建 sink、装配处理链并开始播放
                let start_offset = Some(jump_target);
                // [在线播放重构] 优先使用 StreamingTempFileReader 重建（边下边播）
                if let Some(state) = streaming_state {
                    match state.new_reader() {
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
                        ),
                        Err(e) => {
                            eprintln!("[Audio][rust] seek 重建流式临时文件失败: {e}");
                        }
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
                        ),
                        Err(e) => {
                            eprintln!("[Audio][rust] seek 重建远程流失败: {e}");
                        }
                    }
                } else if !current_path.is_empty() {
                    match File::open(current_path) {
                        Ok(file) => append_decoded_source(
                            file,
                            output,
                            current_sink,
                            progress,
                            start_offset,
                            volume_balance_gain,
                            current_normalizer_handle,
                            equalizer_handle,
                            sound_effect_handle,
                            user_volume,
                        ),
                        Err(e) => {
                            eprintln!("[Audio][rust] seek 重建本地文件失败: {e}");
                        }
                    }
                }

                if !is_playing {
                    if let Some(new_sink) = current_sink {
                        new_sink.pause();
                    }
                }
            }
        }
    }

    let _ = app.emit(
        "seek_completed",
        SeekCompletedPayload {
            request_id,
            time: clamped_time,
        },
    );
}

pub fn init_player(app: &AppHandle) -> PlayerState {
    let (tx, rx) = channel::<AudioCommand>();
    let shared_progress = Arc::new(SharedProgress {
        samples_played: Arc::new(AtomicU64::new(0)),
        sample_rate: Arc::new(AtomicU32::new(44100)),
        channels: Arc::new(AtomicU32::new(2)),
        visualizer: Arc::new(SharedVisualizer::new()),
        start_failed: Arc::new(AtomicBool::new(false)),
    });
    let thread_progress = shared_progress.clone();
    let thread_app_handle = app.clone();
    let controls = initialize_media_controls(app);
    let output_status = Arc::new(Mutex::new(AudioOutputStatus::default()));
    let thread_output_status = output_status.clone();

    // 在起播时创建非阻塞的 Equalizer 和 UserVolume 快照句柄
    let thread_eq_handle = Arc::new(crate::player::equalizer::EqualizerHandle::new(
        crate::player::equalizer::EqualizerSettings::default(),
    ));
    // 音效参数句柄（阶段 1：直通占位，后续阶段接入 DSP）
    let thread_se_handle = Arc::new(crate::player::sound_effect::SoundEffectHandle::new(
        crate::player::sound_effect::SoundEffectSettings::default(),
    ));
    let thread_user_volume = Arc::new(AtomicU32::new(1.0_f32.to_bits()));

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
        // 当前播放的远程流（在线直链/WebDAV）。seek 失败重建解码链时需要它，
        // 因为远程流的 current_path 是 URL，不能用 File::open 打开。
        let mut current_remote_stream: Option<RemoteStreamSource> = None;
        // [在线播放重构] 流式临时文件状态。设备切换恢复时需要用它重建 StreamingTempFileReader。
        let mut current_streaming_state: Option<
            crate::player::stream_cache::StreamingTempFileState,
        > = None;

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
            match rx.recv_timeout(PLAYER_POLL_INTERVAL) {
                Ok(cmd) => match cmd {
                    AudioCommand::Play {
                        source,
                        output_mode,
                        start_offset_ms,
                        volume_balance_gain,
                    } => {
                        requested_output_mode = output_mode;
                        current_volume_balance_gain = volume_balance_gain;
                        let source_is_remote = source.is_remote();
                        let display_path = source.display_path();
                        // 记住当前远程流信息：seek 失败需要重建解码链时，远程流不能用
                        // File::open(current_path)（那是 URL），必须用 RemoteRangeReader 重建
                        current_remote_stream = match &source {
                            AudioSource::RemoteWebDav(stream) => Some(stream.clone()),
                            AudioSource::LocalFile(_) => None,
                            AudioSource::StreamingTempFile(_) => None,
                        };
                        // [在线播放重构] 保存流式临时文件状态，用于设备切换恢复
                        current_streaming_state = match &source {
                            AudioSource::StreamingTempFile(state) => Some(state.clone()),
                            _ => None,
                        };

                        if let Some(sink) = &current_sink {
                            sink.stop();
                        }
                        current_sink = None;
                        #[cfg(target_os = "windows")]
                        stop_exclusive_playback(&mut exclusive_playback);

                        #[cfg(target_os = "windows")]
                        if output_mode == AudioOutputMode::WasapiExclusive && !source_is_remote {
                            let exclusive_start =
                                start_offset_ms.map_or(Duration::ZERO, Duration::from_millis);
                            match start_exclusive_playback(
                                display_path.clone(),
                                selected_device_name.clone(),
                                current_volume,
                                true,
                                exclusive_start,
                                &thread_progress,
                                current_volume_balance_gain,
                                thread_eq_handle.clone(),
                                thread_user_volume.clone(),
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
                                    continue;
                                }
                                Err(error) => {
                                    active_output_mode = AudioOutputMode::Shared;
                                    fallback_reason = Some(error);
                                }
                            }
                        }
                        #[cfg(target_os = "windows")]
                        if output_mode == AudioOutputMode::WasapiExclusive && source_is_remote {
                            active_output_mode = AudioOutputMode::Shared;
                            fallback_reason =
                                Some("远程 WebDAV 音频使用共享模式流式播放".to_string());
                        }

                        #[cfg(not(target_os = "windows"))]
                        if output_mode == AudioOutputMode::WasapiExclusive {
                            active_output_mode = AudioOutputMode::Shared;
                            fallback_reason = Some(
                                "WASAPI exclusive mode is only available on Windows".to_string(),
                            );
                        }

                        if active_output_mode == AudioOutputMode::Shared {
                            output =
                                SharedOutputBackend::open(&host, selected_device_name.as_deref())
                                    .ok();
                            if selected_device_name.is_none() {
                                last_default_device_name = default_output_device_name(&host);
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
                        // 新歌曲 sink 创建后重新应用播放倍速
                        if current_speed != 1.0 {
                            if let Some(sink) = &current_sink {
                                sink.set_speed(current_speed);
                            }
                        }
                    }
                    AudioCommand::Pause => {
                        is_playing_flag = false;
                        #[cfg(target_os = "windows")]
                        if let Some(playback) = &exclusive_playback {
                            playback.pause();
                        } else if let Some(sink) = &current_sink {
                            sink.pause();
                        }
                        #[cfg(not(target_os = "windows"))]
                        if let Some(sink) = &current_sink {
                            sink.pause();
                        }
                    }
                    AudioCommand::Stop => {
                        is_playing_flag = false;
                        current_path.clear();
                        reset_playback_progress(&thread_progress);
                        if let Some(sink) = &current_sink {
                            sink.stop();
                        }
                        current_sink = None;
                        #[cfg(target_os = "windows")]
                        stop_exclusive_playback(&mut exclusive_playback);
                    }
                    AudioCommand::Resume => {
                        is_playing_flag = true;
                        #[cfg(target_os = "windows")]
                        if let Some(playback) = &exclusive_playback {
                            playback.resume();
                        } else if let Some(sink) = &current_sink {
                            sink.play();
                        }
                        #[cfg(not(target_os = "windows"))]
                        if let Some(sink) = &current_sink {
                            sink.play();
                        }
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
                            playback.seek(Duration::from_secs_f64(clamped_time), is_playing);
                            let _ = thread_app_handle.emit(
                                "seek_completed",
                                SeekCompletedPayload {
                                    request_id,
                                    time: clamped_time,
                                },
                            );
                            continue;
                        }

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
                            current_remote_stream.as_ref(),
                            current_streaming_state.as_ref(),
                        );
                        // 设备切换后重新应用播放倍速
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
                            current_remote_stream.as_ref(),
                            current_streaming_state.as_ref(),
                        );
                        // 输出模式切换后重新应用播放倍速
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
                        // 阶段 1：仅更新共享句柄（SoundEffectSource 直通占位）。
                        // WASAPI 独占模式有独立音频链，暂未接入音效（后续阶段视需要扩展）。
                        thread_se_handle.set_settings(settings);
                    }
                },
                Err(RecvTimeoutError::Timeout) => {
                    #[cfg(target_os = "windows")]
                    if let Some(result) = exclusive_playback
                        .as_ref()
                        .and_then(|playback| playback.try_finished())
                    {
                        stop_exclusive_playback(&mut exclusive_playback);

                        if let Err(error) = result {
                            active_output_mode = AudioOutputMode::Shared;
                            fallback_reason = Some(error);
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
                                current_remote_stream.as_ref(),
                                current_streaming_state.as_ref(),
                            );
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
                    }

                    if selected_device_name.is_none() {
                        let next_default_name = default_output_device_name(&host);
                        if should_restore_for_default_device_change(
                            &selected_device_name,
                            &last_default_device_name,
                            &next_default_name,
                            &active_device_name,
                        ) {
                            last_default_device_name = next_default_name;
                            if let Some(sink) = &current_sink {
                                sink.stop();
                            }
                            current_sink = None;
                            #[cfg(target_os = "windows")]
                            stop_exclusive_playback(&mut exclusive_playback);
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
                                current_remote_stream.as_ref(),
                                current_streaming_state.as_ref(),
                            );

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
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use std::net::TcpListener;

    /// 启动一个本地 mock HTTP 服务器，返回 (url, join_handle)。
    /// support_range=true 时按 Range 头返回 206 分片；false 时忽略 Range 直接返回 200 全量
    /// （模拟很多音乐 CDN 直链的行为，用于验证 no_range 整曲下载修复）。
    fn spawn_mock_server(body: Vec<u8>, support_range: bool) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{addr}/audio");

        let handle = std::thread::spawn(move || {
            // 处理若干次连接（HEAD 探测、content_len 的 Range:0-0、正式读取、后台预读等）
            for _ in 0..32 {
                let Ok((mut stream, _)) = listener.accept() else { break };
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
                        // 解析 "Range: bytes=start-end"
                        let spec = range.split('=').nth(1).unwrap_or("").trim().to_string();
                        let mut parts = spec.split('-');
                        let start: usize = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
                        // start 超出文件末尾时返回 416，避免 body[start..=end] 越界 panic
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

                // 不支持 Range（或无 Range 头）：返回 200 全量
                let header =
                    format!("HTTP/1.1 200 OK\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n");
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
        // 2.5MB 数据，跨越多个 2MB 分块，验证支持 Range 的服务器能完整读取
        let body: Vec<u8> = (0..(2_500_000_usize)).map(|i| (i % 251) as u8).collect();
        let (url, handle) = spawn_mock_server(body.clone(), true);
        let got = read_all_via_reader(&url);
        assert_eq!(got.len(), body.len(), "支持 Range 时应完整读取");
        assert_eq!(got, body, "支持 Range 时内容应一致");
        drop(handle);
    }

    #[test]
    fn remote_reader_reads_full_body_when_range_ignored() {
        // 关键回归测试：服务器忽略 Range 返回 200 全量（不支持 Range 的 CDN 直链）。
        // 旧逻辑只能播首个块后中断（进度条鬼畜）；修复后应触发整曲下载并完整读取。
        let body: Vec<u8> = (0..(2_500_000_usize)).map(|i| (i % 251) as u8).collect();
        let (url, handle) = spawn_mock_server(body.clone(), false);
        let got = read_all_via_reader(&url);
        assert_eq!(got.len(), body.len(), "忽略 Range 时应通过整曲下载完整读取");
        assert_eq!(got, body, "忽略 Range 时内容应一致");
        drop(handle);
    }

    /// 验证 seek 在两种服务器模式下都能定位到正确字节（seek 是在线走 Rust 完整可用的一部分）。
    fn assert_seek_correct(support_range: bool) {
        let body: Vec<u8> = (0..(2_500_000_usize)).map(|i| (i % 251) as u8).collect();
        let (url, handle) = spawn_mock_server(body.clone(), support_range);
        let source = RemoteStreamSource {
            remote_uri: url.clone(),
            url: url.clone(),
            ..Default::default()
        };
        let mut reader = RemoteRangeReader::new(source).expect("reader 创建失败");

        // 先读开头一点，触发（no_range 下的）整曲下载或首块拉取
        let mut head = [0u8; 16];
        reader.read_exact(&mut head).expect("读开头失败");
        assert_eq!(&head[..], &body[..16], "开头字节应正确");

        // seek 到中段某位置，读若干字节比对
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

        // seek 回退到较前位置，验证可后退
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

    /// 构造一个最小合法 WAV 文件（PCM 16bit）字节，用于验证 rodio 能否解码通过
    /// RemoteRangeReader 取到的在线流。sample_rate=44100，双声道，含 `seconds` 秒正弦波。
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
        buf.extend_from_slice(&1u16.to_le_bytes()); // PCM
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

    /// 端到端：验证 rodio Decoder 能解码「通过 RemoteRangeReader 取到的在线流」。
    /// 这是「在线走 Rust 播放」的核心技术前提（取流→解码链路，除 cpal 硬件输出外）。
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
        // 实际取出一些样本，确认解码链路真的产出音频数据
        let produced = decoder.take(1000).count();
        assert!(produced > 0, "解码器应产出音频样本");
        drop(handle);
    }

    /// 验证「seek 到靠后位置」时的重建路径：try_seek 失败后，handle_seek 会用
    /// RemoteRangeReader 重新建流并 skip_duration 跳到目标位置。这里复现该路径，
    /// 断言重建后仍能解码并产出音频样本。
    ///
    /// 回归的 bug：旧代码在 try_seek 失败后用 File::open(current_path) 重建，
    /// 而远程流的 current_path 是 URL，必然失败 → sink 已停却无新音源，
    /// 表现为「拖动进度条到靠后位置后没声音，进度条却继续走」。
    fn assert_seek_rebuild_produces_audio(support_range: bool) {
        // 10 秒音频，跳到第 8 秒（靠后位置）
        let wav = build_wav(44_100, 2, 10);
        let (url, handle) = spawn_mock_server(wav.clone(), support_range);
        let source = RemoteStreamSource {
            remote_uri: url.clone(),
            url: url.clone(),
            ..Default::default()
        };

        // 复现修复后的重建逻辑：新建 RemoteRangeReader + 解码 + skip 到目标位置
        let reader = RemoteRangeReader::new(source).expect("重建 reader 应成功");
        let buffered = BufReader::with_capacity(512 * 1024, reader);
        let decoder = Decoder::new(buffered).expect("重建后应能解码");
        assert_eq!(decoder.sample_rate(), 44_100);

        let jump_target = Duration::from_secs(8);
        let mut skipped = decoder.convert_samples::<f32>().skip_duration(jump_target);
        // 跳转到靠后位置后仍应有音频样本产出（不是静默/立即结束）
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
}
