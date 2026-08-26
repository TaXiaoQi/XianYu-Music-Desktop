use std::fs;

fn normalize_windows_path(path: &str) -> String {
    let path = path.replace('/', "\\");

    if let Some(unc_path) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc_path}");
    }

    if let Some(local_path) = path.strip_prefix(r"\\?\") {
        return local_path.to_string();
    }

    // 兼容旧版本错误移除 `\\?\` 后遗留的 `UNC\server\share` 路径。
    if let Some(unc_path) = path.strip_prefix(r"UNC\") {
        return format!(r"\\{unc_path}");
    }

    path
}

/// 将 i64 钳位到 u32 范围（负值归零，超限取 MAX）
pub(crate) fn clamp_i64_to_u32(v: i64) -> u32 {
    if v <= 0 {
        0
    } else if v > u32::MAX as i64 {
        u32::MAX
    } else {
        v as u32
    }
}

/// 将 Option<i64> 安全转换为 Option<u64>（负值返回 None）
pub(crate) fn i64_to_u64_opt(v: Option<i64>) -> Option<u64> {
    v.filter(|value| *value >= 0).map(|value| value as u64)
}

/// 将 Option<i64> 安全转换为 Option<u8>（超出 0-255 返回 None）
pub(crate) fn i64_to_u8_opt(v: Option<i64>) -> Option<u8> {
    v.filter(|value| *value >= 0 && *value <= u8::MAX as i64)
        .map(|value| value as u8)
}

/// 将 Option<i64> 转换为 bool（None 或 0 为 false）
pub(crate) fn i64_to_bool(v: Option<i64>) -> bool {
    v.unwrap_or(0) != 0
}

pub const SUPPORTED_LIBRARY_EXTENSIONS: &[&str] = &[
    "aac", "aif", "aiff", "ape", "dff", "dsf", "flac", "m4a", "m4b", "mp3", "mp4", "oga", "ogg",
    "opus", "wav", "wv",
    // QQ 音乐 QMC 加密格式（播放时按需解密）
    "mgg", "mgg0", "mggl", "mflac", "mflac0", "qmc0", "qmc2", "qmc3", "qmcflac", "qmcogg",
];

pub const CUE_FILE_EXTENSIONS: &[&str] = &["cue"];

pub fn normalize_path(path_str: &str) -> String {
    if let Ok(p) = fs::canonicalize(path_str) {
        let path = p.to_string_lossy().into_owned();
        return if cfg!(windows) {
            normalize_windows_path(&path)
        } else {
            path
        };
    }

    if cfg!(windows) {
        normalize_windows_path(path_str)
    } else {
        path_str.to_string()
    }
}

