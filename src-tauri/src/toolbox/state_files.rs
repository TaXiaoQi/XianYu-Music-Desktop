use super::common::APP_IDENTIFIER;
use crate::security::path_validator;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

const GPU_CONFIG_FILE: &str = "gpu_config.json"; // 实现

#[derive(Deserialize, Serialize, Debug)]
struct GpuConfig { // GpuConfig
    gpu_acceleration: bool, // 实现
}

#[cfg(windows)]
pub fn gpu_config_path() -> Result<PathBuf, String> { // gpu_config_path
    std::env::var_os("APPDATA") // 实现
        .map(PathBuf::from) // 实现
        .map(|dir| dir.join(APP_IDENTIFIER).join(GPU_CONFIG_FILE)) // 实现
        .ok_or_else(|| "APPDATA environment variable not found".to_string()) // 实现
}

#[cfg(not(target_os = "windows"))]
pub fn gpu_config_path() -> Result<PathBuf, String> { // gpu_config_path
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from) // 实现
        .filter(|dir| dir.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".local").join("share"))
        })
        .ok_or_else(|| "XDG_DATA_HOME/HOME environment variable not found".to_string())?;
    Ok(base.join(APP_IDENTIFIER).join(GPU_CONFIG_FILE))
}

pub fn should_disable_gpu_for_startup() -> bool { // should_disable_gpu_for_startup
    let Ok(path) = gpu_config_path() else { // 实现
        return false; // 实现
    };

    if !path.exists() { // 实现
        return false; // 实现
    }

    let Ok(content) = fs::read_to_string(path) else { // 实现
        return false; // 实现
    };

    match serde_json::from_str::<GpuConfig>(&content) { // 实现
        Ok(config) => !config.gpu_acceleration, // 实现
        Err(_) => false, // 实现
    }
}

#[cfg(windows)]
pub fn append_webview2_browser_arg(arg: &str) { // append_webview2_browser_arg
    const KEY: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"; // 实现

    let current = std::env::var(KEY).unwrap_or_default(); // 实现

    if current.split_whitespace().any(|item| item == arg) { // 实现
        return;
    }

    let next = if current.trim().is_empty() { // 实现
        arg.to_string() // 实现
    } else {
        format!("{} {}", current.trim(), arg) // 实现
    };

    std::env::set_var(KEY, next); // 实现
}

#[tauri::command] // 实现
pub fn set_gpu_acceleration(app_handle: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(not(windows))]
    use tauri::{Manager};

    #[cfg(windows)]
    let path = { // 实现
        let _ = app_handle; // 实现
        gpu_config_path()? // 实现
    };

    #[cfg(not(windows))]
    let path = app_handle // 实现
        .path()
        .app_data_dir() // 实现
        .map_err(|e| e.to_string())? // 实现
        .join(GPU_CONFIG_FILE); // 实现

    if let Some(parent) = path.parent() { // 实现
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; // 实现
    }

    let config = GpuConfig { // 实现
        gpu_acceleration: enabled, // 实现
    };

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?; // 实现

    std::fs::write(path, content).map_err(|e| e.to_string())?; // 实现

    Ok(())
}

#[tauri::command] // 状态写入命令
pub async fn write_state_json(
    app_handle: tauri::AppHandle, // 实现
    key: String,
    value: String,
) -> Result<(), String> {
    let sanitized_key = path_validator::sanitize_filename_component(&key)
        .map_err(|e| format!("无效的 key: {}", e))?;
    let app_dir = app_handle // 应用数据目录
        .path() // 路径服务
        .app_data_dir() // 数据目录
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?; // 目录获取失败
    let state_dir = app_dir.join("state"); // state 子目录
    tokio::fs::create_dir_all(&state_dir) // 创建目录
        .await // 异步等待
        .map_err(|e| format!("创建 state 目录失败: {e}"))?; // 创建失败
    let file_path = state_dir.join(format!("{sanitized_key}.json"));
    tokio::fs::write(&file_path, &value) // 写入状态文件
        .await // 异步等待
        .map_err(|e| format!("写入 state 文件失败: {e}"))?; // 写入失败
    Ok(()) // 成功返回
} // save_bytes_via_dialog

#[tauri::command] // 状态读取命令
pub async fn read_state_json(
    app_handle: tauri::AppHandle, // 实现
    key: String,
) -> Result<Option<String>, String> {
    let sanitized_key = path_validator::sanitize_filename_component(&key)
        .map_err(|e| format!("无效的 key: {}", e))?;
    let app_dir = app_handle // 应用数据目录
        .path() // 路径服务
        .app_data_dir() // 数据目录
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?; // 目录获取失败
    let file_path = app_dir.join("state").join(format!("{sanitized_key}.json"));
    if !file_path.exists() { // 存在性检查
        return Ok(None); // 缺失返回空
    } // save_bytes_via_dialog
    let content = tokio::fs::read_to_string(&file_path) // 读取文件内容
        .await // 异步等待
        .map_err(|e| format!("读取 state 文件失败: {e}"))?; // 读取失败
    Ok(Some(content)) // 返回内容
} // save_bytes_via_dialog
