//! 托盘菜单的「点击外部关闭」低级鼠标钩子。
//!
//! 原生右键菜单的关外关闭靠系统模态菜单循环 + 鼠标捕获，与窗口焦点
//! 无关；自定义菜单窗是普通窗口，托盘点击授予的前台激活权在异步弹出
//! 链路里往往已经失效，失焦关闭因此不可靠。这里采用与原生菜单同源的
//! 机制：菜单显示期间安装 WH_MOUSE_LL 低级鼠标钩子，任何落在托盘窗
//! 之外的鼠标按下即收起菜单——无论焦点归属如何都生效。

/// 托盘窗显示后开启关外点击捕获（幂等；已在捕获中则仅刷新目标句柄）。
#[tauri::command]
pub fn start_tray_mouse_capture(app: tauri::AppHandle, label: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return imp::start(&app, &label);

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Ok(())
    }
}

/// 托盘菜单收起后停止捕获（幂等）。
#[tauri::command]
pub fn stop_tray_mouse_capture() {
    #[cfg(target_os = "windows")]
    imp::stop();
}

#[cfg(target_os = "windows")]
mod imp {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicIsize, AtomicPtr, AtomicU32, Ordering};
    use std::sync::OnceLock;

    use tauri::Manager as _;
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetAncestor, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
        UnhookWindowsHookEx, WindowFromPoint, GA_ROOT, MSG, MSLLHOOKSTRUCT, WH_MOUSE_LL,
        WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_NCLBUTTONDOWN, WM_NCMBUTTONDOWN, WM_NCRBUTTONDOWN,
        WM_QUIT, WM_RBUTTONDOWN,
    };

    use crate::window_foreground::window_hwnd;

    static DISMISS_APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    static DISMISS_LABEL: OnceLock<String> = OnceLock::new();
    static TARGET_HWND: AtomicIsize = AtomicIsize::new(0);
    static HOOK: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
    static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);

    pub(super) fn start(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
        let window = app
            .get_webview_window(label)
            .ok_or_else(|| format!("tray menu window '{label}' not found"))?;
        let hwnd = window_hwnd(&window).ok_or("tray menu window has no win32 handle")?;

        let _ = DISMISS_APP.set(app.clone());
        let _ = DISMISS_LABEL.set(label.to_string());
        TARGET_HWND.store(hwnd as isize, Ordering::Release);

        if !HOOK.load(Ordering::Acquire).is_null() {
            return Ok(()); // 已在捕获中，刷新目标句柄即可
        }

        std::thread::Builder::new()
            .name("tray-mouse-capture".into())
            .spawn(hook_thread)
            .map_err(|error| format!("failed to spawn mouse-capture thread: {error}"))?;
        Ok(())
    }

    pub(super) fn stop() {
        unhook();
    }

    fn unhook() {
        let hook = HOOK.swap(std::ptr::null_mut(), Ordering::AcqRel);
        if hook.is_null() {
            return;
        }
        unsafe {
            let _ = UnhookWindowsHookEx(hook);
        }
        let thread_id = HOOK_THREAD_ID.swap(0, Ordering::AcqRel);
        if thread_id != 0 {
            unsafe {
                let _ = PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
            }
        }
    }

    /// 钩子线程：安装低级钩子后靠消息循环投递回调，收到 WM_QUIT 退出。
    fn hook_thread() {
        HOOK_THREAD_ID.store(unsafe { GetCurrentThreadId() }, Ordering::Release);
        let hook = unsafe {
            SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), std::ptr::null_mut(), 0)
        };
        if hook.is_null() {
            return;
        }
        HOOK.store(hook, Ordering::Release);

        unsafe {
            let mut message = std::mem::zeroed::<MSG>();
            while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {}
        }
    }

    unsafe extern "system" fn mouse_proc(code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if code >= 0 {
            // 各类鼠标按下（客户区 + 非客户区）：原生菜单同样「按下即收起」
            let pressed = matches!(
                w_param as u32,
                WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN
                    | WM_NCLBUTTONDOWN | WM_NCRBUTTONDOWN | WM_NCMBUTTONDOWN
            );
            if pressed {
                let info = &*(l_param as *const MSLLHOOKSTRUCT);
                let hit = WindowFromPoint(info.pt);
                let root = GetAncestor(hit, GA_ROOT);
                let target = TARGET_HWND.load(Ordering::Acquire);
                if target != 0 && root as isize != target {
                    schedule_dismiss();
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, w_param, l_param)
    }

    /// 钩子线程触发：切到主线程收起菜单；先清目标句柄去重连击。
    fn schedule_dismiss() {
        if TARGET_HWND.swap(0, Ordering::AcqRel) == 0 {
            return;
        }
        let Some(app) = DISMISS_APP.get() else {
            return;
        };
        let label = DISMISS_LABEL.get().cloned();
        let _ = app.run_on_main_thread(move || {
            unhook();
            if let (Some(label), Some(app)) = (label, DISMISS_APP.get()) {
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.hide();
                }
            }
        });
    }
}
