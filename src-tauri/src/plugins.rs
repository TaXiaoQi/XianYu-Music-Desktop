use crate::security::path_validator;
use image::{GenericImageView, ImageEncoder};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::time::Duration;
use tauri::Manager;
use tokio::io::AsyncWriteExt;

#[derive(Serialize)]
pub struct PluginHttpResponse {
    pub status: u16,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[derive(Serialize)]
pub struct PluginHttpBinaryResponse {
    pub status: u16,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body_base64: String,
}

/// 异步 HTTP 请求 —— 使用 reqwest 异步客户端，不阻塞主线程
#[tauri::command]
pub async fn plugin_http_request(
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout: Option<u64>,
    follow: Option<u32>,
) -> Result<PluginHttpResponse, String> {
    let method =
        reqwest::Method::from_bytes(method.trim().as_bytes()).map_err(|error| error.to_string())?;

    let redirect_limit = follow.unwrap_or(10);
    let timeout_secs = timeout.unwrap_or(30);
    let client_builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(redirect_limit as usize))
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    let client = if timeout_secs == 0 {
        client_builder.build()
    } else {
        client_builder
            .timeout(Duration::from_secs(timeout_secs))
            .build()
    }
    .map_err(|error| error.to_string())?;

    let mut request = client.request(method, &url);
    if let Some(headers) = headers {
        for (key, value) in headers {
            if key.trim().is_empty() || value.trim().is_empty() {
                continue;
            }
            request = request.header(key, value);
        }
    }
    if let Some(body) = body {
        request = request.body(body);
    }

    let mut response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let mut response_headers = HashMap::new();
    for (key, value) in response.headers().iter() {
        if let Ok(value) = value.to_str() {
            response_headers.insert(key.as_str().to_string(), value.to_string());
        }
    }
    // 流式读取响应体，限制最大 50MB
    const MAX_BODY_SIZE: usize = 50 * 1024 * 1024;
    let body = {
        let mut buf = Vec::with_capacity(4096);
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    if buf.len() + chunk.len() > MAX_BODY_SIZE {
                        break;
                    }
                    buf.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                Err(e) => return Err(e.to_string()),
            }
        }
        String::from_utf8(buf).unwrap_or_else(|_| "[INVALID_UTF8]".to_string())
    };

    Ok(PluginHttpResponse {
        status,
        url: final_url,
        headers: response_headers,
        body,
    })
}

/// 异步二进制 HTTP 请求 —— 返回 base64 编码的 body，用于获取二进制歌词数据（如酷我 newlyric）
#[tauri::command]
pub async fn plugin_http_request_binary(
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout: Option<u64>,
    follow: Option<u32>,
) -> Result<PluginHttpBinaryResponse, String> {
    use base64::{engine::general_purpose, Engine as _};

    let method =
        reqwest::Method::from_bytes(method.trim().as_bytes()).map_err(|error| error.to_string())?;

    let redirect_limit = follow.unwrap_or(10);
    let request_timeout = Duration::from_secs(timeout.unwrap_or(30));
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(redirect_limit as usize))
        .timeout(request_timeout)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|error| error.to_string())?;

    let mut request = client.request(method, &url);
    if let Some(headers) = headers {
        for (key, value) in headers {
            if key.trim().is_empty() || value.trim().is_empty() {
                continue;
            }
            request = request.header(key, value);
        }
    }
    if let Some(body) = body {
        request = request.body(body);
    }

    let mut response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let mut response_headers = HashMap::new();
    for (key, value) in response.headers().iter() {
        if let Ok(value) = value.to_str() {
            response_headers.insert(key.as_str().to_string(), value.to_string());
        }
    }
    const MAX_BODY_SIZE: usize = 50 * 1024 * 1024; // 50MB
    let body_base64 = {
        let mut buf = Vec::with_capacity(4096);
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    if buf.len() + chunk.len() > MAX_BODY_SIZE {
                        break;
                    }
                    buf.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                Err(e) => return Err(e.to_string()),
            }
        }
        general_purpose::STANDARD.encode(&buf)
    };

    Ok(PluginHttpBinaryResponse {
        status,
        url: final_url,
        headers: response_headers,
        body_base64,
    })
}

