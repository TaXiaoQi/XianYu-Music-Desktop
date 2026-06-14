// music/sidebar.rs - 侧边栏管理命令
use super::scanner::scan_folder_recursive;
// Deprecated compatibility commands for legacy sidebar_folders data.
// New main-flow folder browsing must use library_folders and get_library_hierarchy.
use super::types::FolderNode;
use super::utils::normalize_path;
use crate::database::DbState;
use serde::Serialize;
use std::path::PathBuf;
use std::time::SystemTime;
use tauri::State;

#[derive(Serialize)]
pub struct SidebarFolder {
    pub path: String,
    pub name: String,
}

#[tauri::command]
pub async fn get_sidebar_folders(
    db_state: State<'_, DbState>,
) -> Result<Vec<SidebarFolder>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT path FROM sidebar_folders ORDER BY added_at DESC")
            .map_err(|e| e.to_string())?;

        let folders: Vec<SidebarFolder> = stmt
            .query_map([], |row| {
                let path: String = row.get(0)?;
                let name = std::path::Path::new(&path)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.clone());
                Ok(SidebarFolder { path, name })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        Ok::<Vec<SidebarFolder>, String>(folders)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

// Deprecated compat command. Keep only for legacy sidebar_folders access.
#[tauri::command]
pub async fn add_sidebar_folder(path: String, db_state: State<'_, DbState>) -> Result<(), String> {
    let db_conn = db_state.conn.clone();
    let normalized = normalize_path(&path);

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO sidebar_folders (path, added_at) VALUES (?1, ?2)",
            [
                &normalized,
                &SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_secs()
                    .to_string(),
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(())
}

// Deprecated compat command. Keep only for legacy sidebar_folders access.
#[tauri::command]
pub async fn remove_sidebar_folder(
    path: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let db_conn = db_state.conn.clone();
    let normalized = normalize_path(&path);

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM sidebar_folders WHERE path = ?1", [&normalized])
            .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(())
}

// Deprecated compat command. Main folder-tree flow must use get_library_hierarchy.
#[tauri::command]
pub async fn get_sidebar_hierarchy(
    db_state: State<'_, DbState>,
) -> Result<Vec<FolderNode>, String> {
    let db_conn = db_state.conn.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare("SELECT path FROM sidebar_folders ORDER BY added_at DESC")
            .map_err(|e| e.to_string())?;
        let roots: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let mut tree = Vec::new();

        for root in roots {
            let root_path = PathBuf::from(&root);
            if let Some(root_node) = scan_folder_recursive(root_path.clone(), 0, 1, &conn) {
                tree.push(root_node);
            }
        }

        Ok::<Vec<FolderNode>, String>(tree)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}
