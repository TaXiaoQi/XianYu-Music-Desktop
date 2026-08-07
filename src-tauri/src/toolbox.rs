use crate::music::tags::{
    extract_text_metadata, read_tagged_file_from_path, write_metadata_to_file, EmbedMetadataRequest,
};
use crate::music::utils::is_supported_library_extension;
use crate::security::path_validator;
use lofty::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize)]
pub struct RenameConfig {
    pub mode: String,     // "tags", "rules", "auto"
    pub template: String, // e.g. "{artist} - {title}"
    pub remove_track_prefix: bool,
    pub remove_source_prefix: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RenamePreview {
    pub original_path: String,
    pub original_name: String,
    pub new_name: String,
    pub status: String, // "tags" (success via tags), "rules" (cleaned via rules), "skipped" (no change/error)
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RenameOperation {
    pub original_path: String,
    pub new_name: String,
}

fn sanitize_filename(name: &str) -> String {
    let invalid_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let mut sanitized = String::new();
    for c in name.chars() {
        if invalid_chars.contains(&c) {
            sanitized.push('_');
        } else {
            sanitized.push(c);
        }
    }
    sanitized.trim().to_string()
}

fn process_file(path: &Path, config: &RenameConfig) -> RenamePreview {
    let original_name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let original_path_str = path.to_string_lossy().to_string();
    let ext = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Mode A: Standardize via Tags
    if config.mode == "tags" || config.mode == "auto" {
        if let Ok(tagged_file) = read_tagged_file_from_path(path) {
            let metadata = extract_text_metadata(&tagged_file);
            let title = metadata.title.unwrap_or_default();
            let artist = metadata.artist.unwrap_or_default();
            let album = metadata.album.unwrap_or_default();

            let year = tagged_file
                .primary_tag()
                .and_then(|tag| tag.year())
                .map(|y| y.to_string())
                .unwrap_or_default();
            let track = tagged_file
                .primary_tag()
                .and_then(|tag| tag.track())
                .map(|t| format!("{:02}", t))
                .unwrap_or_default();

            if !title.is_empty() {
                let mut new_name_base = config.template.clone();
                new_name_base = new_name_base.replace("{title}", &title);
                new_name_base = new_name_base.replace("{artist}", &artist);
                new_name_base = new_name_base.replace("{album}", &album);
                new_name_base = new_name_base.replace("{year}", &year);
                new_name_base = new_name_base.replace("{track}", &track);

                let new_name = format!("{}.{}", sanitize_filename(&new_name_base), ext);

                if new_name != original_name {
                    return RenamePreview {
                        original_path: original_path_str,
                        original_name,
                        new_name,
                        status: "tags".to_string(),
                        error: None,
                    };
                } else if config.mode == "tags" {
                    return RenamePreview {
                        original_path: original_path_str,
                        original_name: original_name.clone(),
                        new_name: original_name,
                        status: "skipped".to_string(),
                        error: Some("Already named correctly".to_string()),
                    };
                }
            }
        }

        // If mode is "tags" and we failed, return skipped
        if config.mode == "tags" {
            return RenamePreview {
                original_path: original_path_str,
                original_name: original_name.clone(),
                new_name: original_name,
                status: "skipped".to_string(),
                error: Some("Missing tags".to_string()),
            };
        }
    }

    // Mode B: Clean via Rules (or Auto fallback)
    if config.mode == "rules" || config.mode == "auto" {
        let mut cleaned_name = original_name.clone();

        // Apply regex rules only to the stem (filename without extension)
        if let Some(stem) = path.file_stem() {
            let mut stem_str = stem.to_string_lossy().to_string();

            if config.remove_track_prefix {
                let re = Regex::new(r"^\d+[\.\-\s]+").unwrap();
                stem_str = re.replace(&stem_str, "").to_string();
            }

            if config.remove_source_prefix {
                let re = Regex::new(r"^\s*\[.*?\]\s*").unwrap();
                stem_str = re.replace(&stem_str, "").to_string();
            }

            cleaned_name = format!("{}.{}", stem_str.trim(), ext);
        }

        if cleaned_name != original_name {
            return RenamePreview {
                original_path: original_path_str,
                original_name,
                new_name: cleaned_name,
                status: "rules".to_string(),
                error: None,
            };
        }
    }

    // Fallback: Skipped
    RenamePreview {
        original_path: original_path_str,
        original_name: original_name.clone(),
        new_name: original_name,
        status: "skipped".to_string(),
        error: Some("No rules matched or missing tags".to_string()),
    }
}

#[tauri::command]
pub fn preview_rename(
    root_path: String,
    config: RenameConfig,
) -> Result<Vec<RenamePreview>, String> {
    let _validated_root = path_validator::validate_path(&root_path, None)?;
    let root_path = _validated_root.to_string_lossy().to_string();
    let mut results = Vec::new();

    for entry in WalkDir::new(root_path)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                let ext = ext.to_string_lossy().to_lowercase();
                if is_supported_library_extension(&ext) {
                    results.push(process_file(path, &config));
                }
            }
        }
    }

    // Sort logic: changed files first
    results.sort_by(|a, b| {
        let a_changed = a.status != "skipped";
        let b_changed = b.status != "skipped";
        if a_changed && !b_changed {
            std::cmp::Ordering::Less
        } else if !a_changed && b_changed {
            std::cmp::Ordering::Greater
        } else {
            a.original_name.cmp(&b.original_name)
        }
    });

    Ok(results)
}

