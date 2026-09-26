//! 开机自启动：手写三平台分支。
//!
//! - Windows：HKCU 的 `...\CurrentVersion\Run` 键下一个固定值名。
//! - Linux：XDG autostart 的 `~/.config/autostart/xianyu-music.desktop`。
//! - macOS：`~/Library/LaunchAgents/<bundle-id>.plist`（RunAtLoad + ProgramArguments）。
//!
//! 不引官方 `tauri-plugin-autostart`：仓库对新增依赖一向谨慎，且 power.rs 已把
//! 「手写三平台分支」这条路走通并测试过。代价是自己维护三支平台代码。
//!
//! 「内容怎么生成」全部抽成下面这组纯函数并由 `#[cfg(test)]` 覆盖；平台 I/O 本身
//! 不做单测（与 system_fonts.rs / toolbox.rs 一致）。
//! 这些纯函数按平台裁剪编译（`any(test, target_os = ...)`），保证跨平台构建无 dead_code 告警，
//! 同时在任何平台 `cargo test` 下都可单测。

/// 标识「本次由开机自启拉起」的命令行参数。
const AUTOSTART_ARG: &str = "--autostart";

/// 传给应用的参数（用函数暴露，便于单测断言与复用）。
#[cfg(any(test, unix))]
fn autostart_arg() -> &'static str {
    AUTOSTART_ARG
}

/// .desktop / plist 中展示的应用名。
#[cfg(any(test, unix))]
const APP_NAME: &str = "XianYu Music";

// ---- Windows：注册表 Run 键 ----

#[cfg(any(test, target_os = "windows"))]
/// HKCU 下的 Run 子键。
const RUN_SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

#[cfg(any(test, target_os = "windows"))]
/// Run 键下的固定值名（固定才能在被用户改动前精确读回/删除）。
const RUN_VALUE_NAME: &str = "XianYuMusic";

#[cfg(any(test, target_os = "windows"))]
fn run_value_name() -> &'static str {
    RUN_VALUE_NAME
}

/// Run 键的数据：“整体加引号的 exe 路径” + `--autostart`。
/// 路径可能含空格，必须整体加引号，否则登录时会被截断。
#[cfg(any(test, target_os = "windows"))]
fn run_value_data(exe: &str) -> String {
    format!("\"{exe}\" {AUTOSTART_ARG}")
}

// ---- Linux：XDG autostart ----

#[cfg(any(test, target_os = "linux"))]
/// XDG autostart 目录下的文件名。
const DESKTOP_FILE: &str = "xianyu-music.desktop";

/// 桌面条目 `Exec=` 里的单个参数：路径可能含空格，整体加引号。
/// 先转义反斜杠再转义引号，避免把引号转义引入的反斜杠又加倍。
#[cfg(any(test, target_os = "linux"))]
fn quote_exec_argument(path: &str) -> String {
    let escaped = path.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

/// XDG autostart 的 `.desktop` 内容。
#[cfg(any(test, target_os = "linux"))]
fn desktop_entry(exe: &str) -> String {
    let exec = quote_exec_argument(exe);
    let arg = autostart_arg();
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Version=1.0\n\
         Name={APP_NAME}\n\
         Comment=Launch {APP_NAME} at login\n\
         Exec={exec} {arg}\n\
         Terminal=false\n\
         X-GNOME-Autostart-enabled=true\n"
    )
}

// ---- macOS：LaunchAgent plist ----

#[cfg(any(test, target_os = "macos"))]
/// LaunchAgent 的 Label 与文件名，取应用标识（同 tauri.conf.json 的 identifier）。
const BUNDLE_ID: &str = "com.xymusic.desktop";

