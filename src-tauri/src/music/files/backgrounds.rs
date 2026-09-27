// 歌曲自定义背景图：复制进应用数据目录并在数据库登记映射关系。

use super::super::utils::normalize_path;
use crate::database::DbState;
use rusqlite::{params, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

// 背景图存放目录：<app_data>/song_backgrounds，拿不到 app_data 时退回系统临时目录。
fn background_store_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("song_backgrounds"))
        .join("song_backgrounds");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir
}

#[tauri::command]
pub fn save_song_background(
    app: AppHandle,
    song_path: String,
    background_path: String,
    db_state: State<'_, DbState>,
) -> Result<String, String> {
    let normalized_song_path = normalize_path(&song_path);

    let src_path = crate::security::path_validator::validate_path(&background_path, None)?;
    if !src_path.is_file() {
        return Err("背景图片文件不存在".to_string());
    }

    let bg_dir = background_store_dir(&app);
    let ext = src_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let dest_name = format!("{}.{}", Uuid::new_v4().to_string().replace('-', ""), ext);
    let dest_path = bg_dir.join(&dest_name);
    fs::copy(&src_path, &dest_path).map_err(|e| format!("复制背景图片失败: {}", e))?;

    let stored_path = dest_path.to_string_lossy().into_owned();

    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO song_backgrounds (song_path, background_path) VALUES (?1, ?2)",
        params![&normalized_song_path, &stored_path],
    )
    .map_err(|e| format!("写入数据库失败: {}", e))?;

    Ok(stored_path)
}

#[tauri::command]
pub fn get_song_background(
    song_path: String,
    db_state: State<'_, DbState>,
) -> Result<Option<String>, String> {
    let normalized_song_path = normalize_path(&song_path);
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    let result: Option<String> = conn
        .query_row(
            "SELECT background_path FROM song_backgrounds WHERE song_path = ?1",
            params![&normalized_song_path],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("查询失败: {}", e))?;

    if let Some(ref p) = result {
        if !Path::new(p).is_file() {
            return Ok(None);
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn clear_song_background(
    app: AppHandle,
    song_path: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let normalized_song_path = normalize_path(&song_path);
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    let bg_path: Option<String> = conn
        .query_row(
            "SELECT background_path FROM song_backgrounds WHERE song_path = ?1",
            params![&normalized_song_path],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("查询失败: {}", e))?;

    conn.execute(
        "DELETE FROM song_backgrounds WHERE song_path = ?1",
        params![&normalized_song_path],
    )
    .map_err(|e| format!("删除失败: {}", e))?;

    if let Some(p) = bg_path {
        let _ = fs::remove_file(&p);
    }

    let _ = app;
    Ok(())
}