#[tauri::command]
pub fn apply_rename(operations: Vec<RenameOperation>) -> Result<u32, String> {
    let mut success_count = 0;

    for mut op in operations {
        let validated_path = path_validator::validate_path(&op.original_path, None)?;
        op.original_path = validated_path.to_string_lossy().to_string();
        // Also sanitize new_name
        op.new_name = path_validator::sanitize_filename_component(&op.new_name)?;
        let src = PathBuf::from(&op.original_path);
        if let Some(parent) = src.parent() {
            let dest = parent.join(&op.new_name);
            if fs::rename(&src, &dest).is_ok() {
                success_count += 1;
            } else {
                eprintln!("Failed to rename {:?} to {:?}", src, dest);
            }
        }
    }

    Ok(success_count)
}

#[tauri::command]
pub fn open_external_program(path: String, args: Vec<String>) -> Result<(), String> {
    use std::process::Command;

    let validated = path_validator::validate_path(&path, None)?;

    // 确保路径指向一个实际存在的文件
    if !validated.is_file() {
        return Err(format!("目标程序文件不存在: {}", validated.display()));
    }

    // 扩展名白名单：Windows 仅允许 .exe，其他平台允许常见可执行扩展名
    #[cfg(target_os = "windows")]
    {
        let ext = validated
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if ext != "exe" {
            return Err(format!(
                "仅允许启动 .exe 程序，当前扩展名: .{ext}"
            ));
        }
    }

    // 清理参数：拒绝包含空字节或其他控制字符的参数
    let safe_args: Vec<String> = args
        .into_iter()
        .map(|arg| {
            if arg.contains('\0') {
                return Err("参数包含非法空字节".to_string());
            }
            Ok(arg)
        })
        .collect::<Result<Vec<_>, _>>()?;

    let mut cmd = Command::new(&validated);
    for arg in safe_args {
        cmd.arg(arg);
    }

    cmd.spawn()
        .map_err(|e| format!("Failed to launch program: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn refresh_folder_songs(
    folder_path: String,
    minimum_duration_seconds: Option<u32>,
    db_state: tauri::State<'_, crate::database::DbState>,
) -> Result<Vec<crate::music::types::Song>, String> {
    let validated = path_validator::validate_path(&folder_path, None)?;
    let folder_path = validated.to_string_lossy().to_string();
    // 复用现有的扫描逻辑
    crate::music::scanner::scan_single_directory_internal(
        folder_path,
        db_state.conn.clone(),
        None,
        1,
        1,
        crate::music::scanner::ScanOptions::from_minimum_duration_seconds(minimum_duration_seconds),
    )
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    if path_validator::validate_path(&path, None).is_err() {
        return false;
    }
    std::path::Path::new(&path).is_file()
}

/// [项4 下载编排] 在目标目录中解析非冲突文件路径。
///
/// 替代前端 `resolveNonConflictingPath` 逐次调用 `file_exists` 的 N 次 IPC 往返。
/// 若文件已存在且 `overwrite_existing` 为 false，自动追加 ` (1)`/` (2)`… 直到不冲突。
#[tauri::command]
pub fn resolve_download_path(
    directory: String,
    file_name: String,
    overwrite_existing: bool,
) -> Result<String, String> {
    let validated_dir = path_validator::validate_path(&directory, None)?;
    let dir = validated_dir;
    let file_name = path_validator::sanitize_filename_component(&file_name)?;
    let direct = dir.join(&file_name);

    if overwrite_existing || !direct.exists() {
        // 确保目录存在
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建下载目录失败: {e}"))?;
        return Ok(direct.to_string_lossy().to_string());
    }

    // 分离扩展名
    let dot = file_name.rfind('.');
    let (stem, ext) = match dot {
        Some(idx) => (&file_name[..idx], &file_name[idx..]),
        None => (file_name.as_str(), ""),
    };

    for i in 1..1000 {
        let candidate_name = format!("{stem} ({i}){ext}");
        let candidate = dir.join(&candidate_name);
        if !candidate.exists() {
            return Ok(candidate.to_string_lossy().to_string());
        }
    }

    // 兜底：返回原始路径（极不可能走到这里）
    Ok(direct.to_string_lossy().to_string())
}

// ==================== 下载文件名统一计算 ====================
//
// 前端原先自带 sanitizeFileName / buildFileNameBase / buildDownloadFileName / extFromUrl /
// extFromQuality 等纯计算函数，与 Rust 侧 toolbox 的 sanitize_filename 规则不一致
//（前者替换非法字符为空格、限长 180；后者替换为下划线、不限长）。
// 现将下载专用的文件名计算统一下沉到 Rust，前端只传参数，避免两份命名规则漂移。

/// 下载文件名清洗：非法字符替换为空格、折叠连续空白、限长 180 字符
///
/// 与前端旧 sanitizeFileName 行为完全一致：
/// `<>:"/\\|?*` 及控制字符 \x00-\x1f → 空格 → 折叠连续空格 → trim → 截断 180 → 空则 "download"
fn sanitize_download_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let collapsed: String = sanitized.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim();
    if trimmed.is_empty() {
        return "download".to_string();
    }
    // 按 char 截断到 180 字符（与前端 .slice(0, 180) 一致）
    trimmed.chars().take(180).collect()
}

/// 从 URL 路径推断音频文件扩展名（含点，如 ".flac"）；无法识别返回空串
///
/// 仅接受常见音频扩展名，避免把 query 参数误判为扩展名
fn ext_from_url(url: &str) -> String {
    // 使用 reqwest 重导出的 url::Url 解析 URL，提取 pathname
    let path = match reqwest::Url::parse(url) {
        Ok(u) => u.path().to_string(),
        Err(_) => return String::new(),
    };
    let dot = match path.rfind('.') {
        Some(idx) => idx,
        None => return String::new(),
    };
    let ext = path[dot..].to_lowercase();
    match ext.as_str() {
        ".mp3" | ".flac" | ".wav" | ".m4a" | ".aac" | ".ape" | ".ogg" | ".wma" => ext,
        _ => String::new(),
    }
}

/// 判断音质档位是否属于无损类（用于推断扩展名）
///
/// 无损：flac, flac24bit, hires, vinyl, master → .flac
/// 有损：mgg, 128k, 192k, 320k, dolby, atmos, atmos_plus → .mp3
fn is_lossless_quality(quality: &str) -> bool {
    matches!(quality, "flac" | "flac24bit" | "hires" | "vinyl" | "master")
}

/// 根据命中的音质档位推断扩展名兜底
fn ext_from_quality(quality: &str) -> String {
    if is_lossless_quality(quality) {
        ".flac".to_string()
    } else {
        ".mp3".to_string()
    }
}

/// 按样式拼接文件名主体（不含扩展名）
///
/// 缺失字段会被跳过，避免出现 "歌名 -  - " 空段
fn build_filename_base(title: &str, artist: &str, album: &str, style: &str) -> String {
    let title = if title.is_empty() {
        "未知歌曲"
    } else {
        title
    };
    let parts: Vec<&str> = match style {
        "title-artist" => vec![title, artist],
        "title-artist-album" => vec![title, artist, album],
        _ => vec![artist, title], // "artist-title" 为默认
    };
    let joined: String = parts
        .iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(" - ");
    if joined.is_empty() {
        title.to_string()
    } else {
        joined
    }
}

/// 构造下载文件名（含扩展名，不含目录）
///
/// keep_source_filename 为真时使用 URL 原始文件名（去扩展名后清洗 + 追加推断的扩展名），
/// 否则按 style 拼接歌名/歌手/专辑后清洗 + 追加扩展名。
fn build_download_filename(
    title: &str,
    artist: &str,
    album: &str,
    url: &str,
    quality: &str,
    keep_source_filename: bool,
    style: &str,
) -> String {
    let ext = {
        let e = ext_from_url(url);
        if e.is_empty() {
            ext_from_quality(quality)
        } else {
            e
        }
    };

    if keep_source_filename {
        if let Ok(u) = reqwest::Url::parse(url) {
            let path = u.path();
            if let Some(base) = path.rsplit('/').next() {
                if let Some(dot_idx) = base.rfind('.') {
                    let stem = &base[..dot_idx];
                    // 使用 urlencoding crate 做 percent-decode（与前端 decodeURIComponent 一致）
                    let decoded = urlencoding::decode(stem)
                        .map(|cow| cow.into_owned())
                        .unwrap_or_else(|_| stem.to_string());
                    if !decoded.is_empty() {
                        return format!("{}{}", sanitize_download_filename(&decoded), ext);
                    }
                }
            }
        }
    }

    let base = build_filename_base(title, artist, album, style);
    format!("{}{}", sanitize_download_filename(&base), ext)
}

/// [项3 下载命名统一] 构建下载文件名并解析非冲突完整路径（单次 IPC）
///
/// 将前端原先的 buildDownloadFileName + joinPath + resolveNonConflictingPath 三步
/// 合并为一次 Rust 调用，确保文件名清洗规则在 Rust 侧统一实现。
///
/// 参数：
/// - `directory`: 下载目录
/// - `title`, `artist`, `album`: 歌曲元信息
/// - `url`: 音源直链（用于推断扩展名和原始文件名）
/// - `quality`: 命中的音质档位（如 "320k", "flac" 等，用于扩展名兜底）
/// - `keep_source_filename`: 是否保留 URL 原始文件名
/// - `file_name_style`: 命名样式 ("artist-title" | "title-artist" | "title-artist-album")
/// - `overwrite_existing`: 是否覆盖已存在文件
#[tauri::command]
pub fn resolve_download_full_path(
    directory: String,
    title: String,
    artist: String,
    album: String,
    url: String,
    quality: String,
    keep_source_filename: bool,
    file_name_style: String,
    overwrite_existing: bool,
) -> Result<String, String> {
    let validated_dir = path_validator::validate_path(&directory, None)?;
    let directory = validated_dir.to_string_lossy().to_string();
    let file_name = build_download_filename(
        &title,
        &artist,
        &album,
        &url,
        &quality,
        keep_source_filename,
        &file_name_style,
    );
    let file_name = path_validator::sanitize_filename_component(&file_name)?;
    // 复用已有的 resolve_download_path 逻辑
    resolve_download_path(directory, file_name, overwrite_existing)
}

/// [项3 下载命名统一] 构建下载附件（歌词/封面）的清洗后文件名基名（不含扩展名）
///
/// 供 downloadSongExtras 使用：歌词/封面文件命名需与音频文件名保持一致的前缀，
/// 但不需要扩展名（由调用方追加 .lrc / .jpg 等）。
#[tauri::command]
pub fn build_download_basename(
    title: String,
    artist: String,
    album: String,
    file_name_style: String,
) -> String {
    let base = build_filename_base(&title, &artist, &album, &file_name_style);
    let cleaned = sanitize_download_filename(&base);
    // 路径安全校验：确保文件名组件不含路径分隔符或目录遍历引用
    path_validator::sanitize_filename_component(&cleaned).unwrap_or_else(|_| "download".to_string())
}

const APP_IDENTIFIER: &str = "com.xymusic.desktop";
const GPU_CONFIG_FILE: &str = "gpu_config.json";
const DOWNLOAD_HISTORY_FILE: &str = "download_history.json";

#[derive(Debug, Serialize, Deserialize)]
struct GpuConfig {
    gpu_acceleration: bool,
}

#[cfg(target_os = "windows")]
pub fn gpu_config_path() -> Result<PathBuf, String> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|dir| dir.join(APP_IDENTIFIER).join(GPU_CONFIG_FILE))
        .ok_or_else(|| "APPDATA environment variable not found".to_string())
}