/// plist 里的文本转义（路径可能含 `&`）。
#[cfg(any(test, target_os = "macos"))]
fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// LaunchAgent 的 plist 内容：`RunAtLoad` + `ProgramArguments`（含 `--autostart`）。
#[cfg(any(test, target_os = "macos"))]
fn launch_agent_plist(label: &str, exe: &str) -> String {
    let label = xml_escape(label);
    let exe = xml_escape(exe);
    let arg = autostart_arg();
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\">\n\
         <dict>\n\
         \t<key>Label</key>\n\
         \t<string>{label}</string>\n\
         \t<key>ProgramArguments</key>\n\
         \t<array>\n\
         \t\t<string>{exe}</string>\n\
         \t\t<string>{arg}</string>\n\
         \t</array>\n\
         \t<key>RunAtLoad</key>\n\
         \t<true/>\n\
         </dict>\n\
         </plist>\n"
    )
}

// ---- 共用 I/O 辅助 ----

/// 当前可执行文件路径；三平台都要把它写进自启动条目。
fn exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| format!("读取程序路径失败: {error}"))
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{exe_path, run_value_data, run_value_name, RUN_SUBKEY};
    use std::ffi::c_void;

    fn to_wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn set(enabled: bool) -> Result<(), String> {
        use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegSetKeyValueW, HKEY, HKEY_CURRENT_USER,
            KEY_SET_VALUE, REG_SZ,
        };

        let subkey = to_wide(RUN_SUBKEY);
        let name = to_wide(run_value_name());

        if enabled {
            let data = to_wide(&run_value_data(&exe_path()?));
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
                return Err(format!("写入开机自启注册表失败: {status}"));
            }
            return Ok(());
        }

        // RegDeleteValueW 只接收已打开的键句柄，故先打开 Run 子键再删值。
        let mut key: HKEY = std::ptr::null_mut();
        let open_status =
            unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_SET_VALUE, &mut key) };
        // 子键不存在 -> 本就没有自启项，视为已关闭。
        if open_status == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        if open_status != ERROR_SUCCESS {
            return Err(format!("打开开机自启注册表失败: {open_status}"));
        }

        let status = unsafe { RegDeleteValueW(key, name.as_ptr()) };
        unsafe { RegCloseKey(key) };

        // 值本来就不存在时同样视为已关闭。
        if status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            Err(format!("删除开机自启注册表失败: {status}"))
        }
    }

    /// 读回真实状态：Run 键下该值存在即视为已开启。
    pub fn get() -> bool {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{
            RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ,
        };

        let subkey = to_wide(RUN_SUBKEY);
        let name = to_wide(run_value_name());
        let mut data_len: u32 = 0;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut data_len,
            )
        };
        status == ERROR_SUCCESS && data_len > 0
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::{desktop_entry, DESKTOP_FILE};
    use std::path::PathBuf;

    /// XDG autostart 的目标文件：`$XDG_CONFIG_HOME/autostart/<name>`（回退 `~/.config`）。
    fn entry_path() -> Result<PathBuf, String> {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|dir| dir.is_absolute())
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(PathBuf::from)
                    .map(|home| home.join(".config"))
            })
            .ok_or_else(|| "XDG_CONFIG_HOME/HOME 环境变量不存在".to_string())?;
        Ok(base.join("autostart").join(DESKTOP_FILE))
    }

    pub fn set(enabled: bool) -> Result<(), String> {
        let path = entry_path()?;
        if enabled {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|error| format!("创建 autostart 目录失败: {error}"))?;
            }
            std::fs::write(&path, desktop_entry(&super::exe_path()?))
                .map_err(|error| format!("写入 autostart 文件失败: {error}"))
        } else {
            remove_file(&path)
        }
    }

    pub fn get() -> bool {
        entry_path().map(|path| path.exists()).unwrap_or(false)
    }

    fn remove_file(path: &std::path::Path) -> Result<(), String> {
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("删除 autostart 文件失败: {error}")),
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{launch_agent_plist, BUNDLE_ID};
    use std::path::PathBuf;

    fn plist_path() -> Result<PathBuf, String> {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "HOME 环境变量不存在".to_string())?;
        Ok(home
            .join("Library")
            .join("LaunchAgents")
            .join(format!("{BUNDLE_ID}.plist")))
    }

    pub fn set(enabled: bool) -> Result<(), String> {
        let path = plist_path()?;
        if enabled {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|error| format!("创建 LaunchAgents 目录失败: {error}"))?;
            }
            // 只落盘：登录时 launchd 会自动读取 ~/Library/LaunchAgents。
            // 若要「立即」生效还需 `launchctl bootstrap gui/$UID <plist>`，本版本不执行。
            std::fs::write(&path, launch_agent_plist(BUNDLE_ID, &super::exe_path()?))
                .map_err(|error| format!("写入 LaunchAgent 失败: {error}"))
        } else {
            // 同样只删文件；已 bootstrap 的实例需 `launchctl bootout` 才会立即消失。
            remove_file(&path)
        }
    }

    pub fn get() -> bool {
        plist_path().map(|path| path.exists()).unwrap_or(false)
    }

    fn remove_file(path: &std::path::Path) -> Result<(), String> {
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("删除 LaunchAgent 失败: {error}")),
        }
    }
}

