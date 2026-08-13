use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::Shell::{DefSubclassProc, SetWindowSubclass},
    UI::WindowsAndMessaging::{WM_MOVING, WM_NCCALCSIZE},
};

/// 全局标志：是否启用 mini 窗口边界约束
static BOUNDARY_ENABLED: AtomicBool = AtomicBool::new(false);

/// 全局标志：主窗口是否处于沉浸式全屏状态。
///
/// 全屏时需要拦截 `WM_NCCALCSIZE` 返回 0，告知 Windows 整个窗口矩形即为客户区，
/// 消除 tao 对无边框窗口默认的 DWM 不可见边框 padding，使内容真正铺满整屏。
pub static FULLSCREEN_ENABLED: AtomicBool = AtomicBool::new(false);

/// Subclass ID（任意唯一常量）
#[cfg(target_os = "windows")]
const SUBCLASS_ID: usize = 1001;

#[cfg(target_os = "windows")]
unsafe extern "system" fn boundary_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uid_subclass: usize,
    _dw_ref_data: usize,
) -> LRESULT {
    // 全屏时拦截 WM_NCCALCSIZE：返回 0 表示整个窗口矩形即为客户区，
    // 消除 tao 对无边框窗口默认的 DWM 不可见边框 padding，使内容铺满整屏。
    if msg == WM_NCCALCSIZE && wparam == 1 && FULLSCREEN_ENABLED.load(Ordering::Relaxed) {
        return 0;
    }

    if msg == WM_MOVING && BOUNDARY_ENABLED.load(Ordering::Relaxed) {
        // lparam 指向一个 RECT，表示窗口即将移动到的目标位置
        let rect = &mut *(lparam as *mut RECT);
        let win_width = rect.right - rect.left;
        let win_height = rect.bottom - rect.top;

        // 获取窗口所在显示器的工作区域（排除任务栏）
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;

        if GetMonitorInfoW(monitor, &mut mi) != 0 {
            let work = mi.rcWork;

            // 钳制位置：不允许超出工作区域
            if rect.left < work.left {
                rect.left = work.left;
                rect.right = work.left + win_width;
            }
            if rect.top < work.top {
                rect.top = work.top;
                rect.bottom = work.top + win_height;
            }
            if rect.right > work.right {
                rect.right = work.right;
                rect.left = work.right - win_width;
            }
            if rect.bottom > work.bottom {
                rect.bottom = work.bottom;
                rect.top = work.bottom - win_height;
            }
        }

        return 0;
    }

    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// 为指定窗口安装 subclass（在 setup 阶段调用一次即可）
#[cfg(target_os = "windows")]
pub fn install_boundary_subclass(hwnd: isize) {
    unsafe {
        SetWindowSubclass(hwnd as HWND, Some(boundary_subclass_proc), SUBCLASS_ID, 0);
    }
}

/// Tauri 命令：启用/禁用 mini 窗口边界约束
#[tauri::command]
pub fn set_mini_boundary_enabled(enabled: bool) {
    BOUNDARY_ENABLED.store(enabled, Ordering::Relaxed);
}
