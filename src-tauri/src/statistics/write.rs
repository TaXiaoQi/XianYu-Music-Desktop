//! 聚合层的落库实现。
//!
//! 一次收听先作为原始事件写进 play_history，随后在这里被折算进
//! global / song / daily / hourly 四张汇总表。所有汇总都走"冲突时累加
//! （或取极值）"的 upsert，所以同一批数据重复合入只会继续累加，不会把
//! 已有结果覆盖坏。
//!
//! 除了逐条写入，这里还做两件事：把 play_history 整体重放来重建全部聚合
//! 结果（删歌、清空统计之后用到），以及 record_play 命令本身。

use rusqlite::{params, Connection, OptionalExtension as _};
use tauri::State;

use crate::database::DbState;
use crate::music::utils::normalize_path;

use super::portable::{
    PortableDailyStats, PortableGlobalStats, PortableHourlyStats, PortableRecentPlay,
    PortableSongIdentity, PortableSongStats, RecordPlayPayload,
};
use super::support::{
    build_song_identity, classify_playback, collapse_identity_text, current_unix_secs,
    full_match_key, int_cell, local_calendar_date, local_clock_hour, rfc3339_from_unix_secs,
    recent_entry_dedupe_key, text_cell, track_number_from_raw, RECENT_PLAY_CAP,
};

/// statistics_meta 里标记"聚合表已按全量历史回填"的键名。
const BACKFILL_FLAG_KEY: &str = "aggregates_backfilled";

/// 上述标记取该值时表示回填已经完成。
const BACKFILL_FLAG_ON: &str = "1";

/// 清空聚合结果时需要逐一清掉的表。
const AGGREGATE_TABLES: [&str; 7] = [
    "global_stats",
    "song_stats",
    "daily_stats",
    "hourly_stats",
    "daily_unique_song_entries",
    "daily_unique_artist_entries",
    "recent_plays",
];

/// 按主键读 statistics_meta 的开关值。
const META_READ_SQL: &str = "SELECT value FROM statistics_meta WHERE key = ?1";

/// 开关值的写入模板：键已存在时改写原值。
const META_UPSERT_SQL: &str = "INSERT INTO statistics_meta (key, value)
         VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value";

