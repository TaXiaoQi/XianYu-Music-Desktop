//! 安装语言注册表读写。
//!
//! NSIS 安装器把用户选择的语言写入 `HKCU\Software\xymusic\弦予音乐`：
//! - `AppLanguage`：应用语言码（zh-CN / zh-TW / en-US），由 installer-hooks.nsh 写入，供主程序读取；
//! - `Installer Language`：LCID 数字，由 Tauri/NSIS 模板维护，卸载器 un.onInit 会读取它继承语言。
//!
//! 主程序首次启动读取 `AppLanguage` 使界面语言与安装语言一致；
//! 用户在主程序内切换语言时同步写回这两个值，使卸载器语言跟随主程序当前语言。

/// 注册表子键（与 installer.nsi 的 MANUPRODUCTKEY 一致：Software\<MANUFACTURER>\<PRODUCTNAME>）。
#[cfg(target_os = "windows")]
const REG_SUBKEY: &str = "Software\\xymusic\\弦予音乐";
#[cfg(target_os = "windows")]
const APP_LANGUAGE_VALUE: &str = "AppLanguage";
#[cfg(target_os = "windows")]
const INSTALLER_LANGUAGE_VALUE: &str = "Installer Language";

/// 应用语言码 -> NSIS LCID。
#[cfg(target_os = "windows")]
fn app_lang_to_lcid(lang: &str) -> u32 {
    match lang {
        "zh-TW" => 1028,
        "en-US" => 1033,
        _ => 2052, // zh-CN 及默认
    }
}

#[cfg(target_os = "windows")]
fn to_wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 读取 HKCU 下某子键的字符串值（REG_SZ）。
#[cfg(target_os = "windows")]
fn read_hkcu_string(subkey: &str, value_name: &str) -> Option<String> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ,
    };

    let subkey_w = to_wide(subkey);
    let value_w = to_wide(value_name);

    unsafe {
        // 先查询所需字节数
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

        // data_len 为字节数，转换为 u16 元素个数（向上取整）
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

        // 去掉结尾的 NUL
        let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..end]))
    }
}

/// 写入 HKCU 下某子键的字符串值（REG_SZ，子键不存在时自动创建）。
#[cfg(target_os = "windows")]
fn write_hkcu_string(subkey: &str, value_name: &str, value: &str) -> bool {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ,
    };

    let subkey_w = to_wide(subkey);
    let value_w = to_wide(value_name);
    let data_w = to_wide(value);

    unsafe {
        // 字节数含结尾 NUL
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

/// 读取安装时选择的应用语言码（zh-CN / zh-TW / en-US）。读不到返回 None。
#[tauri::command]
pub fn get_install_language() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let lang = read_hkcu_string(REG_SUBKEY, APP_LANGUAGE_VALUE)?;
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

/// 把主程序当前语言同步到注册表：
/// - 写 `AppLanguage`（应用语言码）；
/// - 写 `Installer Language`（对应 LCID），使卸载器语言跟随主程序当前语言。
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
