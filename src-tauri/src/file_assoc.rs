//! 音频文件关联设置：把「弦予音乐」加入/移出系统「选择应用以打开」候选列表。
//!
//! 病根：Tauri 的 NSIS 宏 `APP_ASSOCIATE`（FileAssociation.nsh）只写扩展名默认值、
//! ProgId 本体描述、DefaultIcon、`shell\open\command`，**从不写 `.<ext>\OpenWithProgIds`**；
//! 而「选择应用以打开」对话框（`SHAssocEnumHandlers`）正是枚举该键得来，故本程序不出现在
//! 候选列表里。`APP_UNASSOCIATE` 同样不碰它。
//!
//! 实测：`.<ext>\OpenWithProgIds` 与 `Applications\<exe>` + `SupportedTypes` 两条路各自都能
//! 让程序出现，但同写会重复两项 → 只走 `OpenWithProgIds` 一条。
//!
//! 只在 HKCU 写入：HKCR 是 `HKLM\Software\Classes` 与 `HKCU\Software\Classes` 的合并视图
//! （HKCU 覆盖 HKLM），而用户设置项必须能不提权地**删除**条目，故统一用 HKCU 根键。安装器钩子
//! 亦写 HKCU，与之同根键。
//!
//! 「尽力设默认」：勾选时顺带把 `.<ext>` 默认值指向本 ProgId，但只在**该 HKCU 默认值为空或
//! 已是本程序**时才写，避免劫持用户已选的第三方默认程序；Win10/11 的真实默认由受保护的
//! `UserChoice` 决定，故此处不保证生效（文案已如实说明）。
//!
//! 结构仿 autostart.rs：注册表路径/命令串抽成纯函数并由 `#[cfg(test)]` 覆盖；Windows 平台
//! I/O 不做单测。

#[cfg(any(test, target_os = "windows"))]
/// 设置项可管的 11 个音频扩展名（与 tauri.conf.json 的 `XianYu Music Audio` 组一致，排除 `.js`）。
pub(crate) const AUDIO_EXTENSIONS: &[&str] = &[
    "aac", "aif", "aiff", "flac", "m4a", "m4b", "mp3", "mp4", "oga", "ogg", "wav",
];

#[cfg(any(test, target_os = "windows"))]
/// 音频 ProgId（同 tauri.conf.json 的 `XianYu Music Audio`）。
const AUDIO_PROGID: &str = "XianYu Music Audio";

/// 只有受管的 11 个音频扩展名可写；非法入参拒绝（防越权写任意扩展名）。
#[cfg(any(test, target_os = "windows"))]
fn is_managed_extension(ext: &str) -> bool {
    AUDIO_EXTENSIONS.iter().any(|known| known.eq_ignore_ascii_case(ext))
}

/// HKCU 下扩展名默认值所在键（默认值即该键的无名值）。
#[cfg(any(test, target_os = "windows"))]
fn ext_default_key(ext: &str) -> String {
    format!("Software\\Classes\\.{ext}")
}

