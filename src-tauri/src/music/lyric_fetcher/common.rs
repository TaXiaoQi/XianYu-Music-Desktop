use encoding_rs::{BIG5, EUC_KR, GBK, SHIFT_JIS, UTF_16BE, UTF_16LE};
use serde::{Deserialize, Serialize};

// ==================== Types ====================

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct LyricSongInfo {
    pub songmid: String,
    pub hash: Option<String>,
    pub name: String,
    pub singer: String,
    pub album_name: Option<String>,
    pub interval: Option<String>,
    #[serde(rename = "_interval")]
    pub interval_ms: Option<u32>,
    pub song_id: Option<serde_json::Value>,
    pub str_media_mid: Option<String>,
    pub album_mid: Option<String>,
    pub album_id: Option<serde_json::Value>,
    pub copyright_id: Option<String>,
    pub source: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LyricResult {
    pub lyric: String,
    pub tlyric: String,
    pub rlyric: String,
    pub lxlyric: String,
}

// ==================== Utility ====================

pub(crate) fn decode_html_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'&' {
            if let Some(end) = s[i..].find(';') {
                let entity = &s[i + 1..i + end];
                let decoded = if let Some(hex) = entity
                    .strip_prefix("#x")
                    .or_else(|| entity.strip_prefix("#X"))
                {
                    u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
                } else if let Some(dec) = entity.strip_prefix('#') {
                    dec.parse::<u32>().ok().and_then(char::from_u32)
                } else {
                    match entity {
                        "amp" => Some('&'),
                        "lt" => Some('<'),
                        "gt" => Some('>'),
                        "quot" => Some('"'),
                        "apos" => Some('\''),
                        "nbsp" => Some(' '),
                        _ => None,
                    }
                };
                if let Some(ch) = decoded {
                    out.push(ch);
                    i += end + 1;
                    continue;
                }
            }
        }
        out.push(s[i..].chars().next().unwrap_or('\u{FFFD}'));
        i += s[i..].chars().next().map(|c| c.len_utf8()).unwrap_or(1);
    }
    out
}

pub(super) fn hex_to_bytes(hex: &str) -> Vec<u8> {
    let hex = hex.trim();
    (0..hex.len())
        .step_by(2)
        .filter_map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}

pub(super) fn is_valid_base64(s: &str) -> bool {
    if s.len() < 4 {
        return false;
    }
    s.bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
        && s.len() % 4 == 0
}

pub(super) fn pad_base64(input: &str) -> String {
    let mut s = input.to_string();
    while s.len() % 4 != 0 {
        s.push('=');
    }
    s
}

pub(super) fn ms_format(time_ms: u64) -> String {
    let ms = time_ms % 1000;
    let total_secs = time_ms / 1000;
    let m = total_secs / 60;
    let s = total_secs % 60;
    format!("[{:0>2}:{:0>2}.{:0>3}]", m, s, ms)
}

// ==================== Deflate/Zlib Decompression ====================

pub(super) fn decompress_zlib_sync_flush(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use flate2::{Decompress, FlushDecompress, Status};
    let mut d = Decompress::new(true);
    let mut out = Vec::with_capacity(bytes.len() * 3 + 64);
    let mut buf = [0u8; 16384];
    let mut in_pos = 0usize;
    let mut guard = 0usize;
    loop {
        guard += 1;
        if guard > 1_000_000 {
            return Err("zlib inflate loop limit".to_string());
        }
        let before = d.total_out();
        let available_in = bytes.len().saturating_sub(in_pos);
        let status = d
            .decompress(
                &bytes[in_pos..in_pos + available_in],
                &mut buf,
                FlushDecompress::Sync,
            )
            .map_err(|e| e.to_string())?;
        let produced = (d.total_out() - before) as usize;
        out.extend_from_slice(&buf[..produced.min(buf.len())]);
        in_pos = d.total_in() as usize;
        match status {
            Status::StreamEnd => break,
            Status::BufError => break,
            Status::Ok => {
                if produced == 0 && in_pos >= bytes.len() {
                    break;
                }
            }
        }
    }
    Ok(out)
}

pub(super) fn decompress_deflate_to_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use flate2::read::DeflateDecoder;
    use std::io::Read;
    let mut decoder = DeflateDecoder::new(bytes);
    let mut result = Vec::new();
    decoder
        .read_to_end(&mut result)
        .map_err(|e| e.to_string())?;
    Ok(result)
}

pub(super) fn decompress_zlib_to_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use flate2::read::ZlibDecoder;
    use std::io::Read;
    let mut decoder = ZlibDecoder::new(bytes);
    let mut result = Vec::new();
    decoder
        .read_to_end(&mut result)
        .map_err(|e| e.to_string())?;
    Ok(result)
}

