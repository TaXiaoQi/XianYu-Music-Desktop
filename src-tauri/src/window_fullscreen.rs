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
//!
//! 最大化/还原切换使用 `smart_toggle_maximize` 命令：
//! - 用 Win32 `IsZoomed` 判断窗口状态（不依赖 tao 内部 `is_maximized` 缓存）
//! - 还原时若 `SAVED_NORMAL_RECT` 有值（全屏期间保存的正确小窗尺寸），
//!   用 `SetWindowPlacement(SW_SHOWNORMAL)` 一步恢复正确几何，绕过 tao 被污染的还原尺寸缓存

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
        GetWindowLongW, GetWindowPlacement, IsZoomed, SetWindowLongW, SetWindowPlacement,
        SetWindowPos, ShowWindow, GWL_EXSTYLE, GWL_STYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_MAXIMIZE, SW_SHOWNORMAL, SW_SHOWMAXIMIZED,
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

/// 保存进入全屏前小窗的正常位置尺寸（placement.rcNormalPosition）。
///
/// 全屏期间 SetWindowPos 会触发 WM_SIZE(SIZE_RESTORED)，tao 据此将全屏矩形缓存为
/// 内部"还原尺寸"。退出全屏后 tao 的 unmaximize 会使用这个错误缓存，导致窗口还原到
/// 全屏大小（看起来没有缩小）。此变量保存正确的小窗尺寸，供 smart_toggle_maximize
/// 命令在还原时使用 SetWindowPlacement 一步到位地恢复正确几何，绕过 tao 的缓存。
#[cfg(target_os = "windows")]
static SAVED_NORMAL_RECT: Mutex<Option<RECT>> = Mutex::new(None);

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
            *SAVED_PLACEMENT.lock().map_err(|e| e.to_string())? = Some(SavedPlacement(placement));

            let style = GetWindowLongW(hwnd, GWL_STYLE);
            *SAVED_STYLE.lock().map_err(|e| e.to_string())? = Some(style);

            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
            *SAVED_EXSTYLE.lock().map_err(|e| e.to_string())? = Some(ex_style);
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
        unsafe {
            mark_taskbar_fullscreen(hwnd, true);
        }
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Err("当前平台不支持".to_string())
    }
}

