//! 沉浸式全屏切换（Windows 原生实现）
//!
//! 背景：tauri/tao 的 setFullscreen 在退出全屏时用 SetWindowPlacement 恢复窗口，
//! 但前端若在进全屏前调用 unmaximize()，保存的 placement.showCmd 会记成普通态，
//! 导致「全屏 → 退出」先弹回普通小窗再放大，出现中间小窗帧。
//!
//! 本模块绕过 tao，自己用 Win32 管理 placement：进全屏前保存当前 placement
//! （若窗口是最大化，showCmd 即 SW_SHOWMAXIMIZED），退出时 SetWindowPlacement
//! 一步恢复到最大化，全程无小窗中间帧。任务栏隐藏用 ITaskbarList2::MarkFullscreenWindow
//! （与 tao 同款做法）。

#[cfg(target_os = "windows")]
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::WindowsAndMessaging::{
        GetWindowLongW, GetWindowPlacement, IsZoomed, SetWindowLongW, SetWindowPlacement,
        SetWindowPos, ShowWindow, GWL_STYLE, SWP_FRAMECHANGED, SWP_NOZORDER, SW_MAXIMIZE,
        SW_SHOWMAXIMIZED, WINDOWPLACEMENT, WS_MAXIMIZE,
    },
};

/// WINDOWPLACEMENT 是 #[repr(C)] 的纯 POD 结构，跨线程存储安全。
#[cfg(target_os = "windows")]
struct SavedPlacement(WINDOWPLACEMENT);

#[cfg(target_os = "windows")]
unsafe impl Send for SavedPlacement {}

/// 保存进入全屏前的窗口 placement（单主窗口场景，够用）。
#[cfg(target_os = "windows")]
static SAVED_PLACEMENT: Mutex<Option<SavedPlacement>> = Mutex::new(None);

/// 从 tauri 窗口取原生 HWND。
#[cfg(target_os = "windows")]
fn hwnd_of(window: &tauri::Window) -> Option<HWND> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let handle = window.window_handle().ok()?;
    match handle.as_raw() {
        RawWindowHandle::Win32(win32) => Some(win32.hwnd.get() as HWND),
        _ => None,
    }
}

/// 告知 shell 窗口进入/退出全屏，使任务栏正确让位（与 tao 同款）。
#[cfg(target_os = "windows")]
unsafe fn mark_taskbar_fullscreen(hwnd: HWND, fullscreen: bool) {
    use windows::Win32::Foundation::HWND as WHWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{ITaskbarList2, TaskbarList};

    // 幂等：同线程重复初始化返回 S_FALSE，无害
    let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

    if let Ok(list) = CoCreateInstance::<_, ITaskbarList2>(&TaskbarList, None, CLSCTX_ALL) {
        if list.HrInit().is_ok() {
            let _ = list.MarkFullscreenWindow(WHWND(hwnd as *mut _), fullscreen);
        }
    }
}

/// 进入/退出沉浸式全屏。
///
/// - enter=true：保存当前 placement，将窗口覆盖到所在显示器全区，隐藏任务栏。
/// - enter=false：用保存的 placement 一步恢复（最大化态直接回最大化，无小窗），恢复任务栏。
///
/// 返回切换后的全屏状态（true=全屏中）。
#[tauri::command]
pub fn set_immersive_fullscreen(window: tauri::Window, enter: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = hwnd_of(&window).ok_or_else(|| "无法获取窗口句柄".to_string())?;

        unsafe {
            if enter {
                // 保存当前 placement（含 showCmd：最大化则为 SW_SHOWMAXIMIZED）
                let mut placement: WINDOWPLACEMENT = std::mem::zeroed();
                placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                if GetWindowPlacement(hwnd, &mut placement) == 0 {
                    return Err("GetWindowPlacement 失败".to_string());
                }
                *SAVED_PLACEMENT.lock().unwrap() = Some(SavedPlacement(placement));

                // 小窗进全屏：先走 SW_MAXIMIZE 的系统丝滑放大动画（放大观感来源）。
                if IsZoomed(hwnd) == 0 {
                    ShowWindow(hwnd, SW_MAXIMIZE);
                    std::thread::sleep(std::time::Duration::from_millis(220));
                }

                // 清除 WS_MAXIMIZE 样式位，否则窗口被约束在工作区内，SetWindowPos 无法铺满整屏。
                // placement 已保存（showCmd 仍为 SW_SHOWMAXIMIZED），退出恢复不受影响。
                let style = GetWindowLongW(hwnd, GWL_STYLE);
                if style & WS_MAXIMIZE as i32 != 0 {
                    SetWindowLongW(hwnd, GWL_STYLE, style & !(WS_MAXIMIZE as i32));
                }

                // 用整个显示器矩形（含任务栏区域）铺满窗口
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
                    SWP_NOZORDER | SWP_FRAMECHANGED,
                ) == 0
                {
                    return Err("SetWindowPos 失败".to_string());
                }

                mark_taskbar_fullscreen(hwnd, true);
                Ok(true)
            } else {
                let saved = SAVED_PLACEMENT.lock().unwrap().take();
                if let Some(SavedPlacement(placement)) = saved {
                    if placement.showCmd == SW_SHOWMAXIMIZED as u32 {
                        // 进全屏前是最大化：直接 SW_MAXIMIZE 一步回最大化，无小窗中间帧。
                        ShowWindow(hwnd, SW_MAXIMIZE);
                    } else {
                        // 进全屏前是小窗：一步还原到原始位置尺寸（硬跳），缩小观感由前端 CSS 承担。
                        if SetWindowPlacement(hwnd, &placement) == 0 {
                            return Err("SetWindowPlacement 失败".to_string());
                        }
                    }
                }
                mark_taskbar_fullscreen(hwnd, false);
                Ok(false)
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // 非 Windows：暂不支持沉浸式全屏
        let _ = (window, enter);
        Err("当前平台不支持沉浸式全屏".to_string())
    }
}
