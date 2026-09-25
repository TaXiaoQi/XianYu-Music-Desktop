#[cfg(target_os = "windows")]
const REG_SUBKEY: &str = "Software\\xianyu\\弦予音乐";
/// 旧版本的注册表路径：仅读取时回退，避免升级后丢失安装时记住的语言
#[cfg(target_os = "windows")]
const LEGACY_REG_SUBKEY: &str = "Software\\xymusic\\弦予音乐";
#[cfg(target_os = "windows")]
const APP_LANGUAGE_VALUE: &str = "AppLanguage";
#[cfg(target_os = "windows")]
const INSTALLER_LANGUAGE_VALUE: &str = "Installer Language";

#[cfg(target_os = "windows")]
fn app_lang_to_lcid(lang: &str) -> u32 {
    match lang {
        "zh-TW" => 1028,
        "en-US" => 1033,
        _ => 2052,
    }
}

#[cfg(target_os = "windows")]
fn to_wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn read_hkcu_string(subkey: &str, value_name: &str) -> Option<String> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};

    let subkey_w = to_wide(subkey);
    let value_w = to_wide(value_name);

    unsafe {
        let mut data_len: u32 = 0;
        let status = RegGetValueW(
            HKEY_CURRENT_USER,
            subkey_w.as_ptr(),
            value_w.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut data_len,
        );
        if status != ERROR_SUCCESS || data_len == 0 {
            return None;
        }

        let u16_len = (data_len as usize).div_ceil(2);
        let mut buffer: Vec<u16> = vec![0u16; u16_len];
        let mut read_len = data_len;
        let status = RegGetValueW(
            HKEY_CURRENT_USER,
            subkey_w.as_ptr(),
            value_w.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr() as *mut core::ffi::c_void,
            &mut read_len,
        );
        if status != ERROR_SUCCESS {
            return None;
        }

        let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..end]))
    }
}

#[cfg(target_os = "windows")]
fn write_hkcu_string(subkey: &str, value_name: &str, value: &str) -> bool {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};

    let subkey_w = to_wide(subkey);
    let value_w = to_wide(value_name);
    let data_w = to_wide(value);

    unsafe {
        let byte_len = (data_w.len() * 2) as u32;
        let status = RegSetKeyValueW(
            HKEY_CURRENT_USER,
            subkey_w.as_ptr(),
            value_w.as_ptr(),
            REG_SZ,
            data_w.as_ptr() as *const core::ffi::c_void,
            byte_len,
        );
        status == ERROR_SUCCESS
    }
}

#[tauri::command]
pub fn get_install_language() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let lang = read_hkcu_string(REG_SUBKEY, APP_LANGUAGE_VALUE)
            .or_else(|| read_hkcu_string(LEGACY_REG_SUBKEY, APP_LANGUAGE_VALUE))?;
        match lang.as_str() {
            "zh-CN" | "zh-TW" | "en-US" => Some(lang),
            _ => None,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[tauri::command]
pub fn set_install_language(language: String) -> bool {
    #[cfg(target_os = "windows")]
    {
        let normalized = match language.as_str() {
            "zh-CN" | "zh-TW" | "en-US" => language.as_str(),
            _ => return false,
        };
        let ok_app = write_hkcu_string(REG_SUBKEY, APP_LANGUAGE_VALUE, normalized);
        let lcid = app_lang_to_lcid(normalized);
        let ok_lcid = write_hkcu_string(REG_SUBKEY, INSTALLER_LANGUAGE_VALUE, &lcid.to_string());
        ok_app && ok_lcid
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = language;
        false
    }
}
