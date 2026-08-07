//! 播放会话状态管理
//!
//! 将播放队列、当前歌曲、进度、播放模式等权威状态从 Pinia/localStorage 迁移到 Rust。
//! Rust 作为单一事实源（single source of truth），通过 SQLite 持久化 + 内存缓存 +
//! `playback:session-changed` 事件广播，实现多窗口一致性和状态安全。
//!
//! 架构：
//! - 主窗口通过 `save_playback_session` 写入完整会话状态（切歌/队列变更时调用）
//! - 主窗口通过 `update_playback_position` 高频更新进度（仅内存，不写 SQLite）
//! - 主窗口通过 `flush_playback_session` 定时/退出时强制持久化
//! - 副窗口（迷你播放器/桌面歌词/任务栏）通过 `get_playback_session` 读取当前状态
//! - 所有窗口监听 `playback:session-changed` 事件获取实时更新

use crate::database::DbState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const SESSION_CHANGED_EVENT: &str = "playback:session-changed";
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
/// 写入内存 + SQLite + 广播事件给所有窗口
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

    // 更新内存状态
    {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        *inner = session.clone();
    }

    // 持久化到 SQLite
    PlaybackSessionState::persist_to_db_internal(&session, &db_state)?;

    // 重置进度持久化防抖计时器
    {
        let mut last = state.last_position_persist.lock().map_err(|e| e.to_string())?;
        *last = Instant::now();
    }

    // 广播事件给所有窗口
    let _ = app.emit(SESSION_CHANGED_EVENT, &session);

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
        let inner = state.inner.lock().map_err(|e| e.to_string())?;
        PlaybackSessionState::persist_to_db_internal(&inner, &db_state)?;
    }

    Ok(())
}

/// 强制将内存状态持久化到 SQLite（定时刷新或应用退出时调用）
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
/// 加载到内存并返回数据，同时广播事件
#[tauri::command]
pub async fn load_playback_session(
    app: AppHandle,
    db_state: tauri::State<'_, DbState>,
    state: tauri::State<'_, PlaybackSessionState>,
) -> Result<PlaybackSessionData, String> {
    state.load_from_db(&db_state)?;
    let inner = state.inner.lock().map_err(|e| e.to_string())?;
    let data = inner.clone();
    // 广播给所有窗口（包括主窗口的其他 webview）
    let _ = app.emit(SESSION_CHANGED_EVENT, &data);
    Ok(data)
}
