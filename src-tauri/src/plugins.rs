use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::Duration;

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
        .danger_accept_invalid_certs(true)
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
        .danger_accept_invalid_certs(true)
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
    let path_obj = Path::new(&path);
    if !path_obj.is_file() {
        return Err("Plugin file does not exist".to_string());
    }

    let ext = path_obj
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "js" | "json" | "txt" | "m3u" | "m3u8") {
        return Err("Unsupported file type".to_string());
    }

    let metadata = fs::metadata(path_obj).map_err(|error| error.to_string())?;
    // JSON 备份文件可能包含封面 data URI 和歌词，允许更大体积（50MB）；
    // 其他文本文件（JS/TXT/M3U）保持 5MB 上限
    let max_size = if ext == "json" {
        50 * 1024 * 1024
    } else {
        5 * 1024 * 1024
    };
    if metadata.len() > max_size {
        return Err(format!("File is larger than {} MB", max_size / 1024 / 1024));
    }

    fs::read_to_string(path_obj).map_err(|error| error.to_string())
}

/// 代理图片请求 —— 自动添加 Referer 头，解决 B站等 CDN 403 问题
#[tauri::command]
pub async fn proxy_image(url: String, referer: Option<String>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
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

    // 限制 5MB
    if bytes.len() > 5 * 1024 * 1024 {
        return Err("Image too large".to_string());
    }

    // 转为 data URL
    use base64::{engine::general_purpose, Engine as _};
    let b64 = general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", content_type, b64))
}

/// 异步下载音频到临时文件，返回本地文件路径
/// 用于 B站 m4s 等需要特殊 headers 的音频流
#[tauri::command]
pub async fn download_audio_to_temp(
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(60))
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(&url);
    if let Some(hdrs) = headers {
        for (key, value) in hdrs {
            if !key.trim().is_empty() && !value.trim().is_empty() {
                req = req.header(key, value);
            }
        }
    }

    let response = req.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
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