#[cfg(target_os = "windows")]
pub fn should_disable_gpu_for_startup() -> bool {
    let Ok(path) = gpu_config_path() else {
        return false;
    };

    if !path.exists() {
        return false;
    }

    let Ok(content) = fs::read_to_string(path) else {
        return false;
    };

    match serde_json::from_str::<GpuConfig>(&content) {
        Ok(config) => !config.gpu_acceleration,
        Err(_) => false,
    }
}

#[cfg(target_os = "windows")]
pub fn append_webview2_browser_arg(arg: &str) {
    const KEY: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";

    let current = std::env::var(KEY).unwrap_or_default();

    if current.split_whitespace().any(|item| item == arg) {
        return;
    }

    let next = if current.trim().is_empty() {
        arg.to_string()
    } else {
        format!("{} {}", current.trim(), arg)
    };

    std::env::set_var(KEY, next);
}

#[tauri::command]
pub fn set_gpu_acceleration(app_handle: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    use tauri::Manager;

    #[cfg(target_os = "windows")]
    let path = {
        let _ = app_handle;
        gpu_config_path()?
    };

    #[cfg(not(target_os = "windows"))]
    let path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(GPU_CONFIG_FILE);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let config = GpuConfig {
        gpu_acceleration: enabled,
    };

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;

    std::fs::write(path, content).map_err(|e| e.to_string())?;

    Ok(())
}

