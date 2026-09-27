//! 播放历史与最近播放列表。
//!
//! play_history 是原始事件表，靠 event 列区分用途：recent 表示"打开过"，
//! play 是完整的一次播放，play_time 是定时上报的时长增量。最近播放列表
//! 只挑 recent 事件，每首歌取最后一次出现的时刻来排序。

use std::collections::HashMap;
use std::sync::MutexGuard;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::database::DbState;
use crate::music::utils::normalize_path;

use super::support::current_unix_secs;
use super::write::clear_aggregate_statistics;

/// 最近播放列表不传 limit 时的默认条数。
const DEFAULT_RECENT_LIMIT: usize = 1000;

/// 最近播放列表允许的最大条数。
const MAX_RECENT_LIMIT: usize = 5000;

/// 按规范化路径反查歌曲主键。
const SONG_ID_LOOKUP_SQL: &str = "SELECT id FROM songs WHERE path = ?1";

/// 追加一条历史事件的模板。
const HISTORY_INSERT_SQL: &str = "INSERT INTO play_history (song_path, song_id, played_at, played_seconds, event) VALUES (?1, ?2, ?3, ?4, ?5)";

/// 最近播放列表的取数模板：每个 song_id 只留最新的 recent 时刻。
const RECENT_TIMELINE_SQL: &str = "SELECT s.path, MAX(ph.played_at) AS played_at
             FROM play_history ph
             INNER JOIN songs s ON ph.song_id = s.id
             WHERE ph.event = 'recent'
             GROUP BY ph.song_id
             ORDER BY played_at DESC
             LIMIT ?1";

/// 只摘掉某首歌的 recent 事件，其余事件保留。
const RECENT_PATH_DELETE_SQL: &str = "DELETE FROM play_history WHERE event = 'recent' AND song_path = ?1";

/// 抹掉某首歌的全部历史事件。
const ANY_EVENT_DELETE_SQL: &str = "DELETE FROM play_history WHERE song_path = ?1";

/// 清空最近播放（不动播放次数与时长）。
const RECENT_WIPE_SQL: &str = "DELETE FROM play_history WHERE event = 'recent'";

/// 清空整个播放历史。
const HISTORY_WIPE_SQL: &str = "DELETE FROM play_history";

/// 最近播放列表里的一行，played_at 是毫秒时间戳。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentHistoryEntry {
    pub song_path: String,
    pub played_at: i64,
}

/// 前端批量回传的一条最近播放记录，played_at 是秒时间戳。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentHistoryImportEntry {
    pub song_path: String,
    pub played_at: i64,
}

/// rusqlite 的错误统一压成字符串。
fn db_err(err: rusqlite::Error) -> String {
    err.to_string()
}

/// 执行一条写语句，返回受影响行数。
fn exec_write(conn: &Connection, sql: &str, args: impl rusqlite::Params) -> Result<usize, String> {
    conn.execute(sql, args).map_err(db_err)
}

/// 拿到数据库连接的锁；锁中毒时把错误压成字符串。
fn hold_db<'a>(db: &'a State<'a, DbState>) -> Result<MutexGuard<'a, Connection>, String> {
    db.conn.lock().map_err(|err| err.to_string())
}

/// 按规范化路径反查歌曲主键；曲库里没有就返回 None。
fn find_song_pk(conn: &Connection, key_path: &str) -> Option<i64> {
    conn.query_row(SONG_ID_LOOKUP_SQL, [key_path], |r| r.get(0))
        .ok()
}

/// 追加一条历史事件。歌曲已经不在曲库里时静默跳过，
/// 免得 play_history 里堆积孤儿行。
fn append_history_event(
    conn: &Connection, key_path: &str, moment: i64, seconds: i64, kind: &str,
) -> Result<(), String> {
    let Some(song_pk) = find_song_pk(conn, key_path) else {
        return Ok(());
    };

    exec_write(conn, HISTORY_INSERT_SQL, params![key_path, song_pk, moment, seconds, kind])?;
    Ok(())
}

/// 同一路径的多条上报只保留时间最晚的一条。
fn fold_latest_timestamps(events: Vec<RecentHistoryImportEntry>) -> HashMap<String, i64> {
    let mut newest_per_path = HashMap::<String, i64>::new();
    for event in events {
        let key_path = normalize_path(&event.song_path);
        if key_path.is_empty() { continue; }
        newest_per_path
            .entry(key_path)
            .and_modify(|seen| *seen = (*seen).max(event.played_at))
            .or_insert(event.played_at);
    }
    newest_per_path
}

