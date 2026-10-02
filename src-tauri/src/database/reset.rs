// 一键清空：抹除曲库与统计相关的本地数据，并清理运行期生成的附属目录。

use crate::database::DbState;
use rusqlite::Connection;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

/// 未收到用户确认时的固定报错文案。
const UNCONFIRMED_MESSAGE: &str = "请先确认后再执行清空操作";

/// 待清空的业务表清单；顺序兼顾外键删除次序。
const PURGE_STATEMENTS: &str = "
                DELETE FROM play_history;
                DELETE FROM song_artists;
                DELETE FROM artists;
                DELETE FROM songs;
                DELETE FROM library_folders;
                DELETE FROM sidebar_folders;
                ";

/// 事务提交后收缩 WAL 并回收主库文件空间。
const RECLAIM_STATEMENTS: &str = "PRAGMA wal_checkpoint(TRUNCATE); VACUUM;";

/// 运行期生成、随数据一并删除的附属目录名。
const GENERATED_DIRS: [&str; 2] = ["covers", "state"];

/// 在单个事务内清空业务表，随后收缩数据库文件。
fn wipe_user_tables(conn: &mut Connection) -> Result<(), String> {
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute_batch(PURGE_STATEMENTS)
        .map_err(|err| err.to_string())?;
    tx.commit().map_err(|err| err.to_string())?;
    conn.execute_batch(RECLAIM_STATEMENTS)
        .map_err(|err| err.to_string())
}

/// 删除封面缓存等运行期附属目录（存在才删）。
fn discard_generated_dirs(app_dir: &Path) -> Result<(), String> {
    for name in GENERATED_DIRS {
        let target = app_dir.join(name);
        if target.exists() {
            fs::remove_dir_all(target).map_err(|err| err.to_string())?;
        } // discard_generated_dirs
    }
    Ok(())
}
#[tauri::command]
pub async fn clear_all_app_data(
    app_handle: AppHandle,
    db_state: State<'_, DbState>,
    confirm: bool,
) -> Result<(), String> {
    if !confirm {
        return Err(UNCONFIRMED_MESSAGE.to_string());
    }

    let shared_conn = db_state.conn.clone();
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = shared_conn.lock().map_err(|err| err.to_string())?;
        wipe_user_tables(&mut guard)?;
        discard_generated_dirs(&app_dir)?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|err| err.to_string())??;

    Ok(())
}
