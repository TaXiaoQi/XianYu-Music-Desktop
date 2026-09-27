//! 曲库概览：总量、音质分布、格式分布。
//!
//! 三个查询都只扫 songs 表，不依赖任何聚合结果，因此统计尚未回填时
//! 也能立刻给出数字。音质与格式的归类规则放在 music::utils 里，
//! 这里只负责遍历与计数。

use serde::Serialize;
use tauri::State;

use crate::database::DbState;
use crate::music::utils::{format_distribution_bucket, is_lossless_audio};

use super::support::{
    current_unix_secs, error_text, int_cell, is_meaningless_name, loose_text, maybe_int,
    maybe_text, qualifies_as_hires,
};

/// 高码率有损（HQ）档的码率下限，单位 kbps。
const HIGH_BITRATE_FLOOR: i64 = 256;

/// 曲库规模概览。时长单位是秒，体积单位是字节。
#[derive(Serialize)]
pub struct LibraryStats {
    pub total_songs: i64,
    pub total_duration: i64,
    pub total_file_size: i64,
    pub album_count: i64,
    pub artist_count: i64,
    pub lossless_count: i64,
    pub hires_count: i64,
    pub this_month_added: i64,
}

/// 音质四档：Hi-Res、SQ（普通无损）、HQ（高码率有损）、其余。
#[derive(Serialize)]
pub struct QualityDistribution {
    pub hires: i64,
    pub super_quality: i64,
    pub high_quality: i64,
    pub other: i64,
}

/// 按容器 / 编码归出来的格式分布，最后一档 other 兜底。
#[derive(Serialize)]
pub struct FormatDistribution {
    pub flac: i64,
    pub mp3: i64,
    pub alac: i64,
    pub wav: i64,
    pub aiff: i64,
    pub aac: i64,
    pub ogg: i64,
    pub other: i64,
}

/// 数某一列有多少个「有意义」的不同取值：NULL / 空串先在 SQL 侧滤掉，
/// 剩下的未知占位串在这里再滤一遍。
fn count_meaningful_column(conn: &rusqlite::Connection, column: &str) -> Result<i64, String> {
    let sql = format!(
        "SELECT DISTINCT {column} FROM songs WHERE {column} IS NOT NULL AND {column} != ''"
    );
    let mut stmt = conn.prepare(&sql).map_err(error_text)?;
    let names = stmt
        .query_map([], |record| record.get::<_, String>(0))
        .map_err(error_text)?;

    let mut total = 0;
    for value in names.flatten() {
        if !is_meaningless_name(&value) {
            total += 1;
        }
    }
    Ok(total)
}

/// 统计每种音频格式各有多少首。
#[tauri::command]
pub fn get_format_distribution(db: State<'_, DbState>) -> Result<FormatDistribution, String> {
    let conn = db.conn.lock().map_err(error_text)?;

    let mut stmt = conn
        .prepare("SELECT format, container, codec FROM songs")
        .map_err(error_text)?;

    let rows = stmt
        .query_map([], |record| {
            Ok((
                loose_text(record, 0),
                maybe_text(record, 1),
                maybe_text(record, 2),
            ))
        })
        .map_err(error_text)?;

    let mut counts = FormatDistribution {
        flac: 0,
        mp3: 0,
        alac: 0,
        wav: 0,
        aiff: 0,
        aac: 0,
        ogg: 0,
        other: 0,
    };

    for (fmt, container, codec) in rows.flatten() {
        match format_distribution_bucket(container.as_deref(), codec.as_deref(), &fmt) {
            "flac" => counts.flac += 1,
            "mp3" => counts.mp3 += 1,
            "alac" => counts.alac += 1,
            "wav" => counts.wav += 1,
            "aiff" => counts.aiff += 1,
            "aac" => counts.aac += 1,
            "ogg" => counts.ogg += 1,
            _ => counts.other += 1,
        }
    }

    Ok(counts)
}

