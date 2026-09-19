use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::Shell::{DefSubclassProc, SetWindowSubclass},
    UI::WindowsAndMessaging::{WM_MOVING, WM_NCCALCSIZE},
};

static BOUNDARY_ENABLED: AtomicBool = AtomicBool::new(false);

pub static FULLSCREEN_ENABLED: AtomicBool = AtomicBool::new(false);

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
    if msg == WM_NCCALCSIZE && wparam == 1 && FULLSCREEN_ENABLED.load(Ordering::Relaxed) {
        return 0;
    }

    if msg == WM_MOVING && BOUNDARY_ENABLED.load(Ordering::Relaxed) {
        let rect = &mut *(lparam as *mut RECT);
        let win_width = rect.right - rect.left;
        let win_height = rect.bottom - rect.top;

        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;

        if GetMonitorInfoW(monitor, &mut mi) != 0 {
            let work = mi.rcWork;

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

#[cfg(target_os = "windows")]
pub fn install_boundary_subclass(hwnd: isize) {
    unsafe {
        SetWindowSubclass(hwnd as HWND, Some(boundary_subclass_proc), SUBCLASS_ID, 0);
    }
}

#[tauri::command]
pub fn set_mini_boundary_enabled(enabled: bool) {
    BOUNDARY_ENABLED.store(enabled, Ordering::Relaxed);
}
