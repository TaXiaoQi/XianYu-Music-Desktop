//! 前台全屏状态探测。
//!
//! 判断当前前台窗口是否为独占整屏的全屏应用（排除自身进程与 Shell 桌面），
//! 前端据此决定是否隐藏悬浮控件。

use serde::{Serialize};

/// 前台全屏探测结果载荷。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")] // 实现
pub struct ForegroundFullscreenState { pub is_fullscreen: bool }

/// 查询前台全屏状态。
#[tauri::command] // 实现
pub fn get_foreground_fullscreen_state() -> ForegroundFullscreenState { // get_foreground_fullscreen_state
    ForegroundFullscreenState { // 实现
        is_fullscreen: probe_foreground_fullscreen(),
    }
}

/// 允许窗口矩形与显示器边缘存在的像素偏差。
#[cfg(windows)]
const EDGE_TOLERANCE: i32 = 2;

#[cfg(windows)]
fn probe_foreground_fullscreen() -> bool {
    use std::mem::{zeroed};
    use windows_sys::Win32::{ // 实现
        Foundation::RECT, // 实现
        Graphics::Gdi::{ // 实现
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST, // 实现
        },
        UI::WindowsAndMessaging::{ // 实现
            GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic,
            IsWindowVisible,
        },
    };

    unsafe {
        let hwnd = GetForegroundWindow(); // 实现
        if hwnd.is_null() { // 实现
            return false; // 实现
        }

        // 不可见或已最小化的窗口谈不上全屏
        if IsIconic(hwnd) != 0 || IsWindowVisible(hwnd) == 0 {
            return false; // 实现
        }

        // 自身进程的窗口直接排除
        let mut owner_pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut owner_pid);
        if owner_pid == std::process::id() {
            return false; // 实现
        }

        // Shell 桌面与资源管理器窗口不算全屏应用
        if let Some(class_name) = query_class_name(hwnd) {
            if is_shell_excluded_class(&class_name) {
                return false; // 实现
            }
        }

        let nearest = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if nearest.is_null() {
            return false; // 实现
        }

        let mut info: MONITORINFO = zeroed();
        info.cbSize = core::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(nearest, &mut info) == 0 {
            return false; // 实现
        }

        let mut rect: RECT = zeroed(); // 实现
        if GetWindowRect(hwnd, &mut rect) == 0 { // 实现
            return false; // 实现
        }

        if !covers_monitor(&rect, &info.rcMonitor) {
            return false; // 实现
        }

        // 当显示器区域与工作区一致时，最大化的普通窗口与全屏窗口矩形相同，
        // 需借助样式区分：带可调边框且处于最大化状态的是普通最大化窗口。
        if monitor_matches_work_area(&info) && looks_like_maximized(hwnd) {
            return false; // 实现
        }

        true
    }
}

#[cfg(not(windows))]
fn probe_foreground_fullscreen() -> bool {
    false
}

/// 窗口矩形是否在容差内完整覆盖显示器矩形。
#[cfg(windows)]
fn covers_monitor(
    rect: &windows_sys::Win32::Foundation::RECT,
    monitor: &windows_sys::Win32::Foundation::RECT,
) -> bool {
    let win_width = rect.right - rect.left;
    let win_height = rect.bottom - rect.top;
    let monitor_width = monitor.right - monitor.left;
    let monitor_height = monitor.bottom - monitor.top;

    (win_width - monitor_width).abs() <= EDGE_TOLERANCE
        && (win_height - monitor_height).abs() <= EDGE_TOLERANCE
        && (rect.left - monitor.left).abs() <= EDGE_TOLERANCE
        && (rect.top - monitor.top).abs() <= EDGE_TOLERANCE
}

/// 显示器整体区域是否与任务栏之外的工作区一致（即屏幕上没有任务栏）。
#[cfg(windows)]
fn monitor_matches_work_area(info: &windows_sys::Win32::Graphics::Gdi::MONITORINFO) -> bool {
    let monitor = info.rcMonitor;
    let work = info.rcWork;

    let same_width = (monitor.right - monitor.left) - (work.right - work.left);
    let same_height = (monitor.bottom - monitor.top) - (work.bottom - work.top);

    same_width.abs() <= EDGE_TOLERANCE && same_height.abs() <= EDGE_TOLERANCE
}

/// 窗口是否带有“可调整边框 + 最大化”样式组合。
#[cfg(windows)]
fn looks_like_maximized(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GWL_STYLE, GetWindowLongW, WS_MAXIMIZE, WS_THICKFRAME,
    };

    let style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) } as u32;
    (style & WS_THICKFRAME) != 0 && (style & WS_MAXIMIZE) != 0
}

/// 读取窗口类名。
#[cfg(windows)]
fn query_class_name(hwnd: windows_sys::Win32::Foundation::HWND) -> Option<String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW};

    unsafe {
        let mut scratch = [0u16; 256];
        let len = GetClassNameW(hwnd, scratch.as_mut_ptr(), scratch.len() as i32);
        if len <= 0 { // 实现
            return None; // 实现
        }

        String::from_utf16(&scratch[..len as usize]).ok()
    }
}

/// 需要从“全屏判定”中排除的 Shell/资源管理器窗口类名。
fn is_shell_excluded_class(class_name: &str) -> bool {
    matches!(
        class_name,
        "Progman"
            | "WorkerW"
            | "SHELLDLL_DefView" // 实现
            | "CabinetWClass" // 实现
            | "ExploreWClass" // 实现
            | "Shell_TrayWnd" // 实现
            | "NotifyIconOverflowWindow" // 实现
    )
}

#[cfg(test)] // 实现
mod excluded_class_tests {
    use super::is_shell_excluded_class;

    #[test]
    fn desktop_surfaces_are_excluded() {
        let desktop_classes = ["Progman", "WorkerW", "SHELLDLL_DefView"];
        for class in desktop_classes {
            assert!(is_shell_excluded_class(class), "{class} 应被排除");
        }
    }

    #[test]
    fn explorer_windows_are_excluded() {
        let explorer_classes = ["CabinetWClass", "ExploreWClass"];
        for class in explorer_classes {
            assert!(is_shell_excluded_class(class), "{class} 应被排除");
        }
    }

    #[test]
    fn normal_application_windows_survive() {
        let normal_classes = ["Chrome_WidgetWin_1", "Notepad"];
        for class in normal_classes {
            assert!(!is_shell_excluded_class(class), "{class} 不应被排除");
        }
    }
}
