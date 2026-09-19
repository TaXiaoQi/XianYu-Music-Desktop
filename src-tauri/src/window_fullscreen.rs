#[cfg(target_os = "windows")]
use std::sync::atomic::Ordering;

#[cfg(target_os = "windows")]
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use crate::window_boundary::FULLSCREEN_ENABLED;

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::WindowsAndMessaging::{
        GetClientRect, GetWindowLongW, GetWindowPlacement, IsZoomed, SendMessageW, SetWindowLongW,
        SetWindowPlacement, SetWindowPos, ShowWindow, GWL_EXSTYLE, GWL_STYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_MAXIMIZE, SW_SHOWMAXIMIZED,
        SW_SHOWNORMAL, WINDOWPLACEMENT, WM_SIZE, WS_CAPTION, WS_MAXIMIZE, WS_THICKFRAME,
    },
};

#[cfg(target_os = "windows")]
struct SavedPlacement(WINDOWPLACEMENT);

#[cfg(target_os = "windows")]
unsafe impl Send for SavedPlacement {}

#[cfg(target_os = "windows")]
static SAVED_PLACEMENT: Mutex<Option<SavedPlacement>> = Mutex::new(None);

#[cfg(target_os = "windows")]
static SAVED_EXSTYLE: Mutex<Option<i32>> = Mutex::new(None);

#[cfg(target_os = "windows")]
static SAVED_STYLE: Mutex<Option<i32>> = Mutex::new(None);

#[cfg(target_os = "windows")]
static SAVED_NORMAL_RECT: Mutex<Option<RECT>> = Mutex::new(None);

#[cfg(target_os = "windows")]
fn hwnd_of(window: &tauri::Window) -> Option<HWND> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let handle = window.window_handle().ok()?;
    match handle.as_raw() {
        RawWindowHandle::Win32(win32) => Some(win32.hwnd.get() as HWND),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
unsafe fn mark_taskbar_fullscreen(hwnd: HWND, fullscreen: bool) {
    use windows::Win32::Foundation::HWND as WHWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{ITaskbarList2, TaskbarList};

    let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

    if let Ok(list) = CoCreateInstance::<_, ITaskbarList2>(&TaskbarList, None, CLSCTX_ALL) {
        if list.HrInit().is_ok() {
            let _ = list.MarkFullscreenWindow(WHWND(hwnd as *mut _), fullscreen);
        }
    }
}

#[tauri::command]
pub fn refresh_immersive_fullscreen(window: tauri::Window) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = hwnd_of(&window).ok_or_else(|| "无法获取窗口句柄".to_string())?;
        unsafe {
            mark_taskbar_fullscreen(hwnd, true);
        }
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Ok(true)
    }
}