/// 全局汇总的累加模板：次数、时长做加法，首尾时间各取更早 / 更晚一端。
const GLOBAL_UPSERT_SQL: &str = "INSERT INTO global_stats (id, total_play_count, total_play_time_ms, first_played_at, last_played_at)
         VALUES (1, ?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           total_play_count = global_stats.total_play_count + excluded.total_play_count,
           total_play_time_ms = global_stats.total_play_time_ms + excluded.total_play_time_ms,
           first_played_at = CASE
             WHEN global_stats.first_played_at IS NULL THEN excluded.first_played_at
             WHEN excluded.first_played_at IS NULL THEN global_stats.first_played_at
             WHEN excluded.first_played_at < global_stats.first_played_at THEN excluded.first_played_at
             ELSE global_stats.first_played_at
           END,
           last_played_at = CASE
             WHEN global_stats.last_played_at IS NULL THEN excluded.last_played_at
             WHEN excluded.last_played_at IS NULL THEN global_stats.last_played_at
             WHEN excluded.last_played_at > global_stats.last_played_at THEN excluded.last_played_at
             ELSE global_stats.last_played_at
           END";

/// 单曲汇总的累加模板，冲突判定用最严格的身份键。
const SONG_UPSERT_SQL: &str = "INSERT INTO song_stats (
            strict_identity_key, title, artist, album, duration_ms, track_number,
            play_count, play_time_ms, full_play_count, skip_count, first_played_at, last_played_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(strict_identity_key) DO UPDATE SET
            title = excluded.title,
            artist = excluded.artist,
            album = excluded.album,
            duration_ms = excluded.duration_ms,
            track_number = excluded.track_number,
            play_count = song_stats.play_count + excluded.play_count,
            play_time_ms = song_stats.play_time_ms + excluded.play_time_ms,
            full_play_count = song_stats.full_play_count + excluded.full_play_count,
            skip_count = song_stats.skip_count + excluded.skip_count,
            first_played_at = CASE
              WHEN song_stats.first_played_at IS NULL THEN excluded.first_played_at
              WHEN excluded.first_played_at IS NULL THEN song_stats.first_played_at
              WHEN excluded.first_played_at < song_stats.first_played_at THEN excluded.first_played_at
              ELSE song_stats.first_played_at
            END,
            last_played_at = CASE
              WHEN song_stats.last_played_at IS NULL THEN excluded.last_played_at
              WHEN excluded.last_played_at IS NULL THEN song_stats.last_played_at
              WHEN excluded.last_played_at > song_stats.last_played_at THEN excluded.last_played_at
              ELSE song_stats.last_played_at
            END";

/// 单日汇总的累加模板；两个去重数不是可加量，取两边较大者。
const DAILY_UPSERT_SQL: &str = "INSERT INTO daily_stats (date, play_count, play_time_ms, unique_songs, unique_artists)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(date) DO UPDATE SET
            play_count = daily_stats.play_count + excluded.play_count,
            play_time_ms = daily_stats.play_time_ms + excluded.play_time_ms,
            unique_songs = MAX(daily_stats.unique_songs, excluded.unique_songs),
            unique_artists = MAX(daily_stats.unique_artists, excluded.unique_artists)";

/// 单小时汇总的累加模板。
const HOURLY_UPSERT_SQL: &str = "INSERT INTO hourly_stats (hour, play_count, play_time_ms)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(hour) DO UPDATE SET
            play_count = hourly_stats.play_count + excluded.play_count,
            play_time_ms = hourly_stats.play_time_ms + excluded.play_time_ms";

/// 只保留最近播放里最新的一批行，其余删除。
const PRUNE_RECENT_SQL: &str = "DELETE FROM recent_plays
         WHERE id NOT IN (
           SELECT id FROM recent_plays ORDER BY played_at DESC, id DESC LIMIT ?1
         )";

/// 最近播放的新增模板，键撞车时静默放弃这一行。
const RECENT_INSERT_SQL: &str = "INSERT OR IGNORE INTO recent_plays (
                recent_dedupe_key, played_at, title, artist, album, duration_ms, listened_ms, is_full_play, is_skip
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)";

/// 登记某首歌当天首次出现的去重行。
const DAY_SONG_ENTRY_SQL: &str = "INSERT OR IGNORE INTO daily_unique_song_entries (date, song_identity_key) VALUES (?1, ?2)";

/// 登记某位歌手当天首次出现的去重行。
const DAY_ARTIST_ENTRY_SQL: &str = "INSERT OR IGNORE INTO daily_unique_artist_entries (date, artist_key) VALUES (?1, ?2)";

/// 重放历史事件时的读取模板：按时间先后取出全部播放 / 时长事件，
/// 左联曲库补齐元信息。
const REPLAY_EVENTS_SQL: &str = "SELECT ph.song_path, s.title, s.artist, s.album, s.duration, s.track_number, ph.played_at, ph.played_seconds, ph.event
                 FROM play_history ph
                 LEFT JOIN songs s ON ph.song_id = s.id
                 WHERE ph.event IN ('play', 'play_time')
                 ORDER BY ph.played_at ASC, ph.id ASC";

/// record_play 里查找歌曲主键的模板。
const SONG_ID_LOOKUP_SQL: &str = "SELECT id FROM songs WHERE path = ?1";

/// record_play 里落一条原始事件的模板。
const HISTORY_INSERT_SQL: &str = "INSERT INTO play_history (song_path, song_id, played_at, played_seconds, event) VALUES (?1, ?2, ?3, ?4, ?5)";

/// rusqlite 的错误统一压成字符串，方便在 Result<_, String> 里传递。
fn db_err(err: rusqlite::Error) -> String {
    err.to_string()
}

/// 执行一条写语句，返回受影响行数。
fn exec_write(conn: &Connection, sql: &str, args: impl rusqlite::Params) -> Result<usize, String> {
    conn.execute(sql, args).map_err(db_err)
}

