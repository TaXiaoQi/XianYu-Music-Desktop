// 播放命令层（本文件为全新组织）：
// - tauri 命令入口：函数名/参数名/返回类型对前端冻结；
// - SMTC 元数据同步、在线流下载失败的显式上报；
// - 远端缓存的过半预热与曲库回填。
// 错误文案、事件名与 payload 字段逐字保留。

use crate::database::DbState;
use crate::music::scanner::apply_scan_changes;
use crate::music::types::Song;
use crate::player::equalizer::EqualizerSettings;
use crate::player::loudness::{LoudnessRecord, calculate_playback_gain, get_song_loudness_record, process_song_on_play};
use crate::player::sound_effect::SoundEffectSettings;
use crate::player::spectrum::build_frequency_bands;
use crate::player::types::{AudioCommand, AudioOutputMode, AudioSource, PlayerState, VISUALIZER_BAND_COUNT};
use crate::remote::cache::{RemotePlaybackSource, ensure_cached_path, is_remote_uri, remote_playback_source};
use crate::remote::repository::get_source_for_remote_uri;
use crate::remote::scanner::song_from_cached_remote_file;
use crate::remote::types::RemoteFileEntry;
use souvlaki::{MediaPlayback, MediaPosition, MediaMetadata};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::Emitter;

/// 远端歌词缓存就绪事件名（前端契约冻结）。
const REMOTE_LYRICS_CACHE_READY_EVENT: &str = "remote-lyrics-cache-ready";

/// 在线音频请求使用的浏览器 UA 标识（对远端服务行为保持不变）。
pub(crate) const DEFAULT_STREAM_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// 远端歌词缓存就绪事件负载（字段名冻结）。
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteLyricsCacheReadyPayload {
    uri: String,        // 远端资源标识
    song: Option<Song>, // 回填后的曲库条目
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/// 向播放线程投递命令的统一入口。
fn dispatch(state: &tauri::State<PlayerState>, command: AudioCommand) -> Result<(), String> {
    let sender = state.tx.lock().map_err(|e| e.to_string())?;
    sender.send(command).map_err(|e| e.to_string())
}

/// 覆写 SMTC 播放态（控制器缺失时静默忽略）。
fn set_smtc_playback(state: &tauri::State<PlayerState>, playback: MediaPlayback) {
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(media) = controls.as_mut() {
            let _ = media.set_playback(playback);
        }
    }
}

