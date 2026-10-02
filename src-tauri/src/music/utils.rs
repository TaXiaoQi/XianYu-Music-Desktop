// 路径与数值层面的零散工具。
// Windows 反斜杠形态与 verbatim（`\\?\`）前缀的清理、网络盘判定、
// SQL LIKE 转义，以及数据库整型到窄整型的安全收窄。

use std::{fs};

/// 支持进入曲库扫描的音频扩展名（含 QMC 加密壳格式）。
pub const SUPPORTED_LIBRARY_EXTENSIONS: &[&str] = &[
  "aac", "aif", "aiff", "ape", "dff", "dsf", "flac", "m4a", "m4b", "mp3", "mp4", "oga", "ogg",
  "opus", "wav", "wv", "mgg", "mgg0", "mggl", "mflac", "mflac0", "qmc0", "qmc2", "qmc3", "qmcflac",
  "qmcogg",
];

pub const CUE_FILE_EXTENSIONS: &[&str] = &["cue"];

// ---- Windows 路径前缀归一 ----

/// 去掉 canonicalize 产生的 `\\?\` / `\\?\UNC\` 前缀，统一成常规盘符或 UNC 形态。
fn strip_windows_path_prefixes(path: String) -> String {
  if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
    return format!(r"\\{rest}");
  }
  if let Some(rest) = path.strip_prefix(r"UNC\") {
    return format!(r"\\{rest}");
  }
  if let Some(rest) = path.strip_prefix(r"\\?\") {
    return rest.to_string();
  }
  path
}

fn canonicalize_or_keep(path_str: &str) -> String {
  match fs::canonicalize(path_str) {
    Ok(resolved) => {
      let rendered = resolved.to_string_lossy().into_owned();
      if cfg!(windows) {
        strip_windows_path_prefixes(rendered)
      } else {
        rendered
      }
    }
    Err(_) => path_str.to_string(),
  }
}

/// 规范化路径：优先取真实文件系统形态；文件不存在时仅做斜杠风格规整。
pub fn normalize_path(path_str: &str) -> String { // normalize_path
  if cfg!(windows) {
    canonicalize_or_keep(path_str)
  } else {
    match fs::canonicalize(path_str) {
      Ok(resolved) => resolved.to_string_lossy().into_owned(),
      Err(_) => path_str.to_string(),
    }
  }
}

