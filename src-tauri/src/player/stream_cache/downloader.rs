use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use super::buffer::{StreamingTempFileState, MIN_BUFFER_BYTES};
use super::decrypt::decrypt_cenc_file;
use super::eviction::{cache, CacheEntry};
use super::paths::cache_dir;
use super::url::{sanitize_stream_url, url_hash};
use super::validate::{is_media_content_type, is_valid_audio_header};

/// MV 等视频流缓存入口：跳过音频头部校验（webm/flv/m4s 非音频魔数），
/// probe 也接受 video/* Content-Type。ekey/cek 一律无。
pub fn start_streaming_download_video(
    url: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
) -> Result<StreamingTempFileState, String> {
    start_streaming_download_inner(url, headers, user_agent, None, None, true)
}

pub fn start_streaming_download(
    url: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
    ekey: Option<&str>,
    cek: Option<&str>,
) -> Result<StreamingTempFileState, String> {
    start_streaming_download_inner(url, headers, user_agent, ekey, cek, false)
}

fn start_streaming_download_inner(
    url: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
    ekey: Option<&str>,
    cek: Option<&str>,
    allow_video: bool,
) -> Result<StreamingTempFileState, String> {
    let cleaned_url = sanitize_stream_url(url);
    let url = cleaned_url.as_str();
    let hash = url_hash(url);
    let mut mgr = cache().lock().map_err(|e| e.to_string())?;

    if let Some(entry) = mgr.entries.get(&hash) {
        if entry.download_failed.load(Ordering::Relaxed) {
            if let Some(failed) = mgr.entries.remove(&hash) {
                let _ = std::fs::remove_file(&failed.path);
                mgr.current_size = mgr.current_size.saturating_sub(failed.size);
            }
        }
    }

    if let Some(entry) = mgr.entries.get_mut(&hash) {
        entry.last_accessed = SystemTime::now();
        if entry.download_complete.load(Ordering::Relaxed)
            && !entry.download_failed.load(Ordering::Relaxed)
        {
            if let Some(cek_str) = cek {
                if let Err(e) = decrypt_cenc_file(&entry.path, cek_str) {
                    let failed = mgr.entries.remove(&hash);
                    if let Some(failed) = failed {
                        let _ = std::fs::remove_file(&failed.path);
                        mgr.current_size = mgr.current_size.saturating_sub(failed.size);
                    }
                    eprintln!("[CENC] 复用缓存解密失败，重新下载: {}", e);
                }
            }
            if let Some(entry) = mgr.entries.get_mut(&hash) {
                let downloaded = entry.size;
                return Ok(StreamingTempFileState {
                    path: entry.path.to_string_lossy().to_string(),
                    downloaded_bytes: Arc::new(AtomicU64::new(downloaded)),
                    download_complete: Arc::new(AtomicBool::new(true)),
                    download_failed: Arc::new(AtomicBool::new(false)),
                    total_bytes: Some(downloaded),
                    ekey: Arc::new(std::sync::Mutex::new(ekey.map(|s| s.to_string()))),
                    cek: Arc::new(std::sync::Mutex::new(cek.map(|s| s.to_string()))),
                    post_check_pending: None,
                    cenc_metadata: Arc::new(std::sync::Mutex::new(None)),
                    cenc_streaming: Arc::new(AtomicBool::new(false)),
                    download_error: Arc::new(std::sync::Mutex::new(None)),
                    content_length_shared: entry.content_length_shared.clone(),
                });
            }
        } else {
            return Ok(StreamingTempFileState {
                path: entry.path.to_string_lossy().to_string(),
                downloaded_bytes: entry.downloaded_bytes.clone(),
                download_complete: entry.download_complete.clone(),
                download_failed: entry.download_failed.clone(),
                total_bytes: None,
                ekey: Arc::new(std::sync::Mutex::new(ekey.map(|s| s.to_string()))),
                cek: Arc::new(std::sync::Mutex::new(cek.map(|s| s.to_string()))),
                post_check_pending: None,
                cenc_metadata: Arc::new(std::sync::Mutex::new(None)),
                cenc_streaming: Arc::new(AtomicBool::new(false)),
                download_error: Arc::new(std::sync::Mutex::new(None)),
                content_length_shared: entry.content_length_shared.clone(),
            });
        }
    }

    let temp_path = cache_dir().join(format!("{}.dat", hash));

    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temp_path)
        .map_err(|e| format!("创建缓存文件失败: {}", e))?;
    drop(file);

    let downloaded_bytes = Arc::new(AtomicU64::new(0));
    let download_complete = Arc::new(AtomicBool::new(false));
    let download_failed = Arc::new(AtomicBool::new(false));
    let post_check_pending = Arc::new(AtomicBool::new(false));
    let shared_ekey = Arc::new(std::sync::Mutex::new(ekey.map(|s| s.to_string())));
    let shared_cek = Arc::new(std::sync::Mutex::new(cek.map(|s| s.to_string())));
    let download_error: Arc<std::sync::Mutex<Option<String>>> =
        Arc::new(std::sync::Mutex::new(None));
    let cenc_metadata = Arc::new(std::sync::Mutex::new(None));
    let cenc_streaming = Arc::new(AtomicBool::new(false));
    let content_length_shared = Arc::new(AtomicU64::new(0));

    let mut resume_from: u64 = 0;
    if let Some(head) = crate::player::audio_head_cache::lookup_for_inject(url) {
        let write_ok = OpenOptions::new()
            .write(true)
            .open(&temp_path)
            .and_then(|mut f| f.write_all(&head.bytes))
            .is_ok();
        if write_ok {
            resume_from = head.bytes.len() as u64;
            downloaded_bytes.store(resume_from, Ordering::Relaxed);
        }
    }

    let url_clone = url.to_string();
    let hash_clone = hash.clone();
    let headers_clone = headers.cloned();
    let ua_clone = user_agent.map(|s| s.to_string());
    let path_clone = temp_path.clone();
    let dl_bytes = downloaded_bytes.clone();
    let dl_complete = download_complete.clone();
    let dl_failed = download_failed.clone();
    let dl_post_check = post_check_pending.clone();
    let dl_ekey = shared_ekey.clone();
    let dl_cek = shared_cek.clone();
    let dl_error = download_error.clone();
    let dl_cenc_metadata = cenc_metadata.clone();
    let dl_cenc_streaming = cenc_streaming.clone();
    let dl_content_length = content_length_shared.clone();
    let panic_failed = download_failed.clone();
    let panic_error = download_error.clone();

    let handle = std::thread::spawn(move || {
        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            download_thread(
                &url_clone,
                &hash_clone,
                headers_clone.as_ref(),
                ua_clone.as_deref(),
                resume_from,
                path_clone,
                dl_bytes,
                dl_complete,
                dl_failed,
                dl_post_check,
                dl_ekey,
                dl_cek,
                dl_error,
                dl_cenc_metadata,
                dl_cenc_streaming,
                dl_content_length,
                allow_video,
            );
        }))
        .is_err();
        if panicked && !panic_failed.load(Ordering::Relaxed) {
            eprintln!("[stream_cache] 下载线程异常退出 (panic)");
            panic_failed.store(true, Ordering::Relaxed);
            if let Ok(mut err) = panic_error.lock() {
                *err = Some("下载线程内部异常".to_string());
            }
        }
    });

    mgr.entries.insert(
        hash,
        CacheEntry {
            path: temp_path.clone(),
            size: 0,
            last_accessed: SystemTime::now(),
            downloaded_bytes: downloaded_bytes.clone(),
            download_complete: download_complete.clone(),
            download_failed: download_failed.clone(),
            content_length_shared: content_length_shared.clone(),
            _download_handle: Some(handle),
        },
    );
    mgr.evict_if_needed();

    Ok(StreamingTempFileState {
        path: temp_path.to_string_lossy().to_string(),
        downloaded_bytes,
        download_complete,
        download_failed,
        total_bytes: None,
        ekey: shared_ekey,
        cek: shared_cek,
        post_check_pending: Some(post_check_pending),
        cenc_metadata,
        cenc_streaming,
        download_error,
        content_length_shared,
    })
}

