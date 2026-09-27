//! 统计备份文件的导出与导入。
//!
//! 导出把四张聚合表（可选附带最近播放）打包成一个 JSON 文件，落盘位置
//! 交给系统保存对话框。导入拆成两步：先 preview 给前端确认影响面，
//! 再执行正式的 import。import 以 export_id 记录导入痕迹，同一个文件
//! 重复导入默认拦下，前端二次确认后可用 continue_duplicate_import 放行。

use std::fs;

use rusqlite::OptionalExtension;
use tauri::State;

use crate::database::DbState;

use super::matching::{build_library_match_index, match_song_identity};
use super::portable::{
    PortableRecentPlay, PortableStatisticsExport, StatisticsExportOptions, StatisticsExportResult,
    StatisticsImportMode, StatisticsImportOptions, StatisticsImportPreview,
    StatisticsImportPreviewOptions, StatisticsImportResult,
};
use super::read::{
    query_daily_stats, query_global_stats, query_hourly_stats, query_recent_plays, query_song_stats,
};
use super::support::{
    current_unix_millis, current_unix_secs, error_text, utc_now_rfc3339, STATS_SCHEMA_VERSION,
};
use super::write::{
    clear_aggregate_statistics, ensure_statistics_aggregates, insert_recent_play,
    merge_global_stats, set_statistics_meta, upsert_daily_stats, upsert_hourly_stats,
    upsert_song_stats,
};

const DAMAGED_BACKUP_MESSAGE: &str = "文件格式不正确或已损坏";
const FUTURE_VERSION_MESSAGE: &str = "该统计文件版本过新，当前版本暂不支持";
const CANCELED_EXPORT_MESSAGE: &str = "已取消导出";
const ALREADY_IMPORTED_MESSAGE: &str = "该统计备份似乎已经导入过";

/// 读入并校验一个备份文件：格式串不对、JSON 坏了、版本过新都会被拒。
fn read_export_bundle(file_path: &str) -> Result<PortableStatisticsExport, String> {
    let text = fs::read_to_string(file_path).map_err(error_text)?;
    let bundle: PortableStatisticsExport =
        serde_json::from_str(&text).map_err(|_| DAMAGED_BACKUP_MESSAGE.to_string())?;

    if bundle.format != "xianyu-stats" {
        return Err(DAMAGED_BACKUP_MESSAGE.to_string());
    }

    if bundle.version > STATS_SCHEMA_VERSION {
        return Err(FUTURE_VERSION_MESSAGE.to_string());
    }

    Ok(bundle)
}

/// 查询某个导出编号是否已经进入导入日志。
fn seen_in_import_log(conn: &rusqlite::Connection, export_id: &str) -> Result<bool, String> {
    let probed = conn
        .query_row(
            "SELECT 1 FROM imported_exports_log WHERE export_id = ?1",
            [export_id],
            |record| record.get::<_, i64>(0),
        )
        .optional();
    probed.map_err(error_text).map(|found| found.is_some())
}

/// 从库里的聚合结果收集一份可携带的统计快照。
fn gather_export_payload(
    conn: &rusqlite::Connection,
    recent_plays: Vec<PortableRecentPlay>,
) -> Result<super::portable::PortableStatisticsPayload, String> {
    Ok(super::portable::PortableStatisticsPayload {
        global: query_global_stats(conn)?,
        songs: query_song_stats(conn)?,
        daily: query_daily_stats(conn)?,
        hourly: query_hourly_stats(conn)?,
        recent_plays,
    })
}