/// 记一次"打开过这首歌"。
#[tauri::command]
pub fn add_to_history(db: State<DbState>, song_path: String) -> Result<(), String> {
    let guard = hold_db(&db)?;
    let key_path = normalize_path(&song_path);

    append_history_event(&guard, &key_path, current_unix_secs(), 0, "recent")
}

/// 批量导入最近播放，同一路径重复出现时保留更晚的那条。
#[tauri::command]
pub fn import_recent_history(db: State<DbState>, entries: Vec<RecentHistoryImportEntry>) -> Result<(), String> {
    if entries.is_empty() { return Ok(()); }

    let newest_per_path = fold_latest_timestamps(entries);
    let mut guard = hold_db(&db)?;
    let tx = guard.transaction().map_err(db_err)?;

    for (key_path, moment) in newest_per_path {
        append_history_event(&tx, &key_path, moment, 0, "recent")?;
    }

    tx.commit().map_err(db_err)
}

/// 取最近播放列表。limit 缺省 1000，夹在 1 到 5000 之间。
#[tauri::command]
pub fn get_recent_history(db: State<DbState>, limit: Option<usize>) -> Result<Vec<RecentHistoryEntry>, String> {
    let guard = hold_db(&db)?;
    let max_rows = limit.unwrap_or(DEFAULT_RECENT_LIMIT).clamp(1, MAX_RECENT_LIMIT) as i64;

    let mut stmt = guard.prepare(RECENT_TIMELINE_SQL).map_err(db_err)?;

    let rows = stmt
        .query_map([max_rows], |r| {
            let library_path: String = r.get(0)?;
            let last_seen: i64 = r.get::<_, i64>(1)?;
            Ok(RecentHistoryEntry {
                song_path: library_path,
                played_at: last_seen * 1000,
            })
        })
        .map_err(db_err)?;

    Ok(rows.filter_map(|item| item.ok()).collect())
}

/// 把若干首歌从最近播放里摘掉，只删 recent 事件。
#[tauri::command]
pub fn remove_from_recent_history(db: State<DbState>, song_paths: Vec<String>) -> Result<(), String> {
    if song_paths.is_empty() { return Ok(()); }

    let mut guard = hold_db(&db)?;
    let tx = guard.transaction().map_err(db_err)?;
    {
        let mut stmt = tx.prepare(RECENT_PATH_DELETE_SQL).map_err(db_err)?;
        for raw_path in song_paths {
            let key_path = normalize_path(&raw_path);
            if key_path.is_empty() { continue; }
            stmt.execute([key_path]).map_err(db_err)?;
        }
    }

    tx.commit().map_err(db_err)
}

/// 把若干首歌的全部历史事件抹掉，再按剩下的历史重算聚合。
/// 这是"从统计里彻底删除"的入口。
#[tauri::command]
pub fn remove_songs_from_history_and_statistics(db: State<DbState>, song_paths: Vec<String>) -> Result<(), String> {
    if song_paths.is_empty() { return Ok(()); }

    let mut guard = hold_db(&db)?;
    let tx = guard.transaction().map_err(db_err)?;
    {
        let mut stmt = tx.prepare(ANY_EVENT_DELETE_SQL).map_err(db_err)?;
        for raw_path in song_paths {
            let key_path = normalize_path(&raw_path);
            if key_path.is_empty() { continue; }
            stmt.execute([key_path]).map_err(db_err)?;
        }
    }

    super::write::rebuild_statistics_aggregates(&tx)?;
    tx.commit().map_err(db_err)
}

/// 清空最近播放，不动播放次数与时长。
#[tauri::command]
pub fn clear_recent_history(db: State<DbState>) -> Result<(), String> {
    let guard = hold_db(&db)?;
    exec_write(&guard, RECENT_WIPE_SQL, [])?;
    Ok(())
}

/// 重置本机统计：历史事件和四张聚合表一起清空。
#[tauri::command]
pub fn reset_local_statistics(db: State<DbState>) -> Result<(), String> {
    let guard = hold_db(&db)?;
    exec_write(&guard, HISTORY_WIPE_SQL, [])?;
    clear_aggregate_statistics(&guard)?;
    Ok(())
}
