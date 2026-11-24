// 封面磁盘缓存（弦予原创实现）- 桌面端命令层。
//
// 核心缓存逻辑（双缓存、内容寻址、别名索引、无图负缓存、原子落盘）已迁入
// 共享仓库 XianYu-Music-Core（xianyu_core::music::covers），本文件仅保留
// Tauri 命令层与 AppHandle → cache_dir 适配：
// - 缓存目录由 app_data_dir 派生（Core 入口统一收 cache_root）；
// - HTTP/远程 URI 走桌面端 remote::cache 与 DbState。

use crate::database::DbState;
use crate::music::types::{FullCoverImageConcurrencyLimit, ThumbnailImageConcurrencyLimit};
use crate::remote::cache::{ensure_cached_path, is_remote_uri};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use xianyu_core::music::covers;

// 三种可落盘头像的魔数签名（read_cover_data_url 白名单用）。
const JPEG_MAGIC: [u8; 3] = [0xFF, 0xD8, 0xFF];
const PNG_MAGIC: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

pub fn get_cover_cache_dir(app: &AppHandle) -> PathBuf {
  let fallback = std::env::temp_dir().join("covers");
  let base = app.path().app_data_dir().unwrap_or(fallback);
  let cache_dir = base.join("covers");
  if !cache_dir.exists() {
    let _ = fs::create_dir_all(&cache_dir);
  }
  cache_dir
}

// 从内嵌封面字节直接生成缩略图实体（云端流缓存元数据探针用）。
// 不做负缓存、不绑定源文件别名；命中既有实体直接复用。
pub fn save_embedded_thumb_from_bytes(bytes: &[u8], app: &AppHandle) -> Option<String> {
  covers::save_embedded_thumb_from_bytes(bytes, &get_cover_cache_dir(app))
}

// 从内存字节落盘自动识别的歌手头像（供扫描/远程链路复用）。
pub use covers::save_artist_avatar_auto;

#[tauri::command]
pub fn run_cache_cleanup(app: &AppHandle) {
  covers::run_cache_cleanup(&get_cover_cache_dir(app));
}

#[tauri::command]
pub fn clear_cover_cache(app: AppHandle) -> Result<(), String> {
  covers::clear_cover_cache(&get_cover_cache_dir(&app))
}

/// 封面文件读为 data URL（移动端 Image.file 的桌面等价物）。webview 里
/// asset 协议对共享数据目录封面的渲染不稳定（2026-10 起播封面实测：
/// URL 合法、作用域已放行却无报错地不渲染），改由 rust 读字节内联，
/// 绕开 asset 作用域/CSP/file:// 三层约束。仅接受图片魔数，避免被当作
/// 任意文件读取通道。
#[tauri::command]
pub async fn read_cover_data_url(path: String) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let bytes = fs::read(&path).map_err(|_| "cover read failed".to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
      return Err("cover too large".into());
    }
    let mime = if bytes.starts_with(&PNG_MAGIC) {
      "image/png"
    } else if bytes.starts_with(&JPEG_MAGIC) {
      "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
      "image/gif"
    } else if bytes.starts_with(b"RIFF") && bytes.len() > 11 && &bytes[8..12] == b"WEBP" {
      "image/webp"
    } else {
      return Err("not an image".into());
    };
    use base64::Engine as _;
    Ok(format!(
      "data:{mime};base64,{}",
      base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_song_cover_thumbnail(
  path: String,
  app: AppHandle,
  semaphore: State<'_, ThumbnailImageConcurrencyLimit>,
  db_state: State<'_, DbState>,
) -> Result<String, String> {
  let _permit = semaphore.0.acquire().await.map_err(|e| e.to_string())?;
  let source_path = match is_remote_uri(&path) {
    true => ensure_cached_path(&app, &db_state, &path).await?,
    false => path.clone(),
  };

  let cache_dir = get_cover_cache_dir(&app);
  let local_target = PathBuf::from(&source_path);
  let thumbnail_path = tauri::async_runtime::spawn_blocking(move || {
    covers::get_or_create_thumbnail(&local_target, &cache_dir)
  })
  .await
  .map_err(|e| e.to_string())?;

  if let Some(cache_path_str) = thumbnail_path {
    if !cache_path_str.is_empty() {
      if let Ok(conn) = db_state.conn.lock() {
        let _ = conn.execute(
          "UPDATE songs SET cover_thumb_path = ?1 WHERE path = ?2",
          rusqlite::params![&cache_path_str, &path],
        );
      }
    }
    return Ok(cache_path_str);
  }
  Ok(String::new())
}

#[tauri::command]
pub async fn get_song_cover(
  path: String,
  app: AppHandle,
  semaphore: State<'_, FullCoverImageConcurrencyLimit>,
  db_state: State<'_, DbState>,
) -> Result<String, String> {
  let _permit = semaphore.0.acquire().await.map_err(|e| e.to_string())?;
  let source_path = match is_remote_uri(&path) {
    true => ensure_cached_path(&app, &db_state, &path).await?,
    false => path.clone(),
  };

  let cache_dir = get_cover_cache_dir(&app);
  let local_target = PathBuf::from(&source_path);
  let full_cover_path = tauri::async_runtime::spawn_blocking(move || {
    covers::get_or_create_full_cover(&local_target, &cache_dir)
  })
  .await
  .map_err(|e| e.to_string())?;

  if let Some(cache_path_str) = full_cover_path {
    return Ok(cache_path_str);
  }
  Ok(String::new())
}