/// 统计音质四档各有多少首。分档优先级：Hi-Res > 无损 > 高码率 > 其余。
#[tauri::command]
pub fn get_quality_distribution(db: State<'_, DbState>) -> Result<QualityDistribution, String> {
    let conn = db.conn.lock().map_err(error_text)?;

    let mut stmt = conn
        .prepare("SELECT format, codec, bit_depth, sample_rate, bitrate FROM songs")
        .map_err(error_text)?;

    let rows = stmt
        .query_map([], |record| {
            Ok((
                loose_text(record, 0),
                maybe_text(record, 1),
                maybe_int(record, 2),
                int_cell(record, 3)?,
                int_cell(record, 4)?,
            ))
        })
        .map_err(error_text)?;

    let mut counts = QualityDistribution {
        hires: 0,
        super_quality: 0,
        high_quality: 0,
        other: 0,
    };

    for (fmt, codec, depth, rate, bitrate) in rows.flatten() {
        let lossless = is_lossless_audio(codec.as_deref(), &fmt);
        if lossless && qualifies_as_hires(depth, rate) {
            counts.hires += 1;
        } else if lossless {
            counts.super_quality += 1;
        } else if bitrate >= HIGH_BITRATE_FLOOR {
            counts.high_quality += 1;
        } else {
            counts.other += 1;
        }
    }

    Ok(counts)
}

/// 曲库规模汇总。本月新增按「最近 30 天」的滑动窗口计，
/// 不严格对齐自然月的初一。
#[tauri::command]
pub fn get_library_stats(db: State<'_, DbState>) -> Result<LibraryStats, String> {
    let conn = db.conn.lock().map_err(error_text)?;

    let (song_total, seconds_total, bytes_total): (i64, i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(duration), 0), COALESCE(SUM(file_size), 0) FROM songs",
            [],
            |record| {
                Ok((
                    record.get::<_, i64>(0)?,
                    record.get::<_, i64>(1)?,
                    record.get::<_, i64>(2)?,
                ))
            },
        )
        .map_err(error_text)?;

    let album_total = count_meaningful_column(&conn, "album")?;
    let artist_total = count_meaningful_column(&conn, "artist")?;

    // 无损数与 Hi-Res 数合并扫一遍音频参数，省掉一次全表扫描。
    let (lossy_free, hires_grade): (i64, i64) = {
        let mut stmt = conn
            .prepare("SELECT format, codec, bit_depth, sample_rate FROM songs")
            .map_err(error_text)?;
        let rows = stmt
            .query_map([], |record| {
                Ok((
                    loose_text(record, 0),
                    maybe_text(record, 1),
                    maybe_int(record, 2),
                    int_cell(record, 3)?,
                ))
            })
            .map_err(error_text)?;

        let mut lossless_seen = 0i64;
        let mut hires_seen = 0i64;
        for (fmt, codec, depth, rate) in rows.flatten() {
            if !is_lossless_audio(codec.as_deref(), &fmt) {
                continue;
            }
            lossless_seen += 1;
            if qualifies_as_hires(depth, rate) {
                hires_seen += 1;
            }
        }
        (lossless_seen, hires_seen)
    };

    let recent_additions: i64 = {
        const RECENT_WINDOW_SECS: i64 = 30 * 24 * 60 * 60;
        let window_start = current_unix_secs() - RECENT_WINDOW_SECS;
        let counted = conn.query_row(
            "SELECT COUNT(*) FROM songs WHERE added_at >= ?1",
            [window_start],
            |record| record.get(0),
        );
        counted.unwrap_or(0)
    };

    Ok(LibraryStats {
        total_songs: song_total,
        total_duration: seconds_total,
        total_file_size: bytes_total,
        album_count: album_total,
        artist_count: artist_total,
        lossless_count: lossy_free,
        hires_count: hires_grade,
        this_month_added: recent_additions,
    })
}
