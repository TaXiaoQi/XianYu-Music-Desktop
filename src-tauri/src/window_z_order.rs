//! 主窗口置顶守护。
//!
//! 桌面歌词等场景需要窗口保持最前。Windows 上通过 WinEvent 钩子监听
//! 系统前台切换与 Shell 焦点事件，在必要时重新施加 HWND_TOPMOST，
//! 防止任务栏弹出层、开始菜单等把窗口压下去。

/// 开关指定窗口的置顶状态（立即生效，不启动守护）。
#[tauri::command]
pub fn refresh_current_window_topmost(
    window: tauri::Window,
    enabled: bool,
) {
    #[cfg(target_os = "windows")]
    imp::force_z_position(&window, enabled);

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window.set_always_on_top(enabled);
    }
}

/// 对指定窗口启动置顶守护（随前台切换自动补置顶）。
#[tauri::command]
pub fn start_topmost_guard(window: tauri::Window) {
    #[cfg(target_os = "windows")]
    imp::engage_guard(&window);

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
    }
}

/// 停止置顶守护。
#[tauri::command]
pub fn stop_topmost_guard() {
    #[cfg(target_os = "windows")]
    imp::relieve_guard();
}

/// 退出前销毁守护线程（应用关闭时调用）。
pub fn shutdown_topmost_guard() {
    #[cfg(target_os = "windows")]
    imp::dispose_worker();
}

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::{
        atomic::{AtomicIsize, Ordering},
        mpsc, OnceLock,
    };

    use raw_window_handle::{RawWindowHandle, HasWindowHandle};
    use tauri::Window;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, WPARAM},
        System::Threading::GetCurrentThreadId,
        UI::{
            Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent},
            WindowsAndMessaging::{
                DispatchMessageW, GetAncestor, GetClassNameW, GetMessageW, IsWindow,
                PeekMessageW, PostThreadMessageW, SetWindowPos, TranslateMessage,
                EVENT_OBJECT_FOCUS, EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MENUSTART, GA_ROOT,
                HWND_NOTOPMOST, HWND_TOPMOST, MSG, PM_NOREMOVE, SWP_NOACTIVATE, SWP_NOMOVE,
                SWP_NOOWNERZORDER, SWP_NOSENDCHANGING, SWP_NOSIZE, WINEVENT_OUTOFCONTEXT,
                WINEVENT_SKIPOWNPROCESS, WM_APP,
            },
        },
    };

    /// 正在守护的目标窗口句柄；0 表示守护未启用。
    static TARGET_HWND_CELL: AtomicIsize = AtomicIsize::new(0);
    /// 守护线程（惰性创建，进程生命周期内复用）。
    static WORKER_CELL: OnceLock<WorkerTicket> = OnceLock::new();

    /// 守护线程的自定义控制消息。
    const CTRL_ENGAGE: u32 = WM_APP + 0x120;
    const CTRL_RELIEVE: u32 = WM_APP + 0x121;
    /// 让守护线程退出的消息（WM_QUIT）。
    const CTRL_EXIT: u32 = 0x0012;

    /// 守护线程句柄。
    struct WorkerTicket {
        thread_id: u32,
    }

    /// 一次守护会话持有的 WinEvent 钩子集合。
    struct HookBundle {
        handles: Vec<HWINEVENTHOOK>,
    }

    impl HookBundle {
        /// 为目标窗口建立事件钩子并立即置顶一次。
        /// 前台切换钩子安装失败时放弃整个会话。
        fn raise(target: HWND) -> Self {
            let mut handles: Vec<HWINEVENTHOOK> = Vec::new();
            let foreground_hook = hook_single_event(EVENT_SYSTEM_FOREGROUND);
            if !foreground_hook.is_null() {
                handles.push(foreground_hook);
                let extras = [EVENT_OBJECT_FOCUS, EVENT_SYSTEM_MENUSTART];
                for wanted in extras {
                    let extra_hook = hook_single_event(wanted);
                    if !extra_hook.is_null() {
                        handles.push(extra_hook);
                    }
                }
                reassert_topmost(target, true);
            }
            Self { handles }
        }

        /// 释放全部钩子。
        fn drop_all(mut self) {
            while let Some(hook) = self.handles.pop() {
                unsafe { UnhookWinEvent(hook) };
            }
        }
    }

    pub(super) fn force_z_position(window: &Window, enabled: bool) {
        if let Some(hwnd) = resolve_hwnd(window) {
            reassert_topmost(hwnd, enabled);
        }
    }

    pub(super) fn engage_guard(window: &Window) {
        let Some(hwnd) = resolve_hwnd(window) else {
            return;
        };

        TARGET_HWND_CELL.store(hwnd as isize, Ordering::SeqCst);
        reassert_topmost(hwnd, true);
        send_worker_ctrl(CTRL_ENGAGE);
    }

    pub(super) fn relieve_guard() {
        TARGET_HWND_CELL.store(0, Ordering::SeqCst);
        send_worker_ctrl(CTRL_RELIEVE);
    }

    pub(super) fn dispose_worker() {
        if let Some(ticket) = WORKER_CELL.get() {
            unsafe {
                let _ = PostThreadMessageW(ticket.thread_id, CTRL_EXIT, 0 as WPARAM, 0 as LPARAM);
            }
        }
    }

    /// 从 Tauri 窗口解析 Win32 句柄。
    fn resolve_hwnd(window: &Window) -> Option<HWND> {
        let Ok(handle) = window.window_handle() else {
            return None;
        };
        match handle.as_raw() {
            RawWindowHandle::Win32(win32) => Some(win32.hwnd.get() as HWND),
            _ => None,
        }
    }

    /// 施加或取消置顶。不动位置尺寸、不抢焦点、不改属主层级。
    fn reassert_topmost(hwnd: HWND, topmost: bool) {
        if hwnd.is_null() {
            return;
        }

        let insert_after = if topmost { HWND_TOPMOST } else { HWND_NOTOPMOST };
        let keep_geometry = SWP_NOSIZE
            | SWP_NOMOVE
            | SWP_NOACTIVATE
            | SWP_NOSENDCHANGING
            | SWP_NOOWNERZORDER;

        unsafe {
            SetWindowPos(hwnd, insert_after, 0, 0, 0, 0, keep_geometry);
        }
    }

    /// 安装单个事件范围的 WinEvent 钩子；失败返回空句柄。
    fn hook_single_event(event: u32) -> HWINEVENTHOOK {
        unsafe {
            SetWinEventHook(
                event,
                event,
                std::ptr::null_mut(),
                Some(shell_win_event_proc),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )
        }
    }

    /// 向守护线程投递控制消息（线程尚未创建时先惰性拉起）。
    fn send_worker_ctrl(message: u32) {
        let ticket = obtain_worker();

        unsafe {
            let _ = PostThreadMessageW(ticket.thread_id, message, 0 as WPARAM, 0 as LPARAM);
        }
    }

    fn obtain_worker() -> &'static WorkerTicket {
        WORKER_CELL.get_or_init(|| {
            let (ready_tx, ready_rx) = mpsc::channel();

            std::thread::spawn(move || unsafe {
                pump_messages(ready_tx);
            });

            let thread_id = ready_rx.recv().unwrap_or_else(|_| {
                eprintln!("[window_z_order] 置顶守护线程未能启动，本次运行退化为无守护模式");
                0
            });

            WorkerTicket { thread_id }
        })
    }

    /// 守护线程主循环：先回报线程 ID，再处理启停控制消息。
    unsafe fn pump_messages(ready: mpsc::Sender<u32>) {
        let self_id = GetCurrentThreadId();
        let mut msg: MSG = std::mem::zeroed();

        // 预触发消息队列创建，确保 PostThreadMessageW 不会因队列未建而丢失
        PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
        let _ = ready.send(self_id);

        let mut bundle: Option<HookBundle> = None;

        loop {
            if GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) <= 0 {
                break;
            }
            match msg.message {
                CTRL_ENGAGE => {
                    if let Some(old) = bundle.take() {
                        old.drop_all();
                    }
                    let hwnd = TARGET_HWND_CELL.load(Ordering::SeqCst) as HWND;
                    if !hwnd.is_null() {
                        bundle = Some(HookBundle::raise(hwnd));
                    }
                }
                CTRL_RELIEVE => {
                    if let Some(old) = bundle.take() {
                        old.drop_all();
                    }
                }
                _ => {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }

        if let Some(old) = bundle.take() {
            old.drop_all();
        }
    }

    /// WinEvent 回调：命中关注事件时为目标窗口重新置顶。
    unsafe extern "system" fn shell_win_event_proc(
        _hook: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        _id_object: i32,
        _id_child: i32,
        _event_thread: u32,
        _event_time: u32,
    ) {
        let target = TARGET_HWND_CELL.load(Ordering::SeqCst) as HWND;
        if target.is_null() {
            return;
        }
        if IsWindow(target) == 0 {
            return;
        }

        if !event_calls_for_refresh(event, hwnd, target) {
            return;
        }

        reassert_topmost(target, true);
    }

    /// 判断事件是否需要刷新置顶：
    /// 前台切换必刷；焦点/菜单事件仅当来源是 Shell 表面（任务栏、开始菜单等）时刷新。
    fn event_calls_for_refresh(event: u32, hwnd: HWND, target: HWND) -> bool {
        let source_root = root_owner_window(hwnd);
        if !source_root.is_null() && source_root == target {
            return false; // 目标窗口自身引发的事件
        }

        match event {
            EVENT_SYSTEM_FOREGROUND => true,
            EVENT_OBJECT_FOCUS | EVENT_SYSTEM_MENUSTART => shell_class_hit(source_root),
            _ => false,
        }
    }

    /// 取窗口的根属主窗口。
    fn root_owner_window(hwnd: HWND) -> HWND {
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

    /// 可能压住目标窗口的系统 Shell 表面类名。
    const SHELL_CLASS_NAMES: [&str; 8] = [
        "Shell_TrayWnd",
        "Shell_SecondaryTrayWnd",
        "TrayNotifyWnd",
        "NotifyIconOverflowWindow",
        "WorkerW",
        "Progman",
        "SHELLDLL_DefView",
        "DV2ControlHost",
    ];

    /// 判断窗口是否属于系统 Shell 表面。
    fn shell_class_hit(hwnd: HWND) -> bool {
        let Some(class_name) = window_class_text(hwnd) else {
            return false;
        };

        SHELL_CLASS_NAMES.contains(&class_name.as_str())
    }

    /// 读取窗口类名。
    fn window_class_text(hwnd: HWND) -> Option<String> {
        if hwnd.is_null() {
            return None;
        }

        unsafe {
            let mut scratch = [0u16; 256];
            let len = GetClassNameW(hwnd, scratch.as_mut_ptr(), scratch.len() as i32);
            if len <= 0 {
                return None;
            }

            String::from_utf16(&scratch[..len as usize]).ok()
        }
    }
}