use std::time::Duration;

#[tauri::command]
pub async fn check_update_by_rust(owner: String, repo: String) -> Result<String, String> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/releases/latest");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("XY-Music-Updater")
        .build()
        .map_err(|e| format!("创建更新请求失败: {e}"))?;

    client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("请求更新接口失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("更新接口返回错误状态: {e}"))?
        .text()
        .await
        .map_err(|e| format!("读取更新数据失败: {e}"))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub progress: f64,
    pub downloaded: u64,
    pub total: u64,
    pub speed: f64,
}

#[tauri::command]
pub async fn download_update_file(
    app_handle: tauri::AppHandle,
    url: String,
) -> Result<String, String> {
    use std::time::Instant;
    use tauri::{Emitter, Manager};
    use tokio::fs::File;
    use tokio::io::AsyncWriteExt;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .user_agent("XY-Music-Updater")
        .build()
        .map_err(|e| format!("创建下载请求客户端失败: {e}"))?;

    let mut download_url = url.clone();
    if download_url.contains("github.com") {
        download_url = format!("https://gh-proxy.com/{}", download_url);
    }

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("发送下载请求失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载服务器返回错误状态: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let download_dir = app_handle
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?;

    let url_lower = url.to_lowercase();
    let filename = if url_lower.contains(".msi") {
        if url_lower.contains("portable") {
            "XianYu.Player_Setup_Portable.msi"
        } else {
            "XianYu.Player_Setup_Standard.msi"
        }
    } else if url_lower.contains(".exe") {
        if url_lower.contains("portable") {
            "XianYu.Player_Setup_Portable.exe"
        } else {
            "XianYu.Player_Setup_Standard.exe"
        }
    } else {
        "XianYu.Player_Setup.msi"
    };
    let dest_path = download_dir.join(filename);

    let mut file = File::create(&dest_path)
        .await
        .map_err(|e| format!("创建目标文件失败: {e}"))?;
    let mut downloaded: u64 = 0;
    let start_time = Instant::now();
    let mut last_emit = Instant::now();

    let mut response = response;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("下载数据分块失败: {e}"))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {e}"))?;
        downloaded += chunk.len() as u64;

        let now = Instant::now();
        if now.duration_since(last_emit).as_millis() >= 100 || downloaded == total_size {
            let elapsed = start_time.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                downloaded as f64 / elapsed
            } else {
                0.0
            };
            let progress = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };

            let payload = DownloadProgress {
                progress,
                downloaded,
                total: total_size,
                speed,
            };
            let _ = app_handle.emit("update-download-progress", payload);
            last_emit = now;
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("刷新文件缓存失败: {e}"))?;

    Ok(dest_path.to_string_lossy().to_string())
}

