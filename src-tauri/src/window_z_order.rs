#[tauri::command]
pub fn refresh_current_window_topmost(window: tauri::Window, enabled: bool) {
    #[cfg(target_os = "windows")]
    {
        refresh_window_topmost(&window, enabled);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, enabled);
    }
}

#[tauri::command]
pub fn start_topmost_guard(window: tauri::Window) {
    #[cfg(target_os = "windows")]
    {
        start_window_topmost_guard(&window);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
    }
}

#[tauri::command]
pub fn stop_topmost_guard() {
    #[cfg(target_os = "windows")]
    {
        stop_window_topmost_guard();
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::sync::{
        atomic::{AtomicIsize, Ordering},
        mpsc, OnceLock,
    };

    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use tauri::Window;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, WPARAM},
        System::Threading::GetCurrentThreadId,
        UI::{
            Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK},
            WindowsAndMessaging::{
                DispatchMessageW, GetAncestor, GetClassNameW, GetMessageW, IsWindow, PeekMessageW,
                PostThreadMessageW, SetWindowPos, TranslateMessage, EVENT_OBJECT_FOCUS,
                EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MENUSTART, GA_ROOT, HWND_NOTOPMOST,
                HWND_TOPMOST, MSG, PM_NOREMOVE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER,
                SWP_NOSENDCHANGING, SWP_NOSIZE, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
                WM_APP,
            },
        },
    };

    static TARGET_HWND: AtomicIsize = AtomicIsize::new(0);
    static HOOK_THREAD: OnceLock<HookThreadHandle> = OnceLock::new();

    const WM_TOPMOST_GUARD_START: u32 = WM_APP + 0x120;
    const WM_TOPMOST_GUARD_STOP: u32 = WM_APP + 0x121;

    pub(super) fn refresh_window_topmost(window: &Window, enabled: bool) {
        if let Some(hwnd) = window_hwnd(window) {
            set_topmost_state(hwnd, enabled);
        }
    }

    pub(super) fn start_window_topmost_guard(window: &Window) {
        let Some(hwnd) = window_hwnd(window) else {
            return;
        };

        TARGET_HWND.store(hwnd as isize, Ordering::SeqCst);
        set_topmost_state(hwnd, true);
        post_guard_thread_message(WM_TOPMOST_GUARD_START);
    }

    pub(super) fn stop_window_topmost_guard() {
        TARGET_HWND.store(0, Ordering::SeqCst);
        post_guard_thread_message(WM_TOPMOST_GUARD_STOP);
    }

    fn window_hwnd(window: &Window) -> Option<HWND> {
        let handle = window.window_handle().ok()?;
        match handle.as_raw() {
            RawWindowHandle::Win32(win32) => Some(win32.hwnd.get() as HWND),
            _ => None,
        }
    }

    fn set_topmost_state(hwnd: HWND, enabled: bool) {
        if hwnd.is_null() {
            return;
        }

        let flags =
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING;

        unsafe {
            if enabled {
                SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, flags);
            } else {
                SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, flags);
            }
        }
    }

    fn post_guard_thread_message(message: u32) {
        let hook_thread = guard_thread();

        unsafe {
            let _ = PostThreadMessageW(hook_thread.thread_id, message, 0 as WPARAM, 0 as LPARAM);
        }
    }

    fn guard_thread() -> &'static HookThreadHandle {
        HOOK_THREAD.get_or_init(|| {
            let (ready_tx, ready_rx) = mpsc::channel();

            std::thread::spawn(move || unsafe {
                run_guard_thread(ready_tx);
            });

            let thread_id = ready_rx
                .recv()
                .expect("topmost guard thread failed to initialize");

            HookThreadHandle { thread_id }
        })
    }

    unsafe fn run_guard_thread(ready_tx: mpsc::Sender<u32>) {
        let thread_id = GetCurrentThreadId();
        let mut msg: MSG = std::mem::zeroed();

        // Force creation of the message queue before other threads start posting messages.
        PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
        let _ = ready_tx.send(thread_id);

        let mut guard: Option<TopMostGuard> = None;

        loop {
            let status = GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0);
            if status <= 0 {
                break;
            }

            match msg.message {
                WM_TOPMOST_GUARD_START => {
                    if let Some(existing_guard) = guard.take() {
                        existing_guard.stop();
                    }

                    let hwnd = TARGET_HWND.load(Ordering::SeqCst) as HWND;
                    if !hwnd.is_null() {
                        guard = TopMostGuard::start(hwnd);
                    }
                }
                WM_TOPMOST_GUARD_STOP => {
                    if let Some(existing_guard) = guard.take() {
                        existing_guard.stop();
                    }
                }
                _ => {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }

        if let Some(existing_guard) = guard.take() {
            existing_guard.stop();
        }
    }

    struct HookThreadHandle {
        thread_id: u32,
    }

    struct TopMostGuard {
        foreground_hook: HWINEVENTHOOK,
        focus_hook: Option<HWINEVENTHOOK>,
        menu_hook: Option<HWINEVENTHOOK>,
    }

    impl TopMostGuard {
        fn start(hwnd: HWND) -> Option<Self> {
            let foreground_hook = unsafe {
                SetWinEventHook(
                    EVENT_SYSTEM_FOREGROUND,
                    EVENT_SYSTEM_FOREGROUND,
                    std::ptr::null_mut(),
                    Some(topmost_guard_event_hook),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
                )
            };

            if foreground_hook.is_null() {
                None
            } else {
                let focus_hook = install_optional_hook(EVENT_OBJECT_FOCUS);
                let menu_hook = install_optional_hook(EVENT_SYSTEM_MENUSTART);
                set_topmost_state(hwnd, true);
                Some(Self {
                    foreground_hook,
                    focus_hook,
                    menu_hook,
                })
            }
        }

        fn stop(self) {
            unsafe {
                UnhookWinEvent(self.foreground_hook);
                if let Some(hook) = self.focus_hook {
                    UnhookWinEvent(hook);
                }
                if let Some(hook) = self.menu_hook {
                    UnhookWinEvent(hook);
                }
            }
        }
    }

    fn install_optional_hook(event: u32) -> Option<HWINEVENTHOOK> {
        let hook = unsafe {
            SetWinEventHook(
                event,
                event,
                std::ptr::null_mut(),
                Some(topmost_guard_event_hook),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )
        };

        if hook.is_null() {
            None
        } else {
            Some(hook)
        }
    }

    unsafe extern "system" fn topmost_guard_event_hook(
        _hook: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        _id_object: i32,
        _id_child: i32,
        _event_thread: u32,
        _event_time: u32,
    ) {
        let target = TARGET_HWND.load(Ordering::SeqCst) as HWND;
        if target.is_null() {
            return;
        }

        if IsWindow(target) == 0 {
            return;
        }

        if !should_refresh_for_event(event, hwnd, target) {
            return;
        }

        set_topmost_state(target, true);
    }

    fn should_refresh_for_event(event: u32, hwnd: HWND, target: HWND) -> bool {
        let source_root = root_window(hwnd);
        if !source_root.is_null() && source_root == target {
            return false;
        }

        match event {
            EVENT_SYSTEM_FOREGROUND => true,
            EVENT_OBJECT_FOCUS | EVENT_SYSTEM_MENUSTART => is_shell_window(source_root),
            _ => false,
        }
    }

    fn root_window(hwnd: HWND) -> HWND {
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

    fn is_shell_window(hwnd: HWND) -> bool {
        let Some(class_name) = window_class_name(hwnd) else {
            return false;
        };

        matches!(
            class_name.as_str(),
            "Shell_TrayWnd"
                | "Shell_SecondaryTrayWnd"
                | "TrayNotifyWnd"
                | "NotifyIconOverflowWindow"
                | "WorkerW"
                | "Progman"
                | "SHELLDLL_DefView"
                | "DV2ControlHost"
        )
    }

    fn window_class_name(hwnd: HWND) -> Option<String> {
        if hwnd.is_null() {
            return None;
        }

        unsafe {
            let mut buffer = [0u16; 256];
            let len = GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
            if len <= 0 {
                return None;
            }

            String::from_utf16(&buffer[..len as usize]).ok()
        }
    }
}

#[cfg(target_os = "windows")]
use platform::{refresh_window_topmost, start_window_topmost_guard, stop_window_topmost_guard};