/// 在线流下载中途失败的哨兵：下载读错会表现为自然播完，必须显式上报。
fn monitor_midway_stream_failure(
    app: &tauri::AppHandle,
    stream_state: &crate::player::stream_cache::StreamingTempFileState,
    url: &str,
) {
    let emitter = app.clone();
    let failed_flag = stream_state.download_failed.clone();
    let finished_flag = stream_state.download_complete.clone();
    let reason_slot = stream_state.download_error.clone();
    let target_url = url.to_string();

    tokio::spawn(async move {
        loop {
            if finished_flag.load(Ordering::Relaxed) {
                return; // 下载已结束，不再可能中途失败
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
            if failed_flag.load(Ordering::Relaxed) {
                let reason = reason_slot
                    .lock()
                    .ok()
                    .and_then(|slot| slot.clone())
                    .unwrap_or_default();
                let _ = emitter.emit(
                    "online-stream-failed",
                    serde_json::json!({ "url": target_url, "reason": reason }),
                );
                return;
            }
        }
    });
}

/// 封面路径归一化为 SMTC 可识别的 URI；空串给 None。
fn smtc_cover_uri(cover: &str) -> Option<String> {
    let text = cover.trim();
    if text.is_empty() {
        return None;
    }

    const KNOWN_SCHEMES: [&str; 4] = ["file://", "http://", "https://", "data:"];
    if KNOWN_SCHEMES.iter().any(|scheme| text.starts_with(scheme)) {
        return Some(text.to_string());
    }

    let backslashed = text.replace('/', "\\");
    Some(format!("file://{backslashed}"))
}

/// 尾部噪声字符判定（引号/逗号/分号/空白/尖括号等粘连符号）。
fn trailing_noise_char(c: char) -> bool {
    matches!(
        c,
        '`' | '\'' | '"' | ',' | '，' | ';' | '；' | ' ' | '\t' | '\n' | '\r' | '<' | '>'
    )
}

/// 播放地址净化：截取最早的 http(s) 起点，并剥掉尾部粘连的噪声字符。
fn tidy_playback_path(raw: &str) -> String {
    let text = raw.trim();
    let http_at = text.find("http://");
    let https_at = text.find("https://");
    let anchor = match (http_at, https_at) {
        (Some(a), Some(b)) => a.min(b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => 0,
    };

    let mut cleaned = text[anchor..].to_string();
    while cleaned.ends_with(trailing_noise_char) {
        cleaned.pop();
    }
    cleaned
}

/// 覆写 SMTC 元数据与播放态。
fn apply_smtc_snapshot(
    controls: &mut Option<souvlaki::MediaControls>,
    title: &str,
    artist: &str,
    album: &str,
    cover: Option<&str>,
    duration_secs: u32,
    playback: MediaPlayback,
) {
    let Some(media) = controls.as_mut() else { return };
    let total = (duration_secs > 0).then(|| Duration::from_secs(u64::from(duration_secs)));
    let _ = media.set_metadata(MediaMetadata {
        title: Some(title),
        artist: Some(artist),
        album: Some(album),
        cover_url: cover,
        duration: total,
    });
    let _ = media.set_playback(playback);
}

/// 音量平衡：按需建档并折算线性增益；建档失败按 1.0 播放。
fn linear_balance_gain(
    conn: &mut rusqlite::Connection,
    song_id: i64,
    path: &str,
    offset_db: f32,
    prevent_clipping: bool,
) -> f32 {
    match process_song_on_play(conn, song_id, path) {
        Ok(record) => calculate_playback_gain(&record, offset_db, prevent_clipping),
        Err(_) => 1.0,
    }
}

/// 最多等 30 秒直到首块可播；超时后交由失败哨兵兜底。
async fn wait_for_first_chunk(stream_state: &crate::player::stream_cache::StreamingTempFileState) {
    let started = std::time::Instant::now();
    while !crate::player::stream_cache::is_buffer_ready(stream_state) {
        if started.elapsed() > std::time::Duration::from_secs(30) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

/// 在线流分支：SSRF 校验 → 启动流式缓存 → 等首块 → 失败即报错。
async fn settle_streaming_source(
    path: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    ekey: Option<&str>,
    cek: Option<&str>,
    app: &tauri::AppHandle,
) -> Result<(AudioSource, AudioOutputMode), String> {
    crate::security::ssrf::validate_url_ip_literal(path)
        .map_err(|why| format!("播放链接校验失败: {why}"))?;

    let stream_state = crate::player::stream_cache::start_streaming_download(
        path,
        headers,
        Some(DEFAULT_STREAM_USER_AGENT),
        ekey,
        cek,
    )
    .map_err(|why| format!("在线音频缓存启动失败: {why}"))?;

    wait_for_first_chunk(&stream_state).await;
    if stream_state.download_failed.load(Ordering::Relaxed) {
        let why = stream_state
            .download_error()
            .unwrap_or_else(|| "未知原因".to_string());
        return Err(format!(
            "在线音频缓存下载失败，已下载 {} bytes，原因: {}",
            stream_state.downloaded_bytes(),
            why
        ));
    }

    monitor_midway_stream_failure(app, &stream_state, path);

    Ok((
        AudioSource::StreamingTempFile(stream_state),
        AudioOutputMode::Shared,
    ))
}

/// 远端资源分支：缓存命中走本地文件，否则直连流并顺带安排过半预热。
async fn settle_remote_source(
    path: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    requested_mode: AudioOutputMode,
    db_state: &DbState,
    app: &tauri::AppHandle,
    state: &tauri::State<'_, PlayerState>,
    playback_id: u64,
    duration: u32,
) -> Result<(AudioSource, AudioOutputMode), String> {
    match remote_playback_source(db_state, path) {
        Ok(RemotePlaybackSource::Cached { path }) => {
            Ok((AudioSource::LocalFile(path), requested_mode))
        }
        Ok(RemotePlaybackSource::Stream(stream)) => {
            schedule_midway_remote_cache(
                app.clone(),
                db_state.conn.clone(),
                state.progress.clone(),
                state.playback_id.clone(),
                playback_id,
                stream.remote_uri.clone(),
                duration,
            );
            Ok((
                AudioSource::RemoteWebDav(stream),
                AudioOutputMode::Shared,
            ))
        }
        Err(_) => Ok((
            AudioSource::RemoteWebDav(crate::remote::cache::RemoteStreamSource {
                url: path.to_string(),
                remote_uri: path.to_string(),
                user_agent: Some(DEFAULT_STREAM_USER_AGENT.to_string()),
                headers: headers.cloned(),
                ..Default::default()
            }),
            AudioOutputMode::Shared,
        )),
    }
}

/// 播放路径的三种落地形态（选定输出模式可能被降级为共享）。
/// 仅流式来源强制共享模式；缓存命中与本地文件保留用户请求的模式。
async fn settle_playback_source(
    path: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    ekey: Option<&str>,
    cek: Option<&str>,
    db_state: &DbState,
    app: &tauri::AppHandle,
    state: &tauri::State<'_, PlayerState>,
    playback_id: u64,
    duration: u32,
    requested_mode: AudioOutputMode,
) -> Result<(AudioSource, AudioOutputMode), String> {
    let is_http_stream = path.starts_with("http://") || path.starts_with("https://");

    if is_http_stream {
        return settle_streaming_source(path, headers, ekey, cek, app).await;
    }

    if is_remote_uri(path) {
        return settle_remote_source(
            path, headers, requested_mode, db_state, app, state, playback_id, duration,
        )
        .await;
    }

    Ok((
        AudioSource::LocalFile(path.to_string()),
        requested_mode,
    ))
}

// ---------------------------------------------------------------------------
// 播放控制命令
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn play_audio(
    path: String, title: String,
    artist: String, album: String, cover: String,
    duration: u32, output_mode: AudioOutputMode,
    start_offset_ms: Option<u64>, song_id: Option<i64>,
    volume_balance_enabled: Option<bool>, gain_offset_db: Option<f32>, prevent_clipping: Option<bool>,
    headers: Option<std::collections::HashMap<String, String>>,
    ekey: Option<String>, cek: Option<String>,
    dsd_native_passthrough: Option<bool>, output_bit_perfect: Option<bool>,
    app: tauri::AppHandle, db_state: tauri::State<'_, DbState>, state: tauri::State<'_, PlayerState>,
) -> Result<(), String> {
    let session_seq = state.playback_id.fetch_add(1, Ordering::Relaxed) + 1;

    let playable_path = tidy_playback_path(&path);

    let (source, selected_output_mode) = settle_playback_source(
        &playable_path,
        headers.as_ref(),
        ekey.as_deref(),
        cek.as_deref(),
        &db_state,
        &app,
        &state,
        session_seq,
        duration,
        output_mode,
    )
    .await?;

    // 音量平衡：播放期按需建档并折算线性增益。
    let mut volume_balance_gain = 1.0_f32;
    if volume_balance_enabled == Some(true) {
        if let Some(s_id) = song_id {
            if let Ok(mut conn) = db_state.conn.lock() {
                volume_balance_gain = linear_balance_gain(
                    &mut conn,
                    s_id,
                    &playable_path,
                    gain_offset_db.unwrap_or(0.0),
                    prevent_clipping.unwrap_or(true),
                );
            }
        }
    }

    let cover_uri = smtc_cover_uri(&cover);
    dispatch(
        &state,
        AudioCommand::Play {
            source,
            output_mode: selected_output_mode,
            start_offset_ms,
            volume_balance_gain,
            dsd_native_passthrough: dsd_native_passthrough.unwrap_or(true),
            bit_perfect: output_bit_perfect.unwrap_or(false),
        },
    )?;

    if let Ok(mut controls) = state.controls.lock() {
        apply_smtc_snapshot(
            &mut controls,
            &title,
            &artist,
            &album,
            cover_uri.as_deref(),
            duration,
            MediaPlayback::Playing { progress: Some(MediaPosition(Duration::from_secs(0))) },
        );
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
    std::collections::HashMap::from([
        ("current", crate::player::stream_cache::current_cache_size()),
        ("max", crate::player::stream_cache::max_cache_size()),
    ])
}

#[tauri::command]
pub fn clear_stream_cache() {
    crate::player::stream_cache::clear_all();
}

#[tauri::command]
pub fn is_stream_cached(url: String) -> bool {
    let hit = crate::player::stream_cache::is_url_cached(&url);
    hit
}

#[tauri::command]
pub fn copy_stream_cache(
    app_handle: tauri::AppHandle,
    url: String,
    file_name: String,
) -> Result<u64, String> {
    let download_root = crate::toolbox::read_authorized_download_dir(&app_handle)?;
    let safe_name = crate::security::path_validator::sanitize_filename_component(&file_name)?;
    let destination = download_root.join(&safe_name);
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|why| format!("创建下载目录失败: {why}"))?;
    }
    crate::player::stream_cache::copy_cache_to(&url, &destination.to_string_lossy())
}

#[tauri::command]
pub fn prefetch_audio_head(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    max_bytes: Option<u64>,
) -> Result<bool, String> {
    crate::security::ssrf::validate_url_ip_literal(&url)
        .map_err(|why| format!("预取链接校验失败: {why}"))?;
    Ok(crate::player::audio_head_cache::prefetch(
        &url,
        headers,
        max_bytes.unwrap_or(0),
    ))
}

// ---------------------------------------------------------------------------
// 远端缓存过半预热
// ---------------------------------------------------------------------------

/// 过半后真正触发缓存，并广播歌词缓存就绪事件。
async fn finish_remote_cache(
    app: tauri::AppHandle,
    conn: std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    remote_uri: String,
) {
    let db_state = DbState { conn };
    if let Ok(cache_path) = ensure_cached_path(&app, &db_state, &remote_uri).await {
        let song = rebuild_cached_remote_song(&db_state, &remote_uri, &cache_path);
        let _ = app.emit(
            REMOTE_LYRICS_CACHE_READY_EVENT,
            RemoteLyricsCacheReadyPayload {
                uri: remote_uri.clone(),
                song,
            },
        );
    }
}

/// 远端流播放过半后触发后台缓存；换曲则放弃本轮预热。
fn schedule_midway_remote_cache(
    app: tauri::AppHandle,
    conn: std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    progress: std::sync::Arc<crate::player::types::SharedProgress>,
    playback_id: std::sync::Arc<std::sync::atomic::AtomicU64>,
    expected_playback_id: u64,
    remote_uri: String,
    duration: u32,
) {
    let gate_seconds = if duration > 0 {
        f64::from(duration) * 0.5
    } else {
        30.0
    };

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if playback_id.load(Ordering::Relaxed) != expected_playback_id {
                return; // 已切歌，本轮预热作废
            }

            let rate = progress.sample_rate.load(Ordering::Relaxed);
            let lanes = progress.channels.load(Ordering::Relaxed);
            if rate == 0 || lanes == 0 {
                continue;
            }

            let played_secs = progress.samples_played.load(Ordering::Relaxed) as f64
                / (f64::from(rate) * f64::from(lanes));
            if played_secs < gate_seconds {
                continue;
            }

            finish_remote_cache(app, conn, remote_uri).await;
            return;
        }
    });
}

