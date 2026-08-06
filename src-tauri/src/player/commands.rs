use crate::database::DbState;
use crate::music::scanner::apply_scan_changes;
use crate::music::types::Song;
use crate::player::effects::EffectParams;
use crate::player::runtime::progress_duration;
use crate::player::spectrum::build_frequency_bands;
use crate::player::types::{
    AudioCommand, AudioOutputMode, AudioSource, BitstreamInfo, PlayerState,
    VISUALIZER_BAND_COUNT,
};
use crate::remote::cache::{
    ensure_cached_path, is_remote_uri, remote_playback_source, RemotePlaybackSource,
    RemoteStreamSource,
};
use crate::remote::repository::get_source_for_remote_uri;
use crate::remote::scanner::song_from_cached_remote_file;
use crate::remote::types::RemoteFileEntry;
use souvlaki::{MediaMetadata, MediaPlayback, MediaPosition};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::Emitter;
use std::io::Write;

const REMOTE_LYRICS_CACHE_READY_EVENT: &str = "remote-lyrics-cache-ready";

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteLyricsCacheReadyPayload {
    uri: String,
    song: Option<Song>,
}

/// [修复防御] 异步下载 HTTP URL 到临时文件，供 WASAPI 独占模式使用。
/// 使用 async reqwest 避免在 Tauri async 命令上下文中创建 blocking runtime 导致 tokio panic。
/// 下载失败时返回错误，调用方应回退到 Shared 流式播放。
async fn download_url_to_tempfile(url: &str) -> Result<tempfile::NamedTempFile, String> {
    let response = reqwest::get(url).await.map_err(|e| {
        let msg = format!("HTTP GET failed: {e}");
        eprintln!("[download_url_to_tempfile] {msg}");
        msg
    })?;

    if !response.status().is_success() {
        let msg = format!("HTTP {} for {}", response.status(), url);
        eprintln!("[download_url_to_tempfile] {msg}");
        return Err(msg);
    }

    // 获取 content-length 用于进度日志
    let total_bytes = response.content_length();

    let mut temp_file =
        tempfile::NamedTempFile::new().map_err(|e| format!("Failed to create temp file: {e}"))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    temp_file
        .write_all(&bytes)
        .map_err(|e| format!("Failed to write temp file: {e}"))?;

    let size_mb = bytes.len() as f64 / 1_048_576.0;
    if let Some(total) = total_bytes {
        eprintln!(
            "[download_url_to_tempfile] Downloaded {:.1} MB / {:.1} MB to {:?}",
            size_mb,
            total as f64 / 1_048_576.0,
            temp_file.path()
        );
    } else {
        eprintln!(
            "[download_url_to_tempfile] Downloaded {:.1} MB to {:?}",
            size_mb,
            temp_file.path()
        );
    }

    Ok(temp_file)
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
    app: tauri::AppHandle,
    db_state: tauri::State<'_, DbState>,
    state: tauri::State<'_, PlayerState>,
) -> Result<(), String> {
    let playback_id = state.playback_id.fetch_add(1, Ordering::Relaxed) + 1;
    let mut selected_output_mode = output_mode;
    let source = if path.starts_with("http://") || path.starts_with("https://") {
        // [修复防御] 当用户启用 USB 独占模式时，下载网络歌曲到临时文件后作为本地文件播放，
        // 避免强制回退到 Shared 模式导致音频输出到扬声器而非 USB DAC。
        // Phase 1 推演：原代码 `selected_output_mode = AudioOutputMode::Shared` 直接丢弃了
        // 用户选择的 WasapiExclusive，导致网络歌曲永远使用默认扬声器。
        if output_mode == AudioOutputMode::WasapiExclusive {
            eprintln!("[play_audio] Network URL with WasapiExclusive — downloading to temp file...");
            match download_url_to_tempfile(&path).await {
                Ok(temp_file) => {
                    let kept_path = temp_file.path().to_string_lossy().to_string();
                    eprintln!("[play_audio] Downloaded to temp: {kept_path}");
                    let _ = temp_file.keep();
                    AudioSource::LocalFile(kept_path)
                }
                Err(error) => {
                    eprintln!("[play_audio] Download FAILED: {error} — falling back to Shared streaming");
                    selected_output_mode = AudioOutputMode::Shared;
                    AudioSource::RemoteWebDav(RemoteStreamSource {
                        remote_uri: path.clone(),
                        url: path,
                        username: None,
                        password: None,
                        user_agent: None,
                        referer: None,
                        headers: None,
                    })
                }
            }
        } else {
            selected_output_mode = AudioOutputMode::Shared;
            AudioSource::RemoteWebDav(RemoteStreamSource {
                remote_uri: path.clone(),
                url: path,
                username: None,
                password: None,
                user_agent: None,
                referer: None,
                headers: None,
            })
        }
    } else if is_remote_uri(&path) {
        match remote_playback_source(&db_state, &path)? {
            RemotePlaybackSource::Cached { path } => AudioSource::LocalFile(path),
            RemotePlaybackSource::Stream(stream) => {
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
        }
    } else {
        AudioSource::LocalFile(path)
    };

    let normalized_cover = normalize_cover_for_smtc(&cover);
    let display_path = source.display_path();
    eprintln!("[play_audio] path='{display_path}' | output_mode={:?} | selected_output_mode={:?}", output_mode, selected_output_mode);
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Play {
        source,
        output_mode: selected_output_mode,
        start_offset_ms,
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
            // [修复防御]: 更新元数据时保留当前播放进度，避免任务栏进度条重置
            let current_pos = MediaPosition(progress_duration(&state.progress));
            let _ = mc.set_playback(if is_playing {
                MediaPlayback::Playing { progress: Some(current_pos) }
            } else {
                MediaPlayback::Paused { progress: Some(current_pos) }
            });
        }
    }

    Ok(())
}