/// HKCU 下「打开方式」候选列表所在键。
#[cfg(any(test, target_os = "windows"))]
fn open_with_key(ext: &str) -> String {
    format!("Software\\Classes\\.{ext}\\OpenWithProgIds")
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{ext_default_key, is_managed_extension, open_with_key, AUDIO_EXTENSIONS, AUDIO_PROGID};
    use std::ffi::c_void;

    fn to_wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 归一化并校验用户传入的扩展名（允许带前导点、大小写任意）。
    fn normalize(raw: &str) -> Result<String, String> {
        let ext = raw.trim().trim_start_matches('.').to_ascii_lowercase();
        if !is_managed_extension(&ext) {
            return Err(format!("不支持的扩展名: {raw}"));
        }
        Ok(ext)
    }

    /// 读 HKCU 下 `.<ext>` 的默认值；不存在或为空返回 None。
    fn read_ext_default(ext: &str) -> Option<String> {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};

        let subkey = to_wide(&ext_default_key(ext));
        let mut buffer = [0u16; 512];
        let mut length = (buffer.len() * 2) as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                std::ptr::null(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                buffer.as_mut_ptr() as *mut c_void,
                &mut length,
            )
        };
        if status != ERROR_SUCCESS || length < 2 {
            return None;
        }
        let chars = (length / 2) as usize;
        let text = String::from_utf16_lossy(&buffer[..chars.saturating_sub(1)]);
        if text.is_empty() { None } else { Some(text) }
    }

    /// 往 `.<ext>\OpenWithProgIds` 写本 ProgId（数据为空串），使本程序出现在「打开方式」列表。
    fn write_open_with(ext: &str) -> Result<(), String> {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};

        let subkey = to_wide(&open_with_key(ext));
        let name = to_wide(AUDIO_PROGID);
        let data: Vec<u16> = vec![0]; // 空 REG_SZ
        let status = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                name.as_ptr(),
                REG_SZ,
                data.as_ptr() as *const c_void,
                (data.len() * 2) as u32,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(format!("写入 .{ext} 打开方式列表失败: {status}"));
        }
        Ok(())
    }

    /// 「尽力设默认」：仅当 `.<ext>` HKCU 默认值为空或已是本程序时才写。
    fn set_ext_default(ext: &str) -> Result<(), String> {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};

        if matches!(read_ext_default(ext), Some(current) if current != AUDIO_PROGID) {
            // 用户当前默认指向别的程序 —— 尊重之，不动。
            return Ok(());
        }
        let subkey = to_wide(&ext_default_key(ext));
        let name: Vec<u16> = vec![0]; // 空名 = 该键默认值
        let data = to_wide(AUDIO_PROGID);
        let status = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                name.as_ptr(),
                REG_SZ,
                data.as_ptr() as *const c_void,
                (data.len() * 2) as u32,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(format!("写入 .{ext} 默认打开程序失败: {status}"));
        }
        Ok(())
    }

    /// 从 `.<ext>\OpenWithProgIds` 删本 ProgId 的值（不存在视为成功）。
    fn delete_open_with(ext: &str) -> Result<(), String> {
        use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegDeleteValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
        };

        let subkey = to_wide(&open_with_key(ext));
        let mut key: HKEY = std::ptr::null_mut();
        let open_status =
            unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_SET_VALUE, &mut key) };
        // 键不存在 -> 本就没有条目，视为已取消。
        if open_status == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        if open_status != ERROR_SUCCESS {
            return Err(format!("打开 .{ext} 打开方式列表失败: {open_status}"));
        }
        let name = to_wide(AUDIO_PROGID);
        let status = unsafe { RegDeleteValueW(key, name.as_ptr()) };
        unsafe { RegCloseKey(key) };
        if status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            Err(format!("删除 .{ext} 打开方式条目失败: {status}"))
        }
    }

    /// 仅当 `.<ext>` HKCU 默认值确实指向本程序时才清掉（避免误清用户选择）。
    fn delete_ext_default(ext: &str) -> Result<(), String> {
        use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegDeleteValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
        };

        if read_ext_default(ext).as_deref() != Some(AUDIO_PROGID) {
            return Ok(());
        }
        let subkey = to_wide(&ext_default_key(ext));
        let mut key: HKEY = std::ptr::null_mut();
        let open_status =
            unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_SET_VALUE, &mut key) };
        if open_status == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        if open_status != ERROR_SUCCESS {
            return Err(format!("打开 .{ext} 关联键失败: {open_status}"));
        }
        let name: Vec<u16> = vec![0]; // 空名 = 该键默认值
        let status = unsafe { RegDeleteValueW(key, name.as_ptr()) };
        unsafe { RegCloseKey(key) };
        if status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            Err(format!("清除 .{ext} 默认打开程序失败: {status}"))
        }
    }

    pub fn set(enabled: &[String], disabled: &[String]) -> Result<(), String> {
        for raw in enabled {
            let ext = normalize(raw)?;
            write_open_with(&ext)?;
            set_ext_default(&ext)?;
        }
        for raw in disabled {
            let ext = normalize(raw)?;
            delete_open_with(&ext)?;
            delete_ext_default(&ext)?;
        }
        Ok(())
    }

    /// 读回 HKCU 里真实带本 ProgId 的扩展名（UI 以它为准）。
    pub fn get() -> Vec<String> {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};

        AUDIO_EXTENSIONS
            .iter()
            .filter(|ext| {
                let subkey = to_wide(&open_with_key(ext));
                let name = to_wide(AUDIO_PROGID);
                let mut length: u32 = 0;
                let status = unsafe {
                    RegGetValueW(
                        HKEY_CURRENT_USER,
                        subkey.as_ptr(),
                        name.as_ptr(),
                        RRF_RT_REG_SZ,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        &mut length,
                    )
                };
                status == ERROR_SUCCESS && length > 0
            })
            .map(|ext| (*ext).to_string())
            .collect()
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    pub fn set(_enabled: &[String], _disabled: &[String]) -> Result<(), String> {
        Err("仅 Windows 支持文件关联设置".to_string())
    }

    pub fn get() -> Vec<String> {
        Vec::new()
    }
}

/// 让指定扩展名出现在/移出「选择应用以打开」列表（并尽力设默认）。
#[tauri::command]
pub fn set_audio_file_associations(enabled: Vec<String>, disabled: Vec<String>) -> Result<(), String> {
    platform::set(&enabled, &disabled)
}

/// 读回 HKCU 里当前已关联（出现在「打开方式」列表）的扩展名。
#[tauri::command]
pub fn get_audio_file_associations() -> Vec<String> {
    platform::get()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_extensions_are_the_eleven_configured_audio_formats() {
        assert_eq!(AUDIO_EXTENSIONS.len(), 11);
        assert!(AUDIO_EXTENSIONS.contains(&"mp3"));
        assert!(AUDIO_EXTENSIONS.contains(&"mp4"));
        assert!(AUDIO_EXTENSIONS.contains(&"wav"));
        // 脚本格式不在可选范围。
        assert!(!AUDIO_EXTENSIONS.contains(&"js"));
    }

    #[test]
    fn managed_extension_accepts_known_and_rejects_unknown() {
        assert!(is_managed_extension("mp3"));
        assert!(is_managed_extension("MP3"));
        assert!(!is_managed_extension("js"));
        assert!(!is_managed_extension("exe"));
        assert!(!is_managed_extension(""));
    }

    #[test]
    fn registry_paths_are_stable() {
        assert_eq!(ext_default_key("mp3"), "Software\\Classes\\.mp3");
        assert_eq!(open_with_key("flac"), "Software\\Classes\\.flac\\OpenWithProgIds");
    }
}
