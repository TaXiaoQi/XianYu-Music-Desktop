use crate::database::DbState;
use crate::music::scanner::apply_scan_changes;
use crate::music::types::Song;
use crate::player::equalizer::EqualizerSettings;
use crate::player::loudness::{
    calculate_playback_gain, get_song_loudness_record, process_song_on_play, LoudnessRecord,
};
use crate::player::sound_effect::SoundEffectSettings;
use crate::player::spectrum::build_frequency_bands;
use crate::player::types::{
    AudioCommand, AudioOutputMode, AudioSource, PlayerState, VISUALIZER_BAND_COUNT,
};
use crate::remote::cache::{
    ensure_cached_path, is_remote_uri, remote_playback_source, RemotePlaybackSource,
};
use crate::remote::repository::get_source_for_remote_uri;
use crate::remote::scanner::song_from_cached_remote_file;
use crate::remote::types::RemoteFileEntry;
use souvlaki::{MediaMetadata, MediaPlayback, MediaPosition};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::Emitter;

const REMOTE_LYRICS_CACHE_READY_EVENT: &str = "remote-lyrics-cache-ready";

pub(crate) const DEFAULT_STREAM_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteLyricsCacheReadyPayload {
    uri: String,
    song: Option<Song>,
}

/// 在线流播放中途下载失败上报：StreamingTempFileReader 读到下载失败会返回 EOF，
/// 后端表现为“自然播完”，前端无从触发换源；监视任务在失败时显式通知前端（对齐移动/腕上端中断换源）
fn spawn_stream_failure_watcher(
    app: &tauri::AppHandle,
    state: &crate::player::stream_cache::StreamingTempFileState,
    url: &str,
) {
    let app = app.clone();
    let failed_flag = state.download_failed.clone();
    let complete_flag = state.download_complete.clone();
    let error_store = state.download_error.clone();
    let failed_url = url.to_string();
    tokio::spawn(async move {
        // 下载完成（成功/失败）或复用已完成缓存时不再可能中途失败，监视即退出
        while !complete_flag.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if failed_flag.load(Ordering::Relaxed) {
                let reason = error_store
                    .lock()
                    .ok()
                    .and_then(|e| e.clone())
                    .unwrap_or_default();
                let _ = app.emit(
                    "online-stream-failed",
                    serde_json::json!({ "url": failed_url, "reason": reason }),
                );
                break;
            }
            if complete_flag.load(Ordering::Relaxed) {
                break;
            }
        }
    });
}

fn normalize_cover_for_smtc(cover: &str) -> Option<String> {
    let trimmed = cover.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.starts_with("file://")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("data:")
    {
        return Some(trimmed.to_string());
    }

    let normalized = trimmed.replace('/', "\\");
    Some(format!("file://{normalized}"))
}

