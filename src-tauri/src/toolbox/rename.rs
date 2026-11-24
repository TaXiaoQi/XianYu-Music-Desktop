//! 文件重命名：纯逻辑已迁入共享 core（xianyu_core::toolbox::rename），
//! 本文件仅保留 Tauri 命令薄包装；apply_rename 在端侧查询音乐库白名单传入 core。

use crate::database::DbState;
use std::path::PathBuf;
use xianyu_core::toolbox::{
    apply_rename as core_apply_rename, preview_rename as core_preview_rename, RenameConfig,
    RenameOperation, RenamePreview,
};

#[tauri::command]
pub fn preview_rename(
    root_path: String,
    config: RenameConfig,
) -> Result<Vec<RenamePreview>, String> {
    core_preview_rename(root_path, config)
}

#[tauri::command]
pub fn apply_rename(
    operations: Vec<RenameOperation>,
    db_state: tauri::State<'_, DbState>,
) -> Result<u32, String> {
    let roots: Vec<PathBuf> = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT path FROM library_folders")
            .map_err(|e| e.to_string())?;
        let paths: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        paths.into_iter().map(PathBuf::from).collect()
    };

    core_apply_rename(operations, Some(&roots))
}
