//! 播放会话状态管理
//!
//! 将播放队列、当前歌曲、进度、播放模式等状态持久化到 Rust + SQLite，
//! 实现跨重启恢复和多窗口共享。
//!
//! 架构定位（务实组合，非纯单一事实源）：
//! - **运行时播放编排权威**在前端（playerPlayback.ts / playbackCore）：
//!   音频解码、进度推进、切歌逻辑、UI 响应均由 JS 侧驱动。
//! - **持久化与多窗口共享权威**在 Rust（本模块）：
//!   会话状态写入 SQLite，副窗口通过 `get_playback_session` / 事件获取。
//! - 两者通过 `save_playback_session`（前端 → Rust）和
//!   `playback:session-changed` 事件（Rust → 所有窗口）保持同步。
//! - ⚠️ 不要在 Rust 侧修改会话的播放逻辑（如切歌、进度跳转），
//!   Rust 仅负责存储和分发，不做播放决策。
//!
//! 广播分频道策略：
//! - `playback:session-changed`：轻量载荷（不含 queueSongMeta），切歌/模式变更时广播
//! - `playback:queue-meta-changed`：重量载荷（仅 queueSongMeta），仅在元数据变化时广播
//! - 避免每次切歌都序列化/传输可能很大的 queueSongMeta（在线歌多时可达数百 KB）
//!
//! 锁顺序约定：**inner → DB**
//! `update_playback_position` 和 `flush_playback_session` 在持有 `inner` 锁时
//! 调用 `persist_to_db_internal`（获取 DB 锁）。当前无反向调用链（持 DB 锁时回调
//! session），但若未来新增此类路径将导致死锁。新增 DB 操作时勿在持锁期间回调 session。

use crate::database::DbState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const SESSION_CHANGED_EVENT: &str = "playback:session-changed";
/// queueSongMeta 变更时独立广播（仅在元数据实际变化时发射）
const QUEUE_META_CHANGED_EVENT: &str = "playback:queue-meta-changed";
/// 进度持久化防抖间隔：避免每秒写 SQLite
const POSITION_PERSIST_INTERVAL_MS: u128 = 5000;

/// 播放会话数据（可序列化，用于 IPC 传输和 SQLite 持久化）
#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSessionData {
    /// 当前播放歌曲路径
    pub current_song_path: Option<String>,
    /// 播放队列路径数组
    pub play_queue_paths: Vec<String>,
    /// 源歌单路径数组（当前播放上下文的完整歌曲列表）
    pub source_song_paths: Vec<String>,
    /// 播放模式 (0=顺序, 1=循环, 2=随机, 3=单曲循环)
    pub play_mode: u32,
    /// 音量 (0-100)
    pub volume: f32,
    /// 当前播放位置（秒）
    pub current_position_secs: f64,
    /// 是否正在播放
    pub is_playing: bool,
    /// 会话级音质覆盖
    pub session_quality_override: Option<String>,
    /// 队列中在线歌曲的元数据（path → JSON Song 对象）
    /// 在线歌不在本地库，需靠此数据在重启后还原
    pub queue_song_meta: HashMap<String, serde_json::Value>,
    /// 最后更新时间戳（毫秒）
    pub updated_at: i64,
}

/// 播放会话托管状态
pub struct PlaybackSessionState {
    /// 内存中的权威状态
    inner: Arc<Mutex<PlaybackSessionData>>,
    /// 上次进度持久化时间（防抖）
    last_position_persist: Arc<Mutex<Instant>>,
}