#[tauri::command]
pub async fn play_audio(
    path: String,
    title: String,
    artist: String,
    album: String,
    cover: String,
    duration: u32,
    output_mode: AudioOutputMode,
    start_offset_ms: Option<u64>,
    song_id: Option<i64>,
    volume_balance_enabled: Option<bool>,
    gain_offset_db: Option<f32>,
    prevent_clipping: Option<bool>,
    headers: Option<std::collections::HashMap<String, String>>,
    ekey: Option<String>,
    cek: Option<String>,
    dsd_native_passthrough: Option<bool>,
    output_bit_perfect: Option<bool>,
    app: tauri::AppHandle,
    db_state: tauri::State<'_, DbState>,
    state: tauri::State<'_, PlayerState>,
) -> Result<(), String> {
    let playback_id = state.playback_id.fetch_add(1, Ordering::Relaxed) + 1;
    let mut selected_output_mode = output_mode;

    let path = {
        let trimmed = path.trim();
        let http_idx = trimmed.find("http://");
        let https_idx = trimmed.find("https://");
        let start = match (http_idx, https_idx) {
            (Some(h), Some(s)) => h.min(s),
            (Some(h), None) => h,
            (None, Some(s)) => s,
            (None, None) => 0,
        };
        let mut result = trimmed[start..].to_string();
        while result.ends_with(|c: char| {
            matches!(
                c,
                '`' | '\'' | '"' | ',' | '，' | ';' | '；' | ' ' | '\t' | '\n' | '\r' | '<' | '>'
            )
        }) {
            result.pop();
        }

        result
    };

    let is_http_stream = path.starts_with("http://") || path.starts_with("https://");
    let source = if is_http_stream {
        crate::security::ssrf::validate_url_ip_literal(&path)
            .map_err(|e| format!("播放链接校验失败: {}", e))?;

        selected_output_mode = AudioOutputMode::Shared;
        let stream_state = crate::player::stream_cache::start_streaming_download(
            &path,
            headers.as_ref(),
            Some(DEFAULT_STREAM_USER_AGENT),
            ekey.as_deref(),
            cek.as_deref(),
        )
        .map_err(|e| format!("在线音频缓存启动失败: {}", e))?;

        let wait_start = std::time::Instant::now();
        while !crate::player::stream_cache::is_buffer_ready(&stream_state) {
            if wait_start.elapsed() > std::time::Duration::from_secs(30) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        if stream_state.download_failed.load(Ordering::Relaxed) {
            let error_reason = stream_state
                .download_error()
                .unwrap_or_else(|| "未知原因".to_string());
            return Err(format!(
                "在线音频缓存下载失败，已下载 {} bytes，原因: {}",
                stream_state.downloaded_bytes(),
                error_reason
            ));
        }

        spawn_stream_failure_watcher(&app, &stream_state, &path);

        AudioSource::StreamingTempFile(stream_state)
    } else if is_remote_uri(&path) {
        match remote_playback_source(&db_state, &path) {
            Ok(RemotePlaybackSource::Cached { path }) => AudioSource::LocalFile(path),
            Ok(RemotePlaybackSource::Stream(stream)) => {
                selected_output_mode = AudioOutputMode::Shared;
                schedule_remote_cache_after_half(
                    app.clone(),
                    db_state.conn.clone(),
                    state.progress.clone(),
                    state.playback_id.clone(),
                    playback_id,
                    stream.remote_uri.clone(),
                    duration,
                );
                AudioSource::RemoteWebDav(stream)
            }
            Err(_) => {
                selected_output_mode = AudioOutputMode::Shared;
                AudioSource::RemoteWebDav(crate::remote::cache::RemoteStreamSource {
                    remote_uri: path.clone(),
                    url: path.clone(),
                    user_agent: Some(DEFAULT_STREAM_USER_AGENT.to_string()),
                    headers: headers.clone(),
                    ..Default::default()
                })
            }
        }
    } else {
        AudioSource::LocalFile(path.clone())
    };

    let mut volume_balance_gain = 1.0;
    if let (Some(s_id), Some(true)) = (song_id, volume_balance_enabled) {
        if let Ok(mut conn) = db_state.conn.lock() {
            if let Ok(record) = process_song_on_play(&mut conn, s_id, &path) {
                let offset_db = gain_offset_db.unwrap_or(0.0);
                let prev_clip = prevent_clipping.unwrap_or(true);
                volume_balance_gain = calculate_playback_gain(&record, offset_db, prev_clip);
            }
        }
    }

    let normalized_cover = normalize_cover_for_smtc(&cover);
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Play {
        source,
        output_mode: selected_output_mode,
        start_offset_ms,
        volume_balance_gain,
        dsd_native_passthrough: dsd_native_passthrough.unwrap_or(true),
        bit_perfect: output_bit_perfect.unwrap_or(false),
    })
    .map_err(|e| e.to_string())?;

    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_metadata(MediaMetadata {
                title: Some(&title),
                artist: Some(&artist),
                album: Some(&album),
                cover_url: normalized_cover.as_deref(),
                duration: if duration > 0 {
                    Some(Duration::from_secs(duration as u64))
                } else {
                    None
                },
            });
            let _ = mc.set_playback(MediaPlayback::Playing {
                progress: Some(MediaPosition(Duration::from_secs(0))),
            });
        }
    }

    Ok(())
}

