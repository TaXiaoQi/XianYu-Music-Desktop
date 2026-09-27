//! 听歌行为统计的查询口。
//!
//! 取数有两条路：时间范围选「全部」时读聚合表，能拿到完整播放 / 切歌
//! 这类只有聚合表才有的维度；选了具体天数或本年度时，直接对
//! play_history 按 played_at 过滤时间窗做 SQL 聚合。两条路对外的字段
//! 完全一致，但内部口径不同，例如「按播放时长排行」在非「全部」模式下
//! play_count 一律填 0。

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::database::DbState;

use super::matching::{build_library_match_index, match_song_identity, SongMatchTable};
use super::portable::PortableSongStatsEntry;
use super::read::{query_global_stats, query_hourly_stats, query_song_stats};
use super::support::{current_unix_secs, error_text, int_cell, is_meaningless_name};
use super::write::ensure_statistics_aggregates;

/// 各榜单统一收前五条。
const BOARD_SIZE: usize = 5;

/// 界面上的时间范围选择。All 读聚合表，其余按时间窗过滤播放流水。
#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
pub enum TimeRange { All, Days7, Days30, ThisYear }

impl TimeRange {
    /// 时间窗下界的 Unix 秒；All 表示不设下界。
    fn window_floor(&self) -> Option<i64> {
        let now = current_unix_secs();
        const DAY_SECS: i64 = 24 * 60 * 60;

        match self {
            Self::All => None,
            Self::Days7 => Some(now - 7 * DAY_SECS),
            Self::Days30 => Some(now - 30 * DAY_SECS),
            Self::ThisYear => Some(now - 365 * DAY_SECS),
        }
    }
}

#[derive(Serialize)]
pub struct BehaviorStats {
    pub total_plays: i64,
    pub total_duration: i64,
    pub top_songs: Vec<TopSong>,
    pub top_songs_by_duration: Vec<TopSong>,
    pub top_artists: Vec<TopArtist>,
    pub top_albums: Vec<TopAlbum>,
    pub hour_distribution: Vec<i64>,
    pub recent_activity: Vec<i64>,
}

/// 排行里的一首歌。value 的含义随榜单变化：次数榜存播放次数，时长榜存秒数。
#[derive(Serialize)]
pub struct TopSong {
    pub song_path: String,
    pub play_count: i64,
    pub value: i64,
}

#[derive(Serialize)]
pub struct TopArtist {
    pub artist: String,
    pub play_count: i64,
}

#[derive(Serialize)]
pub struct TopAlbum {
    pub album: String,
    pub play_count: i64,
}

/// 今日 / 近七日 / 累计的收听时长，单位秒。
#[derive(Serialize)]
pub struct ListenDurations {
    pub daily: i64,
    pub weekly: i64,
    pub total: i64,
}

/// 单值查询：空表或出错时一律按 0 处理，不向上传播。
fn read_scalar(conn: &rusqlite::Connection, statement: &str) -> i64 {
    conn.query_row(statement, [], |cell| cell.get(0)).unwrap_or(0)
}