impl PlaybackSessionState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(PlaybackSessionData::default())),
            last_position_persist: Arc::new(Mutex::new(Instant::now())),
        }
    }

    /// 从 SQLite 加载持久化的会话状态（启动时调用）
    pub fn load_from_db(&self, db_state: &DbState) -> Result<(), String> {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        let result: Result<Option<String>, rusqlite::Error> = conn
            .query_row(
                "SELECT data FROM playback_session WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|e| {
                if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
                    Ok(None)
                } else {
                    Err(e)
                }
            });

        match result {
            Ok(Some(json_str)) => {
                let data: PlaybackSessionData = serde_json::from_str(&json_str)
                    .map_err(|e| format!("反序列化播放会话失败: {}", e))?;
                let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
                *inner = data;
                eprintln!("[Session] 从 SQLite 恢复播放会话成功");
            }
            Ok(None) => {
                eprintln!("[Session] SQLite 中无播放会话记录，使用默认空状态");
            }
            Err(e) => {
                eprintln!("[Session] 加载播放会话失败: {}", e);
            }
        }
        Ok(())
    }

    /// 将当前内存状态持久化到 SQLite
    ///
    /// ⚠️ 锁顺序约定：调用方若持有 `inner` 锁，则在此处获取 DB 锁（inner → DB）。
    /// 切勿在持有 DB 锁时回调 session（获取 inner 锁），否则将死锁。
    fn persist_to_db_internal(
        data: &PlaybackSessionData,
        db_state: &DbState,
    ) -> Result<(), String> {
        let json_str = serde_json::to_string(data)
            .map_err(|e| format!("序列化播放会话失败: {}", e))?;
        let now = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO playback_session (id, data, updated_at) VALUES (1, ?1, ?2)",
            rusqlite::params![json_str, now],
        )
        .map_err(|e| format!("写入播放会话失败: {}", e))?;
        Ok(())
    }
}

impl Default for PlaybackSessionState {
    fn default() -> Self {
        Self::new()
    }
}

/// 保存完整播放会话状态（主窗口切歌/队列变更时调用）
///
/// 写入内存 + SQLite + 分频道广播：
/// - `playback:session-changed`：轻量载荷（不含 queueSongMeta），每次都广播
/// - `playback:queue-meta-changed`：仅 queueSongMeta，仅在元数据变化时广播
#[tauri::command]
pub async fn save_playback_session(
    session: PlaybackSessionData,
    app: AppHandle,
    db_state: tauri::State<'_, DbState>,
    state: tauri::State<'_, PlaybackSessionState>,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let mut session = session;
    session.updated_at = now;

    // 更新内存状态，同时检测 queueSongMeta 是否变化
    let meta_changed = {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        let changed = inner.queue_song_meta != session.queue_song_meta;
        *inner = session.clone();
        changed
    };

    // 持久化到 SQLite（inner 锁已释放，不违反锁顺序）
    PlaybackSessionState::persist_to_db_internal(&session, &db_state)?;

    // 重置进度持久化防抖计时器
    {
        let mut last = state.last_position_persist.lock().map_err(|e| e.to_string())?;
        *last = Instant::now();
    }

    // 分频道广播：轻量 session-changed（不含 queueSongMeta）
    let mut lightweight = session.clone();
    lightweight.queue_song_meta = HashMap::new();
    let _ = app.emit(SESSION_CHANGED_EVENT, &lightweight);

    // 重量 queue-meta-changed（仅元数据变化时发射）
    if meta_changed {
        let _ = app.emit(QUEUE_META_CHANGED_EVENT, &session.queue_song_meta);
    }

    Ok(())
}

/// 高频更新播放进度（仅内存 + 防抖写 SQLite，不广播事件）
///
/// 主窗口播放进度变化时调用，避免每秒都写 SQLite 和广播事件。
/// 进度更新由现有的 `playback:progress` 事件负责通知副窗口，
/// 此命令仅确保 Rust 内存中的进度与前端同步，并在防抖间隔后持久化。
#[tauri::command]
pub async fn update_playback_position(
    position_secs: f64,
    is_playing: bool,
    db_state: tauri::State<'_, DbState>,
    state: tauri::State<'_, PlaybackSessionState>,
) -> Result<(), String> {
    let should_persist = {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        inner.current_position_secs = position_secs;
        inner.is_playing = is_playing;

        let mut last = state.last_position_persist.lock().map_err(|e| e.to_string())?;
        let elapsed = last.elapsed().as_millis();
        if elapsed >= POSITION_PERSIST_INTERVAL_MS {
            *last = Instant::now();
            true
        } else {
            false
        }
    };

    if should_persist {
        // ⚠️ 持有 inner 锁时获取 DB 锁（锁顺序: inner → DB）
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        PlaybackSessionState::persist_to_db_internal(&inner, &db_state)?;
    }

    Ok(())
}

