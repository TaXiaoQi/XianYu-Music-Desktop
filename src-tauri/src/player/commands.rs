use crate::database::DbState;
use crate::music::scanner::apply_scan_changes;
use crate::music::types::Song;
use crate::player::equalizer::EqualizerSettings;
use crate::player::loudness::{
    calculate_playback_gain, get_song_loudness_record, process_song_on_play, LoudnessRecord,
};
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

// 在线直链播放的默认 User-Agent（部分音源防盗链需要浏览器 UA）
const DEFAULT_STREAM_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteLyricsCacheReadyPayload {
    uri: String,
    song: Option<Song>,
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
    prevent_clipping: Option<bool>,// 插件返回的自定义请求头（防盗链 Cookie/Referer 等），仅对 http(s) 直链生效
    headers: Option<std::collections::HashMap<String, String>>,
    app: tauri::AppHandle,
    db_state: tauri::State<'_, DbState>,
    state: tauri::State<'_, PlayerState>,
) -> Result<(), String> {
    let playback_id = state.playback_id.fetch_add(1, Ordering::Relaxed) + 1;
    let mut selected_output_mode = output_mode;
    let is_http_stream = path.starts_with("http://") || path.starts_with("https://");
    let source = if is_http_stream {
        // [在线播放重构] 把在线音频流式下载到本地临时文件，再用本地引擎播放。
        // 这样所有音乐都走统一的 File::open + Decoder 路径，设备切换恢复天然支持，
        // 无需维护 RemoteRangeReader 的复杂重建逻辑。
        // 下载够最小缓冲（512KB）后才开始播放，避免起播立即卡顿。
        selected_output_mode = AudioOutputMode::Shared;
        let stream_state = crate::player::stream_cache::start_streaming_download(
            &path,
            headers.as_ref(),
            Some(DEFAULT_STREAM_USER_AGENT),
        )
        .map_err(|e| format!("在线音频缓存启动失败: {}", e))?;

        // 等待最小缓冲就绪（最多等 30 秒，超时则放弃等待直接播放让 reader 阻塞缓冲）
        let wait_start = std::time::Instant::now();
        while !crate::player::stream_cache::is_buffer_ready(&stream_state) {
            if wait_start.elapsed() > std::time::Duration::from_secs(30) {
                eprintln!("[Audio][rust] 在线音频最小缓冲等待超时，继续播放（reader 会阻塞等待）");
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }

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
            // [落雪] URL 不在数据库中（非 WebDAV 远程源），作为直接 HTTP 音频流播放
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

/// 设置在线音频流式缓存上限（字节）
#[tauri::command]
pub fn set_stream_cache_max_size(bytes: u64) {
    crate::player::stream_cache::set_max_cache_size(bytes);
}

/// 获取在线音频流式缓存信息：当前使用大小和上限（字节）
#[tauri::command]
pub fn get_stream_cache_info() -> std::collections::HashMap<&'static str, u64> {
    let mut info = std::collections::HashMap::new();
    info.insert("current", crate::player::stream_cache::current_cache_size());
    info.insert("max", crate::player::stream_cache::max_cache_size());
    info
}

/// 清空在线音频流式缓存
#[tauri::command]
pub fn clear_stream_cache() {
    crate::player::stream_cache::clear_all();
}

/// 检查指定 URL 是否已缓存且下载完成（前端用于跳过插件重复请求）
#[tauri::command]
pub fn is_stream_cached(url: String) -> bool {
    crate::player::stream_cache::is_url_cached(&url)
}

/// 将指定 URL 的播放缓存复制为目标下载文件（复用播放缓存，避免重复下载）
#[tauri::command]
pub fn copy_stream_cache(url: String, dest_path: String) -> Result<u64, String> {
    crate::player::stream_cache::copy_cache_to(&url, &dest_path)
}

/// 等待指定 URL 缓存下载完成，返回是否成功（前端用于 'wait' 失败行为）
#[tauri::command]
pub async fn wait_stream_complete(url: String, timeout_secs: u64) -> bool {
    tokio::task::spawn_blocking(move || {
        crate::player::stream_cache::wait_url_complete(&url, timeout_secs)
    })
    .await
    .unwrap_or(false)
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

// 播放是否已就绪：sample_rate>0 表示解码器已成功初始化（Decoder::new 成功后立即写入）。
// 用于前端在线走 Rust 的「起播探测」：区分"仍在加载/下载中"（rate=0）与"已就绪"（rate>0），
// 避免不支持 Range 的直链整曲下载耗时被误判为失败而回退 H5。
#[tauri::command]
pub fn get_playback_ready(state: tauri::State<PlayerState>) -> bool {

    state.progress.sample_rate.load(Ordering::Relaxed) > 0
}

// 本次播放启动是否失败（远程取流 403 / 不支持 Range / 解码失败）。
// 供前端在线走 Rust 的起播探测快速感知硬失败，无需死等超时即可回退 H5。
#[tauri::command]
pub fn get_playback_start_failed(state: tauri::State<PlayerState>) -> bool {
    state.progress.start_failed.load(Ordering::Relaxed)
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
    // 1. 严格入参校验：长度必须等于 10
    if gains.len() != 10 {
        return Err(format!("均衡器频段数量错误，期望 10，实际 {}", gains.len()));
    }

    // 2. 校验浮点数有限性，严禁 NaN / Inf
    if !preamp.is_finite() {
        return Err("Preamp 增益必须为有限浮点数，严禁 NaN/Inf".to_string());
    }
    for (i, &gain) in gains.iter().enumerate() {
        if !gain.is_finite() {
            return Err(format!("频段 {} 增益必须为有限浮点数，严禁 NaN/Inf", i));
        }
    }

    // 3. 数值 Clamp
    let preamp_clamped = preamp.clamp(-12.0, 12.0);
    let mut gains_clamped = [0.0; 10];
    for i in 0..10 {
        gains_clamped[i] = gains[i].clamp(-12.0, 12.0);
    }

    // 4. 发送指令
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
