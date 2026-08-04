//! 沉浸式全屏切换（Windows 原生实现）
//!
//! 策略：利用系统原生最大化动画作为全屏过渡，再无缝切换为沉浸式全屏。
//!
//! 进入全屏流程（前端编排）：
//! 1. `save_window_placement` — 保存原始窗口状态（placement + style + ex_style）
//! 2. `appWindow.maximize()` — 享受系统原生最大化动画
//! 3. `set_immersive_fullscreen(true)` — 从最大化同步切换为全屏（去边框 + 覆盖任务栏）
//!
//! 退出全屏流程：
//! 1. `set_immersive_fullscreen(false)` — 恢复到最大化状态（全屏→最大化仅相差任务栏高度）
//! 2. 若原始状态非最大化，前端调用 `appWindow.unmaximize()` — 享受原生还原动画
//!
//! 退出时总是先恢复到最大化（SW_MAXIMIZE），再修正 rcNormalPosition 为保存的原始值，
//! 确保后续 unmaximize 能还原到正确的窗口位置。任务栏隐藏用 ITaskbarList2::MarkFullscreenWindow。

#[cfg(target_os = "windows")]
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        RedrawWindow, RDW_ALLCHILDREN, RDW_INVALIDATE, RDW_UPDATENOW,
    },
    UI::WindowsAndMessaging::{
        GetWindowLongW, GetWindowPlacement, SendMessageW, SetWindowLongW, SetWindowPlacement,
        SetWindowPos, ShowWindow, GWL_EXSTYLE, GWL_STYLE, SWP_NOACTIVATE, SWP_FRAMECHANGED,
        SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_MAXIMIZE, SW_SHOWNORMAL, WM_SETREDRAW,
        WINDOWPLACEMENT, WS_CAPTION, WS_MAXIMIZE, WS_THICKFRAME,
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

/// 保存窗口当前放置信息（在最大化之前调用）。
///
/// 前端在进入全屏前先调用此命令保存原始窗口状态（placement + style + ex_style），
/// 然后执行原生最大化动画，最后调用 `set_immersive_fullscreen` 切换为沉浸式全屏。
/// 退出全屏时使用此保存的信息恢复窗口到原始状态。
#[tauri::command]
pub fn save_window_placement(window: tauri::Window) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = hwnd_of(&window).ok_or_else(|| "无法获取窗口句柄".to_string())?;
        unsafe {
            let mut placement: WINDOWPLACEMENT = std::mem::zeroed();
            placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
            if GetWindowPlacement(hwnd, &mut placement) == 0 {
                return Err("GetWindowPlacement 失败".to_string());
            }
            *SAVED_PLACEMENT.lock().unwrap() = Some(SavedPlacement(placement));

            let style = GetWindowLongW(hwnd, GWL_STYLE);
            *SAVED_STYLE.lock().unwrap() = Some(style);

            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
            *SAVED_EXSTYLE.lock().unwrap() = Some(ex_style);
        }
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Err("当前平台不支持".to_string())
    }
}

/// 重新标记主窗口为沉浸式全屏状态（不改变窗口样式/位置）。
///
/// 用途：主窗口被 hide → show 后（如切换 mini 模式），任务栏会重新显示并遮挡窗口底部。
/// 此时窗口本身仍处于全屏样式（无边框、覆盖任务栏区域），仅需重新告知 shell 让任务栏让位。
/// 相比完整的 `set_immersive_fullscreen(false)` + `set_immersive_fullscreen(true)` 流程，
/// 此命令无窗口样式/位置变更和动画开销，切换更迅速。
#[tauri::command]
pub fn refresh_immersive_fullscreen(window: tauri::Window) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = hwnd_of(&window).ok_or_else(|| "无法获取窗口句柄".to_string())?;
        unsafe { mark_taskbar_fullscreen(hwnd, true); }
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Err("当前平台不支持".to_string())
    }
}

