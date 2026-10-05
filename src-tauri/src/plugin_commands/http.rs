use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use super::format_reqwest_error;

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

fn validate_plugin_http_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("URL 格式非法: {e}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("仅允许 http/https 协议，当前: {scheme}"));
    }
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    if host.is_empty() {
        return Err("URL 缺少主机名".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("URL 不得包含用户凭据".to_string());
    }
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
    {
        return Err(format!("禁止访问内网地址: {host}"));
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        let blocked = match ip {
            std::net::IpAddr::V4(v4) => {
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_unspecified()
                    || v4.is_multicast()
            }
            std::net::IpAddr::V6(v6) => {
                v6.is_loopback() || v6.is_unique_local() || v6.is_unspecified() || v6.is_multicast()
            }
        };
        if blocked {
            return Err(format!("禁止访问内网/保留地址: {host}"));
        }
    }
    Ok(())
}

fn plugin_ssrf_redirect_policy(redirect_limit: usize) -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() > redirect_limit {
            return attempt.stop();
        }
        if validate_plugin_http_url(attempt.url().as_str()).is_ok() {
            attempt.follow()
        } else {
            attempt.error(std::io::Error::other("重定向目标被安全策略禁止"))
        }
    })
}

/// 插件 HTTP 客户端缓存：按 (超时秒数, 重定向上限, 压缩开关) 复用连接池，
/// 免去每个请求重建 DNS 解析器（pinned resolver 零缓存）、TLS 上下文与 TCP 连接的开销。
/// redirect policy 与超时都是 Client 级配置，故必须进缓存 key。
type ClientCacheKey = (Option<u64>, u32, bool);

static PLUGIN_HTTP_CLIENTS: OnceLock<Mutex<HashMap<ClientCacheKey, reqwest::Client>>> =
    OnceLock::new();

fn client_cache() -> &'static Mutex<HashMap<ClientCacheKey, reqwest::Client>> {
    PLUGIN_HTTP_CLIENTS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 代理切换时清空缓存（由 netproxy::clear_plugin_http_clients 调用），下次请求按新代理重建。
pub(crate) fn clear_cached_http_clients() {
    if let Ok(mut guard) = client_cache().lock() {
        guard.clear();
    }
}

fn cached_plugin_http_client(
    timeout_secs: Option<u64>,
    redirect_limit: u32,
    compression: bool,
) -> Result<reqwest::Client, String> {
    let map = client_cache();
    let key = (timeout_secs, redirect_limit, compression);
    if let Ok(guard) = map.lock() {
        if let Some(client) = guard.get(&key) {
            return Ok(client.clone());
        }
    }
    let mut builder = crate::netproxy::client_builder()
        .redirect(plugin_ssrf_redirect_policy(redirect_limit as usize))
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    if compression {
        builder = builder.gzip(true).brotli(true).deflate(true);
    }
    if let Some(secs) = timeout_secs {
        builder = builder.timeout(Duration::from_secs(secs));
    }
    let client = builder.build().map_err(|error| error.to_string())?;
    if let Ok(mut guard) = map.lock() {
        guard.insert(key, client.clone());
    }
    Ok(client)
}

#[tauri::command]
pub async fn plugin_http_request(
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout: Option<u64>,
    follow: Option<u32>,
) -> Result<PluginHttpResponse, String> {
    validate_plugin_http_url(&url)?;
    let method =
        reqwest::Method::from_bytes(method.trim().as_bytes()).map_err(|error| error.to_string())?;

    let redirect_limit = follow.unwrap_or(10);
    let timeout_secs = timeout.unwrap_or(30);
    let client = cached_plugin_http_client(
        if timeout_secs == 0 { None } else { Some(timeout_secs) },
        redirect_limit,
        true,
    )?;

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

    let mut response = request.send().await.map_err(format_reqwest_error)?;
    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let mut response_headers = HashMap::new();
    for (key, value) in response.headers().iter() {
        if let Ok(value) = value.to_str() {
            response_headers.insert(key.as_str().to_string(), value.to_string());
        }
    }
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
                Err(e) => return Err(format_reqwest_error(e)),
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

    validate_plugin_http_url(&url)?;
    let method =
        reqwest::Method::from_bytes(method.trim().as_bytes()).map_err(|error| error.to_string())?;

    let redirect_limit = follow.unwrap_or(10);
    let client = cached_plugin_http_client(Some(timeout.unwrap_or(30)), redirect_limit, false)?;

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

    let mut response = request.send().await.map_err(format_reqwest_error)?;
    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let mut response_headers = HashMap::new();
    for (key, value) in response.headers().iter() {
        if let Ok(value) = value.to_str() {
            response_headers.insert(key.as_str().to_string(), value.to_string());
        }
    }
    const MAX_BODY_SIZE: usize = 50 * 1024 * 1024;
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
                Err(e) => return Err(format_reqwest_error(e)),
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
