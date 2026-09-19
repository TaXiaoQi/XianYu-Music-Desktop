use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundFullscreenState {
    pub is_fullscreen: bool,
}

#[tauri::command]
pub fn get_foreground_fullscreen_state() -> ForegroundFullscreenState {
    ForegroundFullscreenState {
        is_fullscreen: platform_is_foreground_fullscreen(),
    }
}

#[cfg(target_os = "windows")]
fn platform_is_foreground_fullscreen() -> bool {
    use std::mem::zeroed;
    use windows_sys::Win32::{
        Foundation::RECT,
        Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        },
        UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        },
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return false;
        }

        if IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
            return false;
        }

        let mut foreground_pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut foreground_pid);
        if foreground_pid == std::process::id() {
            return false;
        }

        if let Some(class_name) = window_class_name(hwnd) {
            if is_excluded_shell_window_class(&class_name) {
                return false;
            }
        }

        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor.is_null() {
            return false;
        }

        let mut monitor_info: MONITORINFO = zeroed();
        monitor_info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut monitor_info) == 0 {
            return false;
        }

        let mut rect: RECT = zeroed();
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return false;
        }

        let monitor_rect = monitor_info.rcMonitor;
        let work_area = monitor_info.rcWork;
        let tolerance = 2;

        let work_width = work_area.right - work_area.left;
        let work_height = work_area.bottom - work_area.top;
        let win_width = rect.right - rect.left;
        let win_height = rect.bottom - rect.top;

        let monitor_width = monitor_rect.right - monitor_rect.left;
        let monitor_height = monitor_rect.bottom - monitor_rect.top;

        let covers_full_monitor = (win_width - monitor_width).abs() <= tolerance
            && (win_height - monitor_height).abs() <= tolerance
            && (rect.left - monitor_rect.left).abs() <= tolerance
            && (rect.top - monitor_rect.top).abs() <= tolerance;

        if covers_full_monitor
            && (monitor_width - work_width).abs() <= tolerance
            && (monitor_height - work_height).abs() <= tolerance
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                GetWindowLongW, GWL_STYLE, WS_MAXIMIZE, WS_THICKFRAME,
            };
            let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
            if (style & WS_THICKFRAME) != 0 && (style & WS_MAXIMIZE) != 0 {
                return false;
            }
        }

        covers_full_monitor
    }
}

#[cfg(not(target_os = "windows"))]
fn platform_is_foreground_fullscreen() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn window_class_name(hwnd: windows_sys::Win32::Foundation::HWND) -> Option<String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW;

    unsafe {
        let mut buffer = [0u16; 256];
        let len = GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        if len <= 0 {
            return None;
        }

        String::from_utf16(&buffer[..len as usize]).ok()
    }
}

fn is_excluded_shell_window_class(class_name: &str) -> bool {
    matches!(
        class_name,
        "Progman"
            | "WorkerW"
            | "SHELLDLL_DefView"
            | "CabinetWClass"
            | "ExploreWClass"
            | "Shell_TrayWnd"
            | "NotifyIconOverflowWindow"
    )
}

#[cfg(test)]
mod tests {
    use super::is_excluded_shell_window_class;

    #[test]
    fn excludes_desktop_shell_classes() {
        assert!(is_excluded_shell_window_class("Progman"));
        assert!(is_excluded_shell_window_class("WorkerW"));
        assert!(is_excluded_shell_window_class("SHELLDLL_DefView"));
    }

    #[test]
    fn excludes_explorer_shell_classes() {
        assert!(is_excluded_shell_window_class("CabinetWClass"));
        assert!(is_excluded_shell_window_class("ExploreWClass"));
    }

    #[test]
    fn keeps_regular_window_classes() {
        assert!(!is_excluded_shell_window_class("Chrome_WidgetWin_1"));
        assert!(!is_excluded_shell_window_class("Notepad"));
    }
}