#[tauri::command]
pub fn set_stream_cache_max_size(bytes: u64) {
    crate::player::stream_cache::set_max_cache_size(bytes);
}

#[tauri::command]
pub fn set_stream_cache_dir(path: String) {
    crate::player::stream_cache::set_cache_dir(&path);
}

#[tauri::command]
pub fn get_stream_cache_dir() -> String {
    crate::player::stream_cache::get_cache_dir_str()
}

#[tauri::command]
pub fn get_stream_cache_info() -> std::collections::HashMap<&'static str, u64> {
    let mut info = std::collections::HashMap::new();
    info.insert("current", crate::player::stream_cache::current_cache_size());
    info.insert("max", crate::player::stream_cache::max_cache_size());
    info
}

#[tauri::command]
pub fn clear_stream_cache() {
    crate::player::stream_cache::clear_all();
}

#[tauri::command]
pub fn is_stream_cached(url: String) -> bool {
    crate::player::stream_cache::is_url_cached(&url)
}

#[tauri::command]
pub fn copy_stream_cache(
    app_handle: tauri::AppHandle,
    url: String,
    file_name: String,
) -> Result<u64, String> {
    let dir = crate::toolbox::read_authorized_download_dir(&app_handle)?;
    let file_name = crate::security::path_validator::sanitize_filename_component(&file_name)?;
    let dest = dir.join(&file_name);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建下载目录失败: {e}"))?;
    }
    crate::player::stream_cache::copy_cache_to(&url, &dest.to_string_lossy())
}

#[tauri::command]
pub fn prefetch_audio_head(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    max_bytes: Option<u64>,
) -> Result<bool, String> {
    crate::security::ssrf::validate_url_ip_literal(&url)
        .map_err(|e| format!("预取链接校验失败: {e}"))?;
    Ok(crate::player::audio_head_cache::prefetch(
        &url,
        headers,
        max_bytes.unwrap_or(0),
    ))
}

fn schedule_remote_cache_after_half(
    app: tauri::AppHandle,
    conn: std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    progress: std::sync::Arc<crate::player::types::SharedProgress>,
    playback_id: std::sync::Arc<std::sync::atomic::AtomicU64>,
    expected_playback_id: u64,
    remote_uri: String,
    duration: u32,
) {
    tauri::async_runtime::spawn(async move {
        let threshold = if duration > 0 {
            duration as f64 * 0.5
        } else {
            30.0
        };
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if playback_id.load(Ordering::Relaxed) != expected_playback_id {
                return;
            }

            let rate = progress.sample_rate.load(Ordering::Relaxed);
            let channels = progress.channels.load(Ordering::Relaxed);
            if rate == 0 || channels == 0 {
                continue;
            }

            let samples = progress.samples_played.load(Ordering::Relaxed);
            let seconds = samples as f64 / (rate as f64 * channels as f64);
            if seconds >= threshold {
                let db_state = DbState { conn };
                if let Ok(cache_path) = ensure_cached_path(&app, &db_state, &remote_uri).await {
                    let song =
                        update_cached_remote_audio_metadata(&db_state, &remote_uri, &cache_path);
                    let _ = app.emit(
                        REMOTE_LYRICS_CACHE_READY_EVENT,
                        RemoteLyricsCacheReadyPayload {
                            uri: remote_uri.clone(),
                            song,
                        },
                    );
                }
                return;
            }
        }
    });
}

