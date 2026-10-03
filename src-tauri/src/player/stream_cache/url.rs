use sha2::{Digest, Sha256};

pub(super) fn sanitize_stream_url(raw: &str) -> String {
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
        .find(|c: char| {
            matches!(
                c,
                '`' | '\''
                    | '"'
                    | '<'
                    | '>'
                    | ' '
                    | '\t'
                    | '\n'
                    | '\r'
                    | '\u{2018}'
                    | '\u{2019}'
                    | '\u{201c}'
                    | '\u{201d}'
                    | '\u{ff02}'
                    | '\u{ff07}'
            )
        })
        .unwrap_or(candidate.len());
    let mut result = candidate[..end].to_string();
    loop {
        let trimmed_end = result.trim_end_matches(|c: char| {
            matches!(
                c,
                ',' | '，'
                    | ';'
                    | '；'
                    | '`'
                    | '\''
                    | '"'
                    | ' '
                    | '\u{2018}'
                    | '\u{2019}'
                    | '\u{201c}'
                    | '\u{201d}'
                    | '\u{ff02}'
                    | '\u{ff07}'
            )
        });
        if trimmed_end.len() == result.len() {
            break;
        }
        result = trimmed_end.to_string();
    }
    result
}

pub(super) fn url_hash(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    hex::encode(&hasher.finalize()[..16])
}

/// 统一的流缓存 key（清洗 + hash），供 MV 代理等外部模块对齐注册表。
pub fn stream_cache_key(url: &str) -> String {
    url_hash(&sanitize_stream_url(url))
}
