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
    pub mode: String,
    pub template: String,
    pub remove_track_prefix: bool,
    pub remove_source_prefix: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RenamePreview {
    pub original_path: String,
    pub original_name: String,
    pub new_name: String,
    pub status: String,
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

    if config.mode == "rules" || config.mode == "auto" {
        let mut cleaned_name = original_name.clone();

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
pub fn apply_rename(
    operations: Vec<RenameOperation>,
    db_state: tauri::State<'_, crate::database::DbState>,
) -> Result<u32, String> {
    let roots: Vec<PathBuf> = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT path FROM library_folders")
            .map_err(|e| e.to_string())?;
        let paths: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        paths.into_iter().map(PathBuf::from).collect()
    };

    if roots.is_empty() {
        return Err("音乐库为空，请先在音乐库中添加文件夹".to_string());
    }

    let mut success_count = 0;

    for mut op in operations {
        let validated_path = path_validator::validate_path(&op.original_path, Some(&roots))?;
        op.original_path = validated_path.to_string_lossy().to_string();
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

fn authorized_programs_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))
        .map(|dir| dir.join("authorized_programs.json"))
}

fn read_authorized_programs(app_handle: &tauri::AppHandle) -> Vec<PathBuf> {
    let Ok(path) = authorized_programs_path(app_handle) else {
        return Vec::new();
    };
    let Ok(content) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&content)
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

fn save_authorized_programs(
    app_handle: &tauri::AppHandle,
    programs: &[PathBuf],
) -> Result<(), String> {
    let path = authorized_programs_path(app_handle)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建应用数据目录失败: {e}"))?;
    }
    let entries: Vec<String> = programs
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    let content = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| format!("写入授权程序列表失败: {e}"))
}

#[tauri::command]
pub fn register_external_program(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut dialog = app_handle.dialog().file();
    #[cfg(target_os = "windows")]
    {
        dialog = dialog.add_filter("可执行文件", &["exe"]);
    }
    let Some(picked) = dialog.blocking_pick_file() else {
        return Ok(String::new());
    };
    let program_path = picked
        .into_path()
        .map_err(|e| format!("解析所选路径失败: {e}"))?;

    if !program_path.is_file() {
        return Err(format!("目标程序文件不存在: {}", program_path.display()));
    }

    #[cfg(target_os = "windows")]
    {
        let ext = program_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if ext != "exe" {
            return Err(format!("仅允许添加 .exe 程序，当前扩展名: .{ext}"));
        }
    }

    let canonical = program_path
        .canonicalize()
        .map_err(|e| format!("路径规范化失败: {e}"))?;

    let mut programs = read_authorized_programs(&app_handle);
    if !programs.contains(&canonical) {
        programs.push(canonical.clone());
        save_authorized_programs(&app_handle, &programs)?;
    }

    Ok(canonical.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_external_program(
    app_handle: tauri::AppHandle,
    path: String,
    args: Vec<String>,
) -> Result<(), String> {
    use std::process::Command;

    let validated = path_validator::validate_path(&path, None)?;

    if !validated.is_file() {
        return Err(format!("目标程序文件不存在: {}", validated.display()));
    }

    if !read_authorized_programs(&app_handle).contains(&validated) {
        return Err("该程序未获授权，请先在工具箱中重新选择".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let ext = validated
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if ext != "exe" {
            return Err(format!("仅允许启动 .exe 程序，当前扩展名: .{ext}"));
        }
    }

    if args.len() > 1 {
        return Err("最多允许传递一个启动参数".to_string());
    }

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

const DOWNLOAD_DIR_FILE: &str = "download_dir.json";

fn download_dir_config_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))
        .map(|dir| dir.join(DOWNLOAD_DIR_FILE))
}

pub fn read_authorized_download_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = download_dir_config_path(app_handle)?;
    if !path.is_file() {
        return Err("未设置下载目录，请先在设置中选择下载目录".to_string());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取下载目录配置失败: {e}"))?;
    let dir = PathBuf::from(content.trim());
    if !dir.is_dir() {
        return Err("下载目录不可用，请重新在设置中选择下载目录".to_string());
    }
    Ok(dir)
}

#[tauri::command]
pub fn register_download_directory(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let Some(picked) = app_handle.dialog().file().blocking_pick_folder() else {
        return Ok(String::new());
    };
    let dir = picked
        .into_path()
        .map_err(|e| format!("解析所选路径失败: {e}"))?;
    if !dir.is_dir() {
        return Err(format!("所选路径不是目录: {}", dir.display()));
    }

    let config_path = download_dir_config_path(&app_handle)?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建应用数据目录失败: {e}"))?;
    }
    fs::write(&config_path, dir.to_string_lossy().as_bytes())
        .map_err(|e| format!("写入下载目录配置失败: {e}"))?;

    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn resolve_download_path(
    app_handle: tauri::AppHandle,
    file_name: String,
    overwrite_existing: bool,
) -> Result<String, String> {
    let dir = read_authorized_download_dir(&app_handle)?;
    let file_name = path_validator::sanitize_filename_component(&file_name)?;
    let direct = dir.join(&file_name);

    if overwrite_existing || !direct.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建下载目录失败: {e}"))?;
        return Ok(direct.to_string_lossy().to_string());
    }

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

    Ok(direct.to_string_lossy().to_string())
}

