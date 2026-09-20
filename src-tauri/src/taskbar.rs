use std::sync::atomic::{AtomicIsize, Ordering};

pub static LAST_TASKBAR_HWND: AtomicIsize = AtomicIsize::new(0);
const TASKBAR_PLAYER_WINDOW_LABEL: &str = "taskbar-player";

#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OwnerBindingState {
    Bound,
    Failed,
    Unsupported,
    AlreadyBound,
}

#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GeometrySource {
    Tray,
    TaskbarFallback,
}

#[derive(serde::Serialize, Clone, Copy, Debug)]
pub struct RectPhysical {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct TaskbarTrayGeometry {
    pub taskbar_rect_physical: RectPhysical,
    pub tray_rect_physical: Option<RectPhysical>,
    pub taskbar_hwnd_changed: bool,
    pub owner_binding: OwnerBindingState,
    pub source: GeometrySource,
    pub scale_factor: f64,
}

#[cfg(target_os = "windows")]
fn find_window_recursive(
    hwnd: windows_sys::Win32::Foundation::HWND,
    target_class_utf16: &[u16],
    current_depth: u32,
    max_depth: u32,
    node_count: &mut u32,
) -> windows_sys::Win32::Foundation::HWND {
    if hwnd.is_null() {
        return std::ptr::null_mut();
    }
    *node_count += 1;
    if *node_count > 64 {
        return std::ptr::null_mut();
    }

    let mut class_name = [0u16; 256];
    let len = unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW(
            hwnd,
            class_name.as_mut_ptr(),
            class_name.len() as i32,
        )
    };
    if len > 0 {
        let actual_len = len as usize;
        if actual_len == target_class_utf16.len() && &class_name[..actual_len] == target_class_utf16
        {
            return hwnd;
        }
    }

    if current_depth >= max_depth {
        return std::ptr::null_mut();
    }

    let mut child = unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::GetWindow(
            hwnd,
            windows_sys::Win32::UI::WindowsAndMessaging::GW_CHILD,
        )
    };
    while !child.is_null() {
        let found = find_window_recursive(
            child,
            target_class_utf16,
            current_depth + 1,
            max_depth,
            node_count,
        );
        if !found.is_null() {
            return found;
        }
        child = unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::GetWindow(
                child,
                windows_sys::Win32::UI::WindowsAndMessaging::GW_HWNDNEXT,
            )
        };
    }

    std::ptr::null_mut()
}

#[tauri::command]
pub fn setup_taskbar_window(app: tauri::AppHandle) -> OwnerBindingState {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use tauri::Manager;
        use windows_sys::Win32::Foundation::{GetLastError, SetLastError, HWND};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowW, GetWindowLongW, SetWindowLongPtrW, SetWindowLongW, GWLP_HWNDPARENT,
            GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        };

        if let Some(window) = app.get_webview_window(TASKBAR_PLAYER_WINDOW_LABEL) {
            if let Ok(handle) = window.as_ref().window().window_handle() {
                if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                    let hwnd = win32.hwnd.get() as HWND;

                    unsafe {
                        // 先设 owner（GWLP_HWNDPARENT 修改会触发系统重新枚举窗口的
                        // 任务栏归属，若放最后会让 toolwindow 残留一个不可激活的
                        // 任务栏按钮）；随后再补工具窗口样式，保证最终无任务栏按钮
                        let shell_tray_class: Vec<u16> =
                            "Shell_TrayWnd\0".encode_utf16().collect();
                        let hwnd_taskbar =
                            FindWindowW(shell_tray_class.as_ptr(), std::ptr::null());

                        if !hwnd_taskbar.is_null() {
                            SetLastError(0);
                            let prev = SetWindowLongPtrW(
                                hwnd,
                                GWLP_HWNDPARENT,
                                hwnd_taskbar as isize,
                            );
                            if prev == 0 {
                                let err = GetLastError();
                                if err == 0 {
                                    LAST_TASKBAR_HWND.store(
                                        hwnd_taskbar as isize,
                                        Ordering::SeqCst,
                                    );
                                }
                            } else {
                                LAST_TASKBAR_HWND
                                    .store(hwnd_taskbar as isize, Ordering::SeqCst);
                            }
                        }

                        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                        SetWindowLongW(
                            hwnd,
                            GWL_EXSTYLE,
                            ex_style | WS_EX_TOOLWINDOW as i32 | WS_EX_NOACTIVATE as i32,
                        );
                    }

                    let last = LAST_TASKBAR_HWND.load(Ordering::SeqCst);
                    if last != 0 {
                        return OwnerBindingState::Bound;
                    }
                    return OwnerBindingState::Failed;
                }
            }
        }
        OwnerBindingState::Unsupported
    }
    #[cfg(not(target_os = "windows"))]
    {
        OwnerBindingState::Unsupported
    }
}

