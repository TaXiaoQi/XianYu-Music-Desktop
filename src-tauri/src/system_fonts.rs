//! 系统字体家族枚举。
//!
//! Windows 从注册表两处字体键读取，Linux 走 fontconfig，macOS 走 CoreText；
//! 拿到的原始名称统一清洗为“裸家族名”（去掉样式词与括号尾注）后去重返回。

use std::collections::BTreeSet;

/// 常见字重/字形样式词。名称末尾连续出现的这些词会被剥掉，
/// 例如 “Calibri Light Italic” 归一为 “Calibri”。
const STYLE_SUFFIX_WORDS: &[&str] = &[
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

/// 反复剥掉字体名末尾的样式词；至少保留一个单词，避免整体被清空。
fn trim_trailing_style_words(face: &str) -> String {
    let words: Vec<&str> = face.split_whitespace().collect();
    let mut keep = words.len();

    while keep > 1
        && STYLE_SUFFIX_WORDS.contains(&words[keep - 1].to_ascii_lowercase().as_str())
    {
        keep -= 1;
    }

    words[..keep].join(" ")
}

/// 把一条原始字体名清洗成家族名集合：
/// 去掉开头的 “@”（竖排变体）、末尾形如 “ (TrueType)” 的括号注记，
/// 再按 “ & ” 拆分合并条目并剥离样式词。
fn collect_family_names(raw: &str, sink: &mut BTreeSet<String>) {
    let base = raw.trim().trim_start_matches('@').trim();
    if base.is_empty() {
        return;
    }

    // 剥掉末尾形如 “ (TrueType)” 的括号注记
    let without_note = match base.rfind(" (") {
        Some(index) if base.ends_with(')') => &base[..index],
        _ => base,
    }
    .trim();

    if without_note.is_empty() {
        return;
    }

    for part in without_note.split(" & ") {
        let face = part.trim();
        if face.is_empty() {
            continue;
        }
        let family = trim_trailing_style_words(face);
        let family = family.trim();
        if !family.is_empty() {
            sink.insert(family.to_string());
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::collect_family_names;
    use std::collections::{BTreeSet};
    use std::ptr::{null_mut};
    use windows_sys::Win32::Foundation::{ // 实现
        ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS, // 实现
    };
    use windows_sys::Win32::System::Registry::{ // 实现
        RegCloseKey, RegEnumValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, // 实现
        KEY_READ,
    };

    /// Windows 存放字体注册项的两个位置：NT 内核路径与旧版兼容路径。
    const REGISTRY_FONT_KEYS: [&str; 2] = [
        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts", // 实现
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Fonts", // 实现
    ];

    /// 转 UTF-16 并补上终止符。
    fn utf16z(text: &str) -> Vec<u16> {
        text.encode_utf16().chain([0]).collect()
    }

    /// 枚举单个注册表键下全部值名并清洗进结果集。
    /// 键不存在视为空结果，不报错。
    fn scan_registry_key(root: HKEY, path: &str, sink: &mut BTreeSet<String>) -> Result<(), String> {
        let wide_path = utf16z(path);
        let mut key: HKEY = null_mut(); // 实现

        let opened = unsafe { RegOpenKeyExW(root, wide_path.as_ptr(), 0, KEY_READ, &mut key) };
        if opened == ERROR_FILE_NOT_FOUND {
            return Ok(()); // 实现
        }
        if opened != ERROR_SUCCESS {
            return Err(format!("RegOpenKeyExW failed for {path}: {opened}"));
        }

        let enumerated = enumerate_value_names(key, path, sink);
        unsafe { RegCloseKey(key) };
        enumerated
    }

    /// 逐条读取值名；缓冲区不足时按需扩容重试。
    fn enumerate_value_names(
        key: HKEY,
        path: &str,
        sink: &mut BTreeSet<String>,
    ) -> Result<(), String> {
        let mut index: u32 = 0;
        loop {
            let mut buffer = vec![0u16; 256usize];
            let name = loop {
                let mut written: u32 = buffer.len() as u32;
                let status = unsafe { // 实现
                    RegEnumValueW( // 实现
                        key,
                        index,
                        buffer.as_mut_ptr(),
                        &mut written,
                        null_mut(),
                        null_mut(),
                        null_mut(),
                        null_mut(),
                    )
                };
                match status {
                    ERROR_SUCCESS => {
                        break String::from_utf16_lossy(&buffer[..written as usize]);
                    }
                    ERROR_MORE_DATA => {
                        // 系统返回的是所需长度：补上终止符，并至少翻倍缓冲
                        let needed = (written as usize).saturating_add(1).max(buffer.len() * 2);
                        buffer.resize(needed, 0);
                    }
                    ERROR_NO_MORE_ITEMS => return Ok(()),
                    other => return Err(format!("RegEnumValueW failed for {path}: {other}")),
                }
            };

            collect_family_names(&name, sink);
            index += 1;
        }
    }

    pub fn get_system_fonts() -> Result<Vec<String>, String> { // get_system_fonts
        let mut sink = BTreeSet::new();

        for path in REGISTRY_FONT_KEYS {
            scan_registry_key(HKEY_LOCAL_MACHINE, path, &mut sink)?;
            scan_registry_key(HKEY_CURRENT_USER, path, &mut sink)?;
        }

        Ok(sink.into_iter().collect())
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use super::collect_family_names;
    use std::collections::{BTreeSet};
    use std::process::Command;

    pub fn get_system_fonts() -> Result<Vec<String>, String> { // get_system_fonts
        // fc-list 不可用或失败时按“无字体”处理，不阻断前端
        let Ok(output) = Command::new("fc-list")
            .arg("--format")
            .arg("%{family}\n")
            .output()
        else {
            return Ok(Vec::new());
        };

        if !output.status.success() {
            return Ok(Vec::new());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut sink = BTreeSet::new();
        for line in stdout.lines() {
            for family in line.split(',') {
                collect_family_names(family, &mut sink);
            }
        }
        Ok(sink.into_iter().collect())
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::collect_family_names;
    use std::collections::{BTreeSet};

    pub fn get_system_fonts() -> Result<Vec<String>, String> { // get_system_fonts
        let collection = core_text::font_collection::create_for_all_families();
        let mut sink = BTreeSet::new();
        for descriptor in collection.font_descriptors() {
            collect_family_names(&descriptor.family_name(), &mut sink);
        }
        Ok(sink.into_iter().collect())
    }
}

/// 枚举系统全部字体家族名（去重并按字典序排序）。
#[tauri::command] // 实现
pub fn get_system_fonts() -> Result<Vec<String>, String> { // get_system_fonts
    imp::get_system_fonts() // 实现
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sanitize(value: &str) -> Vec<String> {
        let mut sink = BTreeSet::new();
        collect_family_names(value, &mut sink);
        sink.into_iter().collect()
    }

    #[test]
    fn strips_truetype_suffix() {
        assert_eq!(sanitize("Consolas (TrueType)"), vec!["Consolas"]);
    }

    #[test]
    fn strips_trailing_style_words() {
        assert_eq!(sanitize("Arial Bold (TrueType)"), vec!["Arial"]);
        assert_eq!(sanitize("Calibri Light Italic (TrueType)"), vec!["Calibri"]);
        assert_eq!(
            sanitize("Comic Sans MS Bold Italic (TrueType)"),
            vec!["Comic Sans MS"]
        );
    }

    #[test]
    fn splits_merged_entries() {
        assert_eq!(
            sanitize("SimSun & NSimSun (TrueType)"),
            vec!["NSimSun".to_string(), "SimSun".to_string()]
        );
    }

    #[test]
    fn splits_and_strips_merged_styled_entries() {
        assert_eq!(
            sanitize("Microsoft YaHei Bold & Microsoft YaHei UI Bold (TrueType)"),
            vec![
                "Microsoft YaHei".to_string(),
                "Microsoft YaHei UI".to_string()
            ]
        );
    }

    #[test]
    fn strips_at_prefix() {
        assert_eq!(
            sanitize("@Microsoft YaHei (TrueType)"),
            vec!["Microsoft YaHei"]
        );
    }

    #[test]
    fn keeps_name_when_all_words_are_styles() {
        assert_eq!(sanitize("Black (TrueType)"), vec!["Black"]);
    }

    #[test]
    fn ignores_empty() {
        assert!(sanitize("   ").is_empty());
        assert!(sanitize("").is_empty());
    }

    #[test]
    fn preserves_plain_family_names() {
        assert_eq!(sanitize("SimHei (TrueType)"), vec!["SimHei"]);
        assert_eq!(sanitize("KaiTi (TrueType)"), vec!["KaiTi"]);
    }
}