// ==================== 下载文件名统一计算 ====================

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
    trimmed.chars().take(180).collect()
}

fn ext_from_url(url: &str) -> String {
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

fn is_lossless_quality(quality: &str) -> bool {
    matches!(quality, "flac" | "flac24bit" | "hires" | "vinyl" | "master")
}

fn ext_from_quality(quality: &str) -> String {
    if is_lossless_quality(quality) {
        ".flac".to_string()
    } else {
        ".mp3".to_string()
    }
}

fn build_filename_base(title: &str, artist: &str, album: &str, style: &str) -> String {
    let title = if title.is_empty() {
        "未知歌曲"
    } else {
        title
    };
    let parts: Vec<&str> = match style {
        "title-artist" => vec![title, artist],
        "title-artist-album" => vec![title, artist, album],
        _ => vec![artist, title],
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

#[tauri::command]
pub fn resolve_download_full_path(
    app_handle: tauri::AppHandle,
    title: String,
    artist: String,
    album: String,
    url: String,
    quality: String,
    keep_source_filename: bool,
    file_name_style: String,
    overwrite_existing: bool,
) -> Result<String, String> {
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
    resolve_download_path(app_handle, file_name, overwrite_existing)
}

#[tauri::command]
pub fn build_download_basename(
    title: String,
    artist: String,
    album: String,
    file_name_style: String,
) -> String {
    let base = build_filename_base(&title, &artist, &album, &file_name_style);
    let cleaned = sanitize_download_filename(&base);
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

#[cfg(not(target_os = "windows"))]
pub fn gpu_config_path() -> Result<PathBuf, String> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".local").join("share"))
        })
        .ok_or_else(|| "XDG_DATA_HOME/HOME environment variable not found".to_string())?;
    Ok(base.join(APP_IDENTIFIER).join(GPU_CONFIG_FILE))
}

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