#[tauri::command]
pub fn get_taskbar_tray_geometry(app: tauri::AppHandle) -> Result<TaskbarTrayGeometry, String> {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use tauri::Manager;
        use windows_sys::Win32::Foundation::{GetLastError, SetLastError, HWND, RECT};
        use windows_sys::Win32::UI::Shell::{SHAppBarMessage, ABM_GETTASKBARPOS, APPBARDATA};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowW, GetWindowLongW, GetWindowRect, SetWindowLongPtrW, SetWindowLongW,
            GWL_EXSTYLE, GWLP_HWNDPARENT, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        };

        let window = app
            .get_webview_window(TASKBAR_PLAYER_WINDOW_LABEL)
            .ok_or_else(|| "Taskbar player window not found".to_string())?;

        let shell_tray_class: Vec<u16> = "Shell_TrayWnd\0".encode_utf16().collect();
        let current_hwnd_taskbar =
            unsafe { FindWindowW(shell_tray_class.as_ptr(), std::ptr::null()) };

        if current_hwnd_taskbar.is_null() {
            return Err("Taskbar window not found".to_string());
        }

        let last_hwnd = LAST_TASKBAR_HWND.load(Ordering::SeqCst);
        let mut hwnd_changed = false;
        let mut owner_binding = OwnerBindingState::AlreadyBound;

        if last_hwnd != current_hwnd_taskbar as isize {
            hwnd_changed = true;
            if let Ok(handle) = window.as_ref().window().window_handle() {
                if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                    let hwnd = win32.hwnd.get() as HWND;
                    let mut bound_success = false;
                    unsafe {
                        SetLastError(0);
                        let prev =
                            SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, current_hwnd_taskbar as isize);
                        if prev == 0 {
                            let err = GetLastError();
                            if err == 0 {
                                bound_success = true;
                            }
                        } else {
                            bound_success = true;
                        }

                        // owner 重绑会触发任务栏归属重新枚举，紧跟着补工具窗口样式，
                        // 避免残留一个不可激活的任务栏按钮
                        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                        SetWindowLongW(
                            hwnd,
                            GWL_EXSTYLE,
                            ex_style | WS_EX_TOOLWINDOW as i32 | WS_EX_NOACTIVATE as i32,
                        );
                    }

                    if bound_success {
                        owner_binding = OwnerBindingState::Bound;
                        LAST_TASKBAR_HWND.store(current_hwnd_taskbar as isize, Ordering::SeqCst);
                    } else {
                        owner_binding = OwnerBindingState::Failed;
                    }
                } else {
                    owner_binding = OwnerBindingState::Unsupported;
                }
            } else {
                owner_binding = OwnerBindingState::Unsupported;
            }
        }

        let mut abd = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: current_hwnd_taskbar,
            uCallbackMessage: 0,
            uEdge: 0,
            rc: RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            lParam: 0,
        };
        let mut taskbar_rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let got_taskbar = unsafe { SHAppBarMessage(ABM_GETTASKBARPOS, &mut abd) != 0 };
        if got_taskbar {
            taskbar_rect = abd.rc;
        } else {
            unsafe {
                GetWindowRect(current_hwnd_taskbar, &mut taskbar_rect);
            }
        }

        let tray_class_utf16: Vec<u16> = "TrayNotifyWnd".encode_utf16().collect();
        let mut node_count = 0;
        let hwnd_tray = find_window_recursive(
            current_hwnd_taskbar,
            &tray_class_utf16,
            0,
            3,
            &mut node_count,
        );

        let mut tray_rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let got_tray = if !hwnd_tray.is_null() {
            unsafe { GetWindowRect(hwnd_tray, &mut tray_rect) != 0 }
        } else {
            false
        };

        let tray_rect_physical = if got_tray {
            Some(RectPhysical {
                left: tray_rect.left,
                top: tray_rect.top,
                right: tray_rect.right,
                bottom: tray_rect.bottom,
            })
        } else {
            None
        };

        let scale_factor = window.as_ref().window().scale_factor().unwrap_or(1.0);

        Ok(TaskbarTrayGeometry {
            taskbar_rect_physical: RectPhysical {
                left: taskbar_rect.left,
                top: taskbar_rect.top,
                right: taskbar_rect.right,
                bottom: taskbar_rect.bottom,
            },
            tray_rect_physical,
            taskbar_hwnd_changed: hwnd_changed,
            owner_binding,
            source: if got_tray {
                GeometrySource::Tray
            } else {
                GeometrySource::TaskbarFallback
            },
            scale_factor,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Unsupported OS".to_string())
    }
}

