//! Win32 原生插件编辑器窗口（P1）。
//!
//! VST3 `IPlugView` / CLAP `clap.gui` 要求：宿主提供一个带消息循环的父窗口，
//! 且所有视图方法（attached / onSize / removed）在同一拥有消息循环的线程上
//! 调用。本模块为每个打开的编辑器 spawn 一条专用 Win32 线程：
//!
//! - 线程内创建弹出层窗口（owner = 主窗口：Z 序始终在主窗口之上、随其
//!   最小化/恢复、不进任务栏）；
//! - 持机架锁调用 `editor.open(HWND)`，按 `editor.size()` 经
//!   `AdjustWindowRectForDpi` 换算外框尺寸，可缩放编辑器补 WS_THICKFRAME；
//! - 跑标准 `GetMessage` 消息循环；`WM_SIZE` 把客户区尺寸下发
//!   `editor.set_size`（仅可缩放编辑器）；
//! - `WM_CLOSE` 先持机架锁 `editor.close()`（VST3 规范要求 removed() 在父
//!   窗口销毁之前）并把插件编辑器内的手工调参收获回配置，再销毁窗口；
//! - 线程退出时从全局表摘除自己，调用方通过 `on_closed` 回调发 Tauri 事件。
//!
//! 关闭协议：`close_editor_blocking` 投递 `WM_CLOSE` 并等待「编辑器已 close +
//! 线程已退出」信号（超时 5 秒放弃等待）。机架退役/drop 实例前必须走此路径
//! ——绝不能在插件视图仍挂在窗口上时 drop 插件实例（其子窗口的窗口过程指向
//! 即将卸载的 DLL 代码）。

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::COLOR_WINDOW;
use windows_sys::Win32::UI::HiDpi::{AdjustWindowRectExForDpi, GetDpiForWindow};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CS_HREDRAW, CS_VREDRAW, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW,
    GetClientRect, GetMessageW, KillTimer, PostMessageW, PostQuitMessage, RegisterClassExW,
    SetForegroundWindow, SetTimer, SetWindowLongPtrW, SetWindowPos, ShowWindow, TranslateMessage,
    CW_USEDEFAULT, GWL_STYLE, MSG, SIZE_MINIMIZED, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOZORDER,
    SW_RESTORE, SW_SHOW, WNDCLASSEXW, WM_APP, WM_CLOSE, WM_DESTROY, WM_SIZE, WM_TIMER,
    WS_CAPTION, WS_MINIMIZEBOX, WS_OVERLAPPED, WS_SYSMENU, WS_THICKFRAME,
};

use truce_rack::core::editor::WindowHandle;

use super::rack::SharedRack;

/// 关闭等待上限：插件编辑器 close 不应超过数秒，超时放弃等待
/// （继续后续清理，宁可冒一次险也不让命令线程永久卡死）。
const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);

/// 编辑器未上报尺寸时的兜底客户区大小。
const FALLBACK_SIZE: (u32, u32) = (400, 300);

/// 已打开窗口的聚焦请求消息（WM_APP 起始，避免与系统消息冲突）。
const WM_APP_FOCUS: u32 = WM_APP;

/// 编辑器空闲驱动定时器：CLAP 插件依赖宿主周期性调用
/// `PluginEditor::on_idle` 派发 `clap.timer-support` 的 on_timer 与
/// request_callback（nih-plug iced 界面靠它重绘/处理事件）。
/// 15ms ≈ 66Hz，覆盖常见 30/60Hz 插件定时器；VST3 侧 nih-plug 自带
/// Win32 定时器，此处的 on_idle 默认空实现对其无影响。
const EDITOR_IDLE_TIMER_ID: usize = 1;
const EDITOR_IDLE_PERIOD_MS: u32 = 15;

/// 线程本地上下文：窗口过程只在创建它的编辑器线程上被调用，
/// 借 thread_local 把机架与槽位标识递给 wndproc。
#[derive(Clone)]
struct EditorCtx {
    rack: Arc<SharedRack>,
    format: String,
    unique_id: String,
    /// 编辑器成功 open 后置位（WM_SIZE 守卫）。
    opened: bool,
}

thread_local! {
    static CURRENT_CTX: RefCell<Option<EditorCtx>> = const { RefCell::new(None) };
}

/// HWND 的 Send 包装：句柄是平台整数值，跨线程只做数值拷贝，
/// 不转移任何所有权（Win32 窗口句柄本身与线程无关）。
#[derive(Clone, Copy)]
struct SendHwnd(HWND);
unsafe impl Send for SendHwnd {}
unsafe impl Sync for SendHwnd {}