/// 标记/取消标记主窗口为全屏窗口，仅控制任务栏显隐，不改变窗口样式或位置。
///
/// 调用 ITaskbarList2::MarkFullscreenWindow。用途：进入沉浸式全屏前先调用本命令
/// 隐藏任务栏，使工作区扩大到整屏；随后 maximize 的目标矩形即为整屏，最大化动画
/// 可一次覆盖任务栏区域，避免「先最大化到工作区再瞬间扩展覆盖任务栏」的跳变。
#[tauri::command]
pub fn set_taskbar_fullscreen_flag(window: tauri::Window, enter: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = hwnd_of(&window).ok_or_else(|| "无法获取窗口句柄".to_string())?;
        unsafe {
            mark_taskbar_fullscreen(hwnd, enter);
        }
        Ok(enter)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, enter);
        Err("当前平台不支持".to_string())
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
                *SAVED_PLACEMENT.lock().map_err(|e| e.to_string())? =
                    Some(SavedPlacement(placement));

                // 单独保存小窗的正常位置尺寸（rcNormalPosition）。
                // 无论当前窗口是否最大化，rcNormalPosition 始终保存还原时的位置/尺寸。
                // 退出全屏后 tao 的内部还原尺寸缓存已被全屏矩形污染，smart_toggle_maximize
                // 会使用此保存值通过 SetWindowPlacement 一步恢复正确几何。
                *SAVED_NORMAL_RECT.lock().map_err(|e| e.to_string())? = Some(placement.rcNormalPosition);

                // 小窗进全屏：先走 SW_MAXIMIZE 的系统丝滑放大动画（放大观感来源）。
                if IsZoomed(hwnd) == 0 {
                    ShowWindow(hwnd, SW_MAXIMIZE);
                    std::thread::sleep(std::time::Duration::from_millis(220));
                }

                // 清除 WS_MAXIMIZE 样式位，否则窗口被约束在工作区内，SetWindowPos 无法铺满整屏。
                // placement 已保存（showCmd 仍为 SW_SHOWMAXIMIZED），退出恢复不受影响。
                let style = GetWindowLongW(hwnd, GWL_STYLE);
                *SAVED_STYLE.lock().map_err(|e| e.to_string())? = Some(style);
                // WS_CAPTION(0xC00000) = WS_BORDER | WS_DLGFRAME，WS_THICKFRAME(0x40000) 用于调整大小
                // 这两个样式位是非客户区（边框+标题栏）的主要来源，清除后窗口将没有非客户区
                const STYLE_BORDER_MASK: i32 =
                    (WS_CAPTION as i32) | (WS_THICKFRAME as i32) | (WS_MAXIMIZE as i32);
                if style & STYLE_BORDER_MASK != 0 {
                    SetWindowLongW(hwnd, GWL_STYLE, style & !STYLE_BORDER_MASK);
                }

                // 保存并清除扩展样式中的边框位（WS_EX_WINDOWEDGE 等），
                // 否则 Windows 会为窗口保留一圈不可见的边框 padding，导致内容与屏幕边缘有间隙。
                // 0x1C0 = WS_EX_WINDOWEDGE(0x100) | WS_EX_CLIENTEDGE(0x40) | WS_EX_DLGMODALFRAME(0x80) 等
                const EX_BORDER_MASK: i32 = 0x1C0;
                let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                *SAVED_EXSTYLE.lock().map_err(|e| e.to_string())? = Some(ex_style);
                if ex_style & EX_BORDER_MASK != 0 {
                    SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style & !EX_BORDER_MASK);
                }

                // 标记全屏状态：subclass 据此拦截 WM_NCCALCSIZE 返回 0，
                // 消除 tao 对无边框窗口默认的 DWM 不可见边框 padding，使内容真正铺满整屏。
                FULLSCREEN_ENABLED.store(true, Ordering::Relaxed);

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

                // 上方已清除 WS_THICKFRAME | WS_CAPTION 及扩展边框样式，窗口已无非客户区，
                // DWM 不再为窗口保留约 8px 的不可见边框（该边框本服务于可调整大小窗口的阴影/resize 抓手）。
                // 因此直接用 rcMonitor 铺满即可，无需额外扩大。若再向四周扩大，窗口矩形会大于显示器，
                // WebView 内容会溢出屏幕边缘几十像素（底部/右侧内容被裁切）。
                if SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    left,
                    top,
                    right - left,
                    bottom - top,
                    // SWP_FRAMECHANGED: 清除边框样式后强制窗口重新计算非客户区
                    SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                ) == 0
                {
                    return Err("SetWindowPos 失败".to_string());
                }

                mark_taskbar_fullscreen(hwnd, true);
                Ok(true)
            } else {
                // 退出全屏：先清除标志，恢复 tao 默认的 WM_NCCALCSIZE 处理
                FULLSCREEN_ENABLED.store(false, Ordering::Relaxed);

                // 先恢复扩展样式和窗口样式（边框位），再恢复窗口 placement
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
                        // 进全屏前是最大化：直接 SW_MAXIMIZE 一步回最大化，无小窗中间帧。
                        ShowWindow(hwnd, SW_MAXIMIZE);
                        // 修正 rcNormalPosition 为保存的原始值。
                        // 全屏期间 SetWindowPos 将窗口铺满整屏，Windows 据此更新了
                        // rcNormalPosition（还原尺寸）为全屏矩形。若不修正，后续 unmaximize
                        // 时窗口会"还原"到全屏大小，看起来还是最大化。
                        // SetWindowPlacement 会用保存的 placement.rcNormalPosition 更新
                        // 窗口的正常位置，showCmd 仍为 SW_SHOWMAXIMIZED 故窗口保持最大化态。
                        if SetWindowPlacement(hwnd, &placement) == 0 {
                            return Err("SetWindowPlacement 失败".to_string());
                        }
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
                //
                // tao 内部还原尺寸缓存已污染的问题由 smart_toggle_maximize 命令处理：
                // 该命令使用 SAVED_NORMAL_RECT 保存的正确小窗尺寸，通过 SetWindowPlacement
                // 一步恢复正确几何，绕过 tao 的缓存，无需 unmaximize+maximize 造成闪烁。
                if was_maximized {
                    let _ = window.maximize();
                } else {
                    // 退出到小窗状态：清除保存的小窗尺寸（窗口已在正确位置，后续不需要）
                    *SAVED_NORMAL_RECT.lock().map_err(|e| e.to_string())? = None;
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

/// 智能最大化/还原切换。
///
/// 使用 Win32 原生 `IsZoomed` 判断窗口是否最大化（不依赖 tao 内部状态），
/// 避免沉浸式全屏后 tao 的 `is_maximized` 未同步导致判断错误。
///
/// 还原时若 `SAVED_NORMAL_RECT` 有值（退出沉浸式全屏后保留的正确小窗尺寸），
/// 则用 `SetWindowPlacement(SW_SHOWNORMAL)` 一步恢复到正确几何——这是单个 Win32
/// API 调用，同时设置 showCmd 和 rcNormalPosition，不会产生中间帧闪烁。
/// 同时触发 `WM_SIZE(SIZE_RESTORED)` 更新 tao 内部缓存，后续还原不再需要特殊处理。
///
/// 无保存值时（正常使用，未经历全屏）退化为 `window.unmaximize()`。
#[tauri::command]
pub fn smart_toggle_maximize(window: tauri::Window) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = hwnd_of(&window).ok_or_else(|| "无法获取窗口句柄".to_string())?;

        unsafe {
            if IsZoomed(hwnd) != 0 {
                // 当前最大化 → 需要还原
                let saved = SAVED_NORMAL_RECT.lock().map_err(|e| e.to_string())?.take();
                if let Some(normal_rect) = saved {
                    // 沉浸式全屏后首次还原：tao 内部缓存已被全屏矩形污染，
                    // 用 SetWindowPlacement 一步恢复到保存的正确小窗尺寸。
                    // SW_SHOWNORMAL 同时去除 WS_MAXIMIZE 样式并设置 rcNormalPosition，
                    // WM_SIZE(SIZE_RESTORED) 会更新 tao 内部缓存为正确值。
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
                    // 正常还原（未经历全屏，tao 缓存正确）
                    let _ = window.unmaximize();
                }
                Ok(false) // 返回还原后的状态
            } else {
                // 当前非最大化 → 最大化
                let _ = window.maximize();
                Ok(true)
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Err("当前平台不支持".to_string())
    }
}