#[tauri::command]
pub fn pause_audio(state: tauri::State<PlayerState>) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Pause).map_err(|e| e.to_string())?;
    // [修复防御]: 暂停时保留当前播放进度到任务栏，避免进度条丢失位置
    let current_pos = MediaPosition(progress_duration(&state.progress));
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_playback(MediaPlayback::Paused { progress: Some(current_pos) });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn resume_audio(state: tauri::State<PlayerState>) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Resume).map_err(|e| e.to_string())?;
    // [修复防御]: 恢复时保留当前播放进度到任务栏，避免进度条跳回起点
    let current_pos = MediaPosition(progress_duration(&state.progress));
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_playback(MediaPlayback::Playing { progress: Some(current_pos) });
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
pub fn get_audio_visualizer_samples(state: tauri::State<PlayerState>) -> Vec<f32> {
    let visualizer = &state.progress.visualizer;
    let sample_rate = state.progress.sample_rate.load(Ordering::Relaxed);
    build_frequency_bands(&visualizer.snapshot(), sample_rate, VISUALIZER_BAND_COUNT)
}

// ==================== USB 独占模式相关命令 ====================

/// [USB 独占模式] 设置音效参数
/// 前端调用此命令更新共享的 effect_params
/// 同时发送 SyncEffects 命令给播放线程，让当前活跃的播放实例应用新参数
#[tauri::command]
pub fn set_audio_effects(
    params: EffectParams,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    // 1. 更新共享参数
    {
        let mut guard = state.effect_params.lock().map_err(|e| e.to_string())?;
        *guard = params;
    }
    // 2. 通知播放线程同步音效（如果当前有活跃的独占播放实例）
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    let _ = tx.send(AudioCommand::SyncEffects);
    Ok(())
}

/// [USB 独占模式] 获取当前位流信息
/// 返回采样率、通道数、位深、设备名、输出模式、是否位完美等
#[tauri::command]
pub fn get_bitstream_info(state: tauri::State<PlayerState>) -> Result<BitstreamInfo, String> {
    let sample_rate = state.progress.sample_rate.load(Ordering::Relaxed);
    let channels = state.progress.channels.load(Ordering::Relaxed);
    let samples = state.progress.samples_played.load(Ordering::Relaxed);

    let (active_device_name, output_mode) = {
        let status = state.output_status.lock().map_err(|e| e.to_string())?;
        (status.active_device_name.clone(), status.active_output_mode)
    };

    let position_seconds = if sample_rate == 0 || channels == 0 {
        0.0
    } else {
        samples as f64 / (sample_rate as u64 * channels as u64) as f64
    };

    // [修复防御] 位深从 WASAPI 协商格式推断
    // 由于 SharedProgress 没有存储位深，这里返回 0 表示未知
    // 真实位深在前端通过其他方式获取（或扩展 SharedProgress）
    let bit_depth = 0u32;

    // 位完美判断：独占模式 + 非零采样率
    let bit_perfect = output_mode == AudioOutputMode::WasapiExclusive && sample_rate > 0;

    Ok(BitstreamInfo {
        sample_rate,
        channels,
        bit_depth,
        active_device_name,
        output_mode,
        bit_perfect,
        position_seconds,
    })
}