impl SendHwnd {
    /// 方法调用（而非字段访问）确保闭包捕获整个包装结构而非裸指针字段
    /// （Rust 2021 析构闭包捕获会绕过 newtype 的 Send 实现）。
    fn raw(self) -> HWND {
        self.0
    }
}

/// 全局打开的编辑器表：key → 窗口句柄 + 线程退出信号接收端。
struct EditorEntry {
    hwnd: SendHwnd,
    done_rx: Receiver<()>,
}

static EDITORS: OnceLock<Mutex<HashMap<String, EditorEntry>>> = OnceLock::new();

fn editors() -> &'static Mutex<HashMap<String, EditorEntry>> {
    EDITORS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn editor_key(format: &str, unique_id: &str) -> String {
    format!("{format}::{unique_id}")
}

fn class_name() -> &'static [u16] {
    static NAME: OnceLock<Vec<u16>> = OnceLock::new();
    NAME.get_or_init(|| "XianYuPluginEditorWnd\0".encode_utf16().collect())
}

/// 打开（或聚焦已存在的）插件编辑器窗口。命令线程调用。
///
/// - `owner`：主窗口 HWND（Z 序跟随）；
/// - `on_closed`：编辑器线程退出时回调一次（发 Tauri 事件）。
pub fn open_editor(
    owner: HWND,
    rack: Arc<SharedRack>,
    format: &str,
    unique_id: &str,
    title: &str,
    on_closed: impl FnOnce() + Send + 'static,
) -> Result<(), String> {
    let key = editor_key(format, unique_id);
    {
        let map = editors().lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = map.get(&key) {
            // 已打开：恢复并拉到前台
            unsafe {
                let _ = PostMessageW(entry.hwnd.0, WM_APP_FOCUS, 0, 0);
            }
            return Ok(());
        }
    }

    let (ready_tx, ready_rx) = channel::<Result<isize, String>>();
    let (done_tx, done_rx) = channel::<()>();
    let format_owned = format.to_string();
    let unique_id_owned = unique_id.to_string();
    let title_owned = title.to_string();
    let owner = SendHwnd(owner);

    // 幂等：该插件已有打开的编辑器时，聚焦既有窗口而非新建。对同一实例
    // 重复 open() 会让插件卡在二次 attached，而该 open 持阻塞机架锁 →
    // 整应用无响应（观测日志：第二次 window created 后停在 open，无 open ok）。
    if let Some(hwnd) = editors()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&key)
        .map(|e| e.hwnd)
    {
        unsafe {
            let _ = PostMessageW(hwnd.0, WM_APP_FOCUS, 0, 0);
        }
        return Ok(());
    }

    let spawned = std::thread::Builder::new()
        .name(format!("plugin-editor-{key}"))
        .spawn(move || {
            editor_thread_main(
                owner.raw(),
                rack,
                &format_owned,
                &unique_id_owned,
                &title_owned,
                &ready_tx,
                done_tx,
            );
            on_closed();
        });
    // JoinHandle 丢弃即 detach：线程经 WM_CLOSE / 窗口销毁自行终止
    drop(spawned.map_err(|e| format!("编辑器线程启动失败: {e}"))?);

    match ready_rx.recv_timeout(std::time::Duration::from_secs(8)) {
        Ok(Ok(hwnd_bits)) => {
            // 注册表项在 open 成功后写入（含窗口句柄 + 完成信号接收端）。
            // 用户极快关闭的竞态由线程退出路径的幂等移除兜底。
            editors()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(
                    key,
                    EditorEntry {
                        hwnd: SendHwnd(hwnd_bits as HWND),
                        done_rx,
                    },
                );
            Ok(())
        }
        Ok(Err(e)) => Err(e),
        Err(_) => Err("编辑器打开超时（插件无响应或已崩溃）".into()),
    }
}

