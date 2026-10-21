//! 托盘守护进程主进程侧（仅 Windows 实装）。
//!
//! 主程序启动时拉起独立守护进程（见 `bin/xianyu_tray_daemon.rs`），传入自身
//! PID、命名事件对象与主程序路径；正常退出前 SetEvent 通知守护进程随其自退，
//! 崩溃/被杀时守护进程据进程句柄死亡弹出兜底托盘（重启/强杀入口）。

#[cfg(windows)]
mod imp {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::sync::OnceLock;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::Threading::{CreateEventW, SetEvent};

    /// 正常退出通知事件句柄（以 usize 存放以便放入 OnceLock 静态）。
    static EXIT_EVENT: OnceLock<usize> = OnceLock::new();

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// 拉起托盘守护进程。任何失败都静默跳过：守护进程只是兜底，
    /// 不允许影响主程序启动。
    pub fn spawn() {
        let pid = std::process::id();
        // 事件名按 PID 限定：dev 与正式版并行时各自独立，互不干扰
        let event_name = format!("Local\\xianyu-tray-daemon-exit-{pid}");
        let event_name_w = wide(&event_name);
        let handle = unsafe {
            CreateEventW(
                std::ptr::null(),
                1, // 手动复位：SetEvent 一次即持续有信号
                0,
                event_name_w.as_ptr(),
            )
        };
        if handle.is_null() || EXIT_EVENT.set(handle as usize).is_err() {
            if !handle.is_null() {
                unsafe { CloseHandle(handle) };
            }
            return;
        }

        let Ok(main_exe) = std::env::current_exe() else {
            return;
        };
        let Some(daemon_exe) = main_exe.parent().map(|dir| dir.join("xianyu-tray-daemon.exe"))
        else {
            return;
        };
        if !daemon_exe.exists() {
            return;
        }
        // dev 构建：cargo 会把全部 bin 编进 target/{profile}/，与主程序同目录；
        // 打包后：externalBin 把守护进程装进安装目录，同样与主程序同目录
        let _ = std::process::Command::new(daemon_exe)
            .arg(format!("--pid={pid}"))
            .arg(format!("--event={event_name}"))
            .arg(format!("--exe={}", main_exe.display()))
            .spawn();
    }

    /// 通知守护进程「主进程即将正常退出」，守护进程据此静默自退。
    pub fn signal_exit() {
        if let Some(handle) = EXIT_EVENT.get().copied() {
            unsafe { SetEvent(handle as HANDLE) };
        }
    }
}

#[cfg(windows)]
pub use imp::{signal_exit, spawn};

#[cfg(not(windows))]
pub fn spawn() {}

#[cfg(not(windows))]
pub fn signal_exit() {}