/// 执行逐行映射查询并收集成 Vec；单行映射失败时静默跳过该行。
fn collect_rows<T>(
    conn: &rusqlite::Connection,
    statement: &str,
    map_row: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>, String> {
    let mut stmt = conn.prepare(statement).map_err(error_text)?;
    let rows = stmt.query_map([], map_row).map_err(error_text)?;
    Ok(rows.flatten().collect())
}

/// 把 (名字, 次数) 池子按次数降序、同次数按名字忽略大小写升序排好，再截断。
fn pick_board_entries(mut pool: Vec<(String, i64)>, board_size: usize) -> Vec<(String, i64)> {
    pool.sort_by(|(left_name, left_plays), (right_name, right_plays)| {
        right_plays
            .cmp(left_plays)
            .then_with(|| left_name.to_lowercase().cmp(&right_name.to_lowercase()))
    });
    pool.truncate(board_size);
    pool
}

/// 从歌曲统计里挑榜单：按给定条件过滤、经匹配表换回本地路径并去重，
/// 攒满 board_size 条为止；匹配不上或路径重复的条目直接跳过，
/// 因此榜单可能不足额。
fn fill_song_board(
    entries: &[PortableSongStatsEntry],
    match_table: &SongMatchTable,
    claimed: &mut HashSet<String>,
    qualifies: impl Fn(&PortableSongStatsEntry) -> bool,
    score_of: impl Fn(&PortableSongStatsEntry) -> i64,
) -> Vec<TopSong> {
    let mut board: Vec<TopSong> = Vec::new();
    for entry in entries {
        if board.len() == BOARD_SIZE { break; }
        if !qualifies(entry) { continue; }
        let Some(hit) = match_song_identity(match_table, &entry.song_identity) else { continue; };
        if !claimed.insert(hit.path.clone()) { continue; }
        board.push(TopSong { song_path: hit.path, play_count: entry.song_stats.play_count, value: score_of(entry) });
    }
    board
}

/// 从聚合表算出完整的行为统计（时间范围选「全部」的路径）。
fn behavior_from_aggregates(conn: &rusqlite::Connection) -> Result<BehaviorStats, String> {
    ensure_statistics_aggregates(conn)?;

    let totals = query_global_stats(conn)?;
    let song_entries = query_song_stats(conn)?;
    let match_table = build_library_match_index(conn)?;

    // 播放次数榜：只收确有播放记录的条目。
    let mut claimed_paths = HashSet::new();
    let plays_board = fill_song_board(
        &song_entries,
        &match_table,
        &mut claimed_paths,
        |entry| entry.song_stats.play_count > 0,
        |entry| entry.song_stats.play_count,
    );

    // 累计时长榜：先按时长降序排（时长相同再比次数），再走同一套挑选逻辑。
    let mut ranked_by_time = song_entries.clone();
    ranked_by_time.sort_by(|first, second| {
        let primary = second.song_stats.play_time_ms.cmp(&first.song_stats.play_time_ms);
        primary.then_with(|| second.song_stats.play_count.cmp(&first.song_stats.play_count))
    });

    let mut claimed_time_paths = HashSet::new();
    let minutes_board = fill_song_board(
        &ranked_by_time,
        &match_table,
        &mut claimed_time_paths,
        |entry| entry.song_stats.play_time_ms > 0,
        |entry| entry.song_stats.play_time_ms / 1000,
    );

    // 歌手 / 专辑各自把播放次数累加起来；未知占位名不参与。
    let mut artist_tally: HashMap<String, i64> = HashMap::new();
    let mut album_tally: HashMap<String, i64> = HashMap::new();
    for entry in &song_entries {
        let earned = entry.song_stats.play_count;
        if !is_meaningless_name(&entry.song_identity.artist) {
            *artist_tally.entry(entry.song_identity.artist.clone()).or_insert(0) += earned;
        }
        if !is_meaningless_name(&entry.song_identity.album) {
            *album_tally.entry(entry.song_identity.album.clone()).or_insert(0) += earned;
        }
    }

    let artists_board = pick_board_entries(artist_tally.into_iter().collect(), BOARD_SIZE)
        .into_iter()
        .map(|(name, plays)| TopArtist { artist: name, play_count: plays })
        .collect();
    let albums_board = pick_board_entries(album_tally.into_iter().collect(), BOARD_SIZE)
        .into_iter()
        .map(|(name, plays)| TopAlbum { album: name, play_count: plays })
        .collect();

    // 小时分布：先铺满 24 格，再用聚合值覆盖对应小时。
    let mut hour_slots = vec![0_i64; 24];
    for bucket in query_hourly_stats(conn)? {
        let slot = bucket.hour as usize;
        if slot < hour_slots.len() {
            hour_slots[slot] = bucket.play_count;
        }
    }

    // 近七天：以本地今天为锚点向前推六天，索引 0 是六天前。
    let mut recent_days = vec![0_i64; 7];
    let mut day_stmt = conn
        .prepare(
            "SELECT CAST(julianday(date) - julianday(date('now', 'localtime')) AS INTEGER) AS day_offset,
                    play_time_ms
             FROM daily_stats
             WHERE date >= date('now', 'localtime', '-6 day')",
        )
        .map_err(error_text)?;
    let day_rows = day_stmt
        .query_map([], |record| {
            let offset = int_cell(record, 0)?;
            let spent = int_cell(record, 1)?;
            Ok((offset, spent))
        })
        .map_err(error_text)?;
    for (day_shift, millis) in day_rows.flatten() {
        let slot = (day_shift + 6) as usize;
        if slot < recent_days.len() {
            recent_days[slot] = millis / 1000;
        }
    }

    Ok(BehaviorStats {
        total_plays: totals.total_play_count,
        total_duration: totals.total_play_time_ms / 1000,
        top_songs: plays_board,
        top_songs_by_duration: minutes_board,
        top_artists: artists_board,
        top_albums: albums_board,
        hour_distribution: hour_slots,
        recent_activity: recent_days,
    })
}

/// 行为统计入口：All 走聚合表，其余对 play_history 做窗口内聚合。
#[tauri::command]
pub fn get_behavior_stats(db: State<DbState>, time_range: TimeRange) -> Result<BehaviorStats, String> {
    let conn = db.conn.lock().map_err(error_text)?;

    if let TimeRange::All = time_range {
        return behavior_from_aggregates(&conn);
    }

    let join_clause = "FROM play_history ph INNER JOIN songs s ON ph.song_id = s.id";
    let time_condition = time_range
        .window_floor()
        .map(|floor| format!("AND ph.played_at >= {}", floor))
        .unwrap_or_default();

    // 两个总量指标：播放次数与播放总时长（含切歌时长）。
    let play_events: i64 = read_scalar(
        &conn,
        &format!(
            "SELECT COUNT(*) {} WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {}",
            join_clause, time_condition
        ),
    );
    let play_seconds: i64 = read_scalar(
        &conn,
        &format!(
            "SELECT COALESCE(SUM(ph.played_seconds), 0) {} WHERE ph.event IN ('play', 'play_time') AND ph.song_id IS NOT NULL {}",
            join_clause, time_condition
        ),
    );

    // 次数榜前五。
    let plays_board: Vec<TopSong> = collect_rows(
        &conn,
        &format!(
            "SELECT s.path, COUNT(*) as cnt 
         {} 
         WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {} 
         GROUP BY ph.song_id 
         ORDER BY cnt DESC 
         LIMIT 5",
            join_clause, time_condition
        ),
        |record| {
            let hits: i64 = record.get(1)?;
            Ok(TopSong { song_path: record.get(0)?, play_count: hits, value: hits })
        },
    )?;

    // 时长榜前五：value 为秒数，play_count 固定 0。
    let duration_board: Vec<TopSong> = collect_rows(
        &conn,
        &format!(
            "SELECT s.path, COALESCE(SUM(ph.played_seconds), 0) as duration 
         {} 
         WHERE ph.event IN ('play', 'play_time') AND ph.song_id IS NOT NULL {}
         GROUP BY ph.song_id 
         ORDER BY duration DESC 
         LIMIT 5",
            join_clause, time_condition
        ),
        |record| {
            Ok(TopSong { song_path: record.get(0)?, play_count: 0, value: record.get(1)? })
        },
    )?;

    // 各小时播放次数分布。
    let mut hour_slots = vec![0_i64; 24];
    for (hour, plays) in collect_rows(
        &conn,
        &format!(
            "SELECT CAST(strftime('%H', ph.played_at, 'unixepoch', 'localtime') AS INTEGER) as hour, 
                COUNT(*) as cnt 
         {} 
         WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {} 
         GROUP BY hour",
            join_clause, time_condition
        ),
        |record| Ok((record.get::<_, i64>(0)?, record.get::<_, i64>(1)?)),
    )? {
        if let Some(cell) = hour_slots.get_mut(hour as usize) {
            *cell = plays;
        }
    }

    // 歌手榜 / 专辑榜：SQL 侧先按 trim 后的名字过滤并分组。
    let artist_board: Vec<TopArtist> = collect_rows(
        &conn,
        &format!(
            "SELECT TRIM(s.artist) as artist, COUNT(*) as cnt 
         {} 
         WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {} 
           AND s.artist IS NOT NULL 
           AND TRIM(s.artist) != '' 
           AND LOWER(TRIM(s.artist)) NOT IN ('未知', '未知歌手', 'unknown', 'unknown artist') 
         GROUP BY TRIM(s.artist) 
         ORDER BY cnt DESC 
         LIMIT 5",
            join_clause, time_condition
        ),
        |record| {
            Ok(TopArtist { artist: record.get(0)?, play_count: record.get(1)? })
        },
    )?;

    let album_board: Vec<TopAlbum> = collect_rows(
        &conn,
        &format!(
            "SELECT TRIM(s.album) as album, COUNT(*) as cnt 
         {} 
         WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {} 
           AND s.album IS NOT NULL 
           AND TRIM(s.album) != '' 
           AND LOWER(TRIM(s.album)) NOT IN ('未知', '未知专辑', 'unknown', 'unknown album') 
         GROUP BY TRIM(s.album) 
         ORDER BY cnt DESC 
         LIMIT 5",
            join_clause, time_condition
        ),
        |record| {
            Ok(TopAlbum { album: record.get(0)?, play_count: record.get(1)? })
        },
    )?;

    // 近七天趋势：始终按「当前时刻往前推七天」的滑动窗口计算，供界面展示。
    let mut recent_days = vec![0_i64; 7];
    {
        let day_seconds = 24 * 60 * 60;
        let window_start = current_unix_secs() - 7 * day_seconds;

        for (day_shift, seconds) in collect_rows(
            &conn,
            &format!(
                "SELECT CAST((ph.played_at - {}) / {} AS INTEGER) as day_offset, 
                    COALESCE(SUM(ph.played_seconds), 0) as duration 
             FROM play_history ph 
             INNER JOIN songs s ON ph.song_id = s.id 
             WHERE ph.played_at >= {} AND ph.event IN ('play', 'play_time') AND ph.song_id IS NOT NULL
             GROUP BY day_offset",
                window_start, day_seconds, window_start
            ),
            |record| Ok((record.get::<_, i64>(0)?, record.get::<_, i64>(1)?)),
        )? {
            let slot = day_shift as usize;
            if slot < recent_days.len() {
                recent_days[slot] = seconds;
            }
        }
    }

    Ok(BehaviorStats {
        total_plays: play_events,
        total_duration: play_seconds,
        top_songs: plays_board,
        top_songs_by_duration: duration_board,
        top_artists: artist_board,
        top_albums: album_board,
        hour_distribution: hour_slots,
        recent_activity: recent_days,
    })
}

/// 今日 / 近七日 / 累计的收听时长，单位秒。直接读聚合表，
/// 没有数据的字段一律为 0。
#[tauri::command]
pub fn get_listen_durations(db: State<DbState>) -> Result<ListenDurations, String> {
    let conn = db.conn.lock().map_err(error_text)?;

    let today_ms: i64 = read_scalar(
        &conn,
        "SELECT COALESCE(play_time_ms, 0) FROM daily_stats
             WHERE date = strftime('%Y-%m-%d', 'now', 'localtime')",
    );
    let week_ms: i64 = read_scalar(
        &conn,
        "SELECT COALESCE(SUM(play_time_ms), 0) FROM daily_stats
             WHERE date >= strftime('%Y-%m-%d', 'now', 'localtime', '-6 days')",
    );
    let all_ms: i64 = read_scalar(
        &conn,
        "SELECT COALESCE(total_play_time_ms, 0) FROM global_stats WHERE id = 1",
    );

    Ok(ListenDurations {
        daily: today_ms / 1000,
        weekly: week_ms / 1000,
        total: all_ms / 1000,
    })
}