/// 把已缓存的远端音频回填进曲库；路径不一致时返回 None。
fn rebuild_cached_remote_song(
    db_state: &DbState,
    remote_uri: &str,
    cache_path: &str,
) -> Option<Song> {
    let (source, remote_path, etag, stored_uri) = {
        let conn = db_state.conn.lock().ok()?;
        get_source_for_remote_uri(&conn, remote_uri).ok()?
    };
    let canonical_uri = stored_uri.unwrap_or_else(|| remote_uri.to_string());
    let byte_count = std::fs::metadata(cache_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let leaf_name = remote_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(&remote_path)
        .to_string();
    let entry = RemoteFileEntry {
        name: leaf_name,
        remote_path,
        size: byte_count,
        etag,
        modified_at: None,
        is_dir: false,
    };
    let song = song_from_cached_remote_file(&source, &entry, Path::new(cache_path))?;
    if song.path != canonical_uri {
        return None;
    }
    if let Ok(mut conn) = db_state.conn.lock() {
        let updated = std::slice::from_ref(&song);
        let _ = apply_scan_changes(&mut conn, &[], updated, &[], None);
    }
    Some(song)
}

// ---------------------------------------------------------------------------
// SMTC 与查询命令
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn update_playback_metadata(
    title: String, artist: String, album: String, cover: String,
    duration: u32, is_playing: bool,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    let cover_uri = smtc_cover_uri(&cover);
    let playback = if is_playing {
        MediaPlayback::Playing { progress: Some(MediaPosition(Duration::from_secs(0))) }
    } else {
        MediaPlayback::Paused { progress: None }
    };
    if let Ok(mut controls) = state.controls.lock() {
        apply_smtc_snapshot(
            &mut controls,
            &title,
            &artist,
            &album,
            cover_uri.as_deref(),
            duration,
            playback,
        );
    }

    Ok(())
}

#[tauri::command]
pub fn pause_audio(state: tauri::State<PlayerState>) -> Result<(), String> {
    dispatch(&state, AudioCommand::Pause)?;
    set_smtc_playback(&state, MediaPlayback::Paused { progress: None });
    Ok(())
}

#[tauri::command]
pub fn stop_audio(state: tauri::State<PlayerState>) -> Result<(), String> {
    dispatch(&state, AudioCommand::Stop)?;
    set_smtc_playback(&state, MediaPlayback::Stopped);
    Ok(())
}

#[tauri::command]
pub fn resume_audio(state: tauri::State<PlayerState>) -> Result<(), String> {
    dispatch(&state, AudioCommand::Resume)?;
    set_smtc_playback(&state, MediaPlayback::Playing { progress: None });
    Ok(())
}

#[tauri::command]
pub fn seek_audio(
    time: f64, is_playing: bool, request_id: u64,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    dispatch(&state, AudioCommand::Seek { time, is_playing, request_id })?;

    if let Ok(mut controls) = state.controls.lock() {
        if let Some(media) = controls.as_mut() {
            let position = MediaPosition(Duration::from_secs_f64(time.max(0.0)));
            let playback = if is_playing {
                MediaPlayback::Playing { progress: Some(position) }
            } else {
                MediaPlayback::Paused { progress: Some(position) }
            };
            let _ = media.set_playback(playback);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn set_volume(
    volume: f32,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    dispatch(&state, AudioCommand::SetVolume(volume))
}

#[tauri::command]
pub fn get_playback_progress(state: tauri::State<PlayerState>) -> f64 {
    let rate = state.progress.sample_rate.load(Ordering::Relaxed);
    let lanes = state.progress.channels.load(Ordering::Relaxed);
    if rate == 0 || lanes == 0 {
        return 0.0;
    }
    let per_second = rate as u64 * lanes as u64;
    let played = state.progress.samples_played.load(Ordering::Relaxed);
    played as f64 / per_second as f64
}

#[tauri::command]
pub fn get_playback_duration(state: tauri::State<PlayerState>) -> f64 {
    f64::from_bits(state.progress.total_duration_secs.load(Ordering::Relaxed))
}

#[tauri::command]
pub fn get_playback_ready(state: tauri::State<PlayerState>) -> bool {
    let rate = state.progress.sample_rate.load(Ordering::Relaxed);
    rate != 0
}

#[tauri::command]
pub fn get_playback_start_failed(state: tauri::State<PlayerState>) -> bool {
    let failed = state.progress.start_failed.load(Ordering::Relaxed);
    failed
}

#[tauri::command]
pub fn get_playback_start_failed_reason(state: tauri::State<PlayerState>) -> Option<String> {
    let slot = state.progress.start_failed_reason.lock().ok()?;
    slot.clone()
}

/// 起播失败概要（字段名冻结）。
#[derive(serde::Serialize)]
pub struct PlaybackStartFailedInfo {
    pub failed: bool,           // 是否失败
    pub reason: Option<String>, // 失败原因
}

#[tauri::command]
pub fn get_playback_start_failed_info(state: tauri::State<PlayerState>) -> PlaybackStartFailedInfo {
    let failed = state.progress.start_failed.load(Ordering::Relaxed);
    let reason = state
        .progress
        .start_failed_reason
        .lock()
        .ok()
        .and_then(|slot| slot.clone());
    PlaybackStartFailedInfo { failed, reason }
}

#[tauri::command]
pub fn get_audio_visualizer_samples(state: tauri::State<PlayerState>) -> Vec<f32> {
    let snapshot = state.progress.visualizer.snapshot();
    let rate = state.progress.sample_rate.load(Ordering::Relaxed);
    build_frequency_bands(&snapshot, rate, VISUALIZER_BAND_COUNT)
}

// ---------------------------------------------------------------------------
// 响度与参数设置命令
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_track_loudness_info(
    song_id: i64, db_state: tauri::State<'_, DbState>,
) -> Result<Option<LoudnessRecord>, String> {
    let guard = db_state.conn.lock().map_err(|e| e.to_string())?;
    get_song_loudness_record(&guard, song_id)
}

#[tauri::command]
pub async fn update_loudness_settings(
    enabled: bool, song_id: Option<i64>, song_path: Option<String>,
    gain_offset_db: f32, prevent_clipping: bool,
    db_state: tauri::State<'_, DbState>, state: tauri::State<'_, PlayerState>,
) -> Result<(), String> {
    let mut target_gain = 1.0_f32;
    if enabled {
        if let Some(s_id) = song_id {
            if let Some(path) = song_path.as_deref() {
                if let Ok(mut conn) = db_state.conn.lock() {
                    target_gain =
                        linear_balance_gain(&mut conn, s_id, path, gain_offset_db, prevent_clipping);
                }
            }
        }
    }

    dispatch(&state, AudioCommand::SetVolumeBalance { enabled, target_gain })
}

/// 校验并钳制均衡器参数到 ±12 dB（NaN/Inf 一律拒绝）。
fn sanitize_equalizer_params(preamp: f32, gains: &[f32]) -> Result<(f32, [f32; 10]), String> {
    if gains.len() != 10 {
        return Err(format!(
            "均衡器频段数量错误，期望 10，实际 {}",
            gains.len()
        ));
    }
    if !preamp.is_finite() {
        return Err("Preamp 增益必须为有限浮点数，严禁 NaN/Inf".to_string());
    }
    for (index, &value) in gains.iter().enumerate() {
        if !value.is_finite() {
            return Err(format!("频段 {index} 增益必须为有限浮点数，严禁 NaN/Inf"));
        }
    }

    let clamped_preamp = preamp.clamp(-12.0, 12.0);
    let mut clamped_gains = [0.0_f32; 10];
    for (slot, &value) in clamped_gains.iter_mut().zip(gains) {
        *slot = value.clamp(-12.0, 12.0);
    }
    Ok((clamped_preamp, clamped_gains))
}

#[tauri::command]
pub fn set_equalizer_settings(
    enabled: bool, preamp: f32, gains: Vec<f32>,
    state: tauri::State<'_, PlayerState>,
) -> Result<(), String> {
    let (preamp_clamped, gains_clamped) = sanitize_equalizer_params(preamp, &gains)?;
    let settings = EqualizerSettings {
        enabled,
        preamp: preamp_clamped,
        gains: gains_clamped,
    };
    dispatch(&state, AudioCommand::SetEqualizerSettings { settings })
}
#[tauri::command] // 音效参数命令
pub fn set_sound_effect_settings( // set_sound_effect_settings
    settings: SoundEffectSettings, // 音效参数
    state: tauri::State<'_, PlayerState>, // 播放器状态
) -> Result<(), String> { // 返回结果类型
    let both_finite = settings.pitch_shift.is_finite() && settings.playback_rate.is_finite();
    if !both_finite {
        return Err("音效参数 pitchShift/playbackRate 必须为有限浮点数".to_string()); // 非有限数拒绝
    } // set_equalizer_settings
    dispatch(&state, AudioCommand::SetSoundEffectSettings { settings })
} // set_equalizer_settings