/// 读取本地插件/备份文件内容
/// 支持 .js / .json / .txt / .m3u / .m3u8 格式
#[tauri::command]
pub fn read_plugin_file(path: String) -> Result<String, String> {
    // 路径安全校验：拒绝目录遍历攻击
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
        return Err(format!("不支持的文件类型: .{} (仅支持 .js/.json/.txt/.m3u/.m3u8)", ext));
    }

    let metadata = fs::metadata(path_obj).map_err(|error| format!("读取文件元数据失败: {}", error))?;
    // JSON 备份文件可能包含封面 data URI 和歌词，允许更大体积（50MB）；
    // 其他文本文件（JS/TXT/M3U）保持 5MB 上限
    let max_size = if ext == "json" {
        50 * 1024 * 1024
    } else {
        5 * 1024 * 1024
    };
    if metadata.len() > max_size {
        return Err(format!("文件过大: {} MB (上限 {} MB)", metadata.len() / 1024 / 1024, max_size / 1024 / 1024));
    }

    fs::read_to_string(path_obj).map_err(|error| format!("读取文件内容失败: {}", error))
}

/// 将插件脚本保存到 app_data_dir/plugins/{id}.js，返回保存后的完整路径。
/// 插件安装时复制一份到应用数据目录，避免原始文件被移动/删除后插件失效。
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

/// 读取本地文件的二进制内容（base64 编码返回）
/// 支持 .json / .zip / .lxmc 格式，用于备份导入的压缩包支持
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
        return Err(format!("不支持的文件类型: .{} (仅支持 .json/.zip/.lxmc)", ext));
    }

    let metadata = fs::metadata(path_obj).map_err(|error| format!("读取文件元数据失败: {}", error))?;
    let max_size = 50 * 1024 * 1024;
    if metadata.len() > max_size {
        return Err(format!("文件过大: {} MB (上限 {} MB)", metadata.len() / 1024 / 1024, max_size / 1024 / 1024));
    }

    let bytes = fs::read(path_obj).map_err(|error| format!("读取文件内容失败: {}", error))?;
    Ok(general_purpose::STANDARD.encode(&bytes))
}

/// 代理图片请求 —— 自动添加 Referer 头，解决 B站等 CDN 403 问题
#[tauri::command]
pub async fn proxy_image(url: String, referer: Option<String>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(&url);
    // 各 CDN 图片服务器防盗链所需的 Referer 头
    let ref_url = referer.unwrap_or_else(|| {
        if url.contains("hdslb.com") || url.contains("bilivideo.com") {
            "https://www.bilibili.com".to_string()
        } else if url.contains("126.net") || url.contains("163.com") {
            "https://music.163.com/".to_string()
        } else if url.contains("kuwo.cn") || url.contains("kuwo.com") {
            "http://www.kuwo.cn/".to_string()
        } else if url.contains("kugou.com") || url.contains("kgmusic.com") {
            "http://www.kugou.com/".to_string()
        } else if url.contains("gtimg.cn") || url.contains("qq.com") {
            "https://y.qq.com/".to_string()
        } else if url.contains("migu.cn") {
            "https://m.music.migu.cn/".to_string()
        } else {
            String::new()
        }
    });
    if !ref_url.is_empty() {
        req = req.header("Referer", &ref_url);
    }

    let response = req.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    // 网络读取上限（远超封面预期，防止恶意超大响应拖垮内存）
    const MAX_NETWORK_BYTES: usize = 20 * 1024 * 1024;
    if bytes.len() > MAX_NETWORK_BYTES {
        return Err("Image too large".to_string());
    }

    // 返回前保留上限：过大图片直接透传会生成数十 MB 的 data: URL，拖跨渲染进程。
    // 超过上限时用 image 解码缩小再编码成小体积 JPEG，保证内存与内存封容量可控。
    use base64::{engine::general_purpose, Engine as _};

    const MAX_DATA_BYTES: usize = 5 * 1024 * 1024;
    if bytes.len() > MAX_DATA_BYTES {
        let Ok(img) = image::load_from_memory(&bytes) else {
            return Err("Image too large".to_string());
        };
        // 限制最长边，保证封面缩略图体积足够小（原图过大时才缩放）
        const MAX_EDGE: u32 = 800;
        let img = shrink_to_fit(img, MAX_EDGE);
        let rgba = img.to_rgba8();
        // 尽量保留 alpha（透明 PNG 封面），否则回退 JPEG 保证稳定返回
        let mut png = Vec::new();
        if image::codecs::png::PngEncoder::new(&mut png)
            .write_image(
                rgba.as_raw(),
                rgba.width(),
                rgba.height(),
                image::ExtendedColorType::Rgba8,
            )
            .is_ok()
        {
            return Ok(format!(
                "data:image/png;base64,{}",
                general_purpose::STANDARD.encode(&png)
            ));
        }
        let mut jpeg = Vec::new();
        if image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 82)
            .write_image(
                rgba.as_raw(),
                rgba.width(),
                rgba.height(),
                image::ExtendedColorType::Rgba8,
            )
            .is_ok()
        {
            return Ok(format!(
                "data:image/jpeg;base64,{}",
                general_purpose::STANDARD.encode(&jpeg)
            ));
        }
        return Err("Image too large".to_string());
    }

    // 转为 data URL
    let b64 = general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", content_type, b64))
}

