use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Manager};
use uuid::Uuid;

fn skin_images_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("custom-skins");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn normalize_skin_image_extension(source: &Path) -> Result<&'static str, String> {
    match source
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Ok("png"),
        Some("jpg") | Some("jpeg") => Ok("jpg"),
        Some("webp") => Ok("webp"),
        Some("bmp") => Ok("bmp"),
        Some("gif") => Ok("gif"),
        _ => Err("Only png, jpg, webp, bmp, gif images are supported".to_string()),
    }
}

// 将用户选择的本地皮肤图片复制到应用数据目录（$APPDATA/**，位于 assetProtocol scope 内）。
// 直接使用 open() 返回的任意目录路径会被 asset 协议拒绝导致图片破损，且不会随设置持久有效。
#[tauri::command]
pub fn import_skin_image(app: AppHandle, source_path: String) -> Result<String, String> {
    let source = PathBuf::from(source_path);
    if !source.is_file() {
        return Err("Selected skin image file does not exist".to_string());
    }

    let extension = normalize_skin_image_extension(&source)?;
    let file_name = format!("{}.{}", Uuid::new_v4(), extension);
    let target_path = skin_images_dir(&app)?.join(file_name);

    fs::copy(&source, &target_path).map_err(|error| error.to_string())?;

    Ok(target_path.to_string_lossy().to_string())
}