/// 开启/关闭开机自启动（写/删系统条目）。
#[tauri::command]
pub fn set_launch_on_startup(enabled: bool) -> Result<(), String> {
    platform::set(enabled)
}

/// 读回系统里真实的开机自启动状态（UI 以它为准）。
#[tauri::command]
pub fn get_launch_on_startup() -> bool {
    platform::get()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autostart_arg_is_stable() {
        assert_eq!(autostart_arg(), "--autostart");
    }

    #[test]
    fn platform_location_constants_are_stable() {
        assert_eq!(DESKTOP_FILE, "xianyu-music.desktop");
        assert_eq!(BUNDLE_ID, "com.xymusic.desktop");
    }

    #[test]
    fn run_value_name_is_fixed() {
        assert_eq!(run_value_name(), "XianYuMusic");
    }

    #[test]
    fn run_value_data_quotes_path_and_appends_arg() {
        assert_eq!(
            run_value_data("C:\\Program Files\\XianYu Music\\xianyu-music-desktop.exe"),
            "\"C:\\Program Files\\XianYu Music\\xianyu-music-desktop.exe\" --autostart"
        );
    }

    #[test]
    fn desktop_entry_has_quoted_exec_and_arg() {
        let entry = desktop_entry("/opt/XianYu Music/xianyu-music-desktop");
        assert!(entry.starts_with("[Desktop Entry]\n"));
        assert!(entry.contains("Exec=\"/opt/XianYu Music/xianyu-music-desktop\" --autostart\n"));
        assert!(entry.contains("Name=XianYu Music\n"));
        assert!(entry.contains("X-GNOME-Autostart-enabled=true\n"));
    }

    #[test]
    fn quote_exec_argument_escapes_quotes_and_backslashes() {
        assert_eq!(quote_exec_argument(r#"/a"b\c"#), r#""/a\"b\\c""#);
    }

    #[test]
    fn launch_agent_plist_has_run_at_load_and_program_arguments() {
        let plist = launch_agent_plist(
            BUNDLE_ID,
            "/Applications/XianYu Music.app/Contents/MacOS/xianyu-music-desktop",
        );
        assert!(plist.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"));
        assert!(plist.contains("<key>Label</key>"));
        assert!(plist.contains(&format!("<string>{BUNDLE_ID}</string>")));
        assert!(plist.contains("<key>ProgramArguments</key>"));
        assert!(plist.contains(
            "<string>/Applications/XianYu Music.app/Contents/MacOS/xianyu-music-desktop</string>"
        ));
        assert!(plist.contains("<string>--autostart</string>"));
        assert!(plist.contains("<key>RunAtLoad</key>"));
        assert!(plist.contains("<true/>"));
    }

    #[test]
    fn xml_escape_escapes_special_characters() {
        assert_eq!(xml_escape("a&b<c>d"), "a&amp;b&lt;c&gt;d");
    }
}
