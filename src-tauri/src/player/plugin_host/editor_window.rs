use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::COLOR_WINDOW;
use windows_sys::Win32::UI::HiDpi::{AdjustWindowRectExForDpi, GetDpiForWindow};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect, GetMessageW,
    KillTimer, PostMessageW, PostQuitMessage, RegisterClassExW, SetForegroundWindow, SetTimer,
    SetWindowLongPtrW, SetWindowPos, ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW,
    CW_USEDEFAULT, GWL_STYLE, MSG, SIZE_MINIMIZED, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOZORDER,
    SW_RESTORE, SW_SHOW, WM_APP, WM_CLOSE, WM_DESTROY, WM_SIZE, WM_TIMER, WNDCLASSEXW, WS_CAPTION,
    WS_MINIMIZEBOX, WS_OVERLAPPED, WS_SYSMENU, WS_THICKFRAME,
};

use truce_rack::core::editor::WindowHandle;

use super::rack::SharedRack;

const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);

const FALLBACK_SIZE: (u32, u32) = (400, 300);

const WM_APP_FOCUS: u32 = WM_APP;

const EDITOR_IDLE_TIMER_ID: usize = 1;
const EDITOR_IDLE_PERIOD_MS: u32 = 15;

#[derive(Clone)]
struct EditorCtx {
    rack: Arc<SharedRack>,
    format: String,
    unique_id: String,
    opened: bool,
}

thread_local! {
    static CURRENT_CTX: RefCell<Option<EditorCtx>> = const { RefCell::new(None) };
}

#[derive(Clone, Copy)]
struct SendHwnd(HWND);
unsafe impl Send for SendHwnd {}
unsafe impl Sync for SendHwnd {}

impl SendHwnd {
    fn raw(self) -> HWND {
        self.0
    }
}

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
        let mut map = editors().lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = map.get(&key) {
            if !entry.hwnd.0.is_null() {
                unsafe {
                    let _ = PostMessageW(entry.hwnd.0, WM_APP_FOCUS, 0, 0);
                }
            }
            return Ok(());
        }
        let (_, placeholder_rx) = channel::<()>();
        map.insert(
            key.clone(),
            EditorEntry {
                hwnd: SendHwnd(std::ptr::null_mut()),
                done_rx: placeholder_rx,
            },
        );
    }

    let (ready_tx, ready_rx) = channel::<Result<isize, String>>();
    let (done_tx, done_rx) = channel::<()>();
    let format_owned = format.to_string();
    let unique_id_owned = unique_id.to_string();
    let title_owned = title.to_string();
    let owner = SendHwnd(owner);

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
    if let Err(e) = spawned {
        editors()
            .lock()
            .unwrap_or_else(|se| se.into_inner())
            .remove(&key);
        return Err(format!("编辑器线程启动失败: {e}"));
    }

    match ready_rx.recv_timeout(std::time::Duration::from_secs(8)) {
        Ok(Ok(hwnd_bits)) => {
            editors().lock().unwrap_or_else(|e| e.into_inner()).insert(
                key,
                EditorEntry {
                    hwnd: SendHwnd(hwnd_bits as HWND),
                    done_rx,
                },
            );
            Ok(())
        }
        Ok(Err(e)) => {
            editors()
                .lock()
                .unwrap_or_else(|se| se.into_inner())
                .remove(&key);
            Err(e)
        }
        Err(_) => {
            editors()
                .lock()
                .unwrap_or_else(|se| se.into_inner())
                .remove(&key);
            Err("编辑器打开超时（插件无响应或已崩溃）".into())
        }
    }
}

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

pub fn close_editor(format: &str, unique_id: &str) {
    let key = editor_key(format, unique_id);
    let hwnd = {
        let map = editors().lock().unwrap_or_else(|e| e.into_inner());
        map.get(&key).map(|e| e.hwnd)
    };
    if let Some(hwnd) = hwnd {
        if !hwnd.0.is_null() {
            unsafe {
                let _ = PostMessageW(hwnd.0, WM_CLOSE, 0, 0);
            }
        }
    }
}

pub fn close_editor_blocking(format: &str, unique_id: &str) {
    let key = editor_key(format, unique_id);
    let entry = {
        let mut map = editors().lock().unwrap_or_else(|e| e.into_inner());
        map.remove(&key)
    };
    let Some(entry) = entry else {
        return;
    };
    if !entry.hwnd.0.is_null() {
        unsafe {
            let _ = PostMessageW(entry.hwnd.0, WM_CLOSE, 0, 0);
        }
    }
    let _ = entry.done_rx.recv_timeout(CLOSE_TIMEOUT);
}

// ---------------------------------------------------------------------------
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

        let dpi = if owner.is_null() {
            96
        } else {
            GetDpiForWindow(owner)
        };

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
            owner,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        );
        if hwnd.is_null() {
            let _ = ready_tx.send(Err("编辑器窗口创建失败".into()));
            let _ = done_tx.send(());
            return;
        }
        editor_log(&format!(
            "[{}@{format}] window created hwnd={}",
            std::process::id(),
            hwnd as usize
        ));

        CURRENT_CTX.with(|c| {
            *c.borrow_mut() = Some(EditorCtx {
                rack: rack.clone(),
                format: format.to_string(),
                unique_id: unique_id.to_string(),
                opened: false,
            });
        });

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
                editor_log(&format!(
                    "[{}@{format}] open PANICKED: {msg}",
                    std::process::id()
                ));
                DestroyWindow(hwnd);
                let _ = ready_tx.send(Err("插件编辑器打开时崩溃（已捕获）".into()));
                let _ = done_tx.send(());
                return;
            }
        };
        editor_log(&format!(
            "[{}@{format}] open ok size={}x{}",
            std::process::id(),
            size.0,
            size.1
        ));

        let mut effective_styles = styles;
        if resizable {
            effective_styles |= WS_THICKFRAME | WS_MINIMIZEBOX;
            SetWindowLongPtrW(hwnd, GWL_STYLE, effective_styles as isize);
        }

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
        editor_log(&format!(
            "[{}@{format}] entering message loop",
            std::process::id()
        ));
        SetTimer(hwnd, EDITOR_IDLE_TIMER_ID, EDITOR_IDLE_PERIOD_MS, None);

        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        // ---- 退出路径 ----
        let still_open = CURRENT_CTX.with(|c| c.borrow().as_ref().is_some_and(|ctx| ctx.opened));
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

fn ctx_snapshot() -> Option<EditorCtx> {
    CURRENT_CTX.with(|c| c.borrow().clone())
}

fn clear_ctx_opened() {
    CURRENT_CTX.with(|c| {
        if let Some(ctx) = c.borrow_mut().as_mut() {
            ctx.opened = false;
        }
    });
}

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
                    slot.instance
                        .parameter_value(index)
                        .ok()
                        .map(|value| (index, value))
                })
                .collect()
        })
        .unwrap_or_default();
    for (index, value) in harvested {
        rack.update_slot_param(format, unique_id, index, value);
    }
}

fn guard_plugin_panic<F: FnOnce()>(f: F) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}

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
            let ctx = ctx_snapshot();
            if let Some(ctx) = ctx {
                if ctx.opened {
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
            let mut rect = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
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
                    unsafe {
                        let _ = PostMessageW(hwnd, WM_CLOSE, 0, 0);
                    };
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
                    unsafe {
                        let _ = PostMessageW(hwnd, WM_CLOSE, 0, 0);
                    };
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