/// 导出统计到用户选择的位置；取消保存对话框时按「已取消导出」返回。
#[tauri::command]
pub fn export_statistics_file(app_handle: tauri::AppHandle, db: State<DbState>, options: StatisticsExportOptions) -> Result<StatisticsExportResult, String> {
    let conn = db.conn.lock().map_err(error_text)?;
    ensure_statistics_aggregates(&conn)?;

    // 编号用「秒 + 毫秒」拼出来，同一次会话里的多次导出也能彼此区分。
    let stamp = format!("stats-{}-{}", current_unix_secs(), current_unix_millis());
    let stamped_at = utc_now_rfc3339()?;

    let mut recent_backup = vec![];
    if options.include_recent_plays {
        recent_backup = query_recent_plays(&conn)?;
    }

    let payload = PortableStatisticsExport {
        format: "xianyu-stats".to_string(),
        version: STATS_SCHEMA_VERSION,
        exported_at: stamped_at.clone(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        export_id: stamp.clone(),
        library_fingerprint: Option::None,
        stats: gather_export_payload(&conn, recent_backup)?,
    };

    let content = serde_json::to_string_pretty(&payload).map_err(error_text)?;
    let picked = crate::toolbox::pick_save_path(
        &app_handle,
        &options.default_file_name,
        Some(&crate::toolbox::SaveDialogFilter {
            name: "统计备份文件".to_string(),
            extensions: vec!["json".to_string()],
        }),
    )?;
    let Some(destination) = picked else {
        return Err(CANCELED_EXPORT_MESSAGE.to_string());
    };
    fs::write(&destination, content).map_err(error_text)?;

    Ok(StatisticsExportResult {
        file_path: destination.display().to_string(),
        export_id: stamp,
        exported_at: stamped_at,
    })
}

/// 导入前先看一眼：文件版本、各区块条数、能匹配上多少首歌，
/// 以及这个文件是不是已经导入过。
#[tauri::command]
pub fn preview_statistics_import(db: State<DbState>, options: StatisticsImportPreviewOptions) -> Result<StatisticsImportPreview, String> {
    crate::security::path_validator::validate_path(&options.file_path, None)?;
    let bundle = read_export_bundle(&options.file_path)?;
    let conn = db.conn.lock().map_err(error_text)?;
    ensure_statistics_aggregates(&conn)?;
    let match_index = build_library_match_index(&conn)?;

    let songs_in_file = &bundle.stats.songs;
    let mut matched = 0usize;
    for entry in songs_in_file {
        if match_song_identity(&match_index, &entry.song_identity).is_some() {
            matched += 1;
        }
    }
    let repeated = seen_in_import_log(&conn, &bundle.export_id)?;

    Ok(StatisticsImportPreview {
        version: bundle.version,
        exported_at: bundle.exported_at,
        app_version: bundle.app_version,
        export_id: bundle.export_id,
        song_stats_count: songs_in_file.len(),
        daily_stats_count: bundle.stats.daily.len(),
        recent_plays_count: bundle.stats.recent_plays.len(),
        matched_song_count: matched,
        unmatched_song_count: songs_in_file.len().saturating_sub(matched),
        duplicate_import_detected: repeated,
    })
}

/// 正式导入。覆盖模式先清空现有聚合与导入日志；合并模式直接累加。
/// 匹配不上的歌曲按原样写进去，保证这部分统计不丢，只是暂时没有路径。
#[tauri::command]
pub fn import_statistics_file(db: State<DbState>, options: StatisticsImportOptions) -> Result<StatisticsImportResult, String> {
    crate::security::path_validator::validate_path(&options.file_path, None)?;
    let bundle = read_export_bundle(&options.file_path)?;
    let mut conn = db.conn.lock().map_err(error_text)?;
    ensure_statistics_aggregates(&conn)?;

    let repeated = seen_in_import_log(&conn, &bundle.export_id)?;
    if repeated && !options.continue_duplicate_import {
        return Err(ALREADY_IMPORTED_MESSAGE.to_string());
    }

    let match_index = build_library_match_index(&conn)?;
    let tx = conn.transaction().map_err(error_text)?;

    let wipes_first = matches!(options.mode, StatisticsImportMode::Overwrite);
    if wipes_first {
        let cleared = clear_aggregate_statistics(&tx);
        cleared?;
        tx.execute("DELETE FROM imported_exports_log", [])
            .map_err(error_text)?;
    }

    let marked = set_statistics_meta(&tx, "aggregates_backfilled", "1");
    marked?;
    merge_global_stats(&tx, &bundle.stats.global)?;

    let mut matched_songs = 0usize;
    let mut unmatched_songs = 0usize;
    let mut merged_songs = 0usize;

    for entry in &bundle.stats.songs {
        let resolved = match match_song_identity(&match_index, &entry.song_identity) {
            Some(hit) => {
                matched_songs += 1;
                hit.identity
            }
            None => {
                unmatched_songs += 1;
                entry.song_identity.to_owned()
            }
        };

        upsert_song_stats(&tx, &resolved, &entry.song_stats)?;
        merged_songs += 1;
    }

    bundle
        .stats
        .daily
        .iter()
        .try_for_each(|day| upsert_daily_stats(&tx, day))?;
    bundle
        .stats
        .hourly
        .iter()
        .try_for_each(|hour| upsert_hourly_stats(&tx, hour))?;

    let mut imported_recents = 0usize;
    for entry in &bundle.stats.recent_plays {
        let inserted = insert_recent_play(&tx, entry)?;
        imported_recents += usize::from(inserted);
    }

    tx.execute(
        "INSERT OR REPLACE INTO imported_exports_log (export_id, imported_at) VALUES (?1, ?2)",
        rusqlite::params![bundle.export_id, utc_now_rfc3339()?],
    )
    .map_err(error_text)?;

    tx.commit().map_err(error_text)?;

    Ok(StatisticsImportResult {
        mode: match options.mode {
            StatisticsImportMode::Overwrite => String::from("overwrite"),
            StatisticsImportMode::Merge => String::from("merge"),
        },
        matched_song_count: matched_songs,
        unmatched_song_count: unmatched_songs,
        merged_song_count: merged_songs,
        imported_recent_plays_count: imported_recents,
        duplicate_import_skipped: repeated,
    })
}
