use crate::database::DbState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const SESSION_CHANGED_EVENT: &str = "playback:session-changed";
const QUEUE_META_CHANGED_EVENT: &str = "playback:queue-meta-changed";
const POSITION_PERSIST_INTERVAL_MS: u128 = 5000;

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSessionData {
    pub current_song_path: Option<String>,
    pub play_queue_paths: Vec<String>,
    pub source_song_paths: Vec<String>,
    pub play_mode: u32,
    pub volume: f32,
    pub current_position_secs: f64,
    pub is_playing: bool,
    pub session_quality_override: Option<String>,
    pub queue_song_meta: HashMap<String, serde_json::Value>,
    pub updated_at: i64,
}

pub struct PlaybackSessionState {
    inner: Arc<Mutex<PlaybackSessionData>>,
    last_position_persist: Arc<Mutex<Instant>>,
}

impl PlaybackSessionState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(PlaybackSessionData::default())),
            last_position_persist: Arc::new(Mutex::new(Instant::now())),
        }
    }

    pub fn load_from_db(&self, db_state: &DbState) -> Result<(), String> {
        let result: Result<Option<String>, rusqlite::Error> = {
            let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
            conn.query_row(
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
            })
        };

        match result {
            Ok(Some(json_str)) => {
                let data: PlaybackSessionData = serde_json::from_str(&json_str)
                    .map_err(|e| format!("反序列化播放会话失败: {}", e))?;
                let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
                *inner = data;
            }
            Ok(None) => {}
            Err(_) => {}
        }
        Ok(())
    }

    fn persist_to_db_internal(
        data: &PlaybackSessionData,
        db_state: &DbState,
    ) -> Result<(), String> {
        let json_str =
            serde_json::to_string(data).map_err(|e| format!("序列化播放会话失败: {}", e))?;
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

    let meta_changed = {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        let changed = inner.queue_song_meta != session.queue_song_meta;
        *inner = session.clone();
        changed
    };

    PlaybackSessionState::persist_to_db_internal(&session, &db_state)?;

    {
        let mut last = state
            .last_position_persist
            .lock()
            .map_err(|e| e.to_string())?;
        *last = Instant::now();
    }

    let mut lightweight = session.clone();
    lightweight.queue_song_meta = HashMap::new();
    let _ = app.emit(SESSION_CHANGED_EVENT, &lightweight);

    if meta_changed {
        let _ = app.emit(QUEUE_META_CHANGED_EVENT, &session.queue_song_meta);
    }

    Ok(())
}

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

        let mut last = state
            .last_position_persist
            .lock()
            .map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn get_playback_session(state: tauri::State<'_, PlaybackSessionState>) -> PlaybackSessionData {
    let inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    inner.clone()
}

#[tauri::command]
pub async fn load_playback_session(
    app: AppHandle,
    db_state: tauri::State<'_, DbState>,
    state: tauri::State<'_, PlaybackSessionState>,
) -> Result<PlaybackSessionData, String> {
    state.load_from_db(&db_state)?;
    let inner = state.inner.lock().map_err(|e| e.to_string())?;
    let data = inner.clone();

    let mut lightweight = data.clone();
    lightweight.queue_song_meta = HashMap::new();
    let _ = app.emit(SESSION_CHANGED_EVENT, &lightweight);

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

        assert_eq!(v["currentSongPath"], "/music/song.flac");
        assert_eq!(v["playQueuePaths"][0], "/music/song.flac");
        assert_eq!(v["sourceSongPaths"][0], "/music/song.flac");
        assert_eq!(v["playMode"], 2);
        assert_eq!(v["volume"], 75.0);
        assert_eq!(v["currentPositionSecs"], 42.5);
        assert_eq!(v["isPlaying"], true);
        assert_eq!(v["sessionQualityOverride"], "flac");
        assert_eq!(
            v["queueSongMeta"],
            serde_json::Value::Object(serde_json::Map::new())
        );
        assert_eq!(v["updatedAt"], 1700000000000_i64);

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

        let song_meta = serde_json::json!({
            "title": "Test Song",
            "artist": "Test Artist",
            "duration": 180
        });
        data.queue_song_meta
            .insert("remote://song1".into(), song_meta.clone());

        let json = serde_json::to_string(&data).unwrap();
        let restored: PlaybackSessionData = serde_json::from_str(&json).unwrap();

        assert_eq!(restored.current_song_path, data.current_song_path);
        assert_eq!(restored.play_queue_paths, data.play_queue_paths);
        assert_eq!(restored.play_mode, data.play_mode);
        assert_eq!(restored.volume, data.volume);
        assert_eq!(restored.current_position_secs, data.current_position_secs);
        assert_eq!(restored.is_playing, data.is_playing);
        assert_eq!(
            restored.session_quality_override,
            data.session_quality_override
        );
        assert_eq!(restored.queue_song_meta.len(), 1);
        assert_eq!(restored.queue_song_meta["remote://song1"], song_meta);
    }

    #[test]
    fn test_queue_song_meta_empty_serialization() {
        let data = PlaybackSessionData::default();
        let json = serde_json::to_string(&data).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(
            v["queueSongMeta"],
            serde_json::Value::Object(serde_json::Map::new())
        );

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
        assert_eq!(
            restored.queue_song_meta["remote://song3"]["title"],
            "Song 3"
        );
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
        let mut data = PlaybackSessionData::default();
        data.queue_song_meta
            .insert("path1".into(), serde_json::json!({"title": "A"}));

        let mut lightweight = data.clone();
        lightweight.queue_song_meta = HashMap::new();

        let full_json = serde_json::to_string(&data).unwrap();
        let light_json = serde_json::to_string(&lightweight).unwrap();

        let full_size = full_json.len();
        let light_size = light_json.len();

        assert!(light_size < full_size);
        let light_v: serde_json::Value = serde_json::from_str(&light_json).unwrap();
        assert_eq!(
            light_v["queueSongMeta"],
            serde_json::Value::Object(serde_json::Map::new())
        );
    }

    #[test]
    fn test_meta_change_detection() {
        let mut meta1: HashMap<String, serde_json::Value> = HashMap::new();
        meta1.insert("path1".into(), serde_json::json!({"title": "A"}));

        let mut meta2 = meta1.clone();
        assert!(!(meta1 != meta2));

        meta2.insert("path2".into(), serde_json::json!({"title": "B"}));
        assert!(meta1 != meta2);

        let mut meta3 = meta1.clone();
        meta3.insert("path1".into(), serde_json::json!({"title": "Changed"}));
        assert!(meta1 != meta3);
    }
}
