//! 任务栏迷你播放器窗口管理。
//!
//! - [`setup_taskbar_window`]：把隐藏的 taskbar-player 窗口挂到 Shell_TrayWnd
//!   名下，使其不出现在 Alt-Tab 与任务栏按钮中；
//! - [`get_taskbar_tray_geometry`]：探测任务栏与托盘通知区的物理矩形，供前端定位；
//! - 置顶看护：系统前台切换时保持迷你播放器窗口 TOPMOST。

use std::sync::atomic::{AtomicIsize, Ordering};

/// 最近一次成功绑定的任务栏（Shell_TrayWnd）窗口句柄；0 表示尚未绑定。
pub static LAST_TASKBAR_HWND: AtomicIsize =
    AtomicIsize::new(0);

/// 承担任务栏迷你播放器职责的隐藏窗口标签。
const PLAYER_WINDOW_LABEL: &str = "taskbar-player";

/// 迷你窗口与任务栏的绑定结果。
#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OwnerBindingState { Bound, Failed, Unsupported, AlreadyBound }

/// 几何信息来源：托盘子窗口或任务栏兜底。
#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GeometrySource { Tray, TaskbarFallback }

/// 物理像素坐标下的矩形。
#[derive(serde::Serialize, Clone, Copy, Debug)]
pub struct RectPhysical {
    pub left: i32, pub top: i32,
    pub right: i32, pub bottom: i32,
}

/// 任务栏与托盘通知区的一次探测结果。
#[derive(serde::Serialize, Clone, Debug)]
pub struct TaskbarTrayGeometry {
    pub taskbar_rect_physical: RectPhysical,
    pub tray_rect_physical: Option<RectPhysical>,
    pub taskbar_hwnd_changed: bool,
    pub owner_binding: OwnerBindingState,
    pub source: GeometrySource,
    pub scale_factor: f64,
}

/// 把任务栏迷你播放器窗口绑定为任务栏子窗口，并追加工具窗口样式。
#[tauri::command]
pub fn setup_taskbar_window(
    app: tauri::AppHandle,
) -> OwnerBindingState {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager as _;

        let Some(window) = app.get_webview_window(PLAYER_WINDOW_LABEL) else {
            return OwnerBindingState::Unsupported;
        };
        let Some(hwnd) = resolve_webview_hwnd(&window) else {
            return OwnerBindingState::Unsupported;
        };

        unsafe {
            // owner 重绑会触发系统重新枚举任务栏归属，必须先于工具窗口样式执行：
            // 若顺序颠倒，toolwindow 可能残留一个不可激活的任务栏按钮
            let tray = find_shell_tray();
            if !tray.is_null() && reattach_owner(hwnd, tray) {
                LAST_TASKBAR_HWND.store(tray as isize, Ordering::SeqCst);
            }
            stamp_toolwindow_styles(hwnd);
        }

        if LAST_TASKBAR_HWND.load(Ordering::SeqCst) != 0 {
            OwnerBindingState::Bound
        } else {
            OwnerBindingState::Failed
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        OwnerBindingState::Unsupported
    }
}