#[cfg(target_os = "windows")]
mod zorder_guard {
    use std::sync::atomic::{AtomicIsize, AtomicU64, Ordering};
    use std::sync::{mpsc, OnceLock};
    use std::time::Duration;

    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetAncestor, GetClassNameW, GetMessageW, IsWindow, PeekMessageW,
        PostThreadMessageW, SetWindowPos, TranslateMessage, GA_ROOT, HWND_TOPMOST, MSG,
        PM_NOREMOVE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSENDCHANGING, SWP_NOSIZE,
        WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_APP,
    };

    pub static PLAYER_HWND: AtomicIsize = AtomicIsize::new(0);
    static REFRESH_TOKEN: AtomicU64 = AtomicU64::new(0);

    const WM_INSTALL: u32 = WM_APP + 0x200;
    const WM_UNINSTALL: u32 = WM_APP + 0x201;

    const EVENT_SYSTEM_FOREGROUND: u32 = 0x0003;
    const EVENT_SYSTEM_MENUSTART: u32 = 0x0004;
    const EVENT_OBJECT_FOCUS: u32 = 0x8005;

    struct GuardThread {
        thread_id: u32,
    }

    static GUARD_THREAD: OnceLock<GuardThread> = OnceLock::new();

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
        if hwnd.is_null() {
            return false;
        }
        unsafe {
            let mut buf = [0u16; 256];
            let len = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            if len <= 0 {
                return false;
            }
            let class = String::from_utf16_lossy(&buf[..len as usize]);
            matches!(
                class.as_str(),
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
    }

    fn refresh_player_topmost(player: HWND) {
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
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOSENDCHANGING | SWP_NOOWNERZORDER,
            );
        }
    }

    fn schedule_player_topmost_refresh(player: HWND) {
        let token = REFRESH_TOKEN.fetch_add(1, Ordering::Relaxed) + 1;
        refresh_player_topmost(player);

        let player_hwnd = player as isize;
        std::thread::spawn(move || {
            for delay_ms in [40_u64, 120, 300, 700] {
                std::thread::sleep(Duration::from_millis(delay_ms));
                if REFRESH_TOKEN.load(Ordering::Relaxed) != token {
                    return;
                }

                refresh_player_topmost(player_hwnd as HWND);
            }
        });
    }

    unsafe extern "system" fn hook_proc(
        _hook: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        _id_object: i32,
        _id_child: i32,
        _event_thread: u32,
        _event_time: u32,
    ) {
        let player = PLAYER_HWND.load(Ordering::Relaxed) as HWND;
        if player.is_null() || IsWindow(player) == 0 {
            return;
        }

        let source_root = root_window(hwnd);
        if !source_root.is_null() && source_root == player {
            return;
        }

        let should_refresh = match event {
            EVENT_SYSTEM_FOREGROUND => true,
            EVENT_OBJECT_FOCUS | EVENT_SYSTEM_MENUSTART => is_shell_window(source_root),
            _ => false,
        };

        if should_refresh {
            schedule_player_topmost_refresh(player);
        }
    }

    fn guard_thread() -> &'static GuardThread {
        GUARD_THREAD.get_or_init(|| {
            let (tx, rx) = mpsc::channel::<u32>();

            std::thread::spawn(move || unsafe {
                let tid = GetCurrentThreadId();

                let mut msg: MSG = std::mem::zeroed();
                PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
                let _ = tx.send(tid);

                let mut hook_fg: HWINEVENTHOOK = std::ptr::null_mut();
                let mut hook_focus: HWINEVENTHOOK = std::ptr::null_mut();
                let mut hook_menu: HWINEVENTHOOK = std::ptr::null_mut();

                let install_hook = |event: u32| -> HWINEVENTHOOK {
                    SetWinEventHook(
                        event,
                        event,
                        std::ptr::null_mut(),
                        Some(hook_proc),
                        0,
                        0,
                        WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
                    )
                };

                let unhook = |h: &mut HWINEVENTHOOK| {
                    if !h.is_null() {
                        UnhookWinEvent(*h);
                        *h = std::ptr::null_mut();
                    }
                };

                loop {
                    if GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) <= 0 {
                        break;
                    }

                    match msg.message {
                        WM_INSTALL => {
                            unhook(&mut hook_fg);
                            unhook(&mut hook_focus);
                            unhook(&mut hook_menu);

                            hook_fg = install_hook(EVENT_SYSTEM_FOREGROUND);
                            hook_focus = install_hook(EVENT_OBJECT_FOCUS);
                            hook_menu = install_hook(EVENT_SYSTEM_MENUSTART);
                        }
                        WM_UNINSTALL => {
                            unhook(&mut hook_fg);
                            unhook(&mut hook_focus);
                            unhook(&mut hook_menu);
                            PLAYER_HWND.store(0, Ordering::Relaxed);
                        }
                        _ => {
                            TranslateMessage(&msg);
                            DispatchMessageW(&msg);
                        }
                    }
                }

                unhook(&mut hook_fg);
                unhook(&mut hook_focus);
                unhook(&mut hook_menu);
            });

            let thread_id = rx.recv().unwrap_or_else(|_| {
                eprintln!("[taskbar] 任务栏置顶守护线程初始化失败，功能降级");
                0
            });
            GuardThread { thread_id }
        })
    }

    pub fn install(player_hwnd: isize) {
        PLAYER_HWND.store(player_hwnd, Ordering::Relaxed);
        schedule_player_topmost_refresh(player_hwnd as HWND);
        let t = guard_thread();
        unsafe {
            PostThreadMessageW(t.thread_id, WM_INSTALL, 0, 0);
        }
    }

    pub fn refresh(player_hwnd: isize) {
        schedule_player_topmost_refresh(player_hwnd as HWND);
    }

    pub fn uninstall() {
        if let Some(t) = GUARD_THREAD.get() {
            unsafe {
                PostThreadMessageW(t.thread_id, WM_UNINSTALL, 0, 0);
            }
        } else {
            PLAYER_HWND.store(0, Ordering::Relaxed);
        }
    }

    pub fn shutdown() {
        if let Some(t) = GUARD_THREAD.get() {
            unsafe {
                PostThreadMessageW(t.thread_id, 0x0012, 0, 0);
            }
        }
    }
}

#[tauri::command]
pub fn install_taskbar_zorder_guard(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use tauri::Manager;

        if let Some(window) = app.get_webview_window(TASKBAR_PLAYER_WINDOW_LABEL) {
            if let Ok(handle) = window.as_ref().window().window_handle() {
                if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                    zorder_guard::install(win32.hwnd.get() as isize);
                    return true;
                }
            }
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        false
    }
}

#[tauri::command]
pub fn refresh_taskbar_window_topmost(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use tauri::Manager;

        if let Some(window) = app.get_webview_window(TASKBAR_PLAYER_WINDOW_LABEL) {
            if let Ok(handle) = window.as_ref().window().window_handle() {
                if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                    zorder_guard::refresh(win32.hwnd.get() as isize);
                    return true;
                }
            }
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        false
    }
}

#[tauri::command]
pub fn uninstall_taskbar_zorder_guard() {
    #[cfg(target_os = "windows")]
    {
        zorder_guard::uninstall();
    }
}

pub fn shutdown_taskbar_zorder_guard() {
    #[cfg(target_os = "windows")]
    {
        zorder_guard::shutdown();
    }
}
