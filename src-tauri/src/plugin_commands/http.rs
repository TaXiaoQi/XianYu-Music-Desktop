use serde::Serialize;
use std::collections::HashMap;
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
    let client_builder = crate::netproxy::client_builder()
        .redirect(plugin_ssrf_redirect_policy(redirect_limit as usize))
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
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
    let request_timeout = Duration::from_secs(timeout.unwrap_or(30));
    let client = crate::netproxy::client_builder()
        .redirect(plugin_ssrf_redirect_policy(redirect_limit as usize))
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
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