/// 在线歌曲下载进度事件负载。
#[derive(Debug, Clone, serde::Serialize)]
pub struct SongDownloadProgress {
    pub progress: f64,
    pub downloaded: u64,
    pub total: u64,
    pub speed: f64,
}

/// 下载在线歌曲的真实音源直链到指定目标路径（流式写入 + 进度回报）。
///
/// 前端负责解析音源直链、计算最终目标文件路径（含扩展名与命名冲突处理），
/// 此命令只负责下载与写盘，进度通过 `song-download-progress` 事件回报。
#[tauri::command]
pub async fn download_online_song(
    app_handle: tauri::AppHandle,
    url: String,
    dest_path: String,
) -> Result<String, String> {
    use std::time::Instant;
    use tauri::Emitter;
    use tokio::fs::File;
    use tokio::io::AsyncWriteExt;

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("无效的下载链接".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建下载请求客户端失败: {e}"))?;

    // 模拟浏览器媒体流请求（Accept/Range），降低被下载器识别为“文件下载”的概率。
    // 但部分音源 CDN 对开放式 Range（高品/无损直链节点尤其常见）会返回 502/416/403，
    // 此时自动回退到不带 Range 的普通 GET。
    let send_with_range = |with_range: bool| {
        let mut builder = client.get(&url).header(
            "Accept",
            "audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,application/ogg;q=0.7,video/*;q=0.6,*/*;q=0.5",
        );
        if with_range {
            builder = builder.header("Range", "bytes=0-");
        }
        builder.send()
    };

    let mut response = send_with_range(true)
        .await
        .map_err(|e| format!("发送下载请求失败: {e}"))?;
    let status_code = response.status().as_u16();
    if !response.status().is_success()
        && (status_code == 502 || status_code == 416 || status_code == 403)
    {
        response = send_with_range(false)
            .await
            .map_err(|e| format!("发送下载请求（无 Range 回退）失败: {e}"))?;
    }
    if !response.status().is_success() {
        return Err(format!("下载服务器返回错误状态: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);

    let dest = PathBuf::from(&dest_path);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建下载目录失败: {e}"))?;
    }

    let mut file = File::create(&dest)
        .await
        .map_err(|e| format!("创建目标文件失败: {e}"))?;
    let mut downloaded: u64 = 0;
    let start_time = Instant::now();
    let mut last_emit = Instant::now();

    let mut response = response;
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                file.write_all(&chunk)
                    .await
                    .map_err(|e| format!("写入文件失败: {e}"))?;
                downloaded += chunk.len() as u64;

                let now = Instant::now();
                if now.duration_since(last_emit).as_millis() >= 100 || downloaded == total_size {
                    let elapsed = start_time.elapsed().as_secs_f64();
                    let speed = if elapsed > 0.0 {
                        downloaded as f64 / elapsed
                    } else {
                        0.0
                    };
                    let progress = if total_size > 0 {
                        (downloaded as f64 / total_size as f64) * 100.0
                    } else {
                        0.0
                    };
                    let payload = SongDownloadProgress {
                        progress,
                        downloaded,
                        total: total_size,
                        speed,
                    };
                    let _ = app_handle.emit("song-download-progress", payload);
                    last_emit = now;
                }
            }
            Ok(None) => break,
            Err(e) => {
                // 下载中断，清理不完整文件
                drop(file);
                let _ = tokio::fs::remove_file(&dest).await;
                return Err(format!("下载数据分块失败: {e}"));
            }
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("刷新文件缓存失败: {e}"))?;
    drop(file);

    // 完整性校验：若服务器声明了文件大小但实际下载字节数不足，说明下载被中途干扰
    // （例如 IDM 等下载器接管/拦截了同一链接，导致本进程连接被打断），
    // 此时删除不完整文件并报错，避免留下“能双击但无法播放”的损坏文件。
    if total_size > 0 && downloaded < total_size {
        let _ = tokio::fs::remove_file(&dest).await;
        return Err(format!(
            "下载不完整（{downloaded}/{total_size} 字节），可能被其他下载器（如 IDM）拦截。请在下载器设置中排除本应用，或临时退出下载器后重试。"
        ));
    }

    // 发送最终 100% 进度，确保前端收到完成状态
    let elapsed = start_time.elapsed().as_secs_f64();
    let speed = if elapsed > 0.0 {
        downloaded as f64 / elapsed
    } else {
        0.0
    };
    let _ = app_handle.emit(
        "song-download-progress",
        SongDownloadProgress {
            progress: 100.0,
            downloaded,
            total: if total_size > 0 {
                total_size
            } else {
                downloaded
            },
            speed,
        },
    );

    Ok(dest.to_string_lossy().to_string())
}

/// 保存歌词文本到指定文件（用于下载歌曲时一并保存歌词）。
#[tauri::command]
pub async fn save_download_lyrics(content: String, dest_path: String) -> Result<String, String> {
    let validated = path_validator::validate_path(&dest_path, None)?;
    let dest = validated;
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建歌词目录失败: {e}"))?;
    }
    tokio::fs::write(&dest, content)
        .await
        .map_err(|e| format!("写入歌词文件失败: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

/// 通过 Rust 后端下载图片二进制数据（绕过 WebView 的 CORS 限制）。
///
/// 前端 `fetch()` 下载远程封面时会因 CORS 策略静默失败，
/// 此命令使用 `reqwest` 在 Rust 侧发起请求，返回图片字节和 Content-Type。
#[derive(Debug, Serialize)]
pub struct FetchedImage {
    pub data: Vec<u8>,
    pub mime: String,
}

#[tauri::command]
pub async fn fetch_image_bytes(url: String) -> Result<FetchedImage, String> {
    use std::time::Duration;

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("无效的图片链接".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建请求客户端失败: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求图片失败: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("图片服务器返回错误状态: {}", response.status()));
    }

    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let data = response
        .bytes()
        .await
        .map_err(|e| format!("读取图片数据失败: {e}"))?
        .to_vec();

    if data.is_empty() {
        return Err("图片数据为空".to_string());
    }

    Ok(FetchedImage { data, mime })
}

/// 将前端已下载的字节数据写入目标文件（用于前端 fetch 下载音频后落盘）。
///
/// 前端在 WebView 中用 fetch 拉取音频数据（IDM 等下载器默认不接管 AJAX 请求，
/// 可规避被拦截），再把字节交给此命令写盘。
#[tauri::command]
pub async fn save_download_bytes(data: Vec<u8>, dest_path: String) -> Result<String, String> {
    if data.is_empty() {
        return Err("下载数据为空".to_string());
    }
    let validated = path_validator::validate_path(&dest_path, None)?;
    let dest = validated;
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建下载目录失败: {e}"))?;
    }
    tokio::fs::write(&dest, &data)
        .await
        .map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

/// 将歌曲元数据（标题、艺术家、专辑、歌词、封面等）写入音频文件 tag。
///
/// 在 `spawn_blocking` 中执行，避免阻塞异步运行时。
/// 写入失败仅返回错误字符串，不中断下载主流程（由前端控制是否继续）。
#[tauri::command]
pub async fn embed_audio_metadata(request: EmbedMetadataRequest) -> Result<(), String> {
    let request = request.clone();
    tokio::task::spawn_blocking(move || write_metadata_to_file(&request))
        .await
        .map_err(|e| format!("元数据嵌入任务失败: {e}"))?
}

/// [项4 下载编排] 下载后收尾编排：歌词保存 + 封面下载保存 + 元数据嵌入，单次 IPC 完成。
///
/// 替代前端 `downloadSong` 在音频下载完成后发起的 3-4 次独立 IPC 调用
/// (`save_download_lyrics` + `fetch_image_bytes` + `save_download_bytes` + `embed_audio_metadata`)。
/// 所有子步骤独立执行，单步失败不影响其他步骤，最终统一返回各步骤结果。
#[derive(Debug, serde::Deserialize, Default)]
pub struct FinalizeDownloadExtrasRequest {
    /// 歌词：文本内容 + 保存路径；为 None 则不保存歌词文件
    pub lyrics_text: Option<String>,
    pub lyrics_path: Option<String>,
    /// 封面：远程 URL + 保存路径；URL 为 None 则不下载封面
    /// cover_path 为 None 时仅下载字节供元数据嵌入，不保存独立文件
    pub cover_url: Option<String>,
    pub cover_path: Option<String>,
    /// 元数据嵌入请求；为 None 则不嵌入
    pub metadata: Option<EmbedMetadataRequest>,
    /// 是否将下载的封面自动填充到元数据请求中
    pub embed_cover: bool,
}

#[derive(Debug, Serialize, Default)]
pub struct FinalizeDownloadExtrasResult {
    pub lyrics_saved: bool,
    pub cover_saved: bool,
    pub metadata_embedded: bool,
    /// 下载到的封面二进制数据（供前端后续使用，如嵌入已有数据的场景）
    pub cover_data: Option<Vec<u8>>,
    /// 封面 MIME 类型
    pub cover_mime: String,
}

#[tauri::command]
pub async fn finalize_download_extras(
    request: FinalizeDownloadExtrasRequest,
) -> Result<FinalizeDownloadExtrasResult, String> {
    let mut result = FinalizeDownloadExtrasResult::default();

    // 1. 保存歌词文件
    if let (Some(text), Some(path)) = (&request.lyrics_text, &request.lyrics_path) {
        if !text.is_empty() {
            let dest = PathBuf::from(path);
            if let Some(parent) = dest.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            match tokio::fs::write(&dest, text).await {
                Ok(_) => result.lyrics_saved = true,
                Err(e) => eprintln!("[finalize_download_extras] 保存歌词失败: {e}"),
            }
        }
    }

    // 2. 下载封面（用于独立文件保存和/或元数据嵌入）
    if let Some(url) = &request.cover_url {
        if !url.is_empty() && (url.starts_with("http://") || url.starts_with("https://")) {
            match fetch_image_bytes(url.clone()).await {
                Ok(img) => {
                    // 保存封面文件（若请求了独立文件保存）
                    if let Some(path) = &request.cover_path {
                        // 根据 MIME 类型确定正确的扩展名
                        let actual_ext = if img.mime.contains("png") {
                            ".png"
                        } else {
                            ".jpg"
                        };
                        // 若前端传入的路径扩展名与实际 MIME 不符，替换之
                        let final_path = if path.ends_with(".jpg") && actual_ext == ".png" {
                            format!("{}.png", &path[..path.len() - 4])
                        } else if path.ends_with(".png") && actual_ext == ".jpg" {
                            format!("{}.jpg", &path[..path.len() - 4])
                        } else {
                            path.clone()
                        };
                        let dest = PathBuf::from(&final_path);
                        if let Some(parent) = dest.parent() {
                            let _ = tokio::fs::create_dir_all(parent).await;
                        }
                        match tokio::fs::write(&dest, &img.data).await {
                            Ok(_) => {
                                result.cover_saved = true;
                            }
                            Err(e) => eprintln!("[finalize_download_extras] 保存封面失败: {e}"),
                        }
                    }
                    result.cover_data = Some(img.data);
                    result.cover_mime = img.mime;
                }
                Err(e) => eprintln!("[finalize_download_extras] 下载封面失败: {e}"),
            }
        }
    }

    // 3. 嵌入元数据
    if let Some(mut meta) = request.metadata {
        // 若请求了封面嵌入但未单独提供封面数据，使用步骤 2 下载的封面数据
        if request.embed_cover && meta.cover_data.is_none() {
            if let Some(data) = &result.cover_data {
                meta.cover_data = Some(data.clone());
                meta.cover_mime = Some(result.cover_mime.clone());
            }
        }
        let meta = meta.clone();
        match tokio::task::spawn_blocking(move || write_metadata_to_file(&meta)).await {
            Ok(Ok(())) => result.metadata_embedded = true,
            Ok(Err(e)) => eprintln!("[finalize_download_extras] 元数据嵌入失败: {e}"),
            Err(e) => eprintln!("[finalize_download_extras] 元数据嵌入任务失败: {e}"),
        }
    }

    Ok(result)
}

/// 下载记录文件路径：`%APPDATA%\com.xymusic.desktop\download_history.json`。
///
/// 与 `gpu_config_path` 保持同一目录约定。非 Windows 平台走 Tauri 的 app_data_dir。
fn download_history_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let _ = app_handle;
        return std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|dir| dir.join(APP_IDENTIFIER).join(DOWNLOAD_HISTORY_FILE))
            .ok_or_else(|| "APPDATA environment variable not found".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        use tauri::Manager;
        Ok(app_handle
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join(DOWNLOAD_HISTORY_FILE))
    }
}

