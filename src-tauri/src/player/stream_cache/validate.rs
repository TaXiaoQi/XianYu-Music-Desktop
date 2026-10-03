pub(super) fn is_valid_audio_header(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }

    if &bytes[..3] == b"ID3" {
        return true;
    }

    if bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0 {
        return true;
    }

    if &bytes[..4] == b"fLaC" {
        return true;
    }

    if &bytes[..4] == b"RIFF" {
        return true;
    }

    if &bytes[..4] == b"OggS" {
        return true;
    }

    if &bytes[..4] == b"FORM" {
        return true;
    }

    if bytes.len() >= 8 && &bytes[4..8] == b"ftyp" {
        return true;
    }

    false
}

fn is_audio_content_type(content_type: &str) -> bool {
    let ct = content_type.trim().to_lowercase();
    if ct.is_empty() {
        return true;
    }
    ct.starts_with("audio/")
        || ct.contains("octet-stream")
        || ct.contains("mpegurl")
        || ct.contains("x-mpegurl")
}

/// 视频（MV）流缓存放宽：video/* 视为有效媒体内容。
pub(super) fn is_media_content_type(content_type: &str, allow_video: bool) -> bool {
    if allow_video && content_type.trim().to_lowercase().starts_with("video/") {
        return true;
    }
    is_audio_content_type(content_type)
}

#[cfg(test)]
mod tests {
    use super::is_audio_content_type;

    #[test]
    fn audio_content_type_detects_valid_audio() {
        assert!(is_audio_content_type("audio/mpeg"));
        assert!(is_audio_content_type("audio/flac"));
        assert!(is_audio_content_type("audio/mp4"));
        assert!(is_audio_content_type("application/octet-stream"));
        assert!(is_audio_content_type("application/vnd.apple.mpegurl"));
        assert!(is_audio_content_type("audio/x-mpegurl"));
        assert!(is_audio_content_type(""));
        assert!(is_audio_content_type("   "));
    }

    #[test]
    fn audio_content_type_rejects_error_pages() {
        assert!(!is_audio_content_type("text/html"));
        assert!(!is_audio_content_type("text/html; charset=utf-8"));
        assert!(!is_audio_content_type("application/json"));
        assert!(!is_audio_content_type("text/plain"));
        assert!(!is_audio_content_type("application/xml"));
        assert!(!is_audio_content_type("text/xml"));
        assert!(!is_audio_content_type("image/png"));
    }
}
