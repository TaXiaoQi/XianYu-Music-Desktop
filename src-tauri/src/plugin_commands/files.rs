use std::fs;

use tauri::Manager;

use crate::security::path_validator;

#[tauri::command]
pub fn read_plugin_file(path: String) -> Result<String, String> {
    let validated = path_validator::validate_path(&path, None)
        .map_err(|e| format!("路径校验失败: {} (路径: {})", e, path))?;
    let path_obj = validated.as_path();
    if !path_obj.is_file() {
        return Err(format!("插件文件不存在: {}", path));
    }

    let ext = path_obj
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "js" | "json" | "txt" | "m3u" | "m3u8") {
        return Err(format!(
            "不支持的文件类型: .{} (仅支持 .js/.json/.txt/.m3u/.m3u8)",
            ext
        ));
    }

    let metadata =
        fs::metadata(path_obj).map_err(|error| format!("读取文件元数据失败: {}", error))?;
    let max_size = if ext == "json" {
        50 * 1024 * 1024
    } else {
        5 * 1024 * 1024
    };
    if metadata.len() > max_size {
        return Err(format!(
            "文件过大: {} MB (上限 {} MB)",
            metadata.len() / 1024 / 1024,
            max_size / 1024 / 1024
        ));
    }

    fs::read_to_string(path_obj).map_err(|error| format!("读取文件内容失败: {}", error))
}

#[tauri::command]
pub async fn save_plugin_script(
    app_handle: tauri::AppHandle,
    id: String,
    script: String,
) -> Result<String, String> {
    let sanitized_id = path_validator::sanitize_filename_component(&id)
        .map_err(|e| format!("无效的插件 id: {}", e))?;
    if script.len() > 2 * 1024 * 1024 {
        return Err(format!("插件脚本过大: {} bytes (上限 2MB)", script.len()));
    }
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    let plugins_dir = app_dir.join("plugins");
    tokio::fs::create_dir_all(&plugins_dir)
        .await
        .map_err(|e| format!("创建插件目录失败: {e}"))?;
    let file_path = plugins_dir.join(format!("{sanitized_id}.js"));
    tokio::fs::write(&file_path, &script)
        .await
        .map_err(|e| format!("写入插件脚本失败: {e}"))?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};

    let validated = path_validator::validate_path(&path, None)
        .map_err(|e| format!("路径校验失败: {} (路径: {})", e, path))?;
    let path_obj = validated.as_path();
    if !path_obj.is_file() {
        return Err(format!("文件不存在: {}", path));
    }

    let ext = path_obj
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "json" | "zip" | "lxmc") {
        return Err(format!(
            "不支持的文件类型: .{} (仅支持 .json/.zip/.lxmc)",
            ext
        ));
    }

    let metadata =
        fs::metadata(path_obj).map_err(|error| format!("读取文件元数据失败: {}", error))?;
    let max_size = 50 * 1024 * 1024;
    if metadata.len() > max_size {
        return Err(format!(
            "文件过大: {} MB (上限 {} MB)",
            metadata.len() / 1024 / 1024,
            max_size / 1024 / 1024
        ));
    }

    let bytes = fs::read(path_obj).map_err(|error| format!("读取文件内容失败: {}", error))?;
    Ok(general_purpose::STANDARD.encode(&bytes))
}
