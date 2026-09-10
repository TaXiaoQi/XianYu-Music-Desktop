#[cfg(target_os = "windows")]
mod platform {
    use std::sync::{mpsc, OnceLock};

    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    };

    static PREVENT_SLEEP_SENDER: OnceLock<Result<mpsc::Sender<bool>, String>> = OnceLock::new();

    fn create_sender() -> Result<mpsc::Sender<bool>, String> {
        let (sender, receiver) = mpsc::channel::<bool>();
        std::thread::Builder::new()
            .name("prevent-system-sleep".to_string())
            .spawn(move || {
                let mut active = false;

                while let Ok(mut requested) = receiver.recv() {
                    while let Ok(next) = receiver.try_recv() {
                        requested = next;
                    }

                    if requested == active {
                        continue;
                    }

                    let flags = if requested {
                        ES_CONTINUOUS | ES_SYSTEM_REQUIRED
                    } else {
                        ES_CONTINUOUS
                    };
                    let result = unsafe { SetThreadExecutionState(flags) };
                    if result == 0 {
                        eprintln!("failed to update Windows execution state");
                        continue;
                    }

                    active = requested;
                }

                if active {
                    unsafe {
                        SetThreadExecutionState(ES_CONTINUOUS);
                    }
                }
            })
            .map_err(|error| format!("failed to start sleep-prevention thread: {error}"))?;

        Ok(sender)
    }

    pub fn set(active: bool) -> Result<(), String> {
        let sender = PREVENT_SLEEP_SENDER.get_or_init(create_sender);
        sender
            .as_ref()
            .map_err(Clone::clone)?
            .send(active)
            .map_err(|error| format!("failed to update sleep prevention: {error}"))
    }
}

/// Linux：经 D-Bus 的 org.freedesktop.ScreenSaver 抑制系统休眠（GNOME/KDE
/// 等主流桌面均实现该接口）。用 gdbus CLI 调用——glib 是 WebKitGTK 的强制
/// 依赖、gdbus 随 glib 必装，避免为一次 IPC 引入 D-Bus 客户端 crate。
/// Inhibit 成功返回 cookie，UnInhibit 必须携带同一 cookie，跨调用保存在模块状态。
#[cfg(target_os = "linux")]
mod platform {
    use std::sync::{Mutex, OnceLock};

    static INHIBIT_COOKIE: OnceLock<Mutex<Option<u32>>> = OnceLock::new();

    fn cookie_slot() -> &'static Mutex<Option<u32>> {
        INHIBIT_COOKIE.get_or_init(|| Mutex::new(None))
    }

    fn gdbus_call(args: &[&str]) -> Result<String, String> {
        let output = std::process::Command::new("gdbus")
            .arg("call")
            .arg("--session")
            .args(args)
            .output()
            .map_err(|e| format!("gdbus 执行失败（需安装 glib）: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "ScreenSaver D-Bus 调用失败: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// 从 gdbus 输出 `(uint32 42,)` 中解析 Inhibit 返回的 cookie。
    fn parse_cookie(stdout: &str) -> Option<u32> {
        let index = stdout.find("uint32")?;
        stdout[index + "uint32".len()..]
            .split(|c: char| !c.is_ascii_digit())
            .find(|s| !s.is_empty())?
            .parse()
            .ok()
    }

    pub fn set(active: bool) -> Result<(), String> {
        let slot = cookie_slot();
        let mut cookie = slot.lock().unwrap_or_else(|e| e.into_inner());

        if active {
            // 已在抑制中则幂等返回，避免重复 Inhibit 在桌面环境堆积引用计数
            if cookie.is_some() {
                return Ok(());
            }
            // 字符串参数需按 GVariant 文本语法带引号
            let stdout = gdbus_call(&[
                "--dest",
                "org.freedesktop.ScreenSaver",
                "--object-path",
                "/org/freedesktop/ScreenSaver",
                "--method",
                "org.freedesktop.ScreenSaver.Inhibit",
                "'com.xymusic.desktop'",
                "'playing music'",
            ])?;
            match parse_cookie(&stdout) {
                Some(value) => {
                    *cookie = Some(value);
                    Ok(())
                }
                None => Err("ScreenSaver Inhibit 返回值解析失败".to_string()),
            }
        } else {
            let Some(value) = cookie.take() else {
                return Ok(()); // 未在抑制中，幂等
            };
            // 解除失败仅记录，不回传错误：进程退出时 cookie 随会话抑制自动失效
            if let Err(e) = gdbus_call(&[
                "--dest",
                "org.freedesktop.ScreenSaver",
                "--object-path",
                "/org/freedesktop/ScreenSaver",
                "--method",
                "org.freedesktop.ScreenSaver.UnInhibit",
                &format!("uint32 {value}"),
            ]) {
                eprintln!("[power] ScreenSaver UnInhibit 失败: {e}");
            }
            Ok(())
        }
    }
}

/// macOS 等其余平台尚未适配，维持空操作。
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
mod platform {
    pub fn set(_active: bool) -> Result<(), String> {
        Ok(())
    }
}

#[tauri::command]
pub fn set_prevent_sleep(active: bool) -> Result<(), String> {
    platform::set(active)
}