/// 返回当前规范 UNC 路径在旧版本中可能被错误保存成的值。
pub fn legacy_unc_path(path_str: &str) -> Option<String> {
    path_str
        .strip_prefix(r"\\")
        .filter(|path| !path.starts_with(r"?\") && !path.starts_with(r".\"))
        .map(|path| format!(r"UNC\{path}"))
}

/// 判断路径是否来自 Windows 局域网共享（UNC 或映射网络驱动器）。
pub fn is_network_share_path(path_str: &str) -> bool {
    let path = path_str.trim();
    if path.starts_with(r"\\?\UNC\")
        || (path.starts_with(r"\\") && !path.starts_with(r"\\?\") && !path.starts_with(r"\\.\"))
        || path.starts_with("//")
    {
        return true;
    }

    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::iter;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;

        const WINDOWS_DRIVE_REMOTE: u32 = 4;

        let bytes = path.as_bytes();
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            let drive_root = format!("{}:\\", bytes[0] as char);
            let wide = OsStr::new(&drive_root)
                .encode_wide()
                .chain(iter::once(0))
                .collect::<Vec<_>>();
            return unsafe { GetDriveTypeW(wide.as_ptr()) } == WINDOWS_DRIVE_REMOTE;
        }
    }

    false
}

/// Escape special characters for SQL LIKE pattern with `ESCAPE '^'`.
pub fn escape_like(input: &str) -> String {
    input
        .replace('^', "^^")
        .replace('%', "^%")
        .replace('_', "^_")
}

/// Build forward/backward descendant LIKE patterns for a folder path.
/// Caller should use:
/// `path = ?1 OR path LIKE ?2 ESCAPE '^' OR path LIKE ?3 ESCAPE '^'`
pub fn descendant_like_patterns(folder_path: &str) -> (String, String) {
    let forward_base = if folder_path.ends_with('/') || folder_path.ends_with('\\') {
        folder_path.to_string()
    } else {
        format!("{folder_path}/")
    };

    let backward_base = if folder_path.ends_with('/') || folder_path.ends_with('\\') {
        folder_path.to_string()
    } else {
        format!("{folder_path}\\")
    };

    (
        format!("{}%", escape_like(&forward_base)),
        format!("{}%", escape_like(&backward_base)),
    )
}

pub fn is_supported_library_extension(ext: &str) -> bool {
    SUPPORTED_LIBRARY_EXTENSIONS.contains(&ext)
}

pub fn is_cue_file_extension(ext: &str) -> bool {
    CUE_FILE_EXTENSIONS.contains(&ext)
}

pub fn is_lossless_audio(codec: Option<&str>, format: &str) -> bool {
    let normalized = codec.unwrap_or(format).to_lowercase();
    matches!(
        normalized.as_str(),
        "aif" | "aiff" | "alac" | "ape" | "dff" | "dsd" | "dsf" | "flac" | "pcm" | "wav" | "wv"
    )
}

#[cfg(test)]
mod path_tests {
    use super::{is_network_share_path, legacy_unc_path, normalize_windows_path};

    #[test]
    fn converts_windows_verbatim_unc_to_regular_unc() {
        assert_eq!(
            normalize_windows_path(r"\\?\UNC\NAS\Music\song.flac"),
            r"\\NAS\Music\song.flac"
        );
    }

    #[test]
    fn restores_legacy_broken_unc_prefix() {
        assert_eq!(
            normalize_windows_path(r"UNC\NAS\Music\song.flac"),
            r"\\NAS\Music\song.flac"
        );
        assert_eq!(
            legacy_unc_path(r"\\NAS\Music"),
            Some(r"UNC\NAS\Music".to_string())
        );
    }

    #[test]
    fn recognizes_unc_network_share_paths() {
        assert!(is_network_share_path(r"\\NAS\Music\song.flac"));
        assert!(is_network_share_path(r"\\?\UNC\NAS\Music\song.flac"));
        assert!(is_network_share_path("//NAS/Music/song.flac"));
        assert!(!is_network_share_path(r"C:\Music\song.flac"));
    }
}

pub fn format_distribution_bucket(
    container: Option<&str>,
    codec: Option<&str>,
    format: &str,
) -> &'static str {
    let codec = codec.unwrap_or_default().to_lowercase();
    let container = container.unwrap_or_default().to_lowercase();
    let format = format.to_lowercase();

    match codec.as_str() {
        "flac" => return "flac",
        "mp3" => return "mp3",
        "alac" => return "alac",
        "aac" => return "aac",
        "vorbis" => return "ogg",
        "opus" => return "opus",
        "dsd" => return "dsd",
        _ => {}
    }

    match container.as_str() {
        "wav" => "wav",
        "aiff" => "aiff",
        "ogg" => "ogg",
        "mp4" => "aac",
        "ape" => "ape",
        "wavpack" => "wv",
        _ => match format.as_str() {
            "flac" => "flac",
            "mp3" => "mp3",
            "wav" => "wav",
            "alac" => "alac",
            "aif" | "aiff" => "aiff",
            "aac" | "m4a" | "m4b" | "mp4" => "aac",
            "ogg" | "oga" => "ogg",
            "opus" => "opus",
            "dsf" | "dff" => "dsd",
            "ape" => "ape",
            "wv" => "wv",
            _ => "other",
        },
    }
}
