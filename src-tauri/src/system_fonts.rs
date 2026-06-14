#[cfg(target_os = "windows")]
mod imp {
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

    fn sanitize_font_name(value: &str) -> Option<String> {
        let trimmed = value.trim().trim_start_matches('@').trim();
        if trimmed.is_empty() {
            return None;
        }

        let without_suffix = match trimmed.rfind(" (") {
            Some(index) if trimmed.ends_with(')') => &trimmed[..index],
            _ => trimmed,
        }
        .trim();

        if without_suffix.is_empty() {
            None
        } else {
            Some(without_suffix.to_string())
        }
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
                if let Some(font_name) = sanitize_font_name(&name) {
                    fonts.insert(font_name);
                }
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
