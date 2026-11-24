// database：纯逻辑（连接调优/基线建表/增量迁移/状态句柄/数据清空）已迁共享 core，
// 此处 re-export 保持 crate:: 路径不变；端侧仅保留依赖 Tauri 的薄包装
// （库文件路径解析与清空命令），见 commands.rs。

pub use xianyu_core::database::DbState;

// 仅测试场景需要绕过迁移直接搭建基线表结构。
#[cfg(test)]
pub(crate) use xianyu_core::database::schema::ensure_base_schema;

mod commands;

pub use commands::clear_all_app_data;

use tauri::Manager;

/// 打开（或创建）应用数据目录下的 library.db，完成连接调优、基线建表与迁移。
///
/// 纯逻辑在 core（`DbState::new_from_path`），此处仅补 Tauri 的数据目录解析。
pub fn open_app_db(app_handle: &tauri::AppHandle) -> Result<DbState, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?;
    DbState::new_from_path(&data_dir.join("library.db"))
}
