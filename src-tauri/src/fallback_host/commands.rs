use std::sync::Arc;

use crate::plugin_host::HttpBridge;

use super::{FallbackCallManyResult, FallbackCallResult, FallbackEngine, FallbackLoadResult};

pub struct FallbackHostState {
    pub engine: FallbackEngine,
}

pub fn init_fallback_state(http: Arc<HttpBridge>) -> FallbackHostState {
    FallbackHostState {
        engine: FallbackEngine::new(http),
    }
}

/// 验签 + 编译 + 四条硬校验一体；同 key 覆盖 = 热替换。
#[tauri::command]
pub async fn fallback_module_load(
    state: tauri::State<'_, FallbackHostState>,
    module_key: String,
    version: i64,
    code: String,
    signature: String,
    app_version: String,
) -> Result<FallbackLoadResult, String> {
    Ok(state
        .engine
        .load(&module_key, version, &code, &signature, &app_version)
        .await)
}

/// 调用已加载模块的单个方法 → {ok, data, error, logs}。
#[tauri::command]
pub async fn fallback_module_call(
    state: tauri::State<'_, FallbackHostState>,
    module_key: String,
    method: String,
    args_json: String,
    timeout_ms: Option<u64>,
) -> Result<FallbackCallResult, String> {
    Ok(state
        .engine
        .call(&module_key, &method, &args_json, timeout_ms.unwrap_or(0))
        .await)
}

/// 保序逐项批量调用；单项失败不影响后续。
#[tauri::command]
pub async fn fallback_module_call_many(
    state: tauri::State<'_, FallbackHostState>,
    module_key: String,
    method: String,
    args_json_list: Vec<String>,
    timeout_ms: Option<u64>,
) -> Result<FallbackCallManyResult, String> {
    Ok(state
        .engine
        .call_many(&module_key, &method, &args_json_list, timeout_ms.unwrap_or(0))
        .await)
}

/// 整包替换配置快照（前端 settings 深拷贝 JSON），返回所存配置的 sha256-hex。
#[tauri::command]
pub async fn fallback_module_update_config(
    state: tauri::State<'_, FallbackHostState>,
    config_json: String,
) -> Result<String, String> {
    state.engine.update_config(&config_json)
}

/// 启动对账：返回当前已存配置的 hash（未推送过为空串），前端比对不一致即重推。
#[tauri::command]
pub async fn fallback_module_config_hash(
    state: tauri::State<'_, FallbackHostState>,
) -> Result<String, String> {
    Ok(state.engine.config_hash())
}