/// 当前打开的编辑器列表 [(format, unique_id)]。
pub fn open_editor_keys() -> Vec<(String, String)> {
    editors()
        .lock()
        .map(|m| {
            m.keys()
                .filter_map(|k| {
                    let mut parts = k.splitn(2, "::");
                    let format = parts.next()?.to_string();
                    let unique_id = parts.next()?.to_string();
                    Some((format, unique_id))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 请求关闭编辑器（不等待）。UI 命令路径。
pub fn close_editor(format: &str, unique_id: &str) {
    let key = editor_key(format, unique_id);
    let hwnd = {
        let map = editors().lock().unwrap_or_else(|e| e.into_inner());
        map.get(&key).map(|e| e.hwnd)
    };
    if let Some(hwnd) = hwnd {
        unsafe {
            let _ = PostMessageW(hwnd.0, WM_CLOSE, 0, 0);
        }
    }
}

/// 关闭编辑器并等待线程退出。机架退役实例前必须调用（命令线程）。
pub fn close_editor_blocking(format: &str, unique_id: &str) {
    let key = editor_key(format, unique_id);
    let entry = {
        let mut map = editors().lock().unwrap_or_else(|e| e.into_inner());
        map.remove(&key)
    };
    let Some(entry) = entry else {
        return; // 未打开（或已被线程自身移除）
    };
    unsafe {
        let _ = PostMessageW(entry.hwnd.0, WM_CLOSE, 0, 0);
    }
    // 等待「编辑器已 close + 线程已退出」信号；超时或信号端已断则放弃
    let _ = entry.done_rx.recv_timeout(CLOSE_TIMEOUT);
}

// ---------------------------------------------------------------------------
// 编辑器线程
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn editor_thread_main(
    owner: HWND,
    rack: Arc<SharedRack>,
    format: &str,
    unique_id: &str,
    title: &str,
    ready_tx: &Sender<Result<isize, String>>,
    done_tx: Sender<()>,
) {
    unsafe {
        register_class_once();

        let dpi = if owner.is_null() { 96 } else { GetDpiForWindow(owner) };

        // 固定尺寸起步；编辑器 open 后按其上报尺寸调整（可缩放的补边框样式）
        let styles: u32 = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU;
        let title16: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
        let hwnd = CreateWindowExW(
            0,
            class_name().as_ptr(),
            title16.as_ptr(),
            styles,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            640,
            480,
            owner, // owner：Z 序跟随主窗口、随其最小化、不进任务栏
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        );
        if hwnd.is_null() {
            let _ = ready_tx.send(Err("编辑器窗口创建失败".into()));
            let _ = done_tx.send(());
            return;
        }
        editor_log(&format!("[{}@{format}] window created hwnd={}", std::process::id(), hwnd as usize));

        // 安装线程上下文供 wndproc 使用
        CURRENT_CTX.with(|c| {
            *c.borrow_mut() = Some(EditorCtx {
                rack: rack.clone(),
                format: format.to_string(),
                unique_id: unique_id.to_string(),
                opened: false,
            });
        });

        // 用非阻塞式 try_with_slot 结合短重试打开编辑器，避免长时间独占机架锁
        // 导致音频线程 try_lock 失败产生 2ms 声音卡顿
        let open_outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let start = std::time::Instant::now();
            loop {
                let res = rack.try_with_slot(format, unique_id, |slot| {
                    let Some(editor) = slot.instance.editor() else {
                        return Err("该插件未提供编辑器".to_string());
                    };
                    let scale = f64::from(dpi) / 96.0;
                    editor
                        .open(WindowHandle::HWND(hwnd.cast()), scale)
                        .map_err(|e| format!("插件编辑器打开失败: {e}"))?;
                    let reported = editor.size();
                    let from_fallback = !matches!(reported, Some((w, h)) if w >= 48 && h >= 48);
                    let size = reported
                        .filter(|&(w, h)| w >= 48 && h >= 48)
                        .unwrap_or(FALLBACK_SIZE);
                    Ok((size, editor.is_resizable(), from_fallback))
                });
                if let Some(r) = res {
                    return r;
                }
                if start.elapsed() > std::time::Duration::from_millis(500) {
                    return Err("获取插件实例超时".to_string());
                }
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
        }));
        let (size, resizable, from_fallback) = match open_outcome {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => {
                editor_log(&format!("[{}@{format}] open Err: {e}", std::process::id()));
                DestroyWindow(hwnd);
                let _ = ready_tx.send(Err(e));
                let _ = done_tx.send(());
                return;
            }
            Err(payload) => {
                let any: &(dyn std::any::Any + Send) = &*payload;
                let msg = any
                    .downcast_ref::<String>()
                    .map(|s| s.as_str())
                    .or_else(|| any.downcast_ref::<&str>().copied())
                    .unwrap_or("<非字符串 panic>");
                editor_log(&format!("[{}@{format}] open PANICKED: {msg}", std::process::id()));
                DestroyWindow(hwnd);
                let _ = ready_tx.send(Err("插件编辑器打开时崩溃（已捕获）".into()));
                let _ = done_tx.send(());
                return;
            }
        };
        editor_log(&format!("[{}@{format}] open ok size={}x{}", std::process::id(), size.0, size.1));

        let mut effective_styles = styles;
        if resizable {
            effective_styles |= WS_THICKFRAME | WS_MINIMIZEBOX;
            SetWindowLongPtrW(hwnd, GWL_STYLE, effective_styles as isize);
        }

        // 客户区尺寸 → 外框尺寸换算
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: size.0 as i32,
            bottom: size.1 as i32,
        };
        let _ = AdjustWindowRectExForDpi(&mut rect, effective_styles, 0, 0, dpi);
        let width = (rect.right - rect.left).max(160);
        let height = (rect.bottom - rect.top).max(100);
        let _ = SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            0,
            0,
            width,
            height,
            SWP_NOMOVE | SWP_NOZORDER | SWP_FRAMECHANGED,
        );

        CURRENT_CTX.with(|c| {
            if let Some(ctx) = c.borrow_mut().as_mut() {
                ctx.opened = true;
            }
        });

        // getSize 未就绪回落时，把兜底客户区主动通知**可缩放**插件按此布局
        // 渲染。固定大小插件不可据此布局，也不应被宿主调 set_size（VST3 规范），
        // 去强制调用会在该插件同步等宿主时持机架锁 → 点编辑器整应用无响应。
        if from_fallback {
            rack.try_with_slot(format, unique_id, |slot| {
                if let Some(editor) = slot.instance.editor() {
                    if editor.is_resizable() && editor.is_open() {
                        let _ = editor.set_size(size.0, size.1);
                    }
                }
            });
        }

        editor_log(&format!("[{}@{format}] sending ready", std::process::id()));
        let _ = ready_tx.send(Ok(hwnd as isize));
        ShowWindow(hwnd, SW_SHOW);
        editor_log(&format!("[{}@{format}] entering message loop", std::process::id()));
        // 空闲驱动：阻塞的 GetMessageW 平时无消息可派，靠周期性
        // WM_TIMER 唤醒消息循环给插件 GUI 送 idle tick
        SetTimer(hwnd, EDITOR_IDLE_TIMER_ID, EDITOR_IDLE_PERIOD_MS, None);

        // 标准消息循环（WM_QUIT 退出）
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        // ---- 退出路径 ----
        // 兜底：窗口被直接销毁（未走 WM_CLOSE，如 owner 关闭连坐）时视图
        // 仍未 removed，这里补一次 close + 收获
        let still_open = CURRENT_CTX.with(|c| {
            c.borrow().as_ref().is_some_and(|ctx| ctx.opened)
        });
        if still_open {
            let _ = guard_plugin_panic(|| close_editor_view_and_harvest(&rack, format, unique_id));
        }

        editors()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&editor_key(format, unique_id));
        let _ = done_tx.send(());
        CURRENT_CTX.with(|c| {
            *c.borrow_mut() = None;
        });
    }
}