/// 进入/退出沉浸式全屏。
///
/// - enter=true：将窗口覆盖到所在显示器全区，隐藏任务栏。
/// - enter=false：恢复窗口到最大化状态（前端再根据原始状态决定是否 unmaximize）。
///
/// 返回切换后的全屏状态（true=全屏中）。
///
/// 正常流程：
/// 1. 前端调用 `save_window_placement`（保存原始窗口状态）
/// 2. 前端执行 `appWindow.maximize()`（享受系统原生最大化动画）
/// 3. 前端调用本命令 `set_immersive_fullscreen(true)`（从最大化无缝切换为全屏）
///
/// 退出流程：
/// 1. 前端调用本命令 `set_immersive_fullscreen(false)`（全屏→最大化，平滑过渡）
/// 2. 若原始状态非最大化，前端调用 `appWindow.unmaximize()`（最大化→普通窗口，原生动画）
#[tauri::command]
pub fn set_immersive_fullscreen(window: tauri::Window, enter: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = hwnd_of(&window).ok_or_else(|| "无法获取窗口句柄".to_string())?;

        unsafe {
            if enter {
                // 兜底：如果前端未调用 save_window_placement（正常流程已预先保存），在此保存。
                // 前端流程：先 save_window_placement（保存原始窗口状态）→ maximize（原生动画）→ 本命令。
                // 若已保存则跳过，避免用最大化后的 placement 覆盖原始窗口状态。
                if SAVED_PLACEMENT.lock().unwrap().is_none() {
                    let mut placement: WINDOWPLACEMENT = std::mem::zeroed();
                    placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                    if GetWindowPlacement(hwnd, &mut placement) == 0 {
                        return Err("GetWindowPlacement 失败".to_string());
                    }
                    *SAVED_PLACEMENT.lock().unwrap() = Some(SavedPlacement(placement));
                    *SAVED_STYLE.lock().unwrap() = Some(GetWindowLongW(hwnd, GWL_STYLE));
                    *SAVED_EXSTYLE.lock().unwrap() = Some(GetWindowLongW(hwnd, GWL_EXSTYLE));
                }

                // 先计算全屏目标矩形（后续 SetWindowPlacement 需要用它直接定位，避免中间态）
                let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                let mut mi: MONITORINFO = std::mem::zeroed();
                mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
                if GetMonitorInfoW(monitor, &mut mi) == 0 {
                    return Err("GetMonitorInfoW 失败".to_string());
                }
                let RECT { left, top, right, bottom } = mi.rcMonitor;

                // Windows 10/11 的 DWM 会为窗口保留一圈约 8px 的不可见边框（用于窗口阴影），
                // 这个边框不会被 SetWindowPos 自动裁剪，导致窗口实际可见区域比 rcMonitor 小一圈。
                // 把矩形向四周扩大 16px，让不可见边框溢出屏幕边缘，内容即可铺满整屏。
                const BORDER_OVERLAP: i32 = 16;
                let fs_rect = RECT {
                    left: left - BORDER_OVERLAP,
                    top: top - BORDER_OVERLAP,
                    right: right + BORDER_OVERLAP,
                    bottom: bottom + BORDER_OVERLAP,
                };

                // 暂停窗口重绘：清除边框样式 + SetWindowPos 退出最大化定位期间，
                // 配合前端设置的黑色窗口背景，新暴露区域显示黑色而非 WebView2 默认白色。
                // WM_SETREDRAW 暂停窗口及子窗口（含 WebView2）的绘制，统一刷新消除闪烁。
                SendMessageW(hwnd, WM_SETREDRAW, 0, 0);

                // 清除 WS_MAXIMIZE 样式位，否则窗口被约束在工作区内，无法铺满整屏。
                // WS_CAPTION(0xC00000) = WS_BORDER | WS_DLGFRAME，WS_THICKFRAME(0x40000) 用于调整大小
                // 这两个样式位是非客户区（边框+标题栏）的主要来源，清除后窗口将没有非客户区
                let style = GetWindowLongW(hwnd, GWL_STYLE);
                const STYLE_BORDER_MASK: i32 = (WS_CAPTION as i32) | (WS_THICKFRAME as i32) | (WS_MAXIMIZE as i32);
                if style & STYLE_BORDER_MASK != 0 {
                    SetWindowLongW(hwnd, GWL_STYLE, style & !STYLE_BORDER_MASK);
                }

                // 清除扩展样式中的边框位（WS_EX_WINDOWEDGE 等），
                // 否则 Windows 会为窗口保留一圈不可见的边框 padding，导致内容与屏幕边缘有间隙。
                // 0x1C0 = WS_EX_WINDOWEDGE(0x100) | WS_EX_CLIENTEDGE(0x40) | WS_EX_DLGMODALFRAME(0x80) 等
                const EX_BORDER_MASK: i32 = 0x1C0;
                let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                if ex_style & EX_BORDER_MASK != 0 {
                    SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style & !EX_BORDER_MASK);
                }

                // 直接用 SetWindowPos 定位到全屏矩形，避免 SetWindowPlacement 退出最大化时
                // 触发 DWM 还原动画（窗口先缩小到 rcNormalPosition 再放大 = 白屏闪烁）。
                // SetWindowPos 改变最大化窗口的尺寸会自动取消最大化内部状态，但不触发 DWM 动画，
                // 配合 WM_SETREDRAW 暂停重绘，窗口无中间态直接到达全屏矩形。
                SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    fs_rect.left,
                    fs_rect.top,
                    fs_rect.right - fs_rect.left,
                    fs_rect.bottom - fs_rect.top,
                    SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                );

                // 修正窗口放置内部状态：将 showCmd 设为 SW_SHOWNORMAL（非最大化），
                // rcNormalPosition 设为全屏矩形，使后续 GetWindowPlacement 返回正确值。
                // 此时窗口已定位到全屏矩形，此调用仅更新内部状态，不触发动画或重绘。
                let mut placement: WINDOWPLACEMENT = std::mem::zeroed();
                placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                if GetWindowPlacement(hwnd, &mut placement) != 0 {
                    placement.showCmd = SW_SHOWNORMAL as u32;
                    placement.rcNormalPosition = fs_rect;
                    SetWindowPlacement(hwnd, &placement);
                }

                // 恢复窗口重绘并强制立即刷新所有内容（含 WebView2 子窗口）。
                // 此时窗口已是全屏尺寸 + 无边框，WebView2 按新视口一次性渲染，无白屏中间态。
                SendMessageW(hwnd, WM_SETREDRAW, 1, 0);
                RedrawWindow(
                    hwnd,
                    std::ptr::null(),
                    std::ptr::null_mut(),
                    RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN,
                );

                mark_taskbar_fullscreen(hwnd, true);
                Ok(true)
            } else {
                // 恢复扩展样式和窗口样式（边框位）
                if let Some(saved_ex) = SAVED_EXSTYLE.lock().unwrap().take() {
                    SetWindowLongW(hwnd, GWL_EXSTYLE, saved_ex);
                }
                if let Some(saved_style) = SAVED_STYLE.lock().unwrap().take() {
                    SetWindowLongW(hwnd, GWL_STYLE, saved_style);
                }

                // 总是先恢复到最大化状态：全屏→最大化的过渡非常平滑（仅相差任务栏高度 + 边框），
                // 用户几乎无感。前端再根据原始状态决定是否调用 unmaximize 还原为普通窗口。
                // 若原始状态就是最大化，则直接停留在此；若原始状态是小窗，前端 unmaximize 触发原生还原动画。
                ShowWindow(hwnd, SW_MAXIMIZE);

                // SW_MAXIMIZE 会将当前窗口矩形（全屏矩形）保存为 rcNormalPosition，
                // 导致后续前端 unmaximize 恢复到全屏尺寸而非原始窗口尺寸。
                // 从保存的 placement 中恢复正确的 rcNormalPosition。
                let saved = SAVED_PLACEMENT.lock().unwrap().take();
                if let Some(SavedPlacement(saved_placement)) = saved {
                    let mut current: WINDOWPLACEMENT = std::mem::zeroed();
                    current.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                    if GetWindowPlacement(hwnd, &mut current) != 0 {
                        // 仅修正 rcNormalPosition，保持 showCmd = SW_SHOWMAXIMIZED 不变
                        current.rcNormalPosition = saved_placement.rcNormalPosition;
                        let _ = SetWindowPlacement(hwnd, &current);
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
                // 同步 tao 内部最大化状态：ShowWindow(SW_MAXIMIZE) 不会自动更新 tao 的 is_maximized，
                // 导致前端 appWindow.isMaximized() 返回错误值。始终同步（退出全屏后总是最大化状态）。
                let _ = window.maximize();
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