/// 读取下载记录 JSON 文本。
///
/// 文件不存在或内容损坏时返回 `"{}"` 而不是报错，让前端始终能拿到可解析的结果。
/// 记录结构由前端定义（传 JSON 字符串而非结构体），后续加字段无需改动 Rust 侧。
#[tauri::command]
pub async fn read_download_history(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = download_history_path(&app_handle)?;
    if !path.is_file() {
        return Ok("{}".to_string());
    }
    match tokio::fs::read_to_string(&path).await {
        Ok(content) if !content.trim().is_empty() => Ok(content),
        Ok(_) => Ok("{}".to_string()),
        Err(e) => Err(format!("读取下载记录失败: {e}")),
    }
}

/// 写入下载记录 JSON 文本（整体覆盖），自动创建父目录。
#[tauri::command]
pub async fn write_download_history(
    app_handle: tauri::AppHandle,
    content: String,
) -> Result<(), String> {
    let path = download_history_path(&app_handle)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建下载记录目录失败: {e}"))?;
    }
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("写入下载记录失败: {e}"))?;
    Ok(())
}

/// 探测在线音频直链的大小与最终 URL（用于下载对话框显示各档位文件大小）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProbeUrlInfo {
    pub url: String,
    pub size: u64,
    /// 探测失败时的诊断信息，便于前端在控制台看到具体原因（403/超时等）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 用 `Range: bytes=0-0` 探测直链文件大小。
