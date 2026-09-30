//! 托盘弹窗的前台激活与关外关闭支撑。
//!
//! 自定义托盘菜单窗由主窗口 JS 异步弹出，此时托盘点击授予的前台
//! 激活权往往已经失效，系统会静默拒绝 SetForegroundWindow——菜单窗
//! 拿不到键盘焦点，前端依赖的失焦关闭（blur → hide）就永远不触发。
//!
//! 为此提供两个命令：
//! - `force_window_foreground`：按 Win32 惯例用 AttachThreadInput
//!   暂时借用前台线程的输入队列，强制把目标窗口推到前台；
//! - `describe_foreground_window`：上报当前前台窗口句柄及是否属于
//!   本应用，供前端轮询实现「点击窗口外自动关闭」的兜底守卫。

use serde::Serialize;

/// 前台窗口快照：句柄 + 是否属于本应用（供关外守卫轮询比较）。
#[derive(Debug, Clone, Serialize)]
pub struct ForegroundWindowInfo {
    pub hwnd: isize,
    pub owned_by_app: bool,
}

/// 暴露给兄弟模块：解析 Tauri 窗口的 Win32 顶层句柄
/// （托盘鼠标钩子比对命中窗口时共用）。
#[cfg(target_os = "windows")]
pub(crate) fn window_hwnd(
    window: &tauri::WebviewWindow,
) -> Option<windows_sys::Win32::Foundation::HWND> {
    imp::resolve_hwnd(window)
}

/// 将指定标签的 Webview 窗口强制设为前台（键盘激活）。
#[tauri::command]
pub fn force_window_foreground(app: tauri::AppHandle, label: String) {
    use tauri::Manager as _;

    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app.get_webview_window(&label) {
            imp::steal_foreground(&window);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.set_focus();
        }
        let _ = (app, label);
    }
}

/// 上报当前前台窗口：句柄 + 是否属于本应用的任一 Webview 窗口。
#[tauri::command]
pub fn describe_foreground_window(app: tauri::AppHandle) -> ForegroundWindowInfo {
    #[cfg(target_os = "windows")]
    return imp::describe(&app);

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        ForegroundWindowInfo { hwnd: 0, owned_by_app: true }
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use super::ForegroundWindowInfo;
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use tauri::WebviewWindow;
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
    };

    /// 从 Tauri 窗口解析 Win32 句柄。
    pub(super) fn resolve_hwnd(window: &WebviewWindow) -> Option<HWND> {
        let borrowed_window = window.as_ref().window();
        let Ok(handle) = borrowed_window.window_handle() else {
            return None;
        };
        match handle.as_raw() {
            RawWindowHandle::Win32(win32) => Some(win32.hwnd.get() as HWND),
            _ => None,
        }
    }

    pub(super) fn describe(app: &tauri::AppHandle) -> ForegroundWindowInfo {
        use tauri::Manager as _;
        use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

        unsafe {
            let foreground = GetForegroundWindow();
            if foreground.is_null() {
                return ForegroundWindowInfo { hwnd: 0, owned_by_app: false };
            }
            let owned_by_app = app
                .webview_windows()
                .values()
                .any(|window| resolve_hwnd(window) == Some(foreground));
            ForegroundWindowInfo { hwnd: foreground as isize, owned_by_app }
        }
    }

    pub(super) fn steal_foreground(window: &WebviewWindow) {
        let Some(target) = resolve_hwnd(window) else {
            return;
        };

        unsafe {
            let this_thread = GetCurrentThreadId();
            let foreground = GetForegroundWindow();
            let foreground_thread = if foreground.is_null() {
                0
            } else {
                GetWindowThreadProcessId(foreground, std::ptr::null_mut())
            };
            let target_thread = GetWindowThreadProcessId(target, std::ptr::null_mut());

            // 目标已是前台则直接激活；借用是暂时的，无论成败退出前必须解除
            let borrowing = foreground_thread != 0 && foreground_thread != this_thread;
            let attach = |attach_to: u32, on: bool| {
                let _ = AttachThreadInput(this_thread, attach_to, i32::from(on));
            };
            if borrowing {
                attach(foreground_thread, true);
                if target_thread != 0 && target_thread != foreground_thread {
                    attach(target_thread, true);
                }
            }
            let _ = SetForegroundWindow(target);
            if borrowing {
                attach(foreground_thread, false);
                if target_thread != 0 && target_thread != foreground_thread {
                    attach(target_thread, false);
                }
            }
        }
    }
}