use std::time::{Duration, SystemTime};

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
        .redirect(ssrf::ssrf_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .user_agent("XY-Music-Updater")
        .build()
        .map_err(|e| format!("创建下载请求客户端失败: {e}"))?;

    let mut download_url = url.clone();
    if download_url.contains("github.com") {
        download_url = format!("https://gh-proxy.com/{}", download_url);
    }

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
    } else if url_lower.contains(".deb") {
        "XianYu.Player_Setup.deb"
    } else if url_lower.contains(".rpm") {
        "XianYu.Player_Setup.rpm"
    } else if url_lower.contains(".appimage") {
        "XianYu.Player_Setup.AppImage"
    } else if url_lower.contains(".dmg") {
        "XianYu.Player_Setup.dmg"
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

#[derive(Debug, Clone, serde::Serialize)]
pub struct SongDownloadProgress {
    pub progress: f64,
    pub downloaded: u64,
    pub total: u64,
    pub speed: f64,
}

pub(crate) fn media_url_candidates(url: &str) -> Vec<String> {
    match url.strip_prefix("http://") {
        Some(rest) => vec![format!("https://{rest}"), url.to_string()],
        None => vec![url.to_string()],
    }
}

#[tauri::command]
pub async fn download_online_song(
    app_handle: tauri::AppHandle,
    url: String,
    file_name: String,
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

    ssrf::validate_outbound_url(&url)
        .await
        .map_err(|e| format!("下载链接校验失败: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .redirect(ssrf::ssrf_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建下载请求客户端失败: {e}"))?;

    let send_with_range = |req_url: &str, with_range: bool| {
        let mut builder = client.get(req_url).header(
            "Accept",
            "audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,application/ogg;q=0.7,video/*;q=0.6,*/*;q=0.5",
        );
        if with_range {
            builder = builder.header("Range", "bytes=0-");
        }
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

    let mut response: Option<reqwest::Response> = None;
    let mut last_err = String::new();
    for candidate in media_url_candidates(&url) {
        match send_with_range(&candidate, true).await {
            Ok(resp) if resp.status().is_success() => {
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
                    last_err =
                        format!("https 候选返回非音频内容 (Content-Type: {})，回退 http", ct);
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

    let dir = read_authorized_download_dir(&app_handle)?;
    let file_name = path_validator::sanitize_filename_component(&file_name)
        .map_err(|e| format!("下载文件名非法: {e}"))?;
    let dest = dir.join(&file_name);
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

    if total_size > 0 && downloaded < total_size {
        let _ = tokio::fs::remove_file(&dest).await;
        return Err(format!(
            "下载不完整（{downloaded}/{total_size} 字节），可能被其他下载器（如 IDM）拦截。请在下载器设置中排除本应用，或临时退出下载器后重试。"
        ));
    }

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

fn try_extract_ekey_from_file(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    let file_size = metadata.len();
    if file_size < 8 {
        return None;
    }

    let tail_size = (file_size.min(4096)) as usize;
    let mut file = fs::File::open(path).ok()?;
    use std::io::{Read, Seek, SeekFrom};
    file.seek(SeekFrom::Start(file_size - tail_size as u64))
        .ok()?;
    let mut tail = vec![0u8; tail_size];
    file.read_exact(&mut tail).ok()?;

    crate::player::qmc2::extract_ekey_from_footer(&tail)
}

fn decrypt_qmc_file_inplace(path: &Path, ekey: &str) -> Result<u64, String> {
    use std::io::{Read, Write};

    let crypto = crate::player::qmc2::QmcCrypto::from_ekey(ekey)
        .map_err(|e| format!("ekey 解析失败: {e}"))?;

    let file_size = fs::metadata(path)
        .map_err(|e| format!("读取文件元数据失败: {e}"))?
        .len();

    let temp_path = path.with_extension("qmc_tmp_dec");

    {
        let mut input = fs::File::open(path).map_err(|e| format!("打开加密文件失败: {e}"))?;
        let mut output =
            fs::File::create(&temp_path).map_err(|e| format!("创建临时解密文件失败: {e}"))?;

        let mut offset: u64 = 0;
        let mut buf = vec![0u8; 64 * 1024];

        loop {
            let n = input
                .read(&mut buf)
                .map_err(|e| format!("读取加密数据失败: {e}"))?;
            if n == 0 {
                break;
            }
            crypto.decrypt(offset as usize, &mut buf[..n]);
            output
                .write_all(&buf[..n])
                .map_err(|e| format!("写入解密数据失败: {e}"))?;
            offset += n as u64;
        }

        output
            .flush()
            .map_err(|e| format!("刷新解密文件失败: {e}"))?;
    }

    fs::rename(&temp_path, path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("替换原文件失败: {e}")
    })?;

    Ok(file_size)
}

#[tauri::command]
pub fn decrypt_qmc_file(file_path: String, ekey: Option<String>) -> Result<bool, String> {
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
        Ok(false)
    }
}

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

    ssrf::validate_outbound_url(&url)
        .await
        .map_err(|e| format!("图片链接校验失败: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
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

#[derive(Debug, Deserialize)]
pub struct SaveDialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

pub fn pick_save_path(
    app_handle: &tauri::AppHandle,
    default_file_name: &str,
    filter: Option<&SaveDialogFilter>,
) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_name = path_validator::sanitize_filename_component(default_file_name)?;

    let mut dialog = app_handle.dialog().file();
    dialog = dialog.set_file_name(&file_name);
    if let Some(f) = filter {
        let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
        dialog = dialog.add_filter(&f.name, &exts);
    }

    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    Ok(Some(
        picked
            .into_path()
            .map_err(|e| format!("解析所选路径失败: {e}"))?,
    ))
}

fn write_file_bytes(dest: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::write(dest, data).map_err(|e| format!("写入文件失败: {e}"))
}

#[tauri::command]
pub fn save_text_via_dialog(
    app_handle: tauri::AppHandle,
    default_file_name: String,
    filter: Option<SaveDialogFilter>,
    content: String,
) -> Result<Option<String>, String> {
    let Some(dest) = pick_save_path(&app_handle, &default_file_name, filter.as_ref())? else {
        return Ok(None);
    };
    write_file_bytes(&dest, content.as_bytes())?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn save_bytes_via_dialog(
    app_handle: tauri::AppHandle,
    default_file_name: String,
    filter: Option<SaveDialogFilter>,
    data: Vec<u8>,
) -> Result<Option<String>, String> {
    if data.is_empty() {
        return Err("保存数据为空".to_string());
    }
    let Some(dest) = pick_save_path(&app_handle, &default_file_name, filter.as_ref())? else {
        return Ok(None);
    };
    write_file_bytes(&dest, &data)?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

#[derive(Debug, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeDownloadExtrasRequest {
    pub lyrics_text: Option<String>,
    pub lyrics_path: Option<String>,
    pub cover_url: Option<String>,
    pub cover_path: Option<String>,
    pub metadata: Option<EmbedMetadataRequest>,
    pub embed_cover: bool,
}

#[derive(Debug, Serialize, Default)]
pub struct FinalizeDownloadExtrasResult {
    pub lyrics_saved: bool,
    pub cover_saved: bool,
    pub metadata_embedded: bool,
    pub metadata_error: Option<String>,
    pub cover_data: Option<Vec<u8>>,
    pub cover_mime: String,
}

#[tauri::command]
pub async fn finalize_download_extras(
    app_handle: tauri::AppHandle,
    request: FinalizeDownloadExtrasRequest,
) -> Result<FinalizeDownloadExtrasResult, String> {
    let mut result = FinalizeDownloadExtrasResult::default();

    let download_dir = if request.lyrics_path.is_some() || request.cover_path.is_some() {
        Some(read_authorized_download_dir(&app_handle)?)
    } else {
        None
    };

    if let (Some(text), Some(name)) = (&request.lyrics_text, &request.lyrics_path) {
        if !text.is_empty() {
            let dir = download_dir.clone().ok_or("下载目录未授权")?;
            let name = path_validator::sanitize_filename_component(name)?;
            let dest = dir.join(name);
            match tokio::fs::write(&dest, text).await {
                Ok(_) => result.lyrics_saved = true,
                Err(_) => {}
            }
        }
    }

    if let Some(url) = &request.cover_url {
        if !url.is_empty() && (url.starts_with("http://") || url.starts_with("https://")) {
            match fetch_image_bytes(url.clone()).await {
                Ok(img) => {
                    if let Some(name) = &request.cover_path {
                        let dir = download_dir.clone().ok_or("下载目录未授权")?;
                        let name = path_validator::sanitize_filename_component(name)?;
                        let actual_ext = if img.mime.contains("png") {
                            ".png"
                        } else {
                            ".jpg"
                        };
                        let name_str = name;
                        let final_name = if name_str.ends_with(".jpg") && actual_ext == ".png" {
                            format!("{}.png", &name_str[..name_str.len() - 4])
                        } else if name_str.ends_with(".png") && actual_ext == ".jpg" {
                            format!("{}.jpg", &name_str[..name_str.len() - 4])
                        } else {
                            name_str
                        };
                        let dest = dir.join(final_name);
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

    if let Some(mut meta) = request.metadata {
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

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProbeUrlInfo {
    pub url: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn probe_url_size(url: String) -> Result<ProbeUrlInfo, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("无效的探测链接".to_string());
    }

    ssrf::validate_outbound_url(&url)
        .await
        .map_err(|e| format!("探测链接校验失败: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(ssrf::ssrf_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建探测客户端失败: {e}"))?;

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

#[tauri::command]
pub fn is_store_build() -> bool {
    #[cfg(feature = "store-build")]
    let store = true;
    #[cfg(all(not(feature = "store-build"), target_os = "windows"))]
    let store = {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetCurrentPackageFullName(len: *mut u32, buf: *mut u16) -> i32;
        }
        const ERROR_INSUFFICIENT_BUFFER: i32 = 122;
        let mut len: u32 = 0;
        let rc = unsafe { GetCurrentPackageFullName(&mut len, std::ptr::null_mut()) };
        if rc == ERROR_INSUFFICIENT_BUFFER && len > 0 {
            let mut buf = vec![0u16; len as usize];
            let rc2 = unsafe { GetCurrentPackageFullName(&mut len, buf.as_mut_ptr()) };
            rc2 == 0
        } else {
            false
        }
    };
    #[cfg(all(not(feature = "store-build"), not(target_os = "windows")))]
    let store = false;
    store
}

#[tauri::command]
pub fn run_installer(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    use std::process::Command;

    let download_dir = app_handle
        .path()
        .download_dir()
        .map_err(|e| format!("获取下载目录失败: {e}"))?;

    let validated = path_validator::validate_path_in_dir(&path, &download_dir)?;

    let ext = validated
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    #[cfg(target_os = "windows")]
    let ext_allowed = ext == "msi" || ext == "exe";
    #[cfg(target_os = "linux")]
    let ext_allowed = ext == "deb" || ext == "rpm" || ext == "appimage";
    #[cfg(target_os = "macos")]
    let ext_allowed = ext == "dmg";
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    let ext_allowed = false;

    if !ext_allowed {
        return Err(format!(
            "仅允许运行当前平台支持的安装包（Windows: .msi/.exe；Linux: .deb/.rpm/.AppImage；macOS: .dmg），当前扩展名: .{ext}"
        ));
    }

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
            Command::new(&path_str)
                .spawn()
                .map_err(|e| format!("启动安装程序失败: {e}"))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        let _ = &ext;
        if ext == "appimage" {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = std::fs::metadata(&validated)
                    .map_err(|e| format!("读取安装包信息失败: {e}"))?
                    .permissions();
                if perms.mode() & 0o111 == 0 {
                    perms.set_mode(perms.mode() | 0o111);
                    std::fs::set_permissions(&validated, perms)
                        .map_err(|e| format!("设置执行权限失败: {e}"))?;
                }
            }
            Command::new(&path_str)
                .spawn()
                .map_err(|e| format!("启动 AppImage 失败: {e}"))?;
        } else {
            Command::new("xdg-open")
                .arg(&path_str)
                .spawn()
                .map_err(|e| format!("启动系统安装器失败: {e}"))?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        let script = "#!/bin/sh\n\
            # XY-Music 应用内更新安装脚本（参数: $1=dmg 路径）\n\
            sleep 2\n\
            MOUNT=$(hdiutil attach -nobrowse -readonly \"$1\" | grep -o '/Volumes/.*' | head -1)\n\
            if [ -z \"$MOUNT\" ]; then\n\
              exit 1\n\
            fi\n\
            APP=$(find \"$MOUNT\" -maxdepth 2 -name '*.app' -print | head -1)\n\
            if [ -n \"$APP\" ]; then\n\
              TARGET=\"/Applications/$(basename \"$APP\")\"\n\
              rm -rf \"$TARGET\"\n\
              cp -R \"$APP\" \"/Applications/\"\n\
              open \"$TARGET\"\n\
            fi\n\
            hdiutil detach \"$MOUNT\" >/dev/null 2>&1 || true\n";
        let script_path = std::env::temp_dir().join("xianyu_update_install.sh");
        std::fs::write(&script_path, script).map_err(|e| format!("写入安装脚本失败: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755));
        }
        Command::new("/bin/sh")
            .arg(&script_path)
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("启动更新脚本失败: {e}"))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = &ext;
        let _ = &path_str;
        return Err("当前平台不支持应用内安装更新".to_string());
    }

    Ok(())
}

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

#[tauri::command]
pub async fn download_wallpaper(
    app_handle: tauri::AppHandle,
    url: String,
    filename: String,
    protected_path: Option<String>,
) -> Result<String, String> {
    use tokio::fs::File;
    use tokio::io::AsyncWriteExt;

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("无效的壁纸下载链接".to_string());
    }

    ssrf::validate_outbound_url(&url)
        .await
        .map_err(|e| format!("壁纸链接校验失败: {e}"))?;

    let safe_name = std::path::Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("wallpaper.jpg")
        .to_string();
    let safe_name = if std::path::Path::new(&safe_name).extension().is_none() {
        format!("{safe_name}.jpg")
    } else {
        safe_name
    };
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
    drop(file);

    evict_wallpaper_cache(&wallpaper_dir, &dest_path, protected_path.as_deref()).await;

    Ok(dest_path.to_string_lossy().to_string())
}

const WALLPAPER_CACHE_LIMIT: u64 = 300 * 1024 * 1024;

async fn evict_wallpaper_cache(
    dir: &std::path::Path,
    fresh: &std::path::Path,
    protected: Option<&str>,
) {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return;
    };
    let mut files = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Ok(meta) = entry.metadata().await else { continue };
        if !meta.is_file() {
            continue;
        }
        files.push((
            entry.path(),
            meta.len(),
            meta.modified().unwrap_or(SystemTime::now()),
        ));
    }
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    if total <= WALLPAPER_CACHE_LIMIT {
        return;
    }
    files.sort_by_key(|f| f.2);
    for (path, size, _) in files {
        if path == fresh || Some(path.to_string_lossy().as_ref()) == protected {
            continue;
        }
        if tokio::fs::remove_file(&path).await.is_ok() {
            total = total.saturating_sub(size);
            if total <= WALLPAPER_CACHE_LIMIT {
                break;
            }
        }
    }
}

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
    let canonical_dir =
        std::fs::canonicalize(&wallpaper_dir).map_err(|e| format!("读取壁纸目录失败: {e}"))?;
    let canonical_target =
        std::fs::canonicalize(&target).map_err(|e| format!("读取壁纸文件失败: {e}"))?;
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
        assert_eq!(
            request.cover_url.as_deref(),
            Some("https://example.com/cover.jpg")
        );
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