/// 强制将内存状态持久化到 SQLite（定时刷新或应用退出时调用）
///
/// ⚠️ 持有 inner 锁时获取 DB 锁（锁顺序: inner → DB）
#[tauri::command]
pub async fn flush_playback_session(
    db_state: tauri::State<'_, DbState>,
    state: tauri::State<'_, PlaybackSessionState>,
) -> Result<(), String> {
    let inner = state.inner.lock().map_err(|e| e.to_string())?;
    if inner.current_song_path.is_none() && inner.play_queue_paths.is_empty() {
        return Ok(());
    }
    PlaybackSessionState::persist_to_db_internal(&inner, &db_state)?;
    Ok(())
}

/// 获取当前播放会话状态（副窗口启动时调用）
///
/// 从内存读取权威状态，无需访问 SQLite
#[tauri::command]
pub fn get_playback_session(
    state: tauri::State<'_, PlaybackSessionState>,
) -> PlaybackSessionData {
    let inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    inner.clone()
}

/// 从 SQLite 加载播放会话状态（主窗口启动恢复时调用）
///
/// 加载到内存并返回数据，同时分频道广播给所有窗口
#[tauri::command]
pub async fn load_playback_session(
    app: AppHandle,
    db_state: tauri::State<'_, DbState>,
    state: tauri::State<'_, PlaybackSessionState>,
) -> Result<PlaybackSessionData, String> {
    state.load_from_db(&db_state)?;
    let inner = state.inner.lock().map_err(|e| e.to_string())?;
    let data = inner.clone();

    // 分频道广播：轻量 session-changed（不含 queueSongMeta）
    let mut lightweight = data.clone();
    lightweight.queue_song_meta = HashMap::new();
    let _ = app.emit(SESSION_CHANGED_EVENT, &lightweight);

    // 重量 queue-meta-changed（有元数据时发射）
    if !data.queue_song_meta.is_empty() {
        let _ = app.emit(QUEUE_META_CHANGED_EVENT, &data.queue_song_meta);
    }

    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_values() {
        let data = PlaybackSessionData::default();
        assert!(data.current_song_path.is_none());
        assert!(data.play_queue_paths.is_empty());
        assert!(data.source_song_paths.is_empty());
        assert_eq!(data.play_mode, 0);
        assert_eq!(data.volume, 0.0);
        assert_eq!(data.current_position_secs, 0.0);
        assert!(!data.is_playing);
        assert!(data.session_quality_override.is_none());
        assert!(data.queue_song_meta.is_empty());
        assert_eq!(data.updated_at, 0);
    }

    #[test]
    fn test_camel_case_serialization() {
        let mut data = PlaybackSessionData::default();
        data.current_song_path = Some("/music/song.flac".into());
        data.play_queue_paths = vec!["/music/song.flac".into()];
        data.source_song_paths = vec!["/music/song.flac".into()];
        data.play_mode = 2;
        data.volume = 75.0;
        data.current_position_secs = 42.5;
        data.is_playing = true;
        data.session_quality_override = Some("flac".into());
        data.updated_at = 1700000000000;

        let json = serde_json::to_string(&data).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();

        // 验证 camelCase 映射
        assert_eq!(v["currentSongPath"], "/music/song.flac");
        assert_eq!(v["playQueuePaths"][0], "/music/song.flac");
        assert_eq!(v["sourceSongPaths"][0], "/music/song.flac");
        assert_eq!(v["playMode"], 2);
        assert_eq!(v["volume"], 75.0);
        assert_eq!(v["currentPositionSecs"], 42.5);
        assert_eq!(v["isPlaying"], true);
        assert_eq!(v["sessionQualityOverride"], "flac");
        assert_eq!(v["queueSongMeta"], serde_json::Value::Object(serde_json::Map::new()));
        assert_eq!(v["updatedAt"], 1700000000000_i64);

        // 确认 snake_case 字段名不出现在 JSON 中
        assert!(v.get("current_song_path").is_none());
        assert!(v.get("play_queue_paths").is_none());
        assert!(v.get("current_position_secs").is_none());
    }

    #[test]
    fn test_round_trip_serialization() {
        let mut data = PlaybackSessionData::default();
        data.current_song_path = Some("remote://song1".into());
        data.play_queue_paths = vec!["remote://song1".into(), "remote://song2".into()];
        data.play_mode = 3;
        data.volume = 50.0;
        data.current_position_secs = 120.0;
        data.is_playing = true;
        data.session_quality_override = Some("320k".into());

        // 填充 queueSongMeta
        let song_meta = serde_json::json!({
            "title": "Test Song",
            "artist": "Test Artist",
            "duration": 180
        });
        data.queue_song_meta.insert("remote://song1".into(), song_meta.clone());

        // 序列化 → 反序列化
        let json = serde_json::to_string(&data).unwrap();
        let restored: PlaybackSessionData = serde_json::from_str(&json).unwrap();

        assert_eq!(restored.current_song_path, data.current_song_path);
        assert_eq!(restored.play_queue_paths, data.play_queue_paths);
        assert_eq!(restored.play_mode, data.play_mode);
        assert_eq!(restored.volume, data.volume);
        assert_eq!(restored.current_position_secs, data.current_position_secs);
        assert_eq!(restored.is_playing, data.is_playing);
        assert_eq!(restored.session_quality_override, data.session_quality_override);
        assert_eq!(restored.queue_song_meta.len(), 1);
        assert_eq!(restored.queue_song_meta["remote://song1"], song_meta);
    }

    #[test]
    fn test_queue_song_meta_empty_serialization() {
        let data = PlaybackSessionData::default();
        let json = serde_json::to_string(&data).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        // 空 HashMap 序列化为空对象
        assert_eq!(v["queueSongMeta"], serde_json::Value::Object(serde_json::Map::new()));

        let restored: PlaybackSessionData = serde_json::from_str(&json).unwrap();
        assert!(restored.queue_song_meta.is_empty());
    }

    #[test]
    fn test_queue_song_meta_multiple_entries() {
        let mut data = PlaybackSessionData::default();
        for i in 0..5 {
            let path = format!("remote://song{}", i);
            let meta = serde_json::json!({
                "title": format!("Song {}", i),
                "artist": "Artist",
                "duration": i * 60
            });
            data.queue_song_meta.insert(path, meta);
        }

        let json = serde_json::to_string(&data).unwrap();
        let restored: PlaybackSessionData = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.queue_song_meta.len(), 5);
        assert_eq!(restored.queue_song_meta["remote://song3"]["title"], "Song 3");
    }

    #[test]
    fn test_playback_session_state_new() {
        let state = PlaybackSessionState::new();
        let inner = state.inner.lock().unwrap();
        assert!(inner.current_song_path.is_none());
        assert!(inner.play_queue_paths.is_empty());
    }

    #[test]
    fn test_lightweight_clone_omits_meta() {
        // 模拟 save_playback_session 中的轻量广播逻辑
        let mut data = PlaybackSessionData::default();
        data.queue_song_meta.insert("path1".into(), serde_json::json!({"title": "A"}));

        let mut lightweight = data.clone();
        lightweight.queue_song_meta = HashMap::new();

        let full_json = serde_json::to_string(&data).unwrap();
        let light_json = serde_json::to_string(&lightweight).unwrap();

        let full_size = full_json.len();
        let light_size = light_json.len();

        // 轻量版本应该更小（不含元数据）
        assert!(light_size < full_size);
        // 轻量版本的 queueSongMeta 应为空
        let light_v: serde_json::Value = serde_json::from_str(&light_json).unwrap();
        assert_eq!(light_v["queueSongMeta"], serde_json::Value::Object(serde_json::Map::new()));
    }

    #[test]
    fn test_meta_change_detection() {
        // 验证 HashMap 比较能正确检测 queueSongMeta 变化
        let mut meta1: HashMap<String, serde_json::Value> = HashMap::new();
        meta1.insert("path1".into(), serde_json::json!({"title": "A"}));

        let mut meta2 = meta1.clone();
        assert!(!(meta1 != meta2)); // 相同 → 不应触发广播

        meta2.insert("path2".into(), serde_json::json!({"title": "B"}));
        assert!(meta1 != meta2); // 不同 → 应触发广播

        // 修改已有 key 的值也应检测到变化
        let mut meta3 = meta1.clone();
        meta3.insert("path1".into(), serde_json::json!({"title": "Changed"}));
        assert!(meta1 != meta3);
    }
}