/// 查询任务栏与托盘通知区的物理几何信息。
#[tauri::command]
pub fn get_taskbar_tray_geometry(
    app: tauri::AppHandle,
) -> Result<TaskbarTrayGeometry, String> {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager as _;

        let window = app
            .get_webview_window(PLAYER_WINDOW_LABEL)
            .ok_or_else(|| "Taskbar player window not found".to_string())?;

        let tray = find_shell_tray();
        if tray.is_null() {
            return Err("Taskbar window not found".to_string());
        }

        // 任务栏窗口句柄变化（如 explorer 重启）时需要重新绑定 owner
        let stored = LAST_TASKBAR_HWND.load(Ordering::SeqCst);
        let mut hwnd_changed = false;
        let mut binding = OwnerBindingState::AlreadyBound;

        if stored != tray as isize {
            hwnd_changed = true;
            match resolve_webview_hwnd(&window) {
                Some(hwnd) => unsafe {
                    if reattach_owner(hwnd, tray) {
                        binding = OwnerBindingState::Bound;
                        LAST_TASKBAR_HWND.store(tray as isize, Ordering::SeqCst);
                    } else {
                        binding = OwnerBindingState::Failed;
                    }
                    stamp_toolwindow_styles(hwnd);
                },
                None => binding = OwnerBindingState::Unsupported,
            }
        }

        let taskbar_rect = measure_taskbar_rect(tray);
        let tray_rect = measure_tray_notify_rect(tray);

        Ok(TaskbarTrayGeometry {
            taskbar_rect_physical: taskbar_rect,
            tray_rect_physical: tray_rect,
            taskbar_hwnd_changed: hwnd_changed,
            owner_binding: binding,
            source: if tray_rect.is_some() {
                GeometrySource::Tray
            } else {
                GeometrySource::TaskbarFallback
            },
            scale_factor: window.as_ref().window().scale_factor().unwrap_or(1.0),
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Unsupported OS".to_string())
    }
}

/// 开启迷你播放器置顶看护。
#[tauri::command]
pub fn install_taskbar_zorder_guard(
    app: tauri::AppHandle,
) -> bool {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager as _;

        match app
            .get_webview_window(PLAYER_WINDOW_LABEL)
            .and_then(|window| resolve_webview_hwnd(&window))
        {
            Some(hwnd) => {
                zorder_watch::enroll(hwnd as isize);
                true
            }
            None => false,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        false
    }
}

/// 手动触发一次迷你播放器置顶刷新。
#[tauri::command]
pub fn refresh_taskbar_window_topmost(
    app: tauri::AppHandle,
) -> bool {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager as _;

        match app
            .get_webview_window(PLAYER_WINDOW_LABEL)
            .and_then(|window| resolve_webview_hwnd(&window))
        {
            Some(hwnd) => {
                zorder_watch::nudge(hwnd as isize);
                true
            }
            None => false,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        false
    }
}

/// 关闭置顶看护（解绑事件钩子）。
#[tauri::command]
pub fn uninstall_taskbar_zorder_guard() {
    #[cfg(target_os = "windows")]
    {
        zorder_watch::withdraw();
    }
}

/// 应用退出时终结看护线程。
pub fn shutdown_taskbar_zorder_guard() {
    #[cfg(target_os = "windows")]
    {
        zorder_watch::terminate();
    }
}

// ==================== Windows 平台实现 ====================

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::HWND as TrayHwnd;

/// 把文本转成带 NUL 终止符的 UTF-16 序列。
#[cfg(target_os = "windows")]
fn wide0(text: &str) -> Vec<u16> {
    let mut units: Vec<u16> = text.encode_utf16().collect();
    units.push(0);
    units
}

/// 查找主任务栏窗口（Shell_TrayWnd）。
#[cfg(target_os = "windows")]
fn find_shell_tray() -> TrayHwnd {
    use windows_sys::Win32::UI::WindowsAndMessaging::FindWindowW;

    let class = wide0("Shell_TrayWnd");
    unsafe { FindWindowW(class.as_ptr(), std::ptr::null()) }
}

/// 从 Tauri 窗口解析 Win32 句柄。
#[cfg(target_os = "windows")]
fn resolve_webview_hwnd(window: &tauri::WebviewWindow) -> Option<TrayHwnd> {
    use raw_window_handle::{RawWindowHandle, HasWindowHandle};

    let borrowed = window.as_ref().window();
    let Ok(handle) = borrowed.window_handle() else {
        return None;
    };
    match handle.as_raw() {
        RawWindowHandle::Win32(win32) => Some(win32.hwnd.get() as TrayHwnd),
        _ => None,
    }
}

/// 把窗口 owner 改绑到目标窗口，返回是否成功。
///
/// 判定规则：SetWindowLongPtrW 返回非 0 即成功；返回 0 时若 GetLastError
/// 亦为 0（首次绑定时原 owner 为空），同样视为成功。
#[cfg(target_os = "windows")]
unsafe fn reattach_owner(hwnd: TrayHwnd, owner: TrayHwnd) -> bool {
    use windows_sys::Win32::Foundation::{GetLastError, SetLastError};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GWLP_HWNDPARENT, SetWindowLongPtrW};

    SetLastError(0);
    let previous = SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, owner as isize);
    previous != 0 || GetLastError() == 0
}