/// 取 CURRENT_CTX 的只读快照（克隆），借用立即释放。
///
/// 窗口过程是**可重入**的：插件回调可能在其内部同步 `SendMessage`/`PostMessage`
/// 重新进入本 wndproc。若在调用插件期间一直持有 `RefCell` 借用，重入路径的
/// 第二次 `borrow()` 会抛 "RefCell already borrowed"（此前正是这个 panic 越过
/// `guard_plugin_panic` 触发 abort）。因此所有触碰插件的分支都先快照、立刻
/// 放掉借用，再持 owned 上下文操作。
fn ctx_snapshot() -> Option<EditorCtx> {
    CURRENT_CTX.with(|c| c.borrow().clone())
}

/// 在短暂、不与插件调用重叠的窗口内把 opened 置为 false。
fn clear_ctx_opened() {
    CURRENT_CTX.with(|c| {
        if let Some(ctx) = c.borrow_mut().as_mut() {
            ctx.opened = false;
        }
    });
}

/// 关闭插件视图并收获编辑器内手工调参到配置。
///
/// 1. 持机架锁 `editor.close()`（VST3 规范：removed() 须在父窗口销毁前）；
/// 2. 读出全部参数当前值（performEdit 不经过宿主 set_parameter，只有插件
///    自己知道），写回配置持久化。注意：update_slot_param 自身会加机架锁，
///    不能在 with_slot 闭包内调用（死锁）。
///
/// 本函数不再触碰 CURRENT_CTX（重入防护），调用方先 clear_ctx_opened()。
fn close_editor_view_and_harvest(rack: &Arc<SharedRack>, format: &str, unique_id: &str) {
    rack.with_slot(format, unique_id, |slot| {
        if let Some(editor) = slot.instance.editor() {
            editor.close();
        }
    });
    let harvested: Vec<(usize, f64)> = rack
        .with_slot(format, unique_id, |slot| {
            (0..slot.instance.parameter_count())
                .filter_map(|index| {
                    slot.instance.parameter_value(index).ok().map(|value| (index, value))
                })
                .collect()
        })
        .unwrap_or_default();
    for (index, value) in harvested {
        rack.update_slot_param(format, unique_id, index, value);
    }
}