///
/// 支持 Range 的服务器返回 206 + `Content-Range: bytes 0-0/TOTAL`；
/// 不支持的返回 200 + `Content-Length`（整个文件大小）。
/// 之所以不先发 HEAD：很多音源 CDN 对 HEAD 返回 403/405，反而更慢。
#[tauri::command]
pub async fn probe_url_size(url: String) -> Result<ProbeUrlInfo, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("无效的探测链接".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建探测客户端失败: {e}"))?;

    let resp = match client
        .get(&url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .header(
            reqwest::header::ACCEPT,
            "audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,*/*;q=0.5",
        )
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Ok(ProbeUrlInfo {
                url,
                size: 0,
                error: Some(format!("请求失败: {e}")),
            });
        }
    };

    let final_url = resp.url().to_string();
    let status = resp.status();

    if status == reqwest::StatusCode::PARTIAL_CONTENT {
        let size = resp
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.rsplit('/').next())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        return Ok(ProbeUrlInfo {
            url: final_url,
            size,
            error: None,
        });
    }
    if status.is_success() {
        let size = resp
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(0);
        return Ok(ProbeUrlInfo {
            url: final_url,
            size,
            error: None,
        });
    }

    Ok(ProbeUrlInfo {
        url: final_url,
        size: 0,
        error: Some(format!("HTTP {status}")),
    })
}

