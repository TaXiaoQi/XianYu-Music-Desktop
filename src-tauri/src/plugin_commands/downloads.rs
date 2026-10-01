use std::collections::HashMap;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;

use super::format_reqwest_error;
use crate::security::ssrf;

#[tauri::command]
pub async fn download_audio_to_temp(
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    ssrf::validate_outbound_url(&url)
        .await
        .map_err(|e| e.to_string())?;

    let client = crate::netproxy::client_builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(60))
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let baseline_headers = headers.unwrap_or_default();
    let mut current_url = url;

    let mut body: Option<Vec<u8>> = None;

    for _hop in 0..12 {
        let mut req = client.get(&current_url);
        for (key, value) in &baseline_headers {
            if !key.trim().is_empty() && !value.trim().is_empty() {
                req = req.header(key, value);
            }
        }
        let response = req.send().await.map_err(|e| e.to_string())?;

        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .map(|v| v.to_string());
            let Some(next_url) = location else {
                return Err(format!(
                    "Redirect without Location: HTTP {}",
                    response.status()
                ));
            };
            if next_url.trim().is_empty() {
                return Err(format!(
                    "Empty redirect Location from HTTP {}",
                    response.status()
                ));
            }
            current_url = if next_url.starts_with("http://") || next_url.starts_with("https://") {
                next_url
            } else {
                reqwest::Url::parse(&current_url)
                    .and_then(|base| base.join(&next_url))
                    .map(|u| u.to_string())
                    .unwrap_or(next_url)
            };
            ssrf::validate_outbound_url(&current_url)
                .await
                .map_err(|e| e.to_string())?;
            continue;
        }

        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status()));
        }
        body = Some(response.bytes().await.map_err(|e| e.to_string())?.to_vec());
        break;
    }

    let bytes = body.ok_or_else(|| "No response body".to_string())?;
    if bytes.is_empty() {
        return Err("Empty response".to_string());
    }

    let temp_dir = std::env::temp_dir();
    let file_name = format!(
        "xianyu_music_{}.m4s",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let temp_path = temp_dir.join(&file_name);
    std::fs::write(&temp_path, &bytes).map_err(|e| e.to_string())?;

    Ok(temp_path.to_string_lossy().to_string())
}

const MAX_BACKGROUND_VIDEO_BYTES: u64 = 512 * 1024 * 1024;

#[tauri::command]
pub async fn download_video_to_cache(
    app: tauri::AppHandle,
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Unsupported video URL".to_string());
    }

    ssrf::validate_outbound_url(&url)
        .await
        .map_err(|error| error.to_string())?;

    let client = crate::netproxy::client_builder()
        .timeout(Duration::from_secs(180))
        .redirect(ssrf::ssrf_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|error| error.to_string())?;

    let mut request = client.get(&url);
    if let Some(request_headers) = headers {
        for (key, value) in request_headers {
            if !key.trim().is_empty() && !value.trim().is_empty() {
                request = request.header(key, value);
            }
        }
    }

    let mut response = request.send().await.map_err(format_reqwest_error)?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_BACKGROUND_VIDEO_BYTES)
    {
        return Err("Video is too large for background playback".to_string());
    }

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("video-background");
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|error| error.to_string())?;
    let file_name = format!("xianyu_music_video_{}.mp4", uuid::Uuid::new_v4());
    let cache_path = cache_dir.join(file_name);
    let mut file = tokio::fs::File::create(&cache_path)
        .await
        .map_err(|error| error.to_string())?;

    let mut written = 0_u64;
    // 总长度已知时向前端推送下载进度（百分比变化才发，避免事件风暴）。
    let total = response.content_length();
    let mut last_percent = 0_u64;
    if total.is_some_and(|size| size > 0) {
        let _ = app.emit(
            "mv-download-progress",
            serde_json::json!({ "url": url.as_str(), "percent": 0 }),
        );
    }
    let download_result: Result<(), String> = async {
        while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
            written = written.saturating_add(chunk.len() as u64);
            if written > MAX_BACKGROUND_VIDEO_BYTES {
                return Err("Video is too large for background playback".to_string());
            }
            file.write_all(&chunk)
                .await
                .map_err(|error| error.to_string())?;
            if let Some(total) = total {
                if total > 0 {
                    let percent = written * 100 / total;
                    if percent != last_percent {
                        last_percent = percent;
                        let _ = app.emit(
                            "mv-download-progress",
                            serde_json::json!({ "url": url.as_str(), "percent": percent }),
                        );
                    }
                }
            }
        }
        file.flush().await.map_err(|error| error.to_string())?;
        Ok(())
    }
    .await;

    if let Err(error) = download_result {
        drop(file);
        let _ = tokio::fs::remove_file(&cache_path).await;
        return Err(error);
    }
    if written == 0 {
        drop(file);
        let _ = tokio::fs::remove_file(&cache_path).await;
        return Err("Empty video response".to_string());
    }

    Ok(cache_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn remove_cached_background_video(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("video-background");
    let canonical_cache = cache_dir.canonicalize().unwrap_or(cache_dir);
    let candidate = match std::path::PathBuf::from(&path).canonicalize() {
        Ok(c) => c,
        Err(_) => return Ok(()),
    };
    let file_name = candidate
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if candidate.parent() != Some(canonical_cache.as_path())
        || !file_name.starts_with("xianyu_music_video_")
    {
        return Err("Refusing to remove a non-background-video file".to_string());
    }
    tokio::fs::remove_file(&candidate)
        .await
        .map_err(|error| error.to_string())
}