/// 对插件编辑器的 FFI 调用做 panic 防护。
///
/// 窗口过程是 `extern "system"`：Rust panic 无法越过该 ABI 边界，任何未被
/// 捕获的 panic 都会触发 "non-unwinding panic" 直接 abort 整个进程（详见
/// 崩溃日志 0xc0000409 / `_CxxFrameHandler3`）。插件 DLL 不可信，其视图
/// 交互（on_idle / set_size / close / performEdit）可能在任意时机 panic，
/// 必须在此拦下——与音频 process 链上的 catch_unwind 同理，单一插件崩溃
/// 不应拖垮宿主。返回是否发生了 panic。
fn guard_plugin_panic<F: FnOnce()>(f: F) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}

/// 把编辑器线程生命周期打点写到临时日志，用于在“点编辑器死机”时定位
/// 卡住/崩溃在哪一步。行尾不换行缓冲，立即 flush 以便强杀后日志可见。
fn editor_log(msg: &str) {
    use std::io::Write;
    let Ok(file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(std::env::temp_dir().join("plugin_editor.log"))
    else {
        return;
    };
    let mut f = std::io::BufWriter::new(file);
    let _ = writeln!(f, "{} {msg}", std::process::id());
    let _ = f.flush();
}

fn register_class_once() {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| unsafe {
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(editor_wndproc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: std::ptr::null_mut(),
            hIcon: std::ptr::null_mut(),
            hCursor: std::ptr::null_mut(),
            hbrBackground: COLOR_WINDOW as _,
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name().as_ptr(),
            hIconSm: std::ptr::null_mut(),
        };
        let _ = RegisterClassExW(&wc);
    });
}

unsafe extern "system" fn editor_wndproc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_APP_FOCUS => {
            unsafe {
                ShowWindow(hwnd, SW_RESTORE);
                let _ = SetForegroundWindow(hwnd);
            }
            0
        }
        WM_CLOSE => {
            // 快照优先、借用即放，避免重入二次借阅同一 RefCell。
            let ctx = ctx_snapshot();
            if let Some(ctx) = ctx {
                if ctx.opened {
                    // 先摘插件视图再销毁父窗口（VST3 规范顺序），失败也继续关闭；
                    // 插件 removed/收获可能 panic，绝不能 abort 整个进程。
                    let _ = guard_plugin_panic(|| {
                        close_editor_view_and_harvest(&ctx.rack, &ctx.format, &ctx.unique_id)
                    });
                }
            }
            clear_ctx_opened();
            unsafe { DestroyWindow(hwnd) };
            0
        }
        WM_SIZE => {
            if wparam == SIZE_MINIMIZED as usize {
                return 0;
            }
            let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            unsafe { GetClientRect(hwnd, &mut rect) };
            let width = (rect.right - rect.left).max(0) as u32;
            let height = (rect.bottom - rect.top).max(0) as u32;
            if width > 0 && height > 0 {
                let ctx = ctx_snapshot();
                let crashed = ctx.as_ref().is_some_and(|ctx| {
                    if !ctx.opened {
                        return false;
                    }
                    guard_plugin_panic(|| {
                        ctx.rack.try_with_slot(&ctx.format, &ctx.unique_id, |slot| {
                            if let Some(editor) = slot.instance.editor() {
                                if editor.is_resizable() && editor.is_open() {
                                    let _ = editor.set_size(width, height);
                                }
                            }
                        });
                    })
                });
                if crashed {
                    unsafe { let _ = PostMessageW(hwnd, WM_CLOSE, 0, 0); };
                }
            }
            0
        }
        WM_TIMER => {
            if wparam == EDITOR_IDLE_TIMER_ID {
                let ctx = ctx_snapshot();
                let crashed = ctx.as_ref().is_some_and(|ctx| {
                    if !ctx.opened {
                        return false;
                    }
                    guard_plugin_panic(|| {
                        ctx.rack.try_with_slot(&ctx.format, &ctx.unique_id, |slot| {
                            if let Some(editor) = slot.instance.editor() {
                                editor.on_idle();
                            }
                        });
                    })
                });
                if crashed {
                    unsafe { let _ = PostMessageW(hwnd, WM_CLOSE, 0, 0); };
                }
            }
            0
        }
        WM_DESTROY => {
            unsafe {
                KillTimer(hwnd, EDITOR_IDLE_TIMER_ID);
                PostQuitMessage(0);
            }
            0
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}
