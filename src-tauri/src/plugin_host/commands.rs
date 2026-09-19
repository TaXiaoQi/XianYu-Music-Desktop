use super::store::CookieEntry;
use super::{EngineCallResult, EngineLoadResult, PluginEngine};
use std::collections::HashMap;
use tauri::Manager;

pub struct PluginEngineState {
    pub engine: PluginEngine,
}

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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreImportPayload {
    pub cookies: HashMap<String, CookieEntry>,
    pub storage: HashMap<String, String>,
}

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

#[tauri::command]
pub async fn plugin_engine_cookie_header_for_domain(
    state: tauri::State<'_, PluginEngineState>,
    domain: String,
) -> Result<String, String> {
    Ok(state.engine.store().cookie_header_for_domain(&domain))
}
