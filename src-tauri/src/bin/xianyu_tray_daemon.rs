//! 独立托盘守护进程（仅 Windows 实装，其它平台编译为空程序）。
//!
//! 主程序每次启动都会拉起本进程并传入监控目标：
//!   `--pid=<主进程 PID>  --event=<命名事件对象名>  --exe=<主程序 exe 路径>`
//!
//! 职责：主进程崩溃 / 卡死时的「保底托盘」——
//! 1. 监控主进程：收到退出事件（正常退出）→ 静默自退；进程意外死亡（崩溃 /
//!    被杀）或主窗口持续无响应（UI 线程饿死）→ 弹出兜底托盘。
//! 2. 兜底托盘菜单：打开弦予音乐（活着=聚焦，已死=重新拉起）、
//!    退出弦予音乐（WM_CLOSE 优雅关闭，2 秒超时强杀）、退出托盘。
//!
//! 自身以 HIGH_PRIORITY_CLASS 运行：系统高负载下也必须能及时感知主进程
//! 状态变化并弹出兜底托盘，这是整套退出/重启机制的最后防线。
#![windows_subsystem = "windows"]

fn main() {
    #[cfg(windows)]
    imp::run();
}

#[cfg(windows)]
mod imp {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::PathBuf;

    use tao::event::Event;
    use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
    use tray_icon::menu::accelerator::Accelerator;
    use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
    use tray_icon::{Icon, MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use windows_sys::Win32::Foundation::{HANDLE, HWND, LPARAM, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, OpenEventW, OpenProcess, SetPriorityClass, TerminateProcess,
        WaitForMultipleObjects, WaitForSingleObject, HIGH_PRIORITY_CLASS, PROCESS_SYNCHRONIZE,
        SYNCHRONIZATION_SYNCHRONIZE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsHungAppWindow, IsWindowVisible, PostMessageW,
        SetForegroundWindow, ShowWindow, SW_SHOW, WM_CLOSE,
    };

    const MENU_OPEN_ID: &str = "daemon-open";
    const MENU_QUIT_APP_ID: &str = "daemon-quit-app";
    const MENU_QUIT_DAEMON_ID: &str = "daemon-quit";

    /// 无响应轮询间隔与判定阈值：连续 15 秒（3 次 × 5 秒）无响应才认定卡死，
    /// 避免瞬时高负载导致的误判。
    const HUNG_POLL_MS: u32 = 5_000;
    const HUNG_STREAK_LIMIT: u32 = 3;
    /// 优雅退出主进程的超时：WM_CLOSE 后超过此时长仍未退出则强杀。
    const GRACEFUL_QUIT_TIMEOUT_MS: u32 = 2_000;

    enum DaemonEvent {
        /// 主进程已正常退出：守护进程随其静默自退
        Shutdown,
        /// 主进程意外死亡（崩溃/被杀）：弹出兜底托盘
        MainDied,
        /// 主窗口长时间无响应（UI 线程饿死）：弹出兜底托盘
        MainHung,
        /// 打开/聚焦主程序
        OpenApp,
        /// 优雅退出主程序（超时强杀）
        ForceQuit,
        /// 收起托盘；主进程已死时则直接自退
        QuitDaemon,
    }

    #[derive(Clone)]
    struct WatchTarget {
        /// 主进程句柄（isize 存放以便跨线程；裸指针不是 Send）
        process: isize,
        pid: u32,
        main_exe: PathBuf,
    }

    impl WatchTarget {
        fn handle(&self) -> HANDLE {
            self.process as HANDLE
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// 找主进程第一个可见顶层窗口：无响应检测与聚焦/关闭都作用于它。
    /// 同一进程的全部窗口共享主线程消息泵，任意可见窗口的无响应状态等价。
    fn find_main_window(pid: u32) -> HWND {
        struct Ctx {
            pid: u32,
            hwnd: HWND,
        }
        unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> i32 {
            let ctx = unsafe { &mut *(lparam as *mut Ctx) };
            let mut window_pid = 0u32;
            unsafe { GetWindowThreadProcessId(hwnd, &mut window_pid) };
            if window_pid == ctx.pid && unsafe { IsWindowVisible(hwnd) } != 0 {
                ctx.hwnd = hwnd;
                return 0;
            }
            1
        }
        let mut ctx = Ctx {
            pid,
            hwnd: std::ptr::null_mut(),
        };
        unsafe { EnumWindows(Some(enum_proc), &mut ctx as *mut Ctx as LPARAM) };
        ctx.hwnd
    }

    fn process_alive(process: isize) -> bool {
        (unsafe { WaitForSingleObject(process as HANDLE, 0) }) == WAIT_TIMEOUT
    }

    /// 主进程监控循环：事件对象（正常退出）优先于进程句柄（死亡）。
    /// 事件对象打开失败时降级为「主进程一死就自退」，与旧版托盘行为一致
    /// （不提供崩溃兜底，但也不会出现幽灵托盘）。
    fn monitor_main_process(
        proxy: EventLoopProxy<DaemonEvent>,
        target: &WatchTarget,
        exit_event: isize,
    ) {
        let has_exit_event = exit_event != 0;
        let handles = [target.handle(), exit_event as HANDLE];
        let mut hung_streak = 0u32;

        loop {
            let wait = if has_exit_event {
                unsafe { WaitForMultipleObjects(2, handles.as_ptr(), 0, HUNG_POLL_MS) }
            } else {
                unsafe { WaitForSingleObject(target.handle(), HUNG_POLL_MS) }
            };

            match wait {
                WAIT_OBJECT_0 => {
                    // 双对象模式下进程先于事件死亡 = 意外退出
                    let event = if has_exit_event {
                        DaemonEvent::MainDied
                    } else {
                        DaemonEvent::Shutdown
                    };
                    let _ = proxy.send_event(event);
                    return;
                }
                w if has_exit_event && w == WAIT_OBJECT_0 + 1 => {
                    // 主进程退出前显式通知：正常退出，随其自退
                    let _ = proxy.send_event(DaemonEvent::Shutdown);
                    return;
                }
                WAIT_TIMEOUT => {
                    let hwnd = find_main_window(target.pid);
                    let hung = !hwnd.is_null() && unsafe { IsHungAppWindow(hwnd) } != 0;
                    hung_streak = if hung { hung_streak + 1 } else { 0 };
                    if hung_streak >= HUNG_STREAK_LIMIT {
                        let _ = proxy.send_event(DaemonEvent::MainHung);
                        return;
                    }
                }
                _ => {
                    // WAIT_FAILED 等：监控链路已不可靠，静默自退
                    let _ = proxy.send_event(DaemonEvent::Shutdown);
                    return;
                }
            }
        }
    }

    /// 打开弦予音乐：活着=前置聚焦；已死=重新拉起（返回是否成功）。
    fn open_app(target: &WatchTarget) -> bool {
        if process_alive(target.process) {
            let hwnd = find_main_window(target.pid);
            if hwnd.is_null() {
                return false;
            }
            unsafe {
                ShowWindow(hwnd, SW_SHOW);
                SetForegroundWindow(hwnd);
            }
            return true;
        }
        std::process::Command::new(&target.main_exe).spawn().is_ok()
    }

    /// 退出弦予音乐：WM_CLOSE 优雅关闭，超时强杀（兜底卡死进程的最后手段）。
    fn force_quit(target: &WatchTarget) {
        if !process_alive(target.process) {
            return;
        }
        let hwnd = find_main_window(target.pid);
        if !hwnd.is_null() {
            unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) };
        }
        if unsafe { WaitForSingleObject(target.handle(), GRACEFUL_QUIT_TIMEOUT_MS) } == WAIT_TIMEOUT
        {
            unsafe { TerminateProcess(target.handle(), 1) };
        }
    }

    fn load_app_icon() -> Option<Icon> {
        const ICON_PNG: &[u8] = include_bytes!("../../icons/32x32.png");
        let image = image::load_from_memory(ICON_PNG).ok()?;
        let rgba = image.to_rgba8();
        Icon::from_rgba(rgba.into_raw(), image.width(), image.height()).ok()
    }

    fn build_fallback_menu() -> Menu {
        let menu = Menu::new();
        let open = MenuItem::with_id(MENU_OPEN_ID, "打开弦予音乐", true, None::<Accelerator>);
        let quit_app =
            MenuItem::with_id(MENU_QUIT_APP_ID, "退出弦予音乐", true, None::<Accelerator>);
        let separator = PredefinedMenuItem::separator();
        let quit_daemon =
            MenuItem::with_id(MENU_QUIT_DAEMON_ID, "退出托盘", true, None::<Accelerator>);
        let _ = menu.append_items(&[&open, &quit_app, &separator, &quit_daemon]);
        menu
    }

    pub fn run() {
        let mut pid: Option<u32> = None;
        let mut event_name: Option<String> = None;
        let mut main_exe: Option<PathBuf> = None;
        for arg in std::env::args().skip(1) {
            if let Some(value) = arg.strip_prefix("--pid=") {
                pid = value.parse().ok();
            } else if let Some(value) = arg.strip_prefix("--event=") {
                event_name = Some(value.to_string());
            } else if let Some(value) = arg.strip_prefix("--exe=") {
                main_exe = Some(PathBuf::from(value));
            }
        }
        let (Some(pid), Some(main_exe)) = (pid, main_exe) else {
            return;
        };

        // 保活最高优先级：高负载下也要能及时感知主进程死亡并弹出兜底托盘
        unsafe { SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS) };

        let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        if process.is_null() {
            return;
        }
        let exit_event = match event_name.map(|name| unsafe {
            OpenEventW(SYNCHRONIZATION_SYNCHRONIZE, 0, wide(&name).as_ptr())
        }) {
            Some(handle) if !handle.is_null() => handle,
            _ => std::ptr::null_mut(),
        };
        let (process, exit_event) = (process as isize, exit_event as isize);

        let event_loop = EventLoopBuilder::<DaemonEvent>::with_user_event().build();
        let proxy = event_loop.create_proxy();
        let target = WatchTarget {
            process,
            pid,
            main_exe,
        };

        let Some(icon) = load_app_icon() else {
            return;
        };
        let tray = match TrayIconBuilder::new()
            .with_tooltip("弦予音乐")
            .with_icon(icon)
            .with_menu(Box::new(build_fallback_menu()))
            .with_menu_on_left_click(false)
            .build()
        {
            Ok(tray) => tray,
            Err(_) => return,
        };
        // 平时隐藏：兜底托盘只在主进程崩溃/卡死时出现，与主程序的托盘不共存
        let _ = tray.set_visible(false);

        // 菜单与托盘点击事件统一转发进事件循环处理
        let menu_proxy = proxy.clone();
        MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
            let action = match event.id().as_ref() {
                MENU_OPEN_ID => DaemonEvent::OpenApp,
                MENU_QUIT_APP_ID => DaemonEvent::ForceQuit,
                MENU_QUIT_DAEMON_ID => DaemonEvent::QuitDaemon,
                _ => return,
            };
            let _ = menu_proxy.send_event(action);
        }));
        let tray_proxy = proxy.clone();
        TrayIconEvent::set_event_handler(Some(move |event: TrayIconEvent| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = tray_proxy.send_event(DaemonEvent::OpenApp);
            }
        }));

        // 主进程监控线程
        {
            let proxy = proxy.clone();
            let target = target.clone();
            let _ = std::thread::Builder::new()
                .name("daemon-watch".to_string())
                .spawn(move || monitor_main_process(proxy, &target, exit_event));
        }

        event_loop.run(move |event, _event_loop, control_flow| {
            *control_flow = ControlFlow::Wait;
            if let Event::UserEvent(user_event) = event {
                match user_event {
                    DaemonEvent::Shutdown => *control_flow = ControlFlow::Exit,
                    DaemonEvent::MainDied | DaemonEvent::MainHung => {
                        let _ = tray.set_visible(true);
                    }
                    DaemonEvent::OpenApp => {
                        // 成功重新拉起主程序后本守护进程功成身退：
                        // 新主进程会拉起自己的守护进程
                        if open_app(&target) && !process_alive(target.process) {
                            *control_flow = ControlFlow::Exit;
                        }
                    }
                    DaemonEvent::ForceQuit => force_quit(&target),
                    DaemonEvent::QuitDaemon => {
                        // 主进程还活着（卡死场景）：只藏托盘，继续监控；
                        // 主进程已死：兜底使命结束，自退
                        if !process_alive(target.process) {
                            *control_flow = ControlFlow::Exit;
                        } else {
                            let _ = tray.set_visible(false);
                        }
                    }
                }
            }
        });
    }
}
