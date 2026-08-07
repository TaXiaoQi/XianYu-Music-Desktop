use std::collections::BTreeSet;

/// 字体样式修饰词。Windows 注册表里的字体名是 "face name"（含粗细/斜体等修饰），
/// 而 CSS `font-family` 需要的是 "family name"。选中带修饰词的 face name 会导致
/// 浏览器匹配失败并回退到默认字体，因此需要把这些尾部修饰词剥离掉。
const FONT_STYLE_WORDS: &[&str] = &[
    "thin",
    "hairline",
    "extralight",
    "ultralight",
    "light",
    "semilight",
    "demilight",
    "regular",
    "normal",
    "book",
    "medium",
    "semibold",
    "demibold",
    "bold",
    "extrabold",
    "ultrabold",
    "black",
    "heavy",
    "italic",
    "oblique",
];

/// 从单个 face name 中剥离尾部的样式修饰词，得到 family name。
/// 例如 "Microsoft YaHei UI Bold" -> "Microsoft YaHei UI"，
/// "Calibri Light Italic" -> "Calibri"。
/// 若剥离后为空（整名都是样式词），则回退为原始名。
fn strip_style_words(face_name: &str) -> String {
    let words: Vec<&str> = face_name.split_whitespace().collect();
    let mut end = words.len();

    while end > 1 {
        let last = words[end - 1].to_ascii_lowercase();
        if FONT_STYLE_WORDS.contains(&last.as_str()) {
            end -= 1;
        } else {
            break;
        }
    }

    words[..end].join(" ")
}

/// 把注册表里的一个字体项名解析为一个或多个 CSS 可用的 family name。
/// 处理：去除 "@" 前缀、去除尾部 " (TrueType)" 之类的后缀、
/// 按 " & " 拆分合并项、剥离每个 face 的样式修饰词。
fn sanitize_font_names(value: &str, out: &mut BTreeSet<String>) {
    let trimmed = value.trim().trim_start_matches('@').trim();
    if trimmed.is_empty() {
        return;
    }

    let without_suffix = match trimmed.rfind(" (") {
        Some(index) if trimmed.ends_with(')') => &trimmed[..index],
        _ => trimmed,
    }
    .trim();

    if without_suffix.is_empty() {
        return;
    }

    for face in without_suffix.split(" & ") {
        let face = face.trim();
        if face.is_empty() {
            continue;
        }

        let family = strip_style_words(face);
        let family = family.trim();
        if !family.is_empty() {
            out.insert(family.to_string());
        }
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use super::sanitize_font_names;
    use std::collections::BTreeSet;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{
        ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS,
    };
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE,
        KEY_READ,
    };

    const FONT_REGISTRY_PATHS: [&str; 2] = [
        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Fonts",
    ];

    fn to_wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn collect_fonts_from_key(
        root: HKEY,
        path: &str,
        fonts: &mut BTreeSet<String>,
    ) -> Result<(), String> {
        let wide_path = to_wide(path);
        let mut key: HKEY = null_mut();

        let open_status = unsafe { RegOpenKeyExW(root, wide_path.as_ptr(), 0, KEY_READ, &mut key) };
        if open_status == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        if open_status != ERROR_SUCCESS {
            return Err(format!("RegOpenKeyExW failed for {path}: {open_status}"));
        }

        let mut index = 0;
        loop {
            let mut name_len = 256u32;
            let mut name_buf = vec![0u16; name_len as usize];

            loop {
                let status = unsafe {
                    RegEnumValueW(
                        key,
                        index,
                        name_buf.as_mut_ptr(),
                        &mut name_len,
                        null_mut(),
                        null_mut(),
                        null_mut(),
                        null_mut(),
                    )
                };

                if status == ERROR_MORE_DATA {
                    let next_len = (name_len as usize)
                        .saturating_add(1)
                        .max(name_buf.len() * 2);
                    name_buf.resize(next_len, 0);
                    name_len = next_len as u32;
                    continue;
                }

                if status == ERROR_NO_MORE_ITEMS {
                    unsafe { RegCloseKey(key) };
                    return Ok(());
                }

                if status != ERROR_SUCCESS {
                    unsafe { RegCloseKey(key) };
                    return Err(format!("RegEnumValueW failed for {path}: {status}"));
                }

                let name = String::from_utf16_lossy(&name_buf[..name_len as usize]);
                sanitize_font_names(&name, fonts);
                index += 1;
                break;
            }
        }
    }

    pub fn get_system_fonts() -> Result<Vec<String>, String> {
        let mut fonts = BTreeSet::new();

        for path in FONT_REGISTRY_PATHS {
            collect_fonts_from_key(HKEY_LOCAL_MACHINE, path, &mut fonts)?;
            collect_fonts_from_key(HKEY_CURRENT_USER, path, &mut fonts)?;
        }

        Ok(fonts.into_iter().collect())
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    pub fn get_system_fonts() -> Result<Vec<String>, String> {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub fn get_system_fonts() -> Result<Vec<String>, String> {
    imp::get_system_fonts()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(value: &str) -> Vec<String> {
        let mut out = BTreeSet::new();
        sanitize_font_names(value, &mut out);
        out.into_iter().collect()
    }

    #[test]
    fn strips_truetype_suffix() {
        assert_eq!(parse("Consolas (TrueType)"), vec!["Consolas"]);
    }

    #[test]
    fn strips_trailing_style_words() {
        assert_eq!(parse("Arial Bold (TrueType)"), vec!["Arial"]);
        assert_eq!(parse("Calibri Light Italic (TrueType)"), vec!["Calibri"]);
        assert_eq!(
            parse("Comic Sans MS Bold Italic (TrueType)"),
            vec!["Comic Sans MS"]
        );
    }

    #[test]
    fn splits_merged_entries() {
        assert_eq!(
            parse("SimSun & NSimSun (TrueType)"),
            vec!["NSimSun".to_string(), "SimSun".to_string()]
        );
    }

    #[test]
    fn splits_and_strips_merged_styled_entries() {
        // "Microsoft YaHei Bold & Microsoft YaHei UI Bold" 应规整为两个 family
        assert_eq!(
            parse("Microsoft YaHei Bold & Microsoft YaHei UI Bold (TrueType)"),
            vec![
                "Microsoft YaHei".to_string(),
                "Microsoft YaHei UI".to_string()
            ]
        );
    }

    #[test]
    fn strips_at_prefix() {
        // "@" 前缀用于竖排字体变体
        assert_eq!(
            parse("@Microsoft YaHei (TrueType)"),
            vec!["Microsoft YaHei"]
        );
    }

    #[test]
    fn keeps_name_when_all_words_are_styles() {
        // 整名都是样式词时至少保留最后一个词，避免产出空串
        assert_eq!(parse("Black (TrueType)"), vec!["Black"]);
    }

    #[test]
    fn ignores_empty() {
        assert!(parse("   ").is_empty());
        assert!(parse("").is_empty());
    }

    #[test]
    fn preserves_plain_family_names() {
        assert_eq!(parse("SimHei (TrueType)"), vec!["SimHei"]);
        assert_eq!(parse("KaiTi (TrueType)"), vec!["KaiTi"]);
    }
}