fn extract_audio_info_from_json(body: &str) -> Option<(String, Option<String>)> {
    let value: serde_json::Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => {
            let trimmed = body.trim().trim_matches('"');
            if trimmed != body.trim() {
                if let Ok(v) = serde_json::from_str(trimmed) {
                    v
                } else {
                    return None;
                }
            } else {
                return None;
            }
        }
    };

    let priority_keys = [
        "url",
        "musicUrl",
        "audioUrl",
        "playUrl",
        "play_url",
        "music_url",
        "link",
        "src",
        "file",
        "fileUrl",
        "file_url",
        "data",
        "result",
        "music",
        "audio",
        "source",
        "sourceUrl",
        "source_url",
        "media",
        "mediaUrl",
        "stream",
        "streamUrl",
        "stream_url",
        "cdn",
        "cdnUrl",
        "play",
        "download",
        "downloadUrl",
        "download_url",
    ];

    for key in &priority_keys {
        if let Some(found) = find_url_by_key(&value, key) {
            let ekey = find_ekey_in_json(&value);
            return Some((found, ekey));
        }
    }

    if let Some(url) = find_any_audio_url(&value) {
        let ekey = find_ekey_in_json(&value);
        return Some((url, ekey));
    }

    if let Some(url) = find_any_http_url(&value) {
        let ekey = find_ekey_in_json(&value);
        return Some((url, ekey));
    }

    None
}