/// 读 statistics_meta 里的一个开关值。
pub(crate) fn get_statistics_meta(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(META_READ_SQL, params![key], |r| r.get(0))
        .optional().map_err(db_err)
}

/// 往 statistics_meta 写一个开关值，键已存在时覆盖旧值。
pub(crate) fn set_statistics_meta(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    exec_write(conn, META_UPSERT_SQL, params![key, value])?;
    Ok(())
}

/// 清空全部聚合结果：四张汇总表、两张当日去重表，外加最近播放。
pub(crate) fn clear_aggregate_statistics(conn: &Connection) -> Result<(), String> {
    for table in AGGREGATE_TABLES {
        exec_write(conn, &format!("DELETE FROM {table}"), [])?;
    }
    Ok(())
}

/// 全局汇总累加：次数与时长直接相加，首尾时间各取更早 / 更晚的一端。
pub(crate) fn merge_global_stats(conn: &Connection, global: &PortableGlobalStats) -> Result<(), String> {
    let totals = global;
    exec_write(conn, GLOBAL_UPSERT_SQL, params![
        totals.total_play_count,
        totals.total_play_time_ms,
        totals.first_played_at,
        totals.last_played_at,
    ])?;
    Ok(())
}

/// 单曲汇总累加，按最严格的身份键判冲突。标题等展示信息以新值为准，
/// 四个计数各自累加，首尾时间取极值。
pub(crate) fn upsert_song_stats(
    conn: &Connection, identity: &PortableSongIdentity, stats: &PortableSongStats,
) -> Result<(), String> {
    let song = identity;
    let tally = stats;
    exec_write(conn, SONG_UPSERT_SQL, params![
        full_match_key(song),
        song.title,
        song.artist,
        song.album,
        song.duration_ms,
        song.track_number,
        tally.play_count,
        tally.play_time_ms,
        tally.full_play_count,
        tally.skip_count,
        tally.first_played_at,
        tally.last_played_at,
    ])?;
    Ok(())
}

/// 单日汇总累加。次数与时长相加，去重数取两边较大者（不可加量）。
pub(crate) fn upsert_daily_stats(conn: &Connection, daily: &PortableDailyStats) -> Result<(), String> {
    let day_row = daily;
    exec_write(conn, DAILY_UPSERT_SQL, params![
        day_row.date,
        day_row.play_count,
        day_row.play_time_ms,
        day_row.unique_songs,
        day_row.unique_artists,
    ])?;
    Ok(())
}

/// 单小时汇总累加。
pub(crate) fn upsert_hourly_stats(conn: &Connection, hourly: &PortableHourlyStats) -> Result<(), String> {
    let hour_row = hourly;
    exec_write(conn, HOURLY_UPSERT_SQL, params![
        hour_row.hour,
        hour_row.play_count,
        hour_row.play_time_ms,
    ])?;
    Ok(())
}

/// 把最近播放裁回容量上限：按播放时刻倒序留下前 CAP 条，其余删除。
pub(crate) fn prune_recent_plays(conn: &Connection) -> Result<(), String> {
    exec_write(conn, PRUNE_RECENT_SQL, [RECENT_PLAY_CAP])?;
    Ok(())
}

/// 插入一条最近播放；去重键撞车时整条丢弃，返回是否真的落了行。
pub(crate) fn insert_recent_play(conn: &Connection, entry: &PortableRecentPlay) -> Result<bool, String> {
    let item = entry;
    let landed = exec_write(conn, RECENT_INSERT_SQL, params![
        recent_entry_dedupe_key(item),
        item.played_at,
        item.title,
        item.artist,
        item.album,
        item.duration_ms,
        item.listened_ms,
        if item.is_full_play { 1 } else { 0 },
        if item.is_skip { 1 } else { 0 },
    ])?;
    prune_recent_plays(conn)?;
    Ok(landed > 0)
}

