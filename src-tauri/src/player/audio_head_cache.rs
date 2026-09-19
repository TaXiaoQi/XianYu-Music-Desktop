use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct HeadEntry {
    pub bytes: Arc<Vec<u8>>,
    pub range_ok: bool,
    pub stored_at: Instant,
}

const MAX_ENTRIES: usize = 12;
const MAX_TOTAL_BYTES: usize = 24 * 1024 * 1024;
const TTL: Duration = Duration::from_secs(15 * 60);
const MAX_READ_GUARD: u64 = 8 * 1024 * 1024;

fn heads() -> &'static Mutex<HashMap<String, HeadEntry>> {
    static HEADS: OnceLock<Mutex<HashMap<String, HeadEntry>>> = OnceLock::new();
    HEADS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn inflight() -> &'static Mutex<HashMap<String, Instant>> {
    static INFLIGHT: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    INFLIGHT.get_or_init(|| Mutex::new(HashMap::new()))
}

fn sanitize_stream_url(raw: &str) -> String {
    let trimmed = raw.trim();
    let http_idx = trimmed.find("http://");
    let https_idx = trimmed.find("https://");
    let start = match (http_idx, https_idx) {
        (Some(h), Some(s)) => h.min(s),
        (Some(h), None) => h,
        (None, Some(s)) => s,
        (None, None) => return trimmed.to_string(),
    };
    let candidate = &trimmed[start..];
    let end = candidate
        .find(|c: char| matches!(c, '`' | '\'' | '"' | '<' | '>' | ' ' | '\t' | '\n' | '\r'))
        .unwrap_or(candidate.len());
    let mut result = candidate[..end].to_string();
    loop {
        let t = result.trim_end_matches(|c: char| {
            matches!(c, ',' | '，' | ';' | '；' | '`' | '\'' | '"' | ' ')
        });
        if t.len() == result.len() {
            break;
        }
        result = t.to_string();
    }
    result
}

pub fn lookup(url: &str) -> Option<HeadEntry> {
    let key = sanitize_stream_url(url);
    let mut map = heads().lock().ok()?;
    let entry = map.get_mut(&key)?;
    if entry.stored_at.elapsed() > TTL {
        map.remove(&key);
        return None;
    }
    Some(entry.clone())
}

pub fn lookup_for_inject(url: &str) -> Option<HeadEntry> {
    let e = lookup(url)?;
    if !e.range_ok || e.bytes.is_empty() {
        return None;
    }
    Some(e)
}

fn evict_locked(map: &mut HashMap<String, HeadEntry>) {
    let mut total: usize = map.values().map(|e| e.bytes.len()).sum();
    while map.len() > MAX_ENTRIES || total > MAX_TOTAL_BYTES {
        let oldest = map
            .iter()
            .min_by_key(|(_, e)| e.stored_at)
            .map(|(k, _)| k.clone());
        match oldest {
            Some(k) => {
                if let Some(e) = map.remove(&k) {
                    total = total.saturating_sub(e.bytes.len());
                }
            }
            None => break,
        }
    }
}

pub fn prefetch(
    url: &str,
    headers: Option<std::collections::HashMap<String, String>>,
    max_bytes: u64,
) -> bool {
    let key = sanitize_stream_url(url);
    if key.is_empty() || !key.starts_with("http") {
        return false;
    }
    if lookup(&key).is_some() {
        return false;
    }
    {
        let mut inflight = match inflight().lock() {
            Ok(g) => g,
            Err(_) => return false,
        };
        inflight.retain(|_, t| t.elapsed() < Duration::from_secs(60));
        if inflight.contains_key(&key) {
            return false;
        }
        inflight.insert(key.clone(), Instant::now());
    }

    let key_clone = key.clone();
    let ua = crate::player::commands::DEFAULT_STREAM_USER_AGENT.to_string();
    std::thread::spawn(move || {
        let result = fetch_head(&key_clone, headers.as_ref(), Some(ua.as_str()), max_bytes);
        if let Ok(entry) = result {
            if let Ok(mut map) = heads().lock() {
                map.insert(key_clone.clone(), entry);
                evict_locked(&mut map);
            }
        }
        if let Ok(mut inflight) = inflight().lock() {
            inflight.remove(&key_clone);
        }
    });
    true
}

fn fetch_head(
    url: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
    max_bytes: u64,
) -> Result<HeadEntry, String> {
    let max_bytes = max_bytes.clamp(64 * 1024, MAX_READ_GUARD);

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .redirect(crate::security::ssrf::ip_literal_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let mut req = client.get(url);
    if let Some(ua) = user_agent {
        req = req.header(reqwest::header::USER_AGENT, ua);
    }
    if let Some(hs) = headers {
        for (k, v) in hs {
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                reqwest::header::HeaderValue::from_str(&v),
            ) {
                req = req.header(name, val);
            }
        }
    }
    req = req.header(
        reqwest::header::RANGE,
        format!("bytes=0-{}", max_bytes.saturating_sub(1)),
    );

    let mut resp = req.send().map_err(|e| format!("片头请求失败: {e}"))?;
    let status = resp.status();

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let non_audio = content_type.contains("text/html")
        || content_type.contains("application/json")
        || content_type.contains("text/plain")
        || content_type.contains("xml");
    if non_audio {
        return Err("片头响应非音频内容".to_string());
    }

    if status == reqwest::StatusCode::PARTIAL_CONTENT {
        let mut bytes: Vec<u8> = Vec::with_capacity(max_bytes as usize);
        resp.take(max_bytes)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.is_empty() {
            return Err("片头为空".to_string());
        }
        Ok(HeadEntry {
            bytes: Arc::new(bytes),
            range_ok: true,
            stored_at: Instant::now(),
        })
    } else if status.is_success() {
        let mut bytes: Vec<u8> = Vec::with_capacity(max_bytes as usize);
        (&mut resp)
            .take(max_bytes)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let _ = bytes;
        Err("服务器不支持 Range，片头不缓存".to_string())
    } else {
        Err(format!("片头请求 HTTP {status}"))
    }
}