fn sanitize_extracted_audio_url(url: &str) -> String {
    url.trim()
        .trim_matches(|c: char| {
            c.is_whitespace()
                || matches!(
                    c,
                    '`' | '\'' | '"' | ',' | '，' | ';' | '；' | '‘' | '’' | '“' | '”'
                )
        })
        .to_string()
}

fn extract_audio_info_from_text(body: &str) -> Option<(String, Option<String>)> {
    if let Some(info) = extract_audio_info_from_json(body) {
        return Some(info);
    }

    let trimmed = sanitize_extracted_audio_url(body);
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        if looks_like_audio_url(&trimmed) || !is_obviously_non_audio_url(&trimmed) {
            return Some((trimmed, None));
        }
    }

    if let Some(url) = extract_url_from_raw_text(body) {
        return Some((url, None));
    }

    None
}

fn find_ekey_in_json(value: &serde_json::Value) -> Option<String> {
    let ekey_keys = ["ekey", "eKey", "encryptKey", "encryptionKey"];
    find_string_by_keys(value, &ekey_keys)
}

fn find_string_by_keys(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => {
            for &key in keys {
                if let Some(v) = map.get(key) {
                    if let Some(s) = v.as_str() {
                        if !s.is_empty() {
                            return Some(s.to_string());
                        }
                    }
                }
            }
            for v in map.values() {
                if let Some(found) = find_string_by_keys(v, keys) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                if let Some(found) = find_string_by_keys(v, keys) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn find_url_by_key(value: &serde_json::Value, key: &str) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(v) = map.get(key) {
                if let Some(s) = v.as_str() {
                    let clean = sanitize_extracted_audio_url(s);
                    if clean.starts_with("http://") || clean.starts_with("https://") {
                        return Some(clean);
                    }
                }
                if let Some(found) = find_url_by_key(v, key) {
                    return Some(found);
                }
            }
            for v in map.values() {
                if let Some(found) = find_url_by_key(v, key) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                if let Some(found) = find_url_by_key(v, key) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn find_any_audio_url(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => {
            let clean = sanitize_extracted_audio_url(s);
            if (clean.starts_with("http://") || clean.starts_with("https://"))
                && looks_like_audio_url(&clean)
            {
                Some(clean)
            } else {
                None
            }
        }
        serde_json::Value::Object(map) => {
            for v in map.values() {
                if let Some(found) = find_any_audio_url(v) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                if let Some(found) = find_any_audio_url(v) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn find_any_http_url(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => {
            let clean = sanitize_extracted_audio_url(s);
            if clean.starts_with("http://") || clean.starts_with("https://") {
                if !is_obviously_non_audio_url(&clean) {
                    return Some(clean);
                }
            }
            if s.starts_with("//") {
                let full = format!("https:{}", s);
                if !is_obviously_non_audio_url(&full) {
                    return Some(full);
                }
            }
            None
        }
        serde_json::Value::Object(map) => {
            for v in map.values() {
                if let Some(found) = find_any_http_url(v) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                if let Some(found) = find_any_http_url(v) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn is_obviously_non_audio_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains(".html")
        || lower.contains(".htm")
        || lower.contains(".php")
        || lower.contains(".asp")
        || lower.contains(".aspx")
        || lower.contains(".jsp")
        || lower.contains(".css")
        || lower.contains(".js")
        || lower.contains(".png")
        || lower.contains(".jpg")
        || lower.contains(".jpeg")
        || lower.contains(".gif")
        || lower.contains(".svg")
        || lower.contains(".webp")
        || lower.contains(".ico")
        || lower.contains(".woff")
        || lower.contains(".ttf")
        || lower.contains(".pdf")
        || lower.contains(".zip")
        || lower.contains(".rar")
        || lower.contains(".doc")
        || lower.contains(".docx")
}

fn extract_url_from_raw_text(text: &str) -> Option<String> {
    for prefix in &["https://", "http://"] {
        if let Some(start) = text.find(prefix) {
            let rest = &text[start..];
            let end = rest
                .find(|c: char| {
                    c.is_whitespace()
                        || c == '"'
                        || c == '\''
                        || c == '<'
                        || c == '>'
                        || c == ','
                        || c == '}'
                })
                .unwrap_or(rest.len());
            let url = &rest[..end];
            if url.len() > 10 && !is_obviously_non_audio_url(url) {
                return Some(sanitize_extracted_audio_url(url));
            }
        }
    }
    None
}

fn looks_like_audio_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains(".mp3")
        || lower.contains(".flac")
        || lower.contains(".m4a")
        || lower.contains(".aac")
        || lower.contains(".ogg")
        || lower.contains(".wav")
        || lower.contains(".wma")
        || lower.contains(".opus")
        || lower.contains(".mga")
        || lower.contains(".mgg")
        || lower.contains("stream.qqmusic")
        || lower.contains("ws.stream.qqmusic")
        || lower.contains("dl.stream.qqmusic")
        || lower.contains("isure.stream")
        || lower.contains("trackmedia")
        || lower.contains("music.126.net")
        || lower.contains("m.kugou")
        || lower.contains("track.kg")
        || lower.contains("trackercdn.kugou")
        || lower.contains("fsandroid.kugou")
        || lower.contains("fsm.kugou")
        || lower.contains("mobilesdk.kugou")
        || lower.contains("kuwo")
        || lower.contains("car-lv.kuwo")
        || lower.contains("nmobi.kuwo")
        || lower.contains("sr.kuwo")
        || lower.contains("antiserver")
        || lower.contains("migu.cn")
        || lower.contains("miguvideo")
        || lower.contains("douyin.com")
        || lower.contains("pglstatp-toutiao.com")
        || lower.contains("pangolin-sdk-toutiao.com")
        || lower.contains("bytescm.com")
        || lower.contains("pstatp.com")
        || lower.contains("bytecdn.cn")
        || lower.contains("haitangw")
        || lower.contains("musicapi")
        || (lower.contains("/music")
            || lower.contains("/song")
            || lower.contains("/track")
            || lower.contains("/play"))
}

fn apply_stream_request_headers(
    mut req: reqwest::blocking::RequestBuilder,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
) -> reqwest::blocking::RequestBuilder {
    let has_plugin_user_agent = headers
        .map(|hdrs| {
            hdrs.keys()
                .any(|key| key.eq_ignore_ascii_case("user-agent"))
        })
        .unwrap_or(false);

    if !has_plugin_user_agent {
        if let Some(ua) = user_agent {
            req = req.header(reqwest::header::USER_AGENT, ua);
        }
    }

    if let Some(hdrs) = headers {
        for (key, value) in hdrs {
            if !key.trim().is_empty() && !value.trim().is_empty() {
                if let (Ok(name), Ok(val)) = (
                    reqwest::header::HeaderName::from_bytes(key.as_bytes()),
                    reqwest::header::HeaderValue::from_str(value),
                ) {
                    req = req.header(name, val);
                }
            }
        }
    }
    req
}

fn registrable_audio_domain(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let host = rest.split('/').next()?.split(':').next()?;
    let parts: Vec<&str> = host.split('.').filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 {
        return Some(host.to_string());
    }
    Some(format!(
        "{}.{}",
        parts[parts.len() - 2],
        parts[parts.len() - 1]
    ))
}

fn http_only_audio_domains() -> &'static Mutex<std::collections::HashSet<String>> {
    static CACHE: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

fn send_audio_request(
    client: &reqwest::blocking::Client,
    url: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
    range_start: Option<u64>,
    allow_video: bool,
) -> Result<(reqwest::blocking::Response, String), String> {
    let with_range = |builder: reqwest::blocking::RequestBuilder| {
        if let Some(start) = range_start {
            builder.header(reqwest::header::RANGE, format!("bytes={start}-"))
        } else {
            builder
        }
    };
    if let Some(rest) = url.strip_prefix("http://") {
        let https_url = format!("https://{rest}");
        let skip_probe = registrable_audio_domain(url)
            .map(|d| http_only_audio_domains().lock().unwrap().contains(&d))
            .unwrap_or(false);
        if !skip_probe {
            let probe_ok = if let Ok(probe) = crate::netproxy::blocking_client_builder()
                .connect_timeout(Duration::from_millis(800))
                .timeout(Duration::from_millis(1200))
                .gzip(true)
                .brotli(true)
                .deflate(true)
                .redirect(crate::security::ssrf::ip_literal_redirect_policy())
                .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
                .build()
            {
                match with_range(apply_stream_request_headers(
                    probe.get(&https_url),
                    headers,
                    user_agent,
                ))
                .send()
                {
                    Ok(r) => {
                        if r.status().is_success() {
                            let ct = r
                                .headers()
                                .get(reqwest::header::CONTENT_TYPE)
                                .and_then(|v| v.to_str().ok())
                                .unwrap_or("")
                                .to_lowercase();
                            if is_media_content_type(&ct, allow_video) {
                                return Ok((r, https_url));
                            }
                        }
                        false
                    }
                    Err(_) => false,
                }
            } else {
                false
            };
            if !probe_ok {
                if let Some(d) = registrable_audio_domain(url) {
                    http_only_audio_domains().lock().unwrap().insert(d);
                }
            }
        }
    }
    let r = with_range(apply_stream_request_headers(
        client.get(url),
        headers,
        user_agent,
    ))
    .send()
    .map_err(|e| e.to_string())?;
    Ok((r, url.to_string()))
}

fn download_thread(
    url: &str,
    hash: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    user_agent: Option<&str>,
    resume_from: u64,
    path: PathBuf,
    downloaded_bytes: Arc<AtomicU64>,
    download_complete: Arc<AtomicBool>,
    download_failed: Arc<AtomicBool>,
    post_check_pending: Arc<AtomicBool>,
    ekey: Arc<std::sync::Mutex<Option<String>>>,
    cek: Arc<std::sync::Mutex<Option<String>>>,
    download_error: Arc<std::sync::Mutex<Option<String>>>,
    cenc_metadata: Arc<std::sync::Mutex<Option<crate::player::cenc::CencMetadata>>>,
    cenc_streaming: Arc<AtomicBool>,
    content_length_shared: Arc<AtomicU64>,
    allow_video: bool,
) {
    let fail_download = |reason: &str, bytes_written: u64| {
        eprintln!(
            "[stream_cache] 下载失败: {} (已下载 {} bytes)",
            reason, bytes_written
        );
        downloaded_bytes.store(bytes_written, Ordering::Relaxed);
        download_failed.store(true, Ordering::Relaxed);
        if let Ok(mut err) = download_error.lock() {
            *err = Some(reason.to_string());
        }
        if let Ok(mut mgr) = cache().lock() {
            mgr.update_size(hash, bytes_written);
            mgr.evict_if_needed();
        }
    };

    let has_cek = cek.lock().map(|c| c.is_some()).unwrap_or(false);
    if has_cek {
        post_check_pending.store(true, Ordering::Relaxed);
    }

    let client = match crate::netproxy::blocking_client_builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(10))
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .redirect(crate::security::ssrf::ip_literal_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            fail_download(&format!("创建 HTTP 客户端失败: {}", e), 0);
            return;
        }
    };

    let mut response = match send_audio_request(
        &client,
        url,
        headers,
        user_agent,
        (resume_from > 0).then_some(resume_from),
        allow_video,
    ) {
        Ok((r, _)) => r,
        Err(e) => {
            fail_download(&format!("下载请求失败: {}", e), 0);
            return;
        }
    };

    if !response.status().is_success() {
        fail_download(&format!("HTTP {}", response.status()), 0);
        return;
    }

    let mut head_valid = resume_from > 0;

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let is_non_audio = content_type.contains("text/html")
        || content_type.contains("application/json")
        || content_type.contains("text/plain")
        || content_type.contains("application/xml")
        || content_type.contains("text/xml");
    if is_non_audio {
        head_valid = false;
        let body_text: String = response.text().unwrap_or_default();
        if let Some((real_url, json_ekey)) = extract_audio_info_from_text(&body_text) {
            if let Some(ref ek) = json_ekey {
                if let Ok(mut ekey_guard) = ekey.lock() {
                    if ekey_guard.is_none() {
                        *ekey_guard = Some(ek.clone());
                    }
                }
            }
            match send_audio_request(&client, &real_url, headers, user_agent, None, allow_video) {
                Ok((retry_resp, _)) if retry_resp.status().is_success() => {
                    let retry_ct = retry_resp
                        .headers()
                        .get(reqwest::header::CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                        .to_lowercase();
                    if retry_ct.contains("text/html")
                        || retry_ct.contains("application/json")
                        || retry_ct.contains("text/plain")
                        || retry_ct.contains("application/xml")
                        || retry_ct.contains("text/xml")
                    {
                        let retry_body: String = retry_resp.text().unwrap_or_default();
                        if let Some((real_url2, _)) = extract_audio_info_from_text(&retry_body) {
                            match send_audio_request(&client, &real_url2, headers, user_agent, None, allow_video)
                            {
                                Ok((resp2, _)) if resp2.status().is_success() => {
                                    let ct2 = resp2
                                        .headers()
                                        .get(reqwest::header::CONTENT_TYPE)
                                        .and_then(|v| v.to_str().ok())
                                        .unwrap_or("")
                                        .to_lowercase();
                                    if ct2.contains("text/html")
                                        || ct2.contains("application/json")
                                        || ct2.contains("text/plain")
                                    {
                                        fail_download(
                                            &format!(
                                                "二次提取的 URL 仍返回非音频内容 (Content-Type: {})",
                                                ct2
                                            ),
                                            0,
                                        );
                                        return;
                                    }
                                    response = resp2;
                                }
                                Ok((resp2, _)) => {
                                    fail_download(
                                        &format!("二次提取的 URL 返回 HTTP {}", resp2.status()),
                                        0,
                                    );
                                    return;
                                }
                                Err(e) => {
                                    fail_download(&format!("二次提取的 URL 请求失败: {}", e), 0);
                                    return;
                                }
                            }
                        } else {
                            fail_download(
                                &format!(
                                    "提取的 URL 仍返回非音频内容 (Content-Type: {})，二次提取失败",
                                    retry_ct
                                ),
                                0,
                            );
                            return;
                        }
                    } else {
                        response = retry_resp;
                    }
                }
                Ok((retry_resp, _)) => {
                    fail_download(&format!("提取的 URL 返回 HTTP {}", retry_resp.status()), 0);
                    return;
                }
                Err(e) => {
                    fail_download(&format!("提取的 URL 请求失败: {}", e), 0);
                    return;
                }
            }
        } else {
            fail_download(
                &format!(
                    "服务器返回非音频内容 (Content-Type: {})，URL提取失败",
                    content_type
                ),
                0,
            );
            return;
        }
    }

    let mut total_bytes = response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());

    // 回填共享总长槽：symphonia FLAC/MP3 demuxer 的 seek 依赖 MediaSource::byte_len()，
    // 须在下载中（起播后控制点/用户 seek 时）即实时可读。
    if let Some(total) = total_bytes {
        content_length_shared.store(total, Ordering::Relaxed);
    }

    let mut file = match OpenOptions::new().write(true).open(&path) {
        Ok(f) => f,
        Err(e) => {
            fail_download(&format!("打开缓存文件写入失败: {}", e), 0);
            return;
        }
    };

    let mut bytes_written: u64 =
        if head_valid && response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            if let Some(cr) = response
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
            {
                if let Some(t) = cr.rsplit('/').next().and_then(|s| s.parse::<u64>().ok()) {
                    total_bytes = Some(t);
                    content_length_shared.store(t, Ordering::Relaxed);
                }
            }
            if file.seek(SeekFrom::Start(resume_from)).is_err() {
                fail_download("片头续传定位失败", 0);
                return;
            }
            resume_from
        } else {
            if head_valid {
                let _ = file.set_len(0);
                downloaded_bytes.store(0, Ordering::Relaxed);
            }
            let _ = file.seek(SeekFrom::Start(0));
            0
        };

    let mut buf = [0u8; 64 * 1024];
    let mut error: Option<String> = None;
    let mut cenc_probe_done = false;

    loop {
        match response.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if let Err(e) = file.write_all(&buf[..n]) {
                    error = Some(format!("写入缓存文件失败: {}", e));
                    break;
                }
                bytes_written += n as u64;
                downloaded_bytes.store(bytes_written, Ordering::Relaxed);

                if has_cek && !cenc_probe_done && bytes_written >= MIN_BUFFER_BYTES {
                    cenc_probe_done = true;
                    let probe_len = bytes_written.min(1024 * 1024) as usize;
                    let mut probe_buf = vec![0u8; probe_len];
                    if let Ok(mut f) = std::fs::File::open(&path) {
                        use std::io::Read as _;
                        if f.read_exact(&mut probe_buf).is_ok() {
                            let cek_str = cek.lock().ok().and_then(|c| c.clone());
                            if let Some(ref cek_str) = cek_str {
                                if let Ok(key) = crate::player::cenc::cek_to_key(cek_str) {
                                    if let Ok(Some(metadata)) =
                                        crate::player::cenc::parse_cenc_metadata(&probe_buf, &key)
                                    {
                                        if let Ok(mut md) = cenc_metadata.lock() {
                                            *md = Some(metadata);
                                        }
                                        cenc_streaming.store(true, Ordering::Relaxed);
                                        post_check_pending.store(false, Ordering::Relaxed);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                error = Some(format!("下载流读取错误: {}", e));
                break;
            }
        }
    }

    let _ = file.flush();

    if let Some(error) = error {
        fail_download(&error, bytes_written);
        return;
    }

    if let Some(total) = total_bytes {
        if bytes_written != total {
            fail_download(
                &format!("下载字节数不完整: {} / {}", bytes_written, total),
                bytes_written,
            );
            return;
        }
    }

    let has_ekey = ekey.lock().map(|e| e.is_some()).unwrap_or(false);
    // 视频流（MV）跳过音频魔数校验：webm(EBML)/flv/m4s 均非音频头，
    // 非媒体错误页已由 Content-Type 检查拦截。
    if !has_ekey && !allow_video {
        if let Ok(mut verify_file) = File::open(&path) {
            let mut header = [0u8; 16];
            let header_len = verify_file.read(&mut header).unwrap_or(0);
            if header_len >= 4 && !is_valid_audio_header(&header[..header_len]) {
                let header_hex: String = header[..header_len]
                    .iter()
                    .map(|b| format!("{:02x}", b))
                    .collect::<Vec<_>>()
                    .join(" ");
                fail_download(
                    &format!("下载内容非有效音频格式 (header: {})", header_hex),
                    bytes_written,
                );
                post_check_pending.store(false, Ordering::Relaxed);
                return;
            }
        }
    }

    if has_cek && !cenc_streaming.load(Ordering::Relaxed) {
        let cek_str = cek.lock().ok().and_then(|c| c.clone());
        if let Some(ref cek_str) = cek_str {
            if let Err(e) = decrypt_cenc_file(&path, cek_str) {
                fail_download(&e, bytes_written);
                post_check_pending.store(false, Ordering::Relaxed);
                return;
            }
        }
        post_check_pending.store(false, Ordering::Relaxed);
    }

    download_complete.store(true, Ordering::Relaxed);

    // 更新缓存大小，并在完成后立即触发淘汰：否则多首歌下载完成而
    // 没有新下载启动时，current_size 会持续超出用户设置的上限。
    if let Ok(mut mgr) = cache().lock() {
        mgr.update_size(hash, bytes_written);
        mgr.evict_if_needed();
    }
}