#[tauri::command]
pub async fn fetch_announcement() -> Result<String, String> {
    // 公告数据源：自建服务器（xy.zh2026.cn），接口返回 {code, msg, data}
    // data 为公告对象或 null（无启用公告）。这里解包 data 后返回纯公告 JSON，前端接口无需改动。
    let url = "https://xy.zh2026.cn/chaoguan/public/api/app.php?action=app_announcement";

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("XY-Music-Updater")
        .http1_only() // 强制 HTTP/1.1，规避服务器 TLS 重协商下 HTTP/2 的兼容问题
        .build()
        .map_err(|e| format!("创建请求客户端失败: {e}"))?;

    let resp = client
        .get(url)
        .header("Accept", "application/json")
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|e| {
            // 打印完整错误链，便于诊断 TLS / DNS / 连接问题
            let mut msg = format!("请求公告接口失败: {e}");
            let mut src = std::error::Error::source(&e);
            while let Some(s) = src {
                msg.push_str(&format!(" | {s}"));
                src = s.source();
            }
            msg
        })?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取公告数据失败: {e}"))?;

    if !status.is_success() {
        let snippet: String = text.chars().take(200).collect();
        return Err(format!("公告接口返回错误状态: {status} | 响应: {snippet}"));
    }

    // 解包 {code, msg, data}：仅 code==200 时取 data
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(v) => {
            let code = v.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
            if code == 200 {
                match v.get("data") {
                    Some(d) if !d.is_null() => return Ok(d.to_string()),
                    _ => return Ok("{}".to_string()), // 无启用公告
                }
            }
            let msg = v
                .get("msg")
                .and_then(|m| m.as_str())
                .unwrap_or("公告接口返回未知错误");
            Err(format!("公告接口返回错误: {msg}"))
        }
        Err(_) => {
            let snippet: String = text.chars().take(200).collect();
            Err(format!("公告数据解析失败，原始响应: {snippet}"))
        }
    }
}

#[tauri::command]
pub fn run_installer(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    use std::process::Command;

    // 安全限制：仅允许执行系统下载目录中的 .msi / .exe 安装包
    let download_dir = app_handle
        .path()
        .download_dir()
        .map_err(|e| format!("获取下载目录失败: {e}"))?;

    let validated = path_validator::validate_path_in_dir(&path, &download_dir)?;

    // 扩展名白名单：仅允许 .msi 和 .exe
    let ext = validated
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    if ext != "msi" && ext != "exe" {
        return Err(format!(
            "仅允许运行 .msi 或 .exe 安装程序，当前扩展名: .{ext}"
        ));
    }

    // 确保文件实际存在
    if !validated.is_file() {
        return Err(format!("安装程序文件不存在: {}", validated.display()));
    }

    let path_str = validated.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        if ext == "msi" {
            Command::new("msiexec")
                .args(["/i", &path_str])
                .spawn()
                .map_err(|e| format!("启动 MSI 安装程序失败: {e}"))?;
        } else {
            // 直接启动 .exe，避免使用 cmd /C start 造成命令注入风险
            Command::new(&path_str)
                .spawn()
                .map_err(|e| format!("启动安装程序失败: {e}"))?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = &ext; // 非 Windows 平台不检查扩展名
        Command::new(&path_str)
            .spawn()
            .map_err(|e| format!("启动安装程序失败: {e}"))?;
    }

    Ok(())
}

/// 将 JSON 字符串写入 app_data_dir/state/{key}.json，用于持久化超过 localStorage 配额的大数据（如含 9000+ 歌曲的歌单）。
#[tauri::command]
pub async fn write_state_json(
    app_handle: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    let state_dir = app_dir.join("state");
    tokio::fs::create_dir_all(&state_dir)
        .await
        .map_err(|e| format!("创建 state 目录失败: {e}"))?;
    let file_path = state_dir.join(format!("{key}.json"));
    tokio::fs::write(&file_path, &value)
        .await
        .map_err(|e| format!("写入 state 文件失败: {e}"))?;
    Ok(())
}

/// 从 app_data_dir/state/{key}.json 读取 JSON 字符串。文件不存在时返回 null。
#[tauri::command]
pub async fn read_state_json(
    app_handle: tauri::AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    let file_path = app_dir.join("state").join(format!("{key}.json"));
    if !file_path.exists() {
        return Ok(None);
    }
    let content = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("读取 state 文件失败: {e}"))?;
    Ok(Some(content))
}

/// 下载壁纸图片到 app_data_dir/wallpapers/{filename}，返回本地文件路径。
/// 壁纸体积小，无需进度事件；下载到应用数据目录，更新应用不会丢失。
#[tauri::command]
pub async fn download_wallpaper(
    app_handle: tauri::AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
    use tokio::fs::File;
    use tokio::io::AsyncWriteExt;

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("无效的壁纸下载链接".to_string());
    }

    // 防止路径穿越：仅保留文件名部分，去除任何路径分隔符
    let safe_name = std::path::Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("wallpaper.jpg")
        .to_string();
    // 确保有图片扩展名，默认补 .jpg
    let safe_name = if std::path::Path::new(&safe_name).extension().is_none() {
        format!("{safe_name}.jpg")
    } else {
        safe_name
    };

    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    let wallpaper_dir = app_dir.join("wallpapers");
    tokio::fs::create_dir_all(&wallpaper_dir)
        .await
        .map_err(|e| format!("创建壁纸目录失败: {e}"))?;
    let dest_path = wallpaper_dir.join(&safe_name);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent("XY-Music-WallpaperDownloader")
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {e}"))?;

    let mut response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载壁纸失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载服务器返回错误状态: {}", response.status()));
    }

    let mut file = File::create(&dest_path)
        .await
        .map_err(|e| format!("创建文件失败: {e}"))?;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("读取响应数据失败: {e}"))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {e}"))?;
    }

    Ok(dest_path.to_string_lossy().to_string())
}