fn update_cached_remote_audio_metadata(
    db_state: &DbState,
    remote_uri: &str,
    cache_path: &str,
) -> Option<Song> {
    let (source, remote_path, etag, stored_remote_uri) = {
        let conn = db_state.conn.lock().ok()?;
        get_source_for_remote_uri(&conn, remote_uri).ok()?
    };
    let normalized_uri = stored_remote_uri.unwrap_or_else(|| remote_uri.to_string());
    let file_size = std::fs::metadata(cache_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let file_name = remote_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or(&remote_path)
        .to_string();
    let remote_file = RemoteFileEntry {
        remote_path,
        name: file_name,
        size: file_size,
        etag,
        modified_at: None,
        is_dir: false,
    };
    let Some(song) = song_from_cached_remote_file(&source, &remote_file, Path::new(cache_path))
    else {
        return None;
    };
    if song.path != normalized_uri {
        return None;
    }
    if let Ok(mut conn) = db_state.conn.lock() {
        let _ = apply_scan_changes(&mut conn, &[], std::slice::from_ref(&song), &[], None);
    }
    Some(song)
}

#[tauri::command]
pub fn update_playback_metadata(
    title: String,
    artist: String,
    album: String,
    cover: String,
    duration: u32,
    is_playing: bool,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    let normalized_cover = normalize_cover_for_smtc(&cover);
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_metadata(MediaMetadata {
                title: Some(&title),
                artist: Some(&artist),
                album: Some(&album),
                cover_url: normalized_cover.as_deref(),
                duration: if duration > 0 {
                    Some(Duration::from_secs(duration as u64))
                } else {
                    None
                },
            });
            let _ = mc.set_playback(if is_playing {
                MediaPlayback::Playing {
                    progress: Some(MediaPosition(Duration::from_secs(0))),
                }
            } else {
                MediaPlayback::Paused { progress: None }
            });
        }
    }

    Ok(())
}

#[tauri::command]
pub fn pause_audio(state: tauri::State<PlayerState>) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Pause).map_err(|e| e.to_string())?;
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_playback(MediaPlayback::Paused { progress: None });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn stop_audio(state: tauri::State<PlayerState>) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Stop).map_err(|e| e.to_string())?;
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_playback(MediaPlayback::Stopped);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn resume_audio(state: tauri::State<PlayerState>) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Resume).map_err(|e| e.to_string())?;
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_playback(MediaPlayback::Playing { progress: None });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn seek_audio(
    time: f64,
    is_playing: bool,
    request_id: u64,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Seek {
        time,
        is_playing,
        request_id,
    })
    .map_err(|e| e.to_string())?;

    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let progress = MediaPosition(Duration::from_secs_f64(time.max(0.0)));
            if is_playing {
                let _ = mc.set_playback(MediaPlayback::Playing {
                    progress: Some(progress),
                });
            } else {
                let _ = mc.set_playback(MediaPlayback::Paused {
                    progress: Some(progress),
                });
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn set_volume(volume: f32, state: tauri::State<PlayerState>) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::SetVolume(volume))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_playback_progress(state: tauri::State<PlayerState>) -> f64 {
    let samples = state.progress.samples_played.load(Ordering::Relaxed);
    let rate = state.progress.sample_rate.load(Ordering::Relaxed);
    let channels = state.progress.channels.load(Ordering::Relaxed);

    if rate == 0 || channels == 0 {
        return 0.0;
    }

    let total_samples_per_sec = rate as u64 * channels as u64;
    samples as f64 / total_samples_per_sec as f64
}

#[tauri::command]
pub fn get_playback_duration(state: tauri::State<PlayerState>) -> f64 {
    let bits = state.progress.total_duration_secs.load(Ordering::Relaxed);
    f64::from_bits(bits)
}

#[tauri::command]
pub fn get_playback_ready(state: tauri::State<PlayerState>) -> bool {
    state.progress.sample_rate.load(Ordering::Relaxed) > 0
}

