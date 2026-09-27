//! 云端时长与快照合并。
//!
//! 云同步只搬运"听了多久"这类可比较的标量，所以合并策略是取两边较大的
//! 那个（max 模式）；只有显式传入 add 模式时才做累加。每日明细同理，
//! 其中 unique_* 不是可加量，两种模式下都取 max。

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::database::DbState;

/// 合并云端时长的结果，total_duration 单位是秒。
#[derive(Serialize)]
pub struct CloudMergeResult {
    pub total_duration: i64,
    pub merged: bool,
}

/// 云端下发的全局汇总。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListenSnapshotGlobal {
    pub total_play_count: i64,
    pub total_play_time_ms: i64,
    #[serde(default)]
    pub first_played_at: Option<String>,
    #[serde(default)]
    pub last_played_at: Option<String>,
}

/// 云端下发的单日汇总。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListenSnapshotDaily {
    pub date: String,
    pub play_count: i64,
    pub play_time_ms: i64,
    pub unique_songs: i64,
    pub unique_artists: i64,
}

/// 一次云同步传过来的完整快照。daily 允许缺省，老版本客户端只发 global。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListenSnapshot {
    pub global: ListenSnapshotGlobal,
    #[serde(default)]
    pub daily: Vec<ListenSnapshotDaily>,
}

#[derive(Serialize)]
pub struct ListenSnapshotMergeResult {
    pub total_play_time_ms: i64,
    pub total_play_count: i64,
}

/// 读本机的全局汇总；表里没行时给出全零版本。
fn read_local_global(conn: &rusqlite::Connection) -> Result<ListenSnapshotGlobal, String> {
    let row = conn.query_row(
        "SELECT total_play_count, total_play_time_ms, first_played_at, last_played_at
         FROM global_stats WHERE id = 1",
        [],
        |row| {
            Ok(ListenSnapshotGlobal {
                total_play_count: row.get(0)?,
                total_play_time_ms: row.get(1)?,
                first_played_at: row.get(2)?,
                last_played_at: row.get(3)?,
            })
        },
    );
    Ok(row.unwrap_or(ListenSnapshotGlobal {
        total_play_count: 0,
        total_play_time_ms: 0,
        first_played_at: None,
        last_played_at: None,
    }))
}

/// 两个标量怎么合：add 模式相加，其余情况取较大值。
fn combine_scalar(local: i64, incoming: i64, additive: bool) -> i64 {
    if additive {
        local + incoming
    } else {
        local.max(incoming)
    }
}

/// 两个可选时间戳里取更早的那个（按字典序比较 ISO 串）。
fn earlier_iso(local: &Option<String>, incoming: &Option<String>) -> Option<String> {
    match (local, incoming) {
        (Some(a), Some(b)) => Some(if a <= b { a.clone() } else { b.clone() }),
        (Some(a), None) => Some(a.clone()),
        (None, Some(b)) => Some(b.clone()),
        (None, None) => None,
    }
}

/// 两个可选时间戳里取更晚的那个。
fn later_iso(local: &Option<String>, incoming: &Option<String>) -> Option<String> {
    match (local, incoming) {
        (Some(a), Some(b)) => Some(if a >= b { a.clone() } else { b.clone() }),
        (Some(a), None) => Some(a.clone()),
        (None, Some(b)) => Some(b.clone()),
        (None, None) => None,
    }
}

/// 把云端总时长并进来：本机较短时才真正写入，负数按 0 处理。
fn apply_cloud_listen_duration(
    conn: &rusqlite::Connection,
    total_seconds: i64,
) -> Result<CloudMergeResult, String> {
    let _ = conn.execute(
        "INSERT INTO global_stats (id, total_play_count, total_play_time_ms) VALUES (1, 0, 0) \
         ON CONFLICT(id) DO NOTHING",
        [],
    );

    let cur_ms: i64 = conn
        .query_row(
            "SELECT total_play_time_ms FROM global_stats WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let target_ms = total_seconds.max(0) * 1000;
    conn.execute(
        "UPDATE global_stats SET total_play_time_ms = MAX(total_play_time_ms, ?) WHERE id = 1",
        [target_ms],
    )
    .map_err(|e| e.to_string())?;

    Ok(CloudMergeResult {
        total_duration: target_ms.max(cur_ms) / 1000,
        merged: target_ms > cur_ms,
    })
}

#[tauri::command]
pub fn merge_cloud_listen_duration(
    db: State<DbState>,
    total_seconds: i64,
) -> Result<CloudMergeResult, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    apply_cloud_listen_duration(&conn, total_seconds)
}

/// 导出本机快照，供云同步上传。
#[tauri::command]
pub fn export_listen_snapshot(db: State<DbState>) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let global = read_local_global(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT date, play_count, play_time_ms, unique_songs, unique_artists
             FROM daily_stats ORDER BY date",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ListenSnapshotDaily {
                date: row.get(0)?,
                play_count: row.get(1)?,
                play_time_ms: row.get(2)?,
                unique_songs: row.get(3)?,
                unique_artists: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut daily = Vec::new();
    for row in rows.flatten() {
        daily.push(row);
    }

    let snapshot = ListenSnapshot { global, daily };
    serde_json::to_string(&snapshot).map_err(|e| e.to_string())
}

