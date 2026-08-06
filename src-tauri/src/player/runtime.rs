use crate::player::device::{default_output_device_name, emit_output_status};
use crate::player::effects::EffectParams;
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
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const PLAYER_POLL_INTERVAL: Duration = Duration::from_millis(150);

pub fn progress_duration(progress: &Arc<SharedProgress>) -> Duration {
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
    progress.visualizer.reset();
}

#[cfg(target_os = "windows")]
fn stop_exclusive_playback(
    exclusive_playback: &mut Option<WasapiExclusivePlayback>,
    usb_exclusive_active: &std::sync::atomic::AtomicBool,
    exclusive_device_name: &std::sync::RwLock<Option<String>>,
) {
    if let Some(mut playback) = exclusive_playback.take() {
        playback.stop();
    }
    // [USB 独占模式] 清除全局独占状态
    usb_exclusive_active.store(false, std::sync::atomic::Ordering::Relaxed);
    if let Ok(mut name) = exclusive_device_name.write() {
        *name = None;
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
    effect_params: Arc<Mutex<EffectParams>>,
) -> Result<WasapiExclusivePlayback, String> {
    WasapiExclusivePlayback::start(ExclusivePlayRequest {
        path,
        device_name: selected_device_name,
        volume: current_volume,
        is_playing,
        progress: progress.clone(),
        start_time,
        effect_params,
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
    effect_params: Arc<Mutex<EffectParams>>,
) {
    // [修复防御] 独占模式路径：不先打开共享输出，直接尝试 WASAPI 独占。
    // 原代码先执行 SharedOutputBackend::open() 再 try exclusive，
    // cpal 的 WASAPI 共享模式会持有设备端点，导致后续独占初始化收到 0x8889000F (AUDCLNT_E_ENDPOINT_CREATE_FAILED)。
    // 这是 toggle off→on 失效的根因。
    #[cfg(target_os = "windows")]
    if requested_output_mode == AudioOutputMode::WasapiExclusive && !current_path.is_empty() {
        *output = None;
        match start_exclusive_playback(
            current_path.to_string(),
            selected_device_name.clone(),
            current_volume,
            is_playing_flag,
            progress_duration(progress),
            progress,
            effect_params.clone(),
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
                // 独占失败，回退到共享模式（继续执行下面的共享路径）
            }
        }
    } else {
        #[cfg(target_os = "windows")]
        {
            *active_output_mode = AudioOutputMode::Shared;
            *fallback_reason = None;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = &effect_params;
        *active_output_mode = AudioOutputMode::Shared;
        *fallback_reason = if requested_output_mode == AudioOutputMode::WasapiExclusive {
            Some("WASAPI exclusive mode is only available on Windows".to_string())
        } else {
            None
        };
    }

    // [修复防御] 共享模式路径：独占成功在上面 return 了，这里才打开 cpal 共享输出
    *output = SharedOutputBackend::open(host, selected_device_name.as_deref()).ok();
    *active_device_name = output
        .as_ref()
        .map(|output| output.active_device_name().to_string());

    restore_current_playback(
        output,
        current_sink,
        current_path,
        current_volume,
        is_playing_flag,
        progress,
    );
}

fn restore_shared_output(
    selected_device_name: &Option<String>,
    output: &mut Option<SharedOutputBackend>,
    host: &cpal::Host,
    current_sink: &mut Option<Sink>,
    active_device_name: &mut Option<String>,
    current_path: &str,
    current_volume: f32,
    is_playing_flag: bool,
    progress: &Arc<SharedProgress>,
) {
    *output = SharedOutputBackend::open(host, selected_device_name.as_deref()).ok();
    *active_device_name = output
        .as_ref()
        .map(|output| output.active_device_name().to_string());
    restore_current_playback(
        output,
        current_sink,
        current_path,
        current_volume,
        is_playing_flag,
        progress,
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
                        dbus_name: "my_cloud_music",
                        display_name: "My Cloud Music",
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

const REMOTE_STREAM_CHUNK_BYTES: u64 = 1024 * 1024;

struct RemoteRangeReader {
    client: reqwest::blocking::Client,
    source: RemoteStreamSource,
    pos: u64,
    len: Option<u64>,
    buffer_start: u64,
    buffer: Vec<u8>,
}

impl RemoteRangeReader {
    fn new(source: RemoteStreamSource) -> Result<Self, String> {
        eprintln!("[player] RemoteRangeReader::new url={}", source.url);
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|error| error.to_string())?;
        let len = Self::content_len(&client, &source);
        eprintln!("[player] RemoteRangeReader content_len={:?}", len);
        Ok(Self {
            client,
            source,
            pos: 0,
            len,
            buffer_start: 0,
            buffer: Vec::new(),
        })
    }

    fn auth(
        request: reqwest::blocking::RequestBuilder,
        source: &RemoteStreamSource,
    ) -> reqwest::blocking::RequestBuilder {
        if let Some(username) = source.username.as_deref().filter(|value| !value.is_empty()) {
            request.basic_auth(username.to_string(), source.password.clone())
        } else {
            request
        }
    }

    fn content_len(client: &reqwest::blocking::Client, source: &RemoteStreamSource) -> Option<u64> {
        if let Ok(response) = Self::auth(client.head(&source.url), source).send() {
            if response.status().is_success() {
                if let Some(length) = response.content_length() {
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
            response.content_length()
        } else {
            None
        }
    }

    fn fetch_at(&mut self, start: u64) -> std::io::Result<()> {
        let end = start.saturating_add(REMOTE_STREAM_CHUNK_BYTES - 1);
        let request = self
            .client
            .get(&self.source.url)
            .header(reqwest::header::RANGE, format!("bytes={start}-{end}"));
        let mut response = Self::auth(request, &self.source)
            .send()
            .map_err(|e| {
                eprintln!("[player] RemoteRangeReader fetch_at send error: {e}");
                std::io::Error::other(e)
            })?;
        if !(response.status().is_success()
            || response.status() == reqwest::StatusCode::PARTIAL_CONTENT)
        {
            let status = response.status();
            eprintln!("[player] RemoteRangeReader fetch_at bad status: {status}");
            return Err(std::io::Error::other(format!(
                "远程音频播放失败：{}",
                status
            )));
        }
        if response.status() == reqwest::StatusCode::OK && start > 0 {
            return Err(std::io::Error::other("WebDAV 服务器不支持 Range 播放"));
        }

        let mut limited = response.by_ref().take(REMOTE_STREAM_CHUNK_BYTES);
        let mut bytes = Vec::new();
        limited.read_to_end(&mut bytes)?;
        eprintln!("[player] RemoteRangeReader fetched {} bytes at offset {start}", bytes.len());
        self.buffer_start = start;
        self.buffer = bytes;
        Ok(())
    }

    fn ensure_buffer(&mut self) -> std::io::Result<()> {
        let buffer_end = self.buffer_start.saturating_add(self.buffer.len() as u64);
        if self.pos >= self.buffer_start && self.pos < buffer_end {
            return Ok(());
        }
        self.fetch_at(self.pos)
    }
}

impl Read for RemoteRangeReader {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        if self.len.map(|len| self.pos >= len).unwrap_or(false) {
            return Ok(0);
        }

        self.ensure_buffer()?;
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
        self.pos = next as u64;
        Ok(self.pos)
    }
}

fn append_decoded_source<R>(
    reader: R,
    output: &Option<SharedOutputBackend>,
    current_sink: &mut Option<Sink>,
    current_volume: f32,
    progress: &Arc<SharedProgress>,
    start_offset: Option<Duration>,
) where
    R: Read + Seek + Send + Sync + 'static,
{
    if let Some(output) = output {
        *current_sink = output.create_sink().ok();

        let reader = BufReader::with_capacity(512 * 1024, reader);
        if let Ok(source) = Decoder::new(reader) {
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

            let skipped_source = source
                .convert_samples::<f32>()
                .skip_duration(offset);

            let timed_source = TimedSource::new(
                skipped_source,
                progress.samples_played.clone(),
                progress.visualizer.clone(),
            );

            if let Some(sink) = current_sink {
                sink.append(timed_source);
                sink.set_volume(current_volume);
                sink.play();
            }
        } else {
            eprintln!("[player] Decoder::new failed for remote stream");
        }
    } else {
        eprintln!("[player] No output backend available");
    }
}

fn handle_play(
    source: AudioSource,
    output: &Option<SharedOutputBackend>,
    current_sink: &mut Option<Sink>,
    current_path: &mut String,
    current_volume: f32,
    is_playing_flag: &mut bool,
    progress: &Arc<SharedProgress>,
    start_offset_ms: Option<u64>,
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
                    current_volume,
                    progress,
                    start_offset,
                );
            }
        }
        AudioSource::RemoteWebDav(stream) => {
            match RemoteRangeReader::new(stream) {
                Ok(reader) => {
                    append_decoded_source(
                        reader,
                        output,
                        current_sink,
                        current_volume,
                        progress,
                        start_offset,
                    );
                }
                Err(e) => {
                    eprintln!("[player] Failed to create RemoteRangeReader: {e}");
                }
            }
        }
    }
}

fn handle_seek(
    time: f64,
    is_playing: bool,
    request_id: u64,
    output: &Option<SharedOutputBackend>,
    current_sink: &mut Option<Sink>,
    current_path: &str,
    current_volume: f32,
    is_playing_flag: &mut bool,
    progress: &Arc<SharedProgress>,
    app: &AppHandle,
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
                if !current_path.is_empty() {
                    if let Some(output) = output {
                        sink.stop();
                        *current_sink = output.create_sink().ok();

                        if let Ok(file) = File::open(current_path) {
                            let reader = BufReader::with_capacity(512 * 1024, file);
                            if let Ok(source) = Decoder::new(reader) {
                                let rate = source.sample_rate();
                                let channels = source.channels();
                                let samples_to_skip =
                                    (clamped_time * rate as f64 * channels as f64).round() as u64;
                                progress
                                    .samples_played
                                    .store(samples_to_skip, Ordering::Relaxed);

                                let timed_source = TimedSource::new(
                                    source.convert_samples::<f32>().skip_duration(jump_target),
                                    progress.samples_played.clone(),
                                    progress.visualizer.clone(),
                                );

                                if let Some(new_sink) = current_sink {
                                    new_sink.set_volume(current_volume);
                                    new_sink.append(timed_source);
                                    if is_playing {
                                        new_sink.play();
                                    } else {
                                        new_sink.pause();
                                    }
                                }
                            }
                        }
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
    });
    let thread_progress = shared_progress.clone();
    let thread_app_handle = app.clone();
    let controls = initialize_media_controls(app);
    let output_status = Arc::new(Mutex::new(AudioOutputStatus::default()));
    let thread_output_status = output_status.clone();

    // [USB 独占模式] 创建共享音效参数，前端和播放线程共享
    let effect_params: Arc<Mutex<EffectParams>> = Arc::new(Mutex::new(EffectParams::default()));
    let thread_effect_params = effect_params.clone();

    // [USB 独占模式] 独占状态共享
    let usb_exclusive_active = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let thread_usb_exclusive_active = usb_exclusive_active.clone();
    let exclusive_device_name: std::sync::RwLock<Option<String>> =
        std::sync::RwLock::new(None);
    let thread_exclusive_device_name = Arc::new(exclusive_device_name);
    let player_exclusive_device_name = thread_exclusive_device_name.clone();

    thread::spawn(move || {
        let host = cpal::default_host();
        let mut selected_device_name: Option<String> = None;
        let mut output = SharedOutputBackend::open(&host, None).ok();
        let mut current_sink: Option<Sink> = None;
        #[cfg(target_os = "windows")]
        let mut exclusive_playback: Option<WasapiExclusivePlayback> = None;
        let mut current_path = String::new();
        let mut current_volume = 1.0;
        let mut is_playing_flag = false;
        let mut requested_output_mode = AudioOutputMode::Shared;
        let mut active_output_mode = AudioOutputMode::Shared;
        let mut fallback_reason: Option<String> = None;
        let mut active_device_name = output
            .as_ref()
            .map(|output| output.active_device_name().to_string());

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
                    } => {
                        requested_output_mode = output_mode;
                        let source_is_remote = source.is_remote();
                        let display_path = source.display_path();
                        eprintln!("[runtime] Play command received | path='{display_path}' | output_mode={:?} | is_remote={source_is_remote}", output_mode);

                        if let Some(sink) = &current_sink {
                            sink.stop();
                        }
                        current_sink = None;
                        #[cfg(target_os = "windows")]
                        stop_exclusive_playback(
                &mut exclusive_playback,
                &thread_usb_exclusive_active,
                &thread_exclusive_device_name,
            );

                        #[cfg(target_os = "windows")]
                        if output_mode == AudioOutputMode::WasapiExclusive && !source_is_remote {
                            // [USB 独占模式] 先释放共享输出，避免 cpal 在设备锁定后报错
                            output = None;
                            // [修复防御] 等待 cpal 完全释放 WASAPI 端点。
                            // cpal 的 SharedOutputStream 在 Drop 时有自己的线程收尾，
                            // 若不等待，后续 initialize_client 会收到 0x8889000F (AUDCLNT_E_ENDPOINT_CREATE_FAILED)。
                            std::thread::sleep(std::time::Duration::from_millis(150));
                            eprintln!("[WASAPI Exclusive] Starting exclusive playback for: {}", display_path);
                            let exclusive_start = start_offset_ms
                                .map_or(Duration::ZERO, Duration::from_millis);
                            match start_exclusive_playback(
                                display_path.clone(),
                                selected_device_name.clone(),
                                current_volume,
                                true,
                                exclusive_start,
                                &thread_progress,
                                thread_effect_params.clone(),
                            ) {
                                Ok(playback) => {
                                    eprintln!("[WASAPI Exclusive] Exclusive playback started successfully on device: {}", playback.active_device_name());
                                    active_device_name =
                                        Some(playback.active_device_name().to_string());
                                    active_output_mode = AudioOutputMode::WasapiExclusive;
                                    fallback_reason = None;
                                    current_path = display_path;
                                    is_playing_flag = true;
                                    exclusive_playback = Some(playback);
                                    current_sink = None;
                                    output = None;

                                    // [USB 独占模式] 更新全局独占状态
                                    thread_usb_exclusive_active.store(true, std::sync::atomic::Ordering::Relaxed);
                                    if let Ok(mut name) = thread_exclusive_device_name.write() {
                                        *name = active_device_name.clone();
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
                                    continue;
                                }
                                Err(error) => {
                                    eprintln!("[WASAPI Exclusive] Failed to start exclusive playback: {}", error);
                                    // [修复防御] 独占初始化失败后回退 Shared，并更新 requested_output_mode
                                    // 防止后续 default-device-change handler 再次重试独占形成死循环
                                    requested_output_mode = AudioOutputMode::Shared;
                                    active_output_mode = AudioOutputMode::Shared;
                                    fallback_reason = Some(format!("独占初始化失败: {error}"));
                                    // [USB 独占模式] 清除独占状态
                                    thread_usb_exclusive_active.store(false, std::sync::atomic::Ordering::Relaxed);
                                    if let Ok(mut name) = thread_exclusive_device_name.write() {
                                        *name = None;
                                    }
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
                            current_volume,
                            &mut is_playing_flag,
                            &thread_progress,
                            start_offset_ms,
                        )
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
                            current_volume,
                            &mut is_playing_flag,
                            &thread_progress,
                            &thread_app_handle,
                        )
                    }
                    AudioCommand::SetVolume(vol) => {
                        current_volume = vol;
                        #[cfg(target_os = "windows")]
                        if let Some(playback) = &exclusive_playback {
                            playback.set_volume(vol);
                        } else if let Some(sink) = &current_sink {
                            sink.set_volume(vol);
                        }
                        #[cfg(not(target_os = "windows"))]
                        if let Some(sink) = &current_sink {
                            sink.set_volume(vol);
                        }
                    }
                    AudioCommand::SetDevice(device_name) => {
                        selected_device_name = device_name;

                        if let Some(sink) = &current_sink {
                            sink.stop();
                        }
                        current_sink = None;
                        #[cfg(target_os = "windows")]
                        stop_exclusive_playback(
                            &mut exclusive_playback,
                            &thread_usb_exclusive_active,
                            &thread_exclusive_device_name,
                        );

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
                            thread_effect_params.clone(),
                        );

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
                        stop_exclusive_playback(
                            &mut exclusive_playback,
                            &thread_usb_exclusive_active,
                            &thread_exclusive_device_name,
                        );

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
                            thread_effect_params.clone(),
                        );

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
                    // [USB 独占模式] 同步最新音效参数到当前独占播放实例
                    AudioCommand::SyncEffects => {
                        #[cfg(target_os = "windows")]
                        if let Some(playback) = &exclusive_playback {
                            playback.sync_effects();
                        }
                    }
                },
                Err(RecvTimeoutError::Timeout) => {
                    #[cfg(target_os = "windows")]
                    if let Some(result) = exclusive_playback
                        .as_ref()
                        .and_then(|playback| playback.try_finished())
                    {
                        stop_exclusive_playback(
                            &mut exclusive_playback,
                            &thread_usb_exclusive_active,
                            &thread_exclusive_device_name,
                        );

                        if let Err(error) = result {
                            // [修复防御] 设备拔出导致独占播放失败后，将 requested_output_mode 设为 Shared，
                            // 防止后续 default-device-change handler 通过 restore_preferred_output 再次尝试独占，
                            // 形成 0x80070016 无限重试循环。
                            // 同时清除 selected_device_name，让 Shared 模式使用系统默认设备。
                            eprintln!("[WASAPI Exclusive] Device lost — falling back to Shared mode permanently. Error: {error}");
                            requested_output_mode = AudioOutputMode::Shared;
                            selected_device_name = None;
                            active_output_mode = AudioOutputMode::Shared;
                            fallback_reason = Some(format!("设备已断开: {error}"));
                            restore_shared_output(
                                &selected_device_name,
                                &mut output,
                                &host,
                                &mut current_sink,
                                &mut active_device_name,
                                &current_path,
                                current_volume,
                                is_playing_flag,
                                &thread_progress,
                            );

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
                        if next_default_name != active_device_name {
                            if let Some(sink) = &current_sink {
                                sink.stop();
                            }
                            current_sink = None;
                            #[cfg(target_os = "windows")]
                            stop_exclusive_playback(
                                &mut exclusive_playback,
                                &thread_usb_exclusive_active,
                                &thread_exclusive_device_name,
                            );

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
                                thread_effect_params.clone(),
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
        // [USB 独占模式] 使用与播放线程共享的 effect_params，确保 set_audio_effects 命令的更新能被播放线程读取
        effect_params,
        usb_exclusive_active,
        exclusive_device_name: player_exclusive_device_name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_progress_at(seconds: f64) -> Arc<SharedProgress> {
        let sample_rate = 44_100_u32;
        let channels = 2_u32;
        let samples = (seconds * sample_rate as f64 * channels as f64).round() as u64;

        Arc::new(SharedProgress {
            samples_played: Arc::new(AtomicU64::new(samples)),
            sample_rate: Arc::new(AtomicU32::new(sample_rate)),
            channels: Arc::new(AtomicU32::new(channels)),
            visualizer: Arc::new(SharedVisualizer::new()),
        })
    }

    #[test]
    fn handle_play_resets_progress_even_when_new_source_cannot_open() {
        let progress = test_progress_at(206.0);
        let mut current_sink = None;
        let mut current_path = String::new();
        let mut is_playing_flag = false;

        handle_play(
            AudioSource::LocalFile("Z:\\missing\\song.flac".to_string()),
            &None,
            &mut current_sink,
            &mut current_path,
            1.0,
            &mut is_playing_flag,
            &progress,
            None,
        );

        assert_eq!(progress.samples_played.load(Ordering::Relaxed), 0);
    }
}
