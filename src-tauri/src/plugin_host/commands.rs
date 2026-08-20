//! QuickJS 插件引擎的 Tauri 命令层
//!
//! 前端 pluginSandboxManager 门面通过这些命令路由到 Rust 引擎：
//!   - 加载/调用/销毁（MusicFree 与 LX 两种格式）
//!   - localStorage 旧数据一次性迁移（plugin_engine_store_import）
//!   - Cookie 头查询（B站取流防盗链等前端直用场景）

use super::store::CookieEntry;
use super::{EngineCallResult, EngineLoadResult, PluginEngine};
use std::collections::HashMap;
use tauri::Manager;

/// 由 Tauri 管理的引擎状态
pub struct PluginEngineState {
    pub engine: PluginEngine,
}

/// 在 setup 阶段构建引擎状态（存储落在 app_data_dir/plugin_host_store.json）
pub fn init_engine_state(app: &tauri::AppHandle) -> PluginEngineState {
    let store_path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("plugin_host_store.json"));
    PluginEngineState {
        engine: PluginEngine::new(store_path),
    }
}

#[tauri::command]
pub async fn plugin_engine_load_musicfree(
    state: tauri::State<'_, PluginEngineState>,
    plugin_id: String,
    script: String,
    user_vars_json: String,
) -> Result<EngineLoadResult, String> {
    Ok(state
        .engine
        .load_musicfree(&plugin_id, &script, &user_vars_json)
        .await)
}

#[tauri::command]
pub async fn plugin_engine_load_lx(
    state: tauri::State<'_, PluginEngineState>,
    plugin_id: String,
    script: String,
    script_info_json: String,
) -> Result<EngineLoadResult, String> {
    Ok(state
        .engine
        .load_lx(&plugin_id, &script, &script_info_json)
        .await)
}

#[tauri::command]
pub async fn plugin_engine_call(
    state: tauri::State<'_, PluginEngineState>,
    plugin_id: String,
    method: String,
    args_json: String,
    user_vars_json: Option<String>,
    timeout_ms: u64,
) -> Result<EngineCallResult, String> {
    Ok(state
        .engine
        .call(
            &plugin_id,
            &method,
            &args_json,
            user_vars_json.as_deref(),
            timeout_ms,
        )
        .await)
}

#[tauri::command]
pub async fn plugin_engine_destroy(
    state: tauri::State<'_, PluginEngineState>,
    plugin_id: String,
) -> Result<(), String> {
    state.engine.unload(&plugin_id).await;
    Ok(())
}

#[tauri::command]
pub async fn plugin_engine_destroy_all(
    state: tauri::State<'_, PluginEngineState>,
) -> Result<(), String> {
    state.engine.unload_all().await;
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreImportPayload {
    /// localStorage __plugin_cookies 的原始结构：name -> {value, domain}
    pub cookies: HashMap<String, CookieEntry>,
    /// localStorage __plugin_storage_* 摊平后的 key -> value
    pub storage: HashMap<String, String>,
}

/// 一次性迁移前端 localStorage 中的插件 Cookie/Storage。
/// Rust 侧已有条目优先，仅补缺。
#[tauri::command]
pub async fn plugin_engine_store_import(
    state: tauri::State<'_, PluginEngineState>,
    payload: StoreImportPayload,
) -> Result<(), String> {
    state
        .engine
        .store()
        .import_local(payload.cookies, payload.storage);
    Ok(())
}

/// 按域名关键字拼接 Cookie 头（如 bilibili），对应前端 getPluginBilibiliCookies
#[tauri::command]
pub async fn plugin_engine_cookie_header_for_domain(
    state: tauri::State<'_, PluginEngineState>,
    domain: String,
) -> Result<String, String> {
    Ok(state.engine.store().cookie_header_for_domain(&domain))
}

/// 导出整个存储快照（调试/备份用）
#[tauri::command]
pub async fn plugin_engine_store_snapshot(
    state: tauri::State<'_, PluginEngineState>,
) -> Result<serde_json::Value, String> {
    let store = state.engine.store();
    Ok(serde_json::json!({
        "cookies": store.cookie_snapshot(),
        "storage": store.storage_snapshot(),
    }))
}