/// 把云端快照并回本机。
///
/// 事务是手写 BEGIN IMMEDIATE 而不是 rusqlite 的 transaction()，
/// 因为中间要按结果分支决定提交还是回滚，用闭包包起来反而绕。
#[tauri::command]
pub fn merge_listen_snapshot(
    db: State<DbState>,
    snapshot_json: String,
    mode: String,
) -> Result<ListenSnapshotMergeResult, String> {
    let snapshot: ListenSnapshot =
        serde_json::from_str(&snapshot_json).map_err(|e| format!("快照解析失败: {e}"))?;

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| e.to_string())?;

    let result = (|| -> Result<ListenSnapshotMergeResult, String> {
        conn.execute(
            "INSERT INTO global_stats (id, total_play_count, total_play_time_ms) VALUES (1, 0, 0) \
             ON CONFLICT(id) DO NOTHING",
            [],
        )
        .map_err(|e| e.to_string())?;

        let local_global = read_local_global(&conn)?;
        let additive = mode == "add";

        let new_count = combine_scalar(
            local_global.total_play_count,
            snapshot.global.total_play_count,
            additive,
        );
        let new_total_ms = combine_scalar(
            local_global.total_play_time_ms,
            snapshot.global.total_play_time_ms,
            additive,
        );
        let new_first = earlier_iso(
            &local_global.first_played_at,
            &snapshot.global.first_played_at,
        );
        let new_last = later_iso(&local_global.last_played_at, &snapshot.global.last_played_at);

        conn.execute(
            "UPDATE global_stats
             SET total_play_count = ?,
                 total_play_time_ms = ?,
                 first_played_at = ?,
                 last_played_at = ?
             WHERE id = 1",
            rusqlite::params![new_count, new_total_ms, new_first, new_last],
        )
        .map_err(|e| e.to_string())?;

        for day in &snapshot.daily {
            let existing = conn.query_row(
                "SELECT play_count, play_time_ms, unique_songs, unique_artists
                 FROM daily_stats WHERE date = ?1",
                [&day.date],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            );

            match existing {
                Ok((ecount, etime, esongs, eartists)) => {
                    let next = (
                        combine_scalar(ecount, day.play_count, additive),
                        combine_scalar(etime, day.play_time_ms, additive),
                        esongs.max(day.unique_songs),
                        eartists.max(day.unique_artists),
                    );
                    conn.execute(
                        "UPDATE daily_stats
                         SET play_count = ?, play_time_ms = ?, unique_songs = ?, unique_artists = ?
                         WHERE date = ?",
                        rusqlite::params![next.0, next.1, next.2, next.3, day.date],
                    )
                    .map_err(|e| e.to_string())?;
                }
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    conn.execute(
                        "INSERT INTO daily_stats
                         (date, play_count, play_time_ms, unique_songs, unique_artists)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        rusqlite::params![
                            day.date,
                            day.play_count,
                            day.play_time_ms,
                            day.unique_songs,
                            day.unique_artists
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                }
                Err(e) => return Err(e.to_string()),
            }
        }

        let merged_global = read_local_global(&conn)?;
        Ok(ListenSnapshotMergeResult {
            total_play_time_ms: merged_global.total_play_time_ms,
            total_play_count: merged_global.total_play_count,
        })
    })();

    if result.is_ok() {
        conn.execute("COMMIT", []).ok();
    } else {
        conn.execute("ROLLBACK", []).ok();
    }
    result
}

/// 清空全局汇总与全部每日明细，不动播放历史。
#[tauri::command]
pub fn clear_listen_stats(db: State<DbState>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE global_stats
         SET total_play_count = 0, total_play_time_ms = 0, first_played_at = NULL, last_played_at = NULL
         WHERE id = 1",
        [],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM daily_stats", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod cloud_duration_tests {
    use super::*;

    /// 云端时长只在比本机长的时候覆盖，短了或者负数都不动。
    #[test]
    fn cloud_duration_takes_max_of_local_and_remote() {
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory database");
        crate::database::ensure_base_schema(&conn).expect("create schema");

        let r1 = apply_cloud_listen_duration(&conn, 3600).expect("merge initial");
        assert!(r1.merged);
        assert_eq!(r1.total_duration, 3600);

        let r2 = apply_cloud_listen_duration(&conn, 7200).expect("cloud longer");
        assert!(r2.merged);
        assert_eq!(r2.total_duration, 7200);

        let r3 = apply_cloud_listen_duration(&conn, 100).expect("cloud shorter");
        assert!(!r3.merged);
        assert_eq!(r3.total_duration, 7200);

        let r4 = apply_cloud_listen_duration(&conn, -5).expect("negative cloud");
        assert!(!r4.merged);
        assert_eq!(r4.total_duration, 7200);
    }
}
