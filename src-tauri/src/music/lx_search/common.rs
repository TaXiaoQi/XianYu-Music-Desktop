use crate::music::url_resolver::LxTypeEntry;
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Serialize, Clone, Debug)]
pub struct LxSearchItem {
    pub name: String,
    pub singer: String,
    pub album_name: String,
    pub album_id: serde_json::Value,
    pub songmid: String,
    pub source: String,
    pub interval: String,
    pub img: Option<String>,
    pub hash: Option<String>,
    pub str_media_mid: Option<String>,
    pub song_id: Option<serde_json::Value>,
    pub album_mid: Option<String>,
    pub copyright_id: Option<String>,
    pub types: Vec<LxTypeTuple>,
    pub lx_types: Option<HashMap<String, LxTypeEntry>>,
}

#[derive(Serialize, Clone, Debug)]
pub struct LxTypeTuple {
    #[serde(rename = "type")]
    pub quality_type: String,
    pub size: Option<String>,
    pub hash: Option<String>,
}

pub(super) fn format_play_time(seconds: f64) -> String {
    if seconds.is_nan() || seconds <= 0.0 {
        return "00:00".to_string();
    }
    let total = seconds as u64;
    let m = total / 60;
    let s = total % 60;
    format!("{:02}:{:02}", m, s)
}

pub(super) fn size_formate(bytes: f64) -> String {
    if bytes <= 0.0 {
        return "0B".to_string();
    }
    if bytes < 1024.0 {
        return format!("{}B", bytes as u64);
    }
    if bytes < 1024.0 * 1024.0 {
        return format!("{:.1}KB", bytes / 1024.0);
    }
    if bytes < 1024.0 * 1024.0 * 1024.0 {
        return format!("{:.1}MB", bytes / (1024.0 * 1024.0));
    }
    format!("{:.1}GB", bytes / (1024.0 * 1024.0 * 1024.0))
}

static HTML_NUMERIC_RE: OnceLock<Regex> = OnceLock::new();

fn decode_numeric_entities(s: &str) -> String {
    let re = HTML_NUMERIC_RE.get_or_init(|| Regex::new(r"&#(x?[0-9a-fA-F]+);").unwrap());
    re.replace_all(s, |caps: &regex::Captures| {
        let digits = &caps[1];
        let parsed = if let Some(hex) = digits
            .strip_prefix('x')
            .or_else(|| digits.strip_prefix('X'))
        {
            u32::from_str_radix(hex, 16)
        } else {
            digits.parse::<u32>()
        };
        match parsed {
            Ok(cp) if cp != 0 => char::from_u32(cp)
                .map(|c| c.to_string())
                .unwrap_or_else(|| caps[0].to_string()),
            _ => caps[0].to_string(),
        }
    })
    .into_owned()
}

pub(super) fn decode_name(s: &str) -> String {
    let named = s
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ");
    decode_numeric_entities(&named)
}

pub(super) fn format_singer_name(singers: &serde_json::Value, name_key: &str) -> String {
    if let Some(arr) = singers.as_array() {
        let names: Vec<String> = arr
            .iter()
            .filter_map(|item| {
                item.get(name_key)
                    .and_then(|n| n.as_str())
                    .map(|s| decode_name(s.trim()))
                    .filter(|s| !s.is_empty())
            })
            .collect();
        return names.join("、");
    }
    if let Some(s) = singers.as_str() {
        return decode_name(s);
    }
    String::new()
}

static HTTP_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

fn http_client() -> &'static Result<reqwest::Client, String> {
    HTTP_CLIENT.get_or_init(|| {
        crate::netproxy::client_builder()
            .timeout(Duration::from_secs(15))
            .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
            .build()
            .map_err(|e| e.to_string())
    })
}

pub(super) async fn http_get_json(url: &str, headers: &[(&str, &str)]) -> Result<serde_json::Value, String> {
    let client = http_client().as_ref().map_err(|e| e.clone())?;
    let mut req = client.get(url);
    for (key, value) in headers {
        req = req.header(*key, *value);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;

    if status != 200 {
        return Err(format!("HTTP {} for {}", status, url));
    }

    serde_json::from_str(&body).map_err(|e| format!("Invalid JSON: {}", e))
}

pub(super) async fn http_post_json(
    url: &str,
    body: &str,
    headers: &[(&str, &str)],
) -> Result<serde_json::Value, String> {
    let client = http_client().as_ref().map_err(|e| e.clone())?;
    let mut req = client.post(url).body(body.to_string());
    for (key, value) in headers {
        req = req.header(*key, *value);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body_text = resp.text().await.map_err(|e| e.to_string())?;

    if status != 200 {
        return Err(format!("HTTP {} for {}", status, url));
    }

    serde_json::from_str(&body_text).map_err(|e| format!("Invalid JSON: {}", e))
}
