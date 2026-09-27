//! 迷你播放器拖拽边界与全屏样式辅助。
//!
//! 通过窗口子类过程拦截 WM_MOVING，把窗口拖动范围约束在显示器工作区内；
//! 沉浸式全屏开启期间吞掉 WM_NCCALCSIZE，去掉非客户区边框让内容铺满屏幕。

use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::Shell::{DefSubclassProc, SetWindowSubclass},
    UI::WindowsAndMessaging::{WM_MOVING, WM_NCCALCSIZE},
};

/// 是否启用迷你播放器的拖拽边界约束。
static BOUNDARY_ENABLED: AtomicBool = AtomicBool::new(false);

/// 是否处于沉浸式全屏（由 window_fullscreen 模块切换）。
pub static FULLSCREEN_ENABLED: AtomicBool = AtomicBool::new(false);

/// 子类注册标识，进程内保持唯一即可。
#[cfg(target_os = "windows")]
const BOUNDARY_SUBCLASS_TOKEN: usize = 1001;

/// 把拖动中的矩形约束进工作区，保持宽高不变。
#[cfg(target_os = "windows")]
fn clamp_rect_to_work_area(rect: &mut RECT, work: &RECT) {
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;

    if rect.left < work.left {
        rect.left = work.left;
        rect.right = work.left + width;
    }
    if rect.top < work.top {
        rect.top = work.top;
        rect.bottom = work.top + height;
    }
    if rect.right > work.right {
        rect.right = work.right;
        rect.left = work.right - width;
    }
    if rect.bottom > work.bottom {
        rect.bottom = work.bottom;
        rect.top = work.bottom - height;
    }
}

/// 子类过程：处理全屏非客户区裁剪与拖拽边界，其余消息走默认流程。
#[cfg(target_os = "windows")]
unsafe extern "system" fn boundary_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uid_subclass: usize,
    _dw_ref_data: usize,
) -> LRESULT {
    // 全屏期间取消非客户区计算，让内容区域占满整个窗口
    if msg == WM_NCCALCSIZE && wparam == 1 && FULLSCREEN_ENABLED.load(Ordering::Relaxed) {
        return 0;
    }

    if msg == WM_MOVING && BOUNDARY_ENABLED.load(Ordering::Relaxed) {
        let rect = &mut *(lparam as *mut RECT);
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;

        if GetMonitorInfoW(monitor, &mut info) != 0 {
            clamp_rect_to_work_area(rect, &info.rcWork);
        }
        return 0;
    }

    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// 在指定窗口上安装边界子类过程（启动时对迷你播放器窗口调用）。
#[cfg(target_os = "windows")]
pub fn install_boundary_subclass(hwnd: isize) {
    unsafe {
        SetWindowSubclass(
            hwnd as HWND,
            Some(boundary_subclass_proc),
            BOUNDARY_SUBCLASS_TOKEN,
            0,
        );
    }
}

/// 开关迷你播放器的拖拽边界约束。
#[tauri::command]
pub fn set_mini_boundary_enabled(enabled: bool) {
    BOUNDARY_ENABLED.store(enabled, Ordering::Relaxed);
}
