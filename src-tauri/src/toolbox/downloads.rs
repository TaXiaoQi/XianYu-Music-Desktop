use super::common::APP_IDENTIFIER;
use super::qmc::{decrypt_qmc_file_inplace, try_extract_ekey_from_file};
use crate::security::{path_validator, ssrf};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;

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

// async 命令在异步运行时线程执行：blocking_pick_folder 若在主线程（同步命令）调用，
// 会用 rx.recv() 卡死事件循环整个对话框时长，部分机型上表现为设置下载位置时窗口未响应/失败。
#[tauri::command]
pub async fn register_download_directory(app_handle: tauri::AppHandle) -> Result<String, String> {
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

#[tauri::command] // 实现
pub fn resolve_download_full_path(
    app_handle: tauri::AppHandle, // 实现
    title: String,
    artist: String,
    album: String,
    url: String, // 实现
    quality: String,
    keep_source_filename: bool,
    file_name_style: String,
    overwrite_existing: bool,
) -> Result<String, String> { // 实现
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

#[tauri::command] // 实现
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

    let client = crate::netproxy::client_builder()
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

const DOWNLOAD_HISTORY_FILE: &str = "download_history.json";

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

    let client = crate::netproxy::client_builder()
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
