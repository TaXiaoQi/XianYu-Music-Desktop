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
        SetWindowPos, ShowWindow, GWL_EXSTYLE, GWL_STYLE, SWP_NOACTIVATE, SWP_FRAMECHANGED,
        SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_MAXIMIZE, SW_SHOWMAXIMIZED, WINDOWPLACEMENT,
        WS_CAPTION, WS_MAXIMIZE, WS_THICKFRAME,
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

/// 保存进入全屏前的扩展样式，退出时恢复。
#[cfg(target_os = "windows")]
static SAVED_EXSTYLE: Mutex<Option<i32>> = Mutex::new(None);

/// 保存进入全屏前的窗口样式（GWL_STYLE），退出时恢复。
#[cfg(target_os = "windows")]
static SAVED_STYLE: Mutex<Option<i32>> = Mutex::new(None);

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
                *SAVED_STYLE.lock().unwrap() = Some(style);
                // WS_CAPTION(0xC00000) = WS_BORDER | WS_DLGFRAME，WS_THICKFRAME(0x40000) 用于调整大小
                // 这两个样式位是非客户区（边框+标题栏）的主要来源，清除后窗口将没有非客户区
                const STYLE_BORDER_MASK: i32 = (WS_CAPTION as i32) | (WS_THICKFRAME as i32) | (WS_MAXIMIZE as i32);
                if style & STYLE_BORDER_MASK != 0 {
                    SetWindowLongW(hwnd, GWL_STYLE, style & !STYLE_BORDER_MASK);
                }

                // 保存并清除扩展样式中的边框位（WS_EX_WINDOWEDGE 等），
                // 否则 Windows 会为窗口保留一圈不可见的边框 padding，导致内容与屏幕边缘有间隙。
                // 0x1C0 = WS_EX_WINDOWEDGE(0x100) | WS_EX_CLIENTEDGE(0x40) | WS_EX_DLGMODALFRAME(0x80) 等
                const EX_BORDER_MASK: i32 = 0x1C0;
                let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                *SAVED_EXSTYLE.lock().unwrap() = Some(ex_style);
                if ex_style & EX_BORDER_MASK != 0 {
                    SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style & !EX_BORDER_MASK);
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

                // Windows 10/11 的 DWM 会为窗口保留一圈约 8px 的不可见边框（用于窗口阴影），
                // 这个边框不会被 SetWindowPos 自动裁剪，导致窗口实际可见区域比 rcMonitor 小一圈。
                // 把矩形向四周扩大 16px，让不可见边框溢出屏幕边缘，内容即可铺满整屏。
                // 16px 可覆盖 150% DPI 缩放下的边框厚度。
                const BORDER_OVERLAP: i32 = 16;
                if SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    left - BORDER_OVERLAP,
                    top - BORDER_OVERLAP,
                    (right - left) + BORDER_OVERLAP * 2,
                    (bottom - top) + BORDER_OVERLAP * 2,
                    // SWP_FRAMECHANGED: 清除边框样式后强制窗口重新计算非客户区
                    SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                ) == 0
                {
                    return Err("SetWindowPos 失败".to_string());
                }

                mark_taskbar_fullscreen(hwnd, true);
                Ok(true)
            } else {
                // 先恢复扩展样式和窗口样式（边框位），再恢复窗口 placement
                if let Some(saved_ex) = SAVED_EXSTYLE.lock().unwrap().take() {
                    SetWindowLongW(hwnd, GWL_EXSTYLE, saved_ex);
                }
                if let Some(saved_style) = SAVED_STYLE.lock().unwrap().take() {
                    SetWindowLongW(hwnd, GWL_STYLE, saved_style);
                }
                let saved = SAVED_PLACEMENT.lock().unwrap().take();
                let was_maximized = saved
                    .as_ref()
                    .map(|SavedPlacement(p)| p.showCmd == SW_SHOWMAXIMIZED as u32)
                    .unwrap_or(false);
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
                // 恢复样式后强制重算非客户区：进入全屏时清除了边框样式并扩大了窗口矩形，
                // 若不触发重算，窗口仍保持全屏尺寸，底部会跑到任务栏后面。
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
                // 同步 tao 内部最大化状态：上面用 ShowWindow(SW_MAXIMIZE) 恢复最大化时，
                // tao 的 is_maximized 状态不会自动更新，导致前端 appWindow.isMaximized() 返回错误值。
                // 仅在 was_maximized 时显式同步；小窗状态由 SetWindowPlacement 已恢复，无需额外调用。
                if was_maximized {
                    let _ = window.maximize();
                }
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