/// 登记某一天出现过的歌曲 / 歌手，返回两者是否都属当日首次。
/// 歌手名为空时不参与去重。
pub(crate) fn record_unique_daily_entries(
    conn: &Connection, date: &str, identity: &PortableSongIdentity) -> Result<(bool, bool), String> {
    let song_is_new = exec_write(conn, DAY_SONG_ENTRY_SQL, params![date, full_match_key(identity)])? > 0;
    let artist_tag = collapse_identity_text(&identity.artist);
    let artist_is_new = !artist_tag.is_empty()
        && exec_write(conn, DAY_ARTIST_ENTRY_SQL, params![date, artist_tag])? > 0;
    Ok((song_is_new, artist_is_new))
}

/// 把一次收听摊进四张聚合表。
///
/// count_as_play 为假说明这只是定时上报的时长增量：时长照加，但次数、
/// 完整播放 / 切歌计数与最近播放都不动。
pub(crate) fn record_aggregate_play(
    conn: &Connection, identity: &PortableSongIdentity, played_at: i64, listened_ms: i64,
    is_full_play: bool, is_skip: bool, count_as_play: bool,
) -> Result<(), String> {
    let counted = i64::from(count_as_play);
    let heard_ms = listened_ms.max(0);
    let stamp = rfc3339_from_unix_secs(played_at)?;

    merge_global_stats(conn, &PortableGlobalStats {
        total_play_count: counted,
        total_play_time_ms: heard_ms,
        first_played_at: Some(stamp.clone()),
        last_played_at: Some(stamp.clone()),
    })?;

    upsert_song_stats(conn, identity, &PortableSongStats {
        play_count: counted,
        play_time_ms: heard_ms,
        full_play_count: i64::from(count_as_play && is_full_play),
        skip_count: i64::from(count_as_play && is_skip),
        first_played_at: Some(stamp.clone()),
        last_played_at: Some(stamp.clone()),
    })?;

    let day = local_calendar_date(conn, played_at)?;
    let (song_is_new, artist_is_new) = record_unique_daily_entries(conn, &day, identity)?;
    upsert_daily_stats(conn, &PortableDailyStats {
        date: day,
        play_count: counted,
        play_time_ms: heard_ms,
        unique_songs: i64::from(song_is_new),
        unique_artists: i64::from(artist_is_new),
    })?;

    upsert_hourly_stats(conn, &PortableHourlyStats {
        hour: local_clock_hour(conn, played_at)?,
        play_count: counted,
        play_time_ms: heard_ms,
    })?;

    if count_as_play {
        let (did_finish, did_skip) = (is_full_play, is_skip);
        let PortableSongIdentity { title, artist, album, duration_ms, .. } = identity;
        insert_recent_play(conn, &PortableRecentPlay {
            played_at: stamp,
            title: title.to_owned(),
            artist: artist.to_owned(),
            album: album.to_owned(),
            duration_ms: *duration_ms,
            listened_ms: heard_ms,
            is_full_play: did_finish,
            is_skip: did_skip,
        })?;
    }

    Ok(())
}

/// 把 play_history 里的事件按时间顺序重放一遍，喂给聚合表。
///
/// 曲库里已经删掉的歌在左联之下拿不到元信息，此时退回用路径兜底拼一个
/// 身份，保证这段收听时长不至于凭空消失。
fn replay_history_into_aggregates(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn.prepare(REPLAY_EVENTS_SQL).map_err(db_err)?;

    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                text_cell(r, 1)?,
                text_cell(r, 2)?,
                text_cell(r, 3)?,
                r.get::<_, Option<i64>>(4)?.unwrap_or_default(),
                r.get::<_, Option<String>>(5)?,
                r.get::<_, i64>(6)?,
                int_cell(r, 7)?,
                r.get::<_, String>(8)?,
            ))
        })
        .map_err(db_err)?;

    for event in rows.flatten() {
        let identity = build_song_identity(
            &event.1,
            &event.2,
            &event.3,
            event.4.max(0) * 1000,
            track_number_from_raw(event.5.as_deref()),
            Some(&event.0),
        );
        let heard_ms = event.7.max(0) * 1000;
        let counted_as_play = event.8 == "play";
        let (did_finish, did_skip) = if counted_as_play {
            classify_playback(heard_ms, identity.duration_ms)
        } else {
            (false, false)
        };
        record_aggregate_play(conn, &identity, event.6, heard_ms, did_finish, did_skip, counted_as_play)?;
    }

    Ok(())
}