#[tauri::command]
pub fn set_immersive_fullscreen(window: tauri::Window, enter: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = hwnd_of(&window).ok_or_else(|| "无法获取窗口句柄".to_string())?;

        unsafe {
            if enter {
                let mut placement: WINDOWPLACEMENT = std::mem::zeroed();
                placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                if GetWindowPlacement(hwnd, &mut placement) == 0 {
                    return Err("GetWindowPlacement 失败".to_string());
                }
                *SAVED_PLACEMENT.lock().map_err(|e| e.to_string())? =
                    Some(SavedPlacement(placement));

                *SAVED_NORMAL_RECT.lock().map_err(|e| e.to_string())? =
                    Some(placement.rcNormalPosition);

                if IsZoomed(hwnd) == 0 {
                    ShowWindow(hwnd, SW_MAXIMIZE);
                    std::thread::sleep(std::time::Duration::from_millis(220));
                }

                let style = GetWindowLongW(hwnd, GWL_STYLE);
                *SAVED_STYLE.lock().map_err(|e| e.to_string())? = Some(style);
                const STYLE_BORDER_MASK: i32 =
                    (WS_CAPTION as i32) | (WS_THICKFRAME as i32) | (WS_MAXIMIZE as i32);
                if style & STYLE_BORDER_MASK != 0 {
                    SetWindowLongW(hwnd, GWL_STYLE, style & !STYLE_BORDER_MASK);
                }

                const EX_BORDER_MASK: i32 = 0x1C0;
                let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                *SAVED_EXSTYLE.lock().map_err(|e| e.to_string())? = Some(ex_style);
                if ex_style & EX_BORDER_MASK != 0 {
                    SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style & !EX_BORDER_MASK);
                }

                FULLSCREEN_ENABLED.store(true, Ordering::Relaxed);

                let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                let mut mi: MONITORINFO = std::mem::zeroed();
                mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
                if GetMonitorInfoW(monitor, &mut mi) == 0 {
                    return Err("GetMonitorInfoW 失败".to_string());
                }
                let RECT {
                    left,
                    top,
                    right,
                    bottom,
                } = mi.rcMonitor;

                if SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    left,
                    top,
                    right - left,
                    bottom - top,
                    SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                ) == 0
                {
                    return Err("SetWindowPos 失败".to_string());
                }

                mark_taskbar_fullscreen(hwnd, true);
                Ok(true)
            } else {
                FULLSCREEN_ENABLED.store(false, Ordering::Relaxed);

                if let Some(saved_ex) = SAVED_EXSTYLE.lock().map_err(|e| e.to_string())?.take() {
                    SetWindowLongW(hwnd, GWL_EXSTYLE, saved_ex);
                }
                if let Some(saved_style) = SAVED_STYLE.lock().map_err(|e| e.to_string())?.take() {
                    SetWindowLongW(hwnd, GWL_STYLE, saved_style);
                }
                let saved = SAVED_PLACEMENT.lock().map_err(|e| e.to_string())?.take();
                let was_maximized = saved
                    .as_ref()
                    .map(|SavedPlacement(p)| p.showCmd == SW_SHOWMAXIMIZED as u32)
                    .unwrap_or(false);
                if let Some(SavedPlacement(placement)) = saved {
                    if placement.showCmd == SW_SHOWMAXIMIZED as u32 {
                        ShowWindow(hwnd, SW_MAXIMIZE);
                        if SetWindowPlacement(hwnd, &placement) == 0 {
                            return Err("SetWindowPlacement 失败".to_string());
                        }
                    } else {
                        if SetWindowPlacement(hwnd, &placement) == 0 {
                            return Err("SetWindowPlacement 失败".to_string());
                        }
                    }
                }
                SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED,
                );
                mark_taskbar_fullscreen(hwnd, false);
                if was_maximized {
                    let _ = window.maximize();
                } else {
                    let mut client_rc: RECT = std::mem::zeroed();
                    if GetClientRect(hwnd, &mut client_rc) != 0 {
                        let lparam = ((client_rc.bottom as isize) << 16)
                            | (client_rc.right as isize & 0xFFFF);
                        SendMessageW(hwnd, WM_SIZE, 0, lparam);
                    }
                    *SAVED_NORMAL_RECT.lock().map_err(|e| e.to_string())? = None;
                }
                Ok(false)
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let result = window.set_fullscreen(enter);
        let _ = result;
        Ok(enter)
    }
}

#[tauri::command]
pub fn smart_toggle_maximize(window: tauri::Window) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = hwnd_of(&window).ok_or_else(|| "无法获取窗口句柄".to_string())?;

        unsafe {
            if IsZoomed(hwnd) != 0 {
                let saved = SAVED_NORMAL_RECT.lock().map_err(|e| e.to_string())?.take();
                if let Some(normal_rect) = saved {
                    let mut placement: WINDOWPLACEMENT = std::mem::zeroed();
                    placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                    if GetWindowPlacement(hwnd, &mut placement) == 0 {
                        return Err("GetWindowPlacement 失败".to_string());
                    }
                    placement.showCmd = SW_SHOWNORMAL as u32;
                    placement.rcNormalPosition = normal_rect;
                    if SetWindowPlacement(hwnd, &placement) == 0 {
                        return Err("SetWindowPlacement 失败".to_string());
                    }
                } else {
                    let _ = window.unmaximize();
                }
                Ok(false)
            } else {
                let _ = window.maximize();
                Ok(true)
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let was_maximized = window.is_maximized().unwrap_or(false);
        if was_maximized {
            let _ = window.unmaximize();
            Ok(false)
        } else {
            let _ = window.maximize();
            Ok(true)
        }
    }
}
