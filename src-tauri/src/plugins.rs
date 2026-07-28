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
    let method = reqwest::Method::from_bytes(method.trim().as_bytes())
        .map_err(|error| error.to_string())?;

    let redirect_limit = follow.unwrap_or(10);
    let timeout_secs = timeout.unwrap_or(30);
    let client_builder = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::limited(redirect_limit as usize))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    let client = if timeout_secs == 0 {
        client_builder.build()
    } else {
        client_builder.timeout(Duration::from_secs(timeout_secs)).build()
    }.map_err(|error| error.to_string())?;

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

/// 读取本地插件 JS 文件内容
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
    if !matches!(ext.as_str(), "js" | "json" | "txt") {
        return Err("Only .js plugin files are supported".to_string());
    }

    let metadata = fs::metadata(path_obj).map_err(|error| error.to_string())?;
    if metadata.len() > 5 * 1024 * 1024 {
        return Err("Plugin file is larger than 5 MB".to_string());
    }

    fs::read_to_string(path_obj).map_err(|error| error.to_string())
}