/// 追加 WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE，隐藏任务栏按钮且禁止激活。
#[cfg(target_os = "windows")]
unsafe fn stamp_toolwindow_styles(hwnd: TrayHwnd) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowLongW, SetWindowLongW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
    SetWindowLongW(
        hwnd,
        GWL_EXSTYLE,
        ex_style | WS_EX_TOOLWINDOW as i32 | WS_EX_NOACTIVATE as i32,
    );
}

/// 读取任务栏矩形：优先 SHAppBarMessage(ABM_GETTASKBARPOS)，失败退回 GetWindowRect。
#[cfg(target_os = "windows")]
fn measure_taskbar_rect(tray: TrayHwnd) -> RectPhysical {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::Shell::{ABM_GETTASKBARPOS, APPBARDATA, SHAppBarMessage};
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };

    unsafe {
        let mut data = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: tray,
            uCallbackMessage: 0,
            uEdge: 0,
            rc: RECT { left: 0, top: 0, right: 0, bottom: 0 },
            lParam: 0,
        };

        if SHAppBarMessage(ABM_GETTASKBARPOS, &mut data) != 0 {
            rect = data.rc;
        } else {
            GetWindowRect(tray, &mut rect);
        }
    }

    RectPhysical { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

/// 在任务栏子窗口树中定位托盘通知区（TrayNotifyWnd）并读取其矩形。
#[cfg(target_os = "windows")]
fn measure_tray_notify_rect(tray: TrayHwnd) -> Option<RectPhysical> {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let target_class: Vec<u16> = "TrayNotifyWnd".encode_utf16().collect();
    let mut budget: u32 = 0;
    let hit = hunt_child_class(tray, &target_class, 3, &mut budget)?;

    let mut rect = windows_sys::Win32::Foundation::RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    let ok = unsafe { GetWindowRect(hit, &mut rect) } != 0;
    ok.then_some(RectPhysical {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    })
}

/// 深度优先搜索指定类名的子窗口（前序遍历，取首个命中）。
/// 约束：整棵树最多访问 64 个节点，且搜索深度不超过传入的 depth_left。
#[cfg(target_os = "windows")]
fn hunt_child_class(
    hwnd: TrayHwnd,
    expected_class: &[u16],
    depth_left: u32,
    budget: &mut u32,
) -> Option<TrayHwnd> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GW_CHILD, GW_HWNDNEXT, GetWindow};

    if hwnd.is_null() {
        return None;
    }

    *budget += 1;
    if *budget > 64 {
        return None;
    }

    if class_equals(hwnd, expected_class) {
        return Some(hwnd);
    }

    if depth_left == 0 {
        return None;
    }

    let mut child = unsafe { GetWindow(hwnd, GW_CHILD) };
    while !child.is_null() {
        if let Some(hit) = hunt_child_class(child, expected_class, depth_left - 1, budget) {
            return Some(hit);
        }
        child = unsafe { GetWindow(child, GW_HWNDNEXT) };
    }

    None
}

/// 窗口类名是否与目标 UTF-16 序列完全一致。
#[cfg(target_os = "windows")]
fn class_equals(hwnd: TrayHwnd, expected: &[u16]) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW;

    let mut scratch = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, scratch.as_mut_ptr(), scratch.len() as i32) };
    len > 0 && &scratch[..len as usize] == expected
}