/// 等比缩小到指定最长边（不足或非图片尺寸则原样返回）
fn shrink_to_fit(img: image::DynamicImage, max_edge: u32) -> image::DynamicImage {
    let (w, h) = img.dimensions();
    let largest = w.max(h);
    if largest <= max_edge || w == 0 || h == 0 {
        return img;
    }
    if w >= h {
        img.resize(max_edge, (h * max_edge) / w, image::imageops::FilterType::Lanczos3)
    } else {
        img.resize((w * max_edge) / h, max_edge, image::imageops::FilterType::Lanczos3)
    }
}

/// 异步下载音频到临时文件，返回本地文件路径
/// 用于 B站 m4s 等需要特殊 headers 的音频流。
///
/// 手动跟随 302 重定向：reqwest 默认在同一主机重定向时保留 Cookie 等敏感头，
/// 但跨主机重定向会剥离 Cookie/Authorization 防泄露。B站 CDN 常把取流地址 302
/// 到镜像主机（如 xy*.mcdn.bilivideo.cn），一旦 Cookie/Referer 被剥离，CDN 就按
/// 匿名处理并返回 3-4 秒预览片段。这里禁用自动重定向，每一跳都重新注入完整 headers。
#[tauri::command]
pub async fn download_audio_to_temp(
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(60))
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
                return Err(format!("Redirect without Location: HTTP {}", response.status()));
            };
            if next_url.trim().is_empty() {
                return Err(format!("Empty redirect Location from HTTP {}", response.status()));
            }
            current_url = if next_url.starts_with("http://") || next_url.starts_with("https://") {
                next_url
            } else {
                reqwest::Url::parse(&current_url)
                    .and_then(|base| base.join(&next_url))
                    .map(|u| u.to_string())
                    .unwrap_or(next_url)
            };
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

    // 写入临时文件
    let temp_dir = std::env::temp_dir();
    let file_name = format!(
        "xy_music_{}.m4s",
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

/// 将插件解析得到的视频流式写入应用缓存，供 WebView 通过 asset 协议播放。
#[tauri::command]
pub async fn download_video_to_cache(
    app: tauri::AppHandle,
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Unsupported video URL".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
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

    let mut response = request.send().await.map_err(|error| error.to_string())?;
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
    let file_name = format!("xy_music_video_{}.mp4", uuid::Uuid::new_v4());
    let cache_path = cache_dir.join(file_name);
    let mut file = tokio::fs::File::create(&cache_path)
        .await
        .map_err(|error| error.to_string())?;

    let mut written = 0_u64;
    let download_result: Result<(), String> = async {
        while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
            written = written.saturating_add(chunk.len() as u64);
            if written > MAX_BACKGROUND_VIDEO_BYTES {
                return Err("Video is too large for background playback".to_string());
            }
            file.write_all(&chunk)
                .await
                .map_err(|error| error.to_string())?;
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

/// 仅允许清理本功能在应用缓存中创建的视频文件。
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
    let candidate = std::path::PathBuf::from(path);
    let file_name = candidate
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if candidate.parent() != Some(cache_dir.as_path()) || !file_name.starts_with("xy_music_video_")
    {
        return Err("Refusing to remove a non-background-video file".to_string());
    }
    if !candidate.exists() {
        return Ok(());
    }
    tokio::fs::remove_file(candidate)
        .await
        .map_err(|error| error.to_string())
}