#[tauri::command]
pub fn get_playback_start_failed(state: tauri::State<PlayerState>) -> bool {
    state.progress.start_failed.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn get_playback_start_failed_reason(state: tauri::State<PlayerState>) -> Option<String> {
    state
        .progress
        .start_failed_reason
        .lock()
        .ok()
        .and_then(|r| r.clone())
}

#[derive(serde::Serialize)]
pub struct PlaybackStartFailedInfo {
    pub failed: bool,
    pub reason: Option<String>,
}

#[tauri::command]
pub fn get_playback_start_failed_info(state: tauri::State<PlayerState>) -> PlaybackStartFailedInfo {
    let failed = state.progress.start_failed.load(Ordering::Relaxed);
    let reason = state
        .progress
        .start_failed_reason
        .lock()
        .ok()
        .and_then(|r| r.clone());
    PlaybackStartFailedInfo { failed, reason }
}

#[tauri::command]
pub fn get_audio_visualizer_samples(state: tauri::State<PlayerState>) -> Vec<f32> {
    let visualizer = &state.progress.visualizer;
    let sample_rate = state.progress.sample_rate.load(Ordering::Relaxed);
    build_frequency_bands(&visualizer.snapshot(), sample_rate, VISUALIZER_BAND_COUNT)
}

#[tauri::command]
pub async fn get_track_loudness_info(
    song_id: i64,
    db_state: tauri::State<'_, DbState>,
) -> Result<Option<LoudnessRecord>, String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    get_song_loudness_record(&conn, song_id)
}

#[tauri::command]
pub async fn update_loudness_settings(
    enabled: bool,
    song_id: Option<i64>,
    song_path: Option<String>,
    gain_offset_db: f32,
    prevent_clipping: bool,
    db_state: tauri::State<'_, DbState>,
    state: tauri::State<'_, PlayerState>,
) -> Result<(), String> {
    let mut target_gain = 1.0;
    if enabled {
        if let (Some(s_id), Some(path)) = (song_id, song_path.as_deref()) {
            if let Ok(mut conn) = db_state.conn.lock() {
                if let Ok(record) = process_song_on_play(&mut conn, s_id, path) {
                    target_gain =
                        calculate_playback_gain(&record, gain_offset_db, prevent_clipping);
                }
            }
        }
    }

    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::SetVolumeBalance {
        enabled,
        target_gain,
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_equalizer_settings(
    enabled: bool,
    preamp: f32,
    gains: Vec<f32>,
    state: tauri::State<'_, PlayerState>,
) -> Result<(), String> {
    if gains.len() != 10 {
        return Err(format!("均衡器频段数量错误，期望 10，实际 {}", gains.len()));
    }

    if !preamp.is_finite() {
        return Err("Preamp 增益必须为有限浮点数，严禁 NaN/Inf".to_string());
    }
    for (i, &gain) in gains.iter().enumerate() {
        if !gain.is_finite() {
            return Err(format!("频段 {} 增益必须为有限浮点数，严禁 NaN/Inf", i));
        }
    }

    let preamp_clamped = preamp.clamp(-12.0, 12.0);
    let mut gains_clamped = [0.0; 10];
    for i in 0..10 {
        gains_clamped[i] = gains[i].clamp(-12.0, 12.0);
    }

    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    let settings = EqualizerSettings {
        enabled,
        preamp: preamp_clamped,
        gains: gains_clamped,
    };

    tx.send(AudioCommand::SetEqualizerSettings { settings })
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn set_sound_effect_settings(
    settings: SoundEffectSettings,
    state: tauri::State<'_, PlayerState>,
) -> Result<(), String> {
    if !settings.pitch_shift.is_finite() || !settings.playback_rate.is_finite() {
        return Err("音效参数 pitchShift/playbackRate 必须为有限浮点数".to_string());
    }

    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::SetSoundEffectSettings { settings })
        .map_err(|e| e.to_string())?;
    Ok(())
}