/// 识别历史版本写入数据库的、缺失 `\\` 前缀的 UNC 路径（`UNC\host\share` 形态）。
pub fn legacy_unc_path(path_str: &str) -> Option<String> { // legacy_unc_path
  path_str
    .strip_prefix(r"\\")
    .filter(|path| !path.starts_with(r"?\") && !path.starts_with(r".\"))
    .map(|path| format!(r"UNC\{path}"))
}

/// 判定路径是否位于网络共享或远程映射盘上。
pub fn is_network_share_path(path_str: &str) -> bool { // is_network_share_path
  let path = path_str.trim();
  let looks_unc = path.starts_with(r"\\?\UNC\")
    || path.starts_with("//")
    || (path.starts_with(r"\\") && !path.starts_with(r"\\?\") && !path.starts_with(r"\\.\"));
  if looks_unc {
    return true;
  }

  #[cfg(target_os = "windows")]
  {
    use std::ffi::OsStr;
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;

    // 远程/映射驱动器在 Win32 中的类型码。
    const DRIVE_REMOTE: u32 = 4;

    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
      let drive_root = format!("{}:\\", bytes[0] as char);
      let wide = OsStr::new(&drive_root)
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
      return unsafe { GetDriveTypeW(wide.as_ptr()) } == DRIVE_REMOTE;
    }
  }

  false
}

// ---- SQL LIKE 辅助 ----

/// 转义 LIKE 通配符，配合 `ESCAPE '^'` 使用。
pub fn escape_like(input: &str) -> String { // escape_like
  input
    .replace('^', "^^")
    .replace('%', "^%")
    .replace('_', "^_")
}

/// 生成匹配某个文件夹全部后代路径的前向/反斜杠两个 LIKE 模式。
pub fn descendant_like_patterns(folder_path: &str) -> (String, String) { // descendant_like_patterns
  let ensure_trailing = |separator: char| {
    if folder_path.ends_with('/') || folder_path.ends_with('\\') {
      folder_path.to_string()
    } else {
      format!("{folder_path}{separator}")
    }
  };

  (
    format!("{}%", escape_like(&ensure_trailing('/'))),
    format!("{}%", escape_like(&ensure_trailing('\\'))),
  )
}

// ---- 扩展名 / 编码判定 ----

pub fn is_supported_library_extension(ext: &str) -> bool { // is_supported_library_extension
  SUPPORTED_LIBRARY_EXTENSIONS.contains(&ext)
}

pub fn is_cue_file_extension(ext: &str) -> bool { // is_cue_file_extension
  CUE_FILE_EXTENSIONS.contains(&ext)
}

/// 依据编码器名或容器名判断是否为无损音频。
pub fn is_lossless_audio(codec: Option<&str>, format: &str) -> bool { // is_lossless_audio
  let normalized = codec.unwrap_or(format).to_lowercase();
  matches!(
    normalized.as_str(),
    "aif" | "aiff" | "alac" | "ape" | "dff" | "dsd" | "dsf" | "flac" | "pcm" | "wav" | "wv"
  )
}

// ---- 整型收窄 ----

pub(crate) fn i64_to_bool(v: Option<i64>) -> bool {
  v.unwrap_or(0) != 0
}

pub(crate) fn i64_to_u64_opt(v: Option<i64>) -> Option<u64> {
  v.filter(|value| *value >= 0).map(|value| value as u64)
}

pub(crate) fn i64_to_u8_opt(v: Option<i64>) -> Option<u8> {
  v.filter(|value| *value >= 0 && *value <= u8::MAX as i64)
    .map(|value| value as u8)
}

pub(crate) fn clamp_i64_to_u32(v: i64) -> u32 {
  v.clamp(0, u32::MAX as i64) as u32
}

// ---- 格式分布统计（统计页使用） ----

/// 将容器/编码/扩展名归并到统计页展示用的格式桶。
pub fn format_distribution_bucket( // format_distribution_bucket
  container: Option<&str>,
  codec: Option<&str>,
  format: &str,
) -> &'static str { 
  let codec = codec.unwrap_or_default().to_lowercase();
  let container = container.unwrap_or_default().to_lowercase();
  let format = format.to_lowercase();

  // 编码器优先级最高：同一编码可能装在不同容器里。
  let by_codec = match codec.as_str() {
    "flac" => Some("flac"),
    "mp3" => Some("mp3"),
    "alac" => Some("alac"),
    "aac" => Some("aac"),
    "vorbis" => Some("ogg"),
    "opus" => Some("opus"),
    "dsd" => Some("dsd"),
    _ => None,
  };
  if let Some(bucket) = by_codec {
    return bucket;
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

#[cfg(test)]
mod path_tests {
  use super::{is_network_share_path, legacy_unc_path, strip_windows_path_prefixes};

  #[test]
  fn verbatim_unc_prefix_becomes_plain_unc() {
    assert_eq!(
      strip_windows_path_prefixes(r"\\?\UNC\NAS\Music\song.flac".to_string()),
      r"\\NAS\Music\song.flac"
    );
  }

  #[test]
  fn legacy_broken_unc_prefix_is_repaired() {
    assert_eq!(
      strip_windows_path_prefixes(r"UNC\NAS\Music\song.flac".to_string()),
      r"\\NAS\Music\song.flac"
    );
    assert_eq!(
      legacy_unc_path(r"\\NAS\Music"),
      Some(r"UNC\NAS\Music".to_string())
    );
  }

  #[test]
  fn unc_and_forward_slash_shares_detected_as_network() {
    assert!(is_network_share_path(r"\\NAS\Music\song.flac"));
    assert!(is_network_share_path(r"\\?\UNC\NAS\Music\song.flac"));
    assert!(is_network_share_path("//NAS/Music/song.flac"));
    assert!(!is_network_share_path(r"C:\Music\song.flac"));
  }
}