/// 迷你播放器置顶看护。
///
/// 监听系统前台切换与 Shell 焦点事件，必要时重新施加 TOPMOST，
/// 抵御开始菜单、任务栏弹出层等对 Z 序的压制。
#[cfg(target_os = "windows")]
mod zorder_watch {
    use std::sync::atomic::{AtomicIsize, AtomicU64, Ordering};
    use std::sync::{mpsc, OnceLock};
    use std::time::Duration;

    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetAncestor, GetMessageW, GetClassNameW, IsWindow, PeekMessageW,
        PostThreadMessageW, SetWindowPos, TranslateMessage, GA_ROOT, HWND_TOPMOST, MSG,
        PM_NOREMOVE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSENDCHANGING,
        SWP_NOSIZE, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_APP,
    };

    /// 当前看护的迷你播放器窗口句柄。
    pub static WATCHED_PLAYER: AtomicIsize = AtomicIsize::new(0);
    /// 刷新代号：新请求出现即作废仍在排队的旧补刷序列。
    static REFRESH_EPOCH: AtomicU64 = AtomicU64::new(0);

    /// 看护线程控制消息。
    const CTRL_ENROLL: u32 = WM_APP + 0x200;
    const CTRL_WITHDRAW: u32 = WM_APP + 0x201;
    /// 终结看护线程的消息（WM_QUIT）。
    const CTRL_TERMINATE: u32 = 0x0012;

    /// 关注的 WinEvent：前台切换（0x0003）、菜单弹出（0x0004）、焦点转移（0x8005）。
    const EV_FOREGROUND_SWITCH: u32 = 0x0003;
    const EV_MENU_POPUP: u32 = 0x0004;
    const EV_FOCUS_MOVE: u32 = 0x8005;

    /// 事件触发后的补刷延迟序列（毫秒），覆盖系统动画落定的各种时序。
    const RECHECK_LADDER_MS: [u64; 4] = [40, 120, 300, 700];

    /// 可能压住迷你窗口的系统 Shell 表面类名。
    const SHELL_SURFACE_CLASSES: [&str; 8] = [
        "Shell_TrayWnd",
        "Shell_SecondaryTrayWnd",
        "TrayNotifyWnd",
        "NotifyIconOverflowWindow",
        "WorkerW",
        "Progman",
        "SHELLDLL_DefView",
        "DV2ControlHost",
    ];

    /// 看护线程句柄。
    struct WatchTicket {
        thread_id: u32,
    }

    static WATCH: OnceLock<WatchTicket> = OnceLock::new();

    /// 登记看护目标并启动事件监听。
    pub fn enroll(player_hwnd: isize) {
        WATCHED_PLAYER.store(player_hwnd, Ordering::Relaxed);
        kick_recheck(player_hwnd as HWND);

        let ticket = watch_ticket();
        unsafe {
            PostThreadMessageW(ticket.thread_id, CTRL_ENROLL, 0, 0);
        }
    }

    /// 立即补一次置顶（不改动钩子状态）。
    pub fn nudge(player_hwnd: isize) {
        kick_recheck(player_hwnd as HWND);
    }

    /// 解除看护：卸载钩子并清空目标。
    pub fn withdraw() {
        match WATCH.get() {
            Some(ticket) => unsafe {
                PostThreadMessageW(ticket.thread_id, CTRL_WITHDRAW, 0, 0);
            },
            None => WATCHED_PLAYER.store(0, Ordering::Relaxed),
        }
    }

    /// 应用退出时终结看护线程。
    pub fn terminate() {
        if let Some(ticket) = WATCH.get() {
            unsafe {
                PostThreadMessageW(ticket.thread_id, CTRL_TERMINATE, 0, 0);
            }
        }
    }

    /// 惰性拉起看护线程（消息循环线程，进程生命周期内复用）。
    fn watch_ticket() -> &'static WatchTicket {
        WATCH.get_or_init(|| {
            let (ready_tx, ready_rx) = mpsc::channel::<u32>();

            std::thread::spawn(move || unsafe {
                service_loop(ready_tx);
            });

            let thread_id = ready_rx.recv().unwrap_or_else(|_| {
                eprintln!("[taskbar] 迷你播放器置顶看护线程未能启动，功能降级运行");
                0
            });
            WatchTicket { thread_id }
        })
    }

    /// 看护线程主循环：先回报线程 ID，再处理登记/解除控制消息。
    unsafe fn service_loop(ready: mpsc::Sender<u32>) {
        let self_id = GetCurrentThreadId();
        let mut msg: MSG = std::mem::zeroed();

        // 预触发消息队列创建，避免 PostThreadMessageW 丢失首个控制消息
        PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
        let _ = ready.send(self_id);

        let mut hooks: Vec<HWINEVENTHOOK> = Vec::new();

        loop {
            if GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) <= 0 {
                break;
            }
            match msg.message {
                CTRL_ENROLL => {
                    drop_hooks(&mut hooks);
                    let wanted = [
                        EV_FOREGROUND_SWITCH,
                        EV_FOCUS_MOVE,
                        EV_MENU_POPUP,
                    ];
                    hooks = wanted.into_iter().filter_map(subscribe_hook).collect();
                }
                CTRL_WITHDRAW => {
                    drop_hooks(&mut hooks);
                    WATCHED_PLAYER.store(0, Ordering::Relaxed);
                }
                _ => {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }

        drop_hooks(&mut hooks);
    }

    /// 为单个事件安装钩子；安装失败返回 None。
    fn subscribe_hook(event: u32) -> Option<HWINEVENTHOOK> {
        let hook = unsafe {
            SetWinEventHook(
                event,
                event,
                std::ptr::null_mut(),
                Some(shell_event_proc),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )
        };

        (!hook.is_null()).then_some(hook)
    }

    /// 卸载全部已安装的钩子。
    fn drop_hooks(hooks: &mut Vec<HWINEVENTHOOK>) {
        for hook in hooks.drain(..) {
            unsafe { UnhookWinEvent(hook) };
        }
    }

    /// WinEvent 回调：按事件类型决定是否需要补刷置顶。
    unsafe extern "system" fn shell_event_proc(
        _hook: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        _id_object: i32,
        _id_child: i32,
        _event_thread: u32,
        _event_time: u32,
    ) {
        let player = WATCHED_PLAYER.load(Ordering::Relaxed) as HWND;
        if player.is_null() || IsWindow(player) == 0 {
            return;
        }

        // 迷你窗口自身引发的事件不做处理，避免自我触发循环
        let source_root = root_owner(hwnd);
        if !source_root.is_null() && source_root == player {
            return;
        }

        let interesting = match event {
            EV_FOREGROUND_SWITCH => true,
            EV_FOCUS_MOVE | EV_MENU_POPUP => shell_surface_hit(source_root),
            _ => false,
        };

        if interesting {
            kick_recheck(player);
        }
    }

    /// 立即刷新一次，并在后台按延迟序列补刷，覆盖动画落定后的时序竞态。
    fn kick_recheck(player: HWND) {
        let serial = REFRESH_EPOCH.fetch_add(1, Ordering::Relaxed) + 1;
        enforce_topmost(player);

        let player_value = player as isize;
        std::thread::spawn(move || {
            for delay in RECHECK_LADDER_MS {
                std::thread::sleep(Duration::from_millis(delay));
                if REFRESH_EPOCH.load(Ordering::Relaxed) != serial {
                    return; // 已有更新的刷新请求接管
                }
                enforce_topmost(player_value as HWND);
            }
        });
    }

    /// 施加 TOPMOST（不动位置尺寸、不抢焦点、不改属主层级）。
    fn enforce_topmost(player: HWND) {
        if player.is_null() {
            return;
        }

        unsafe {
            if IsWindow(player) == 0 {
                return;
            }

            SetWindowPos(
                player,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOSIZE
                    | SWP_NOMOVE
                    | SWP_NOACTIVATE
                    | SWP_NOOWNERZORDER
                    | SWP_NOSENDCHANGING,
            );
        }
    }

    /// 取窗口的根属主窗口。
    fn root_owner(hwnd: HWND) -> HWND {
        if hwnd.is_null() {
            return hwnd;
        }

        unsafe {
            let root = GetAncestor(hwnd, GA_ROOT);
            if root.is_null() {
                hwnd
            } else {
                root
            }
        }
    }

    /// 判断窗口是否为系统 Shell 表面（任务栏、开始菜单、桌面层等）。
    fn shell_surface_hit(hwnd: HWND) -> bool {
        if hwnd.is_null() {
            return false;
        }

        unsafe {
            let mut scratch = [0u16; 256];
            let len = GetClassNameW(hwnd, scratch.as_mut_ptr(), scratch.len() as i32);
            if len <= 0 {
                return false;
            }

            let class = String::from_utf16_lossy(&scratch[..len as usize]);
            SHELL_SURFACE_CLASSES.contains(&class.as_str())
        }
    }
}
