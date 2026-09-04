use crate::music::tags::{
    extract_text_metadata, read_tagged_file_from_path, write_metadata_to_file, EmbedMetadataRequest,
};
use crate::music::utils::is_supported_library_extension;
use crate::security::{path_validator, ssrf};
use lofty::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::Manager;
use walkdir::WalkDir;

static TRACK_PREFIX_RE: OnceLock<Regex> = OnceLock::new();
static SOURCE_PREFIX_RE: OnceLock<Regex> = OnceLock::new();

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
                let re = TRACK_PREFIX_RE.get_or_init(|| Regex::new(r"^\d+[\.\-\s]+").unwrap());
                stem_str = re.replace(&stem_str, "").to_string();
            }

            if config.remove_source_prefix {
                let re = SOURCE_PREFIX_RE.get_or_init(|| Regex::new(r"^\s*\[.*?\]\s*").unwrap());
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

    // 仅允许「打开单个目标文件/目录」语义：最多一个参数（现有调用方
    // ToolboxStep2 / SongInfoModal 均只传 0~1 个参数），封顶防止被用来
    // 向任意程序注入多条命令行参数。
    if args.len() > 1 {
        return Err("最多允许传递一个启动参数".to_string());
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
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
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
        // 每次跳转目标都需通过 SSRF 校验，防重定向到内网/元数据地址
        .redirect(ssrf::ssrf_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .user_agent("XY-Music-Updater")
        .build()
        .map_err(|e| format!("创建下载请求客户端失败: {e}"))?;

    let mut download_url = url.clone();
    if download_url.contains("github.com") {
        download_url = format!("https://gh-proxy.com/{}", download_url);
    }

    // SSRF 防护：更新包仅允许公网 http/https 直链
    ssrf::validate_outbound_url(&download_url)
        .await
        .map_err(|e| format!("更新包下载链接校验失败: {e}"))?;

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

/// 生成媒体流请求的 URL 候选：http 直链优先升级为 https。
///
/// IDM 等下载工具经 Winsock LSP 拦截系统级明文 HTTP 流量，按 URL 扩展名/
/// MIME 嗅探音频直链并弹窗接管；https 的 TLS 加密让嗅探失效。
/// 音源 CDN 不支持 https（连接失败/非 2xx）时由调用方回退原 http URL。
pub(crate) fn media_url_candidates(url: &str) -> Vec<String> {
    match url.strip_prefix("http://") {
        Some(rest) => vec![format!("https://{rest}"), url.to_string()],
        None => vec![url.to_string()],
    }
}

/// 下载在线歌曲的真实音源直链到指定目标路径（流式写入 + 进度回报）。
///
/// 前端负责解析音源直链、计算最终目标文件路径（含扩展名与命名冲突处理），
/// 此命令负责下载、写盘、以及 QMC2 解密（若提供 ekey），进度通过 `song-download-progress` 事件回报。
///
/// 新增参数：
/// - `ekey`: QMC2 加密密钥（Baka 插件加密音源，如 QQ 音乐 L2）。提供时下载后自动解密。
/// - `headers`: 自定义请求头（防盗链 Cookie/Referer 等）。
#[tauri::command]
pub async fn download_online_song(
    app_handle: tauri::AppHandle,
    url: String,
    dest_path: String,
    ekey: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<String, String> {
    use std::time::Instant;
    use tauri::Emitter;
    use tokio::fs::File;
    use tokio::io::AsyncWriteExt;

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("无效的下载链接".to_string());
    }

    // SSRF 防护：音源直链仅允许公网 http/https 目标，拒绝内网/回环/云元数据等
    ssrf::validate_outbound_url(&url)
        .await
        .map_err(|e| format!("下载链接校验失败: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        // 每个跳转目标都需通过 SSRF 校验，防重定向到内网/元数据地址
        .redirect(ssrf::ssrf_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建下载请求客户端失败: {e}"))?;

    // 模拟浏览器媒体流请求（Accept/Range），降低被下载器识别为“文件下载”的概率。
    // 但部分音源 CDN 对开放式 Range（高品/无损直链节点尤其常见）会返回 502/416/403，
    // 此时自动回退到不带 Range 的普通 GET。
    let send_with_range = |req_url: &str, with_range: bool| {
        let mut builder = client.get(req_url).header(
            "Accept",
            "audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,application/ogg;q=0.7,video/*;q=0.6,*/*;q=0.5",
        );
        if with_range {
            builder = builder.header("Range", "bytes=0-");
        }
        // 透传插件返回的自定义请求头（防盗链 Cookie/Referer/Origin 等）
        if let Some(ref hdrs) = headers {
            for (key, value) in hdrs {
                if key.eq_ignore_ascii_case("accept") || key.eq_ignore_ascii_case("range") {
                    continue;
                }
                builder = builder.header(key.as_str(), value.as_str());
            }
        }
        builder.send()
    };

    // http 直链优先升级 https（规避 IDM 等下载工具的系统级明文嗅探），
    // 每个 URL 候选先带 Range 请求，CDN 拒绝开放式 Range 时回退普通 GET。
    let mut response: Option<reqwest::Response> = None;
    let mut last_err = String::new();
    for candidate in media_url_candidates(&url) {
        match send_with_range(&candidate, true).await {
            Ok(resp) if resp.status().is_success() => {
                // https 升级候选返回 200 但内容非音频（CDN 错误页）时跳过，回退 http 原 URL
                let ct = resp
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_lowercase();
                let is_non_audio = ct.contains("text/html")
                    || ct.contains("application/json")
                    || ct.contains("text/plain")
                    || ct.contains("application/xml")
                    || ct.contains("text/xml");
                if is_non_audio && candidate.starts_with("https://") && url.starts_with("http://") {
                    last_err = format!("https 候选返回非音频内容 (Content-Type: {})，回退 http", ct);
                    continue;
                }
                response = Some(resp);
                break;
            }
            Ok(resp) => {
                let status_code = resp.status().as_u16();
                if status_code == 502 || status_code == 416 || status_code == 403 {
                    match send_with_range(&candidate, false).await {
                        Ok(resp) if resp.status().is_success() => {
                            response = Some(resp);
                            break;
                        }
                        Ok(resp) => last_err = format!("下载服务器返回错误状态: {}", resp.status()),
                        Err(e) => last_err = format!("发送下载请求失败: {e}"),
                    }
                } else {
                    last_err = format!("下载服务器返回错误状态: {}", resp.status());
                }
            }
            Err(e) => last_err = format!("发送下载请求失败: {e}"),
        }
    }
    let mut response = match response {
        Some(r) => r,
        None => return Err(last_err),
    };

    let total_size = response.content_length().unwrap_or(0);

    // 复检写入路径：拒绝目录穿越/符号链接逃逸，规范化后再落盘
    let dest = path_validator::validate_path(&dest_path, None)
        .map_err(|e| format!("下载目标路径非法: {e}"))?;
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

    // QMC2 解密：若提供了 ekey，下载的文件是 QMC2 加密数据，需要解密后才能播放/读取标签。
    // 解密在原地完成：读取加密文件 -> 逐块解密 -> 覆盖写回。
    // 若未提供 ekey 但文件头看起来像 QMC 加密，尝试从文件尾部提取 ekey（QTag/V1 footer）。
    if let Some(ref ek) = ekey {
        if !ek.is_empty() {
            match decrypt_qmc_file_inplace(&dest, ek) {
                Ok(_) => {}
                Err(e) => {
                    return Err(format!("QMC2 解密失败: {e}"));
                }
            }
        }
    } else if let Some(extracted_ekey) = try_extract_ekey_from_file(&dest) {
        match decrypt_qmc_file_inplace(&dest, &extracted_ekey) {
            Ok(_) => {}
            Err(e) => {
                return Err(format!("QMC2 解密失败（footer ekey）: {e}"));
            }
        }
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

/// 从文件尾部提取 QMC ekey（QTag/V1 footer 格式）。
/// 返回 base64 编码的 ekey 字符串，若文件不含 footer 则返回 None。
fn try_extract_ekey_from_file(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    let file_size = metadata.len();
    if file_size < 8 {
        return None;
    }

    // 只读取文件尾部 4KB 用于检测 footer
    let tail_size = (file_size.min(4096)) as usize;
    let mut file = fs::File::open(path).ok()?;
    use std::io::{Read, Seek, SeekFrom};
    file.seek(SeekFrom::Start(file_size - tail_size as u64)).ok()?;
    let mut tail = vec![0u8; tail_size];
    file.read_exact(&mut tail).ok()?;

    crate::player::qmc2::extract_ekey_from_footer(&tail)
}

/// 原地解密 QMC2 加密文件：读取加密内容，逐块解密，覆盖写回。
/// 返回解密后的文件大小（字节）。
fn decrypt_qmc_file_inplace(path: &Path, ekey: &str) -> Result<u64, String> {
    use std::io::{Read, Write};

    let crypto = crate::player::qmc2::QmcCrypto::from_ekey(ekey)
        .map_err(|e| format!("ekey 解析失败: {e}"))?;

    let file_size = fs::metadata(path)
        .map_err(|e| format!("读取文件元数据失败: {e}"))?
        .len();

    // 使用临时文件写入解密数据，完成后原子替换原文件
    let temp_path = path.with_extension("qmc_tmp_dec");

    {
        let mut input = fs::File::open(path)
            .map_err(|e| format!("打开加密文件失败: {e}"))?;
        let mut output = fs::File::create(&temp_path)
            .map_err(|e| format!("创建临时解密文件失败: {e}"))?;

        let mut offset: u64 = 0;
        let mut buf = vec![0u8; 64 * 1024]; // 64KB chunks

        loop {
            let n = input.read(&mut buf)
                .map_err(|e| format!("读取加密数据失败: {e}"))?;
            if n == 0 {
                break;
            }
            crypto.decrypt(offset as usize, &mut buf[..n]);
            output.write_all(&buf[..n])
                .map_err(|e| format!("写入解密数据失败: {e}"))?;
            offset += n as u64;
        }

        output.flush()
            .map_err(|e| format!("刷新解密文件失败: {e}"))?;
    }

    // 原子替换：重命名临时文件为原文件
    fs::rename(&temp_path, path)
        .map_err(|e| {
            let _ = fs::remove_file(&temp_path);
            format!("替换原文件失败: {e}")
        })?;

    // 返回解密后文件大小（QTag/V1 footer 会被移除，但 QmcCrypto::decrypt 不处理 footer 移除，
    // 解密后的文件包含原始音频数据 + footer 垃圾字节。
    // 实际上 QMC2 的 footer 在解密后仍存在但已被破坏，音频播放器通常能忽略尾部垃圾。
    // 若需要精确裁剪，可在此处检测并截断 footer。）
    Ok(file_size)
}

/// 原地解密 QMC2 加密文件（用于缓存复用路径）。
///
/// 当 ekey 已知时直接使用；否则尝试从文件尾部 footer 提取 ekey。
/// 若文件不含 QMC 加密特征（无 ekey、无 footer），返回 Ok(false) 表示无需解密。
#[tauri::command]
pub fn decrypt_qmc_file(
    file_path: String,
    ekey: Option<String>,
) -> Result<bool, String> {
    let validated = path_validator::validate_path(&file_path, None)?;
    let path = validated;

    if !path.is_file() {
        return Err(format!("文件不存在: {}", path.display()));
    }

    let actual_ekey = if let Some(ref ek) = ekey {
        if !ek.is_empty() {
            Some(ek.clone())
        } else {
            try_extract_ekey_from_file(&path)
        }
    } else {
        try_extract_ekey_from_file(&path)
    };

    if let Some(ek) = actual_ekey {
        match decrypt_qmc_file_inplace(&path, &ek) {
            Ok(_) => Ok(true),
            Err(e) => Err(format!("QMC2 解密失败: {e}")),
        }
    } else {
        // 无 ekey 且文件不含 QMC footer，可能是非加密音源，无需解密
        Ok(false)
    }
}

/// 保存歌词文本到指定文件（用于下载歌曲时一并保存歌词）。
#[tauri::command]
pub async fn save_download_lyrics(content: String, dest_path: String) -> Result<String, String> {
    write_text_file(content, dest_path).await
}

/// 将文本内容写入指定路径（通用文本写入，自动创建父目录）。
#[tauri::command]
pub async fn write_text_file(content: String, dest_path: String) -> Result<String, String> {
    let validated = path_validator::validate_path(&dest_path, None)?;
    let dest = validated;
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建目录失败: {e}"))?;
    }
    tokio::fs::write(&dest, content)
        .await
        .map_err(|e| format!("写入文件失败: {e}"))?;
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

    // SSRF 防护：图片直链仅允许公网 http/https 目标
    ssrf::validate_outbound_url(&url)
        .await
        .map_err(|e| format!("图片链接校验失败: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        // 每个跳转目标都需通过 SSRF 校验
        .redirect(ssrf::ssrf_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
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

/// [项4 下载编排] 下载后收尾编排：歌词保存 + 封面下载保存 + 元数据嵌入，单次 IPC 完成。
///
/// 替代前端 `downloadSong` 在音频下载完成后发起的 3-4 次独立 IPC 调用
/// (`save_download_lyrics` + `fetch_image_bytes` + `save_download_bytes` + `embed_audio_metadata`)。
/// 所有子步骤独立执行，单步失败不影响其他步骤，最终统一返回各步骤结果。
#[derive(Debug, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
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
    pub metadata_error: Option<String>,
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
                Err(_) => {}
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
                            Err(_) => {}
                        }
                    }
                    result.cover_data = Some(img.data);
                    result.cover_mime = img.mime;
                }
                Err(_) => {}
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
            Ok(Err(e)) => {
                result.metadata_error = Some(e);
            }
            Err(e) => {
                let msg = format!("元数据嵌入任务失败: {e}");
                result.metadata_error = Some(msg);
            }
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

    // SSRF 防护：探测目标仅允许公网 http/https 地址
    ssrf::validate_outbound_url(&url)
        .await
        .map_err(|e| format!("探测链接校验失败: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        // 每次跳转目标都需通过 SSRF 校验
        .redirect(ssrf::ssrf_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建探测客户端失败: {e}"))?;

    // http 直链优先 https（规避下载工具嗅探）；https 失败/非 2xx 时回退原 URL
    let candidates = media_url_candidates(&url);
    let mut resp_opt: Option<reqwest::Response> = None;
    let mut probe_err: Option<String> = None;
    for candidate in &candidates {
        match client
            .get(candidate)
            .header(reqwest::header::RANGE, "bytes=0-0")
            .header(
                reqwest::header::ACCEPT,
                "audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,*/*;q=0.5",
            )
            .send()
            .await
        {
            Ok(r) => {
                if r.status().is_success() || candidates.len() == 1 {
                    resp_opt = Some(r);
                    break;
                }
                // https 非 2xx：CDN 可能不支持 https，记录状态后回退 http
                if probe_err.is_none() {
                    probe_err = Some(format!("HTTP {}", r.status()));
                }
            }
            Err(e) => {
                if probe_err.is_none() {
                    probe_err = Some(format!("请求失败: {e}"));
                }
            }
        }
    }
    let resp = match resp_opt {
        Some(r) => r,
        None => {
            return Ok(ProbeUrlInfo {
                url,
                size: 0,
                error: probe_err,
            })
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

/// 是否运行在带 MSIX 包身份的进程中（Microsoft Store / winget MSIX 安装、
/// winapp CLI 带身份调试均视为商店环境）。
/// 用途：微软商店政策禁止应用绕过商店自行更新，前端更新检查据此跳过。
/// 实现：Win32 `GetCurrentPackageFullName`——普通 Win32 进程返回
/// APPMODEL_ERROR_NO_PACKAGE(15700)，带包身份时走两次调用返回完整包名。
/// 直接声明 kernel32 导入，不新增依赖。
#[tauri::command]
pub fn is_store_build() -> bool {
    #[cfg(target_os = "windows")]
    let store = {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetCurrentPackageFullName(len: *mut u32, buf: *mut u16) -> i32;
        }
        const ERROR_INSUFFICIENT_BUFFER: i32 = 122;
        let mut len: u32 = 0;
        // 第一次调用传空缓冲取包名长度；无包身份时返回 NO_PACKAGE 等非 122 值
        let rc = unsafe { GetCurrentPackageFullName(&mut len, std::ptr::null_mut()) };
        if rc == ERROR_INSUFFICIENT_BUFFER && len > 0 {
            let mut buf = vec![0u16; len as usize];
            let rc2 = unsafe { GetCurrentPackageFullName(&mut len, buf.as_mut_ptr()) };
            rc2 == 0
        } else {
            false
        }
    };
    #[cfg(not(target_os = "windows"))]
    let store = false;
    store
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
    let sanitized_key = path_validator::sanitize_filename_component(&key)
        .map_err(|e| format!("无效的 key: {}", e))?;
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    let state_dir = app_dir.join("state");
    tokio::fs::create_dir_all(&state_dir)
        .await
        .map_err(|e| format!("创建 state 目录失败: {e}"))?;
    let file_path = state_dir.join(format!("{sanitized_key}.json"));
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
    let sanitized_key = path_validator::sanitize_filename_component(&key)
        .map_err(|e| format!("无效的 key: {}", e))?;
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    let file_path = app_dir.join("state").join(format!("{sanitized_key}.json"));
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

    // SSRF 防护：壁纸源仅允许公网 http/https 目标
    ssrf::validate_outbound_url(&url)
        .await
        .map_err(|e| format!("壁纸链接校验失败: {e}"))?;

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
    // 文件名组件清洗：拒绝空/./..，防止特殊名逃逸
    let safe_name = crate::security::path_validator::sanitize_filename_component(&safe_name)?;

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
        // 每个跳转目标都需通过 SSRF 校验
        .redirect(ssrf::ssrf_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
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

/// 删除 app_data_dir/wallpapers 下的已下载壁纸文件。
#[tauri::command]
pub async fn delete_wallpaper_file(
    app_handle: tauri::AppHandle,
    local_path: String,
) -> Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    let wallpaper_dir = app_dir.join("wallpapers");
    let target = PathBuf::from(&local_path);

    if !target.exists() {
        return Ok(());
    }
    if !target.is_file() {
        return Err("目标不是可删除的壁纸文件".to_string());
    }
    let canonical_dir = std::fs::canonicalize(&wallpaper_dir)
        .map_err(|e| format!("读取壁纸目录失败: {e}"))?;
    let canonical_target = std::fs::canonicalize(&target)
        .map_err(|e| format!("读取壁纸文件失败: {e}"))?;
    if !canonical_target.starts_with(&canonical_dir) {
        return Err("只能删除应用壁纸目录中的文件".to_string());
    }
    tokio::fs::remove_file(&target)
        .await
        .map_err(|e| format!("删除壁纸文件失败: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::FinalizeDownloadExtrasRequest;

    #[test]
    fn finalize_download_extras_request_accepts_frontend_camel_case_payload() {
        let json = serde_json::json!({
            "lyricsText": "[00:00.00]测试歌词",
            "lyricsPath": "D:\\Music\\song.lrc",
            "coverUrl": "https://example.com/cover.jpg",
            "coverPath": "D:\\Music\\song.jpg",
            "embedCover": true,
            "metadata": {
                "filePath": "D:\\Music\\song.mp3",
                "title": "测试歌曲",
                "albumArtist": "测试专辑艺术家",
                "trackNumber": "7",
                "coverMime": "image/jpeg"
            }
        });

        let request: FinalizeDownloadExtrasRequest =
            serde_json::from_value(json).expect("frontend payload should deserialize");

        assert_eq!(request.lyrics_text.as_deref(), Some("[00:00.00]测试歌词"));
        assert_eq!(request.lyrics_path.as_deref(), Some("D:\\Music\\song.lrc"));
        assert_eq!(request.cover_url.as_deref(), Some("https://example.com/cover.jpg"));
        assert_eq!(request.cover_path.as_deref(), Some("D:\\Music\\song.jpg"));
        assert!(request.embed_cover);

        let metadata = request.metadata.expect("metadata should deserialize");
        assert_eq!(metadata.file_path, "D:\\Music\\song.mp3");
        assert_eq!(metadata.title.as_deref(), Some("测试歌曲"));
        assert_eq!(metadata.album_artist.as_deref(), Some("测试专辑艺术家"));
        assert_eq!(metadata.track_number.as_deref(), Some("7"));
        assert_eq!(metadata.cover_mime.as_deref(), Some("image/jpeg"));
    }
}