/// 落一个"聚合表已经按全量历史回填过"的标记。
fn mark_aggregates_backfilled(conn: &Connection) -> Result<(), String> {
    set_statistics_meta(conn, BACKFILL_FLAG_KEY, BACKFILL_FLAG_ON)
}

/// 丢弃现有聚合结果，按 play_history 的时间顺序重算一遍。
///
/// play_history 是唯一的真相来源，删歌或清历史之后只要重放它就能得到
/// 一致的聚合结果。时长增量只累加时长，只有 play 事件才计一次播放。
pub(crate) fn rebuild_statistics_aggregates(conn: &Connection) -> Result<(), String> {
    clear_aggregate_statistics(conn)?;
    replay_history_into_aggregates(conn)?;
    mark_aggregates_backfilled(conn)
}

/// 老库没有聚合数据时，首次访问统计先补一次全量重算。
pub(crate) fn ensure_statistics_aggregates(conn: &Connection) -> Result<(), String> {
    let flag = get_statistics_meta(conn, BACKFILL_FLAG_KEY)?.unwrap_or_default();
    if flag == BACKFILL_FLAG_ON {
        return Ok(());
    }

    rebuild_statistics_aggregates(conn)
}

/// 前端上报一次收听。原始事件与聚合更新放进同一个事务，避免出现
/// "事件落了而汇总没落"的中间态。
#[tauri::command]
pub fn record_play(db: State<DbState>, payload: RecordPlayPayload) -> Result<(), String> {
    let mut guard = db.conn.lock().map_err(|err| err.to_string())?;
    let tx = guard.transaction().map_err(db_err)?;

    let key_path = normalize_path(&payload.song_path);
    let song_pk: Option<i64> = tx.query_row(SONG_ID_LOOKUP_SQL, params![&key_path], |r| r.get(0)).ok();

    let moment = current_unix_secs();
    // 毫秒折算成秒；负数（时钟异常）统一按 0 记。
    let seconds_listened = payload.listened_ms.max(0) / 1000;
    let count_as_play = payload.count_as_play.unwrap_or(true);
    let history_event = if count_as_play { "play" } else { "play_time" };

    exec_write(&tx, HISTORY_INSERT_SQL, params![&key_path, song_pk, moment, seconds_listened, history_event])?;

    let identity = build_song_identity(&payload.title, &payload.artist, &payload.album,
        payload.duration_ms, track_number_from_raw(payload.track_number.as_deref()),
        Some(&payload.song_path));
    let (did_finish, did_skip) = classify_playback(payload.listened_ms, payload.duration_ms);
    record_aggregate_play(&tx, &identity, moment, payload.listened_ms,
        did_finish, did_skip, count_as_play)?;

    tx.commit().map_err(db_err)
}

#[cfg(test)]
mod playback_count_tests {
    use super::*;

    /// 定时上报的时长增量不应该把播放次数也刷上去。
    #[test]
    fn periodic_time_flushes_only_increment_play_count_once() {
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory database");
        crate::database::ensure_base_schema(&conn).expect("create schema");
        let identity = PortableSongIdentity {
            title: "Demo".to_string(),
            artist: "Artist".to_string(),
            album: "Album".to_string(),
            duration_ms: 195_000,
            track_number: Some(1),
        };

        record_aggregate_play(&conn, &identity, 1_700_000_000, 30_000, false, false, true)
            .expect("record initial play chunk");
        for offset in 1..=12 {
            record_aggregate_play(
                &conn,
                &identity,
                1_700_000_000 + offset,
                30_000,
                false,
                false,
                false,
            )
            .expect("record time-only chunk");
        }

        let (play_count, play_time_ms): (i64, i64) = conn
            .query_row(
                "SELECT total_play_count, total_play_time_ms FROM global_stats WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read global stats");
        assert_eq!(play_count, 1);
        assert_eq!(play_time_ms, 390_000);

        let recent_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM recent_plays", [], |row| row.get(0))
            .expect("read recent plays");
        assert_eq!(recent_count, 1);
    }
}
