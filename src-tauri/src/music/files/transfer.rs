// 文件搬移 / 删除 / 目录操作，搬移成功后同步数据库内的旧路径。

use super::super::utils::normalize_path;
use crate::database::DbState;
use crate::error::CommandError;
use crate::security::path_validator;
use rusqlite::params;
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;
use tauri::State;

#[derive(Serialize)]
pub struct MovedMusicFilePath {
    old_path: String,
    new_path: String,
}

#[derive(Serialize)]
pub struct BatchMoveMusicFilesResult {
    moved_paths: Vec<MovedMusicFilePath>,
}

// 搬移后把 songs 与 play_history 中命中的旧路径改写为新路径（单事务）。
fn rewrite_moved_paths_in_db(
    conn: &mut rusqlite::Connection,
    moved_paths: &[(String, String)],
) -> Result<(), String> {
    if moved_paths.is_empty() {
        return Ok(());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        let mut update_song_stmt = tx
            .prepare("UPDATE songs SET path = ?1 WHERE path = ?2")
            .map_err(|e| e.to_string())?;
        let mut update_history_stmt = tx
            .prepare("UPDATE play_history SET song_path = ?1 WHERE song_path = ?2")
            .map_err(|e| e.to_string())?;

        for (old_path, new_path) in moved_paths {
            update_song_stmt
                .execute(params![new_path, old_path])
                .map_err(|e| format!("failed to update song path '{}': {}", old_path, e))?;
            update_history_stmt
                .execute(params![new_path, old_path])
                .map_err(|e| format!("failed to update play history '{}': {}", old_path, e))?;
        }
    }

    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn batch_move_music_files(
    paths: Vec<String>,
    target_folder: String,
    db_state: State<'_, DbState>,
) -> Result<BatchMoveMusicFilesResult, CommandError> {
    let validated_target = path_validator::validate_path(&target_folder, None)
        .map_err(|e| CommandError::new("INVALID_PATH", &e))?;
    if !validated_target.exists() || !validated_target.is_dir() {
        return Err(CommandError::new("TARGET_NOT_FOUND", "目标文件夹不存在"));
    }
    let mut moved_paths: Vec<(String, String)> = Vec::new();
    for path_str in paths {
        let validated_src = match path_validator::validate_path(&path_str, None) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if let Some(file_name) = validated_src.file_name() {
            let dest = validated_target.join(file_name);
            if fs::rename(&validated_src, &dest).is_ok() {
                moved_paths.push((
                    normalize_path(&path_str),
                    normalize_path(&dest.to_string_lossy()),
                ));
            }
        }
    }
    if !moved_paths.is_empty() {
        let mut conn = db_state
            .conn
            .lock()
            .map_err(|e| CommandError::new("DB_LOCK_FAILED", &e.to_string()))?;
        rewrite_moved_paths_in_db(&mut conn, &moved_paths)
            .map_err(|e| CommandError::new("DB_SYNC_FAILED", &e))?;
    }

    Ok(BatchMoveMusicFilesResult {
        moved_paths: moved_paths
            .into_iter()
            .map(|(old_path, new_path)| MovedMusicFilePath { old_path, new_path })
            .collect(),
    })
}

#[tauri::command]
pub fn move_music_file(
    old_path: String,
    new_path: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let validated_src = path_validator::validate_path(&old_path, None)?;
    let validated_dest = path_validator::validate_path(&new_path, None)?;
    if !validated_src.exists() {
        return Err("源文件不存在".to_string());
    }
    if let Some(parent) = validated_dest.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::rename(&validated_src, &validated_dest).map_err(|e| e.to_string())?;
    let normalized_old_path = normalize_path(&old_path);
    let normalized_new_path = normalize_path(&validated_dest.to_string_lossy());
    let mut conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    rewrite_moved_paths_in_db(&mut conn, &[(normalized_old_path, normalized_new_path)])?;
    Ok(())
}

#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    let validated = path_validator::validate_path(&path, None)?;
    let path_str = validated.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(["/select,", &path_str])
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path_str])
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = validated.parent() {
            Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_music_file(path: String) -> Result<(), String> {
    let validated_path = path_validator::validate_path(&path, None)?;
    fs::remove_file(validated_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_folder(path: String) -> Result<(), String> {
    let validated_path = path_validator::validate_path(&path, None)?;
    fs::remove_dir_all(validated_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_folder(parent_path: String, folder_name: String) -> Result<String, String> {
    let sanitized_name = path_validator::sanitize_filename_component(folder_name.trim())?;
    let validated_parent = path_validator::validate_path(&parent_path, None)?;
    if !validated_parent.exists() || !validated_parent.is_dir() {
        return Err("Parent folder does not exist".to_string());
    }

    let new_folder_path = validated_parent.join(&sanitized_name);
    if new_folder_path.exists() {
        return Err("Folder already exists".to_string());
    }

    fs::create_dir(&new_folder_path).map_err(|e| e.to_string())?;

    Ok(normalize_path(&new_folder_path.to_string_lossy()))
}

#[tauri::command]
pub fn move_file_to_folder(
    source_path: String,
    target_folder: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let source = crate::security::path_validator::validate_path(&source_path, None)?;
    let filename = source.file_name().ok_or("Invalid source filename")?;
    let target_folder = crate::security::path_validator::validate_path(&target_folder, None)?;
    let target = target_folder.join(filename);

    if target.exists() {
        return Err("Target file already exists".to_string());
    }

    fs::rename(&source, &target).map_err(|e| e.to_string())?;
    let normalized_source = normalize_path(&source_path);
    let normalized_target = normalize_path(&target.to_string_lossy());
    let mut conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    rewrite_moved_paths_in_db(&mut conn, &[(normalized_source, normalized_target)])
}

#[tauri::command]
pub fn is_directory(path: String) -> bool {
    Path::new(&path).is_dir()
}
