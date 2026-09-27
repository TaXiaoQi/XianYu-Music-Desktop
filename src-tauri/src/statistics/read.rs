//! 聚合表的查询侧。
//!
//! 这一层只负责把表里的行读出来装进快照结构，不做二次加工，保证导出
//! 文件与界面看到的是同一份口径。聚合表尚未回填时本来就是空的，此时
//! 返回合理的零值即可，没必要报错。

use rusqlite::{Connection, OptionalExtension as _};

use super::portable::{
    PortableDailyStats, PortableGlobalStats, PortableHourlyStats, PortableRecentPlay,
    PortableSongIdentity, PortableSongStats, PortableSongStatsEntry,
};
use super::support::{int_cell, text_cell, RECENT_PLAY_CAP};

/// 全局汇总只有 id = 1 这一行。
const GLOBAL_READ_SQL: &str = "SELECT total_play_count, total_play_time_ms, first_played_at, last_played_at
         FROM global_stats
         WHERE id = 1";

/// 单曲汇总的读取顺序：先按次数、再按时长，最后按标题字典序。
const SONG_READ_SQL: &str = "SELECT title, artist, album, duration_ms, track_number,
                    play_count, play_time_ms, full_play_count, skip_count, first_played_at, last_played_at
             FROM song_stats
             ORDER BY play_count DESC, play_time_ms DESC, title COLLATE NOCASE ASC";

/// 单日汇总按日期从早到晚读出。
const DAILY_READ_SQL: &str = "SELECT date, play_count, play_time_ms, unique_songs, unique_artists
             FROM daily_stats
             ORDER BY date ASC";

/// 小时分布的原始行，缺的小时由调用方补零。
const HOURLY_READ_SQL: &str = "SELECT hour, play_count, play_time_ms FROM hourly_stats";

/// 最近播放按时间倒序取最新一批。
const RECENT_READ_SQL: &str = "SELECT played_at, title, artist, album, duration_ms, listened_ms, is_full_play, is_skip
             FROM recent_plays
             ORDER BY played_at DESC, id DESC
             LIMIT ?1";

/// rusqlite 的错误统一压成字符串。
fn db_err(err: rusqlite::Error) -> String {
    err.to_string()
}

/// 读全局汇总；表里还没有行时给一份全零结果。
pub(crate) fn query_global_stats(conn: &Connection) -> Result<PortableGlobalStats, String> {
    let stored = conn
        .query_row(GLOBAL_READ_SQL, [], |r| {
            Ok(PortableGlobalStats {
                total_play_count: int_cell(r, 0)?,
                total_play_time_ms: int_cell(r, 1)?,
                first_played_at: r.get(2)?,
                last_played_at: r.get(3)?,
            })
        })
        .optional().map_err(db_err)?;

    Ok(stored.unwrap_or(PortableGlobalStats {
        total_play_count: 0, total_play_time_ms: 0, first_played_at: None, last_played_at: None,
    }))
}

/// 读单曲汇总，排序已经交给 SQL 完成。
pub(crate) fn query_song_stats(conn: &Connection) -> Result<Vec<PortableSongStatsEntry>, String> {
    let mut stmt = conn.prepare(SONG_READ_SQL).map_err(db_err)?;

    let rows = stmt.query_map([], |r| {
        let identity = PortableSongIdentity {
            title: text_cell(r, 0)?,
            artist: text_cell(r, 1)?,
            album: text_cell(r, 2)?,
            duration_ms: int_cell(r, 3)?,
            track_number: r.get(4)?,
        };
        let tally = PortableSongStats {
            play_count: int_cell(r, 5)?,
            play_time_ms: int_cell(r, 6)?,
            full_play_count: int_cell(r, 7)?,
            skip_count: int_cell(r, 8)?,
            first_played_at: r.get(9)?,
            last_played_at: r.get(10)?,
        };
        Ok(PortableSongStatsEntry { song_identity: identity, song_stats: tally })
    }).map_err(db_err)?;

    Ok(rows.filter_map(|item| item.ok()).collect())
}

/// 读单日汇总，按日期升序。
pub(crate) fn query_daily_stats(conn: &Connection) -> Result<Vec<PortableDailyStats>, String> {
    let mut stmt = conn.prepare(DAILY_READ_SQL).map_err(db_err)?;

    let rows = stmt.query_map([], |r| {
        Ok(PortableDailyStats {
            date: r.get(0)?,
            play_count: int_cell(r, 1)?,
            play_time_ms: int_cell(r, 2)?,
            unique_songs: int_cell(r, 3)?,
            unique_artists: int_cell(r, 4)?,
        })
    }).map_err(db_err)?;

    Ok(rows.filter_map(|item| item.ok()).collect())
}

/// 读小时分布。先把 24 个格子铺满零值，再用库里的行覆盖对应位置，
/// 这样前端画柱状图时不会缺柱。
pub(crate) fn query_hourly_stats(conn: &Connection) -> Result<Vec<PortableHourlyStats>, String> {
    let mut grid: Vec<PortableHourlyStats> = (0..24)
        .map(|hour| PortableHourlyStats { hour: hour as i64, play_count: 0, play_time_ms: 0 })
        .collect();

    let mut stmt = conn.prepare(HOURLY_READ_SQL).map_err(db_err)?;

    let rows = stmt
        .query_map([], |r| Ok((int_cell(r, 0)?, int_cell(r, 1)?, int_cell(r, 2)?)))
        .map_err(db_err)?;

    for (hour, plays, listened) in rows.flatten() {
        if let Some(slot) = grid.get_mut(hour as usize) {
            slot.play_count = plays;
            slot.play_time_ms = listened;
        }
    }

    Ok(grid)
}

/// 读最近播放，最多取容量上限条，时间最近的排前面。
pub(crate) fn query_recent_plays(conn: &Connection) -> Result<Vec<PortableRecentPlay>, String> {
    let mut stmt = conn.prepare(RECENT_READ_SQL).map_err(db_err)?;

    let rows = stmt.query_map([RECENT_PLAY_CAP], |r| {
        Ok(PortableRecentPlay {
            played_at: r.get(0)?,
            title: text_cell(r, 1)?,
            artist: text_cell(r, 2)?,
            album: text_cell(r, 3)?,
            duration_ms: int_cell(r, 4)?,
            listened_ms: int_cell(r, 5)?,
            is_full_play: int_cell(r, 6)? > 0,
            is_skip: int_cell(r, 7)? > 0,
        })
    }).map_err(db_err)?;

    Ok(rows.filter_map(|item| item.ok()).collect())
}
