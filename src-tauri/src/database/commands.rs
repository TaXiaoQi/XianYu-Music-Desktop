// database 模块的 Tauri 端侧包装：清空所有应用数据命令。
// 纯清空逻辑（清表 + VACUUM + 删除 covers/state 目录）在共享 core。

use crate::database::DbState;
use tauri::{AppHandle, Manager, State};

/// 未收到用户确认时的固定报错文案。
const UNCONFIRMED_MESSAGE: &str = "请先确认后再执行清空操作";

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
        xianyu_core::database::reset::clear_all_app_data(&mut guard, &app_dir)
    })
    .await
    .map_err(|err| err.to_string())?
}
