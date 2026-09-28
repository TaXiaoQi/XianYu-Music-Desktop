//! 迷你播放器窗口辅助层：拖拽范围限制与沉浸式全屏的消息处理。
//!
//! 通过 Win32 子类机制接管窗口过程：
//! - `WM_MOVING`：把拖动目标矩形钳制进所在显示器的工作区；
//! - `WM_NCCALCSIZE`：沉浸式全屏期间返回 0，让客户区铺满整个窗口。

use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITOR_DEFAULTTONEAREST, MONITORINFO,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{WM_MOVING, WM_NCCALCSIZE};

/// 迷你播放器拖拽限制是否开启。
static DRAG_LIMIT_ACTIVE: AtomicBool = AtomicBool::new(false);

/// 沉浸式全屏是否开启（开关由 window_fullscreen 模块维护）。
pub static FULLSCREEN_ENABLED: AtomicBool = AtomicBool::new(false);

/// 子类槽位号，进程内保持唯一即可。
#[cfg(target_os = "windows")]
const DRAG_HOOK_SLOT: usize = 1001;

/// 单轴收拢：先把起点贴向下限，若终点越上限再改为贴上限。
/// 两步顺序与"先左后右 / 先上后下"的逐边钳制次序完全等价。
#[cfg(target_os = "windows")]
fn fit_axis(start: i32, end: i32, lo: i32, hi: i32) -> (i32, i32) {
    let span = end - start;
    let (moved_start, moved_end) = if start < lo {
        (lo, lo + span)
    } else {
        (start, end)
    };
    if moved_end > hi {
        (hi - span, hi)
    } else {
        (moved_start, moved_end)
    }
}

/// 把拖动中的窗口矩形整体拉回工作区，宽高保持不变。
#[cfg(target_os = "windows")]
fn pull_rect_into_work_area(target: &mut RECT, area: &RECT) {
    let (left, right) = fit_axis(target.left, target.right, area.left, area.right);
    target.left = left;
    target.right = right;
    let (top, bottom) = fit_axis(target.top, target.bottom, area.top, area.bottom);
    target.top = top;
    target.bottom = bottom;
}

/// 取窗口所在（最近）显示器的工作区矩形；查询失败时返回 None。
#[cfg(target_os = "windows")]
fn nearest_work_area(window: HWND) -> Option<RECT> {
    let monitor = unsafe { MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST) };
    let zero_rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    let mut details = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        rcMonitor: zero_rect,
        rcWork: zero_rect,
        dwFlags: 0,
    };
    let ok = unsafe { GetMonitorInfoW(monitor, &mut details) };
    if ok != 0 {
        Some(details.rcWork)
    } else {
        None
    }
}

/// 子类过程：全屏时抹平非客户区计算，拖动时执行工作区约束，其余消息放行。
#[cfg(target_os = "windows")]
unsafe extern "system" fn drag_and_fullscreen_hook(
    window: HWND,
    message: u32,
    w_param: WPARAM,
    l_param: LPARAM,
    _slot: usize,
    _context: usize,
) -> LRESULT {
    match message {
        // wparam 为 1 表示正在计算非客户区尺寸，返回 0 即可让内容铺满窗口
        WM_NCCALCSIZE if w_param == 1 && FULLSCREEN_ENABLED.load(Ordering::Relaxed) => 0,
        WM_MOVING if DRAG_LIMIT_ACTIVE.load(Ordering::Relaxed) => {
            let target = &mut *(l_param as *mut RECT);
            if let Some(area) = nearest_work_area(window) {
                pull_rect_into_work_area(target, &area);
            }
            0
        }
        _ => DefSubclassProc(window, message, w_param, l_param),
    }
}

/// 为窗口安装边界约束子类（启动阶段对迷你播放器窗口调用一次）。
#[cfg(target_os = "windows")]
pub fn install_boundary_subclass(hwnd: isize) {
    let _ = unsafe {
        SetWindowSubclass(
            hwnd as HWND,
            Some(drag_and_fullscreen_hook),
            DRAG_HOOK_SLOT,
            0,
        )
    };
}

/// Tauri 命令：开关迷你播放器的拖拽边界约束。
#[tauri::command]
pub fn set_mini_boundary_enabled(enabled: bool) {
    DRAG_LIMIT_ACTIVE.store(enabled, Ordering::Relaxed);
}