pub(super) fn decompress_zlib_to_bytes_skip_header(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if let Ok(result) = decompress_zlib_to_bytes(bytes) {
        return Ok(result);
    }
    if bytes.len() > 2 {
        if let Ok(result) = decompress_zlib_to_bytes(&bytes[2..]) {
            return Ok(result);
        }
    }
    Err("zlib decompression failed".to_string())
}

pub(super) fn decompress_gzip_to_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use flate2::read::GzDecoder;
    use std::io::Read;
    let mut decoder = GzDecoder::new(bytes);
    let mut result = Vec::new();
    decoder
        .read_to_end(&mut result)
        .map_err(|e| e.to_string())?;
    Ok(result)
}

pub(super) fn bytes_to_lossy_string(bytes: Vec<u8>) -> String {
    super::super::files::decode_lyrics_file_bytes(&bytes)
}

// ==================== HTTP Fetching ====================

pub(crate) struct HttpResponse {
    pub(crate) status: u16,
    pub(crate) body: String,
    pub(crate) body_bytes: Vec<u8>,
    /// 全部响应头（键转小写），短链解析等场景需要读 location
    pub(crate) headers: Vec<(String, String)>,
}

fn extract_charset(content_type: Option<&str>) -> Option<String> {
    let header = content_type?;
    let (_, params) = header.split_once(';')?;
    for param in params.split(';') {
        let param = param.trim();
        if let Some(value) = param
            .strip_prefix("charset=")
            .or_else(|| param.strip_prefix("charset ="))
        {
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if !value.is_empty() {
                return Some(value.to_ascii_lowercase());
            }
        }
    }
    None
}

fn decode_http_body(body_bytes: &[u8], content_type: Option<&str>) -> String {
    if let Some(charset) = extract_charset(content_type) {
        let decoded = match charset.as_str() {
            "utf-8" | "utf8" => None,
            "utf-16" | "utf-16le" => {
                let (decoded, _, _) = UTF_16LE.decode(body_bytes);
                Some(decoded.into_owned())
            }
            "utf-16be" => {
                let (decoded, _, _) = UTF_16BE.decode(body_bytes);
                Some(decoded.into_owned())
            }
            "gbk" | "gb2312" | "gb18030" | "cp936" => {
                let (decoded, _, _) = GBK.decode(body_bytes);
                Some(decoded.into_owned())
            }
            "big5" | "big-5" | "cp950" => {
                let (decoded, _, _) = BIG5.decode(body_bytes);
                Some(decoded.into_owned())
            }
            "shift_jis" | "shift-jis" | "sjis" | "cp932" => {
                let (decoded, _, _) = SHIFT_JIS.decode(body_bytes);
                Some(decoded.into_owned())
            }
            "euc-kr" | "euckr" | "cp949" => {
                let (decoded, _, _) = EUC_KR.decode(body_bytes);
                Some(decoded.into_owned())
            }
            _ => None,
        };
        if let Some(text) = decoded {
            return text;
        }
    }
    super::super::files::decode_lyrics_file_bytes(body_bytes)
}

pub(crate) async fn http_fetch_text(
    url: &str,
    method: &str,
    headers: &[(&str, &str)],
    body: Option<&str>,
) -> Result<HttpResponse, String> {
    crate::security::ssrf::validate_outbound_url(url)
        .await
        .map_err(|e| e.to_string())?;

    let client = crate::netproxy::client_builder()
        .redirect(crate::security::ssrf::ssrf_redirect_policy())
        .dns_resolver(crate::security::ssrf::pinned_dns_resolver())
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = match method {
        "POST" => client.post(url),
        _ => client.get(url),
    };

    for (key, value) in headers {
        req = req.header(*key, *value);
    }

    if let Some(body) = body {
        req = req.body(body.to_string());
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| {
            (
                k.as_str().to_ascii_lowercase(),
                v.to_str().unwrap_or_default().to_string(),
            )
        })
        .collect();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let body_bytes = resp.bytes().await.map_err(|e| e.to_string())?.to_vec();
    let body = decode_http_body(&body_bytes, content_type.as_deref());

    Ok(HttpResponse {
        status,
        body,
        body_bytes,
        headers,
    })
}

pub(super) async fn http_fetch_binary(
    url: &str,
    method: &str,
    headers: &[(&str, &str)],
    body: Option<&str>,
) -> Result<HttpResponse, String> {
    http_fetch_text(url, method, headers, body).await
}
