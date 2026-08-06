use crate::audio_proxy::AudioProxy;
use crate::database::DbState;
use crate::music::{
    run_cache_cleanup, FullCoverImageConcurrencyLimit, ThumbnailImageConcurrencyLimit,
    FULL_COVER_IMAGE_CONCURRENCY_LIMIT, THUMBNAIL_IMAGE_CONCURRENCY_LIMIT,
};
use crate::player::{init_player, start_usb_device_monitor};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tokio::sync::Semaphore;

const APP_SHOW_MAIN_EVENT: &str = "app:show-main";
const APP_TRAY_MENU_OPEN_EVENT: &str = "app:tray-menu-open";
const MAIN_WINDOW_LABEL: &str = "main";
const MINI_PLAYER_WINDOW_LABEL: &str = "mini-player";

#[derive(serde::Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct TrayMenuOpenPayload {
    x: f64,
    y: f64,
}

#[derive(Default)]
pub(crate) struct PendingOpenPaths(pub(crate) Mutex<Vec<String>>);

/// Holds the local audio proxy instance (started once on app launch).
/// [YinDong 播放引擎移植] 为 HTML <audio> + Web Audio 路径提供带 CORS 头的本地代理。
pub struct AudioProxyState(pub(crate) Arc<Mutex<Option<AudioProxy>>>);

fn append_unique_paths(target: &mut Vec<String>, incoming: impl IntoIterator<Item = String>) {
    let mut seen = target.iter().cloned().collect::<HashSet<_>>();

    for path in incoming {
        if seen.insert(path.clone()) {
            target.push(path);
        }
    }
}

fn collect_existing_open_paths(
    args: impl IntoIterator<Item = String>,
    current_exe: Option<&Path>,
) -> Vec<String> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    for arg in args {
        let trimmed = arg.trim();
        if trimmed.is_empty() {
            continue;
        }

        let normalized = crate::music::utils::normalize_path(trimmed);
        if normalized.is_empty() {
            continue;
        }

        let candidate = PathBuf::from(&normalized);
        if !candidate.exists() {
            continue;
        }

        if current_exe.is_some_and(|exe| exe == candidate.as_path()) {
            continue;
        }

        if seen.insert(normalized.clone()) {
            paths.push(normalized);
        }
    }

    paths
}

fn queue_open_paths<R: tauri::Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    if let Some(state) = app.try_state::<PendingOpenPaths>() {
        if let Ok(mut pending_paths) = state.0.lock() {
            append_unique_paths(&mut pending_paths, paths);
        }
    }
}

fn reveal_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let mini_player_visible = app
        .get_webview_window(MINI_PLAYER_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    if mini_player_visible {
        let _ = app.emit(APP_SHOW_MAIN_EVENT, ());
        return;
    }

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn emit_tray_menu_open<R: tauri::Runtime>(app: &tauri::AppHandle<R>, x: f64, y: f64) {
    let _ = app.emit(APP_TRAY_MENU_OPEN_EVENT, TrayMenuOpenPayload { x, y });
}

fn install_window_boundary<R: tauri::Runtime>(app: &tauri::App<R>) {
    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            use raw_window_handle::HasWindowHandle;

            if let Ok(handle) = window.as_ref().window().window_handle() {
                if let raw_window_handle::RawWindowHandle::Win32(win32) = handle.as_raw() {
                    crate::window_boundary::install_boundary_subclass(win32.hwnd.get() as isize);
                }
            }
        }
    }
}

fn build_tray<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let _tray = TrayIconBuilder::with_id("tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("弦予音乐")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal_main_window(&tray.app_handle());
                return;
            }

            if let TrayIconEvent::Click {
                button: MouseButton::Right,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                emit_tray_menu_open(&tray.app_handle(), position.x, position.y);
            }
        })
        .build(app.handle())?;

    Ok(())
}

pub(crate) fn handle_single_instance<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    argv: Vec<String>,
) {
    let current_exe = std::env::current_exe().ok();
    let open_paths = collect_existing_open_paths(argv, current_exe.as_deref());
    queue_open_paths(app, open_paths);
    let _ = app.emit("app:open-paths", ());
    reveal_main_window(app);
}

pub(crate) fn setup_app(
    app: &mut tauri::App<tauri::Wry>,
) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(PendingOpenPaths::default());

    let db_state = DbState::new(app.handle())?;
    app.manage(db_state);

    let player_state = init_player(app.handle());
    app.manage(player_state);

    // [YinDong 播放引擎移植] 启动 USB 设备热插拔监视器，前端通过 usb-device-changed 事件接收变更
    let usb_monitor = start_usb_device_monitor(app.handle());
    app.manage(usb_monitor);

    app.manage(ThumbnailImageConcurrencyLimit(Semaphore::new(
        THUMBNAIL_IMAGE_CONCURRENCY_LIMIT,
    )));
    app.manage(FullCoverImageConcurrencyLimit(Semaphore::new(
        FULL_COVER_IMAGE_CONCURRENCY_LIMIT,
    )));
    run_cache_cleanup(app.handle());

    let current_exe = std::env::current_exe().ok();
    let initial_open_paths =
        collect_existing_open_paths(std::env::args().skip(1), current_exe.as_deref());
    queue_open_paths(app.handle(), initial_open_paths);

    install_window_boundary(app);
    build_tray(app)?;

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        crate::webview_settings::disable_browser_accelerator_keys(&window);
    }

    // [YinDong 播放引擎移植] 启动本地音频代理：为 HTML <audio> + Web Audio 路径
    // 提供 CORS 头（createMediaElementSource 要求 crossOrigin="anonymous"）。
    // spawn() 在独立 OS 线程跑 accept loop，存活整个 app 生命周期。
    let proxy = AudioProxy::spawn();
    if let Some(proxy) = proxy {
        app.manage(AudioProxyState(Arc::new(Mutex::new(Some(proxy)))));
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn consume_pending_open_paths(
    state: tauri::State<PendingOpenPaths>,
) -> Result<Vec<String>, String> {
    let mut pending_paths = state.0.lock().map_err(|error| error.to_string())?;
    Ok(std::mem::take(&mut *pending_paths))
}

#[tauri::command]
pub(crate) fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub(crate) fn open_devtools(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or("main window not found")?;
    let _: () = window.open_devtools();
    Ok(())
}

/// [YinDong 播放引擎移植] 为远程音频 URL 生成本地代理 URL。
/// 代理在服务端拉取远程音频并注入 CORS 头，使浏览器 Web Audio API
/// （createMediaElementSource）能处理跨域音频。
#[tauri::command]
pub(crate) fn get_proxied_audio_url(
    state: tauri::State<'_, AudioProxyState>,
    url: String,
) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    match guard.as_ref() {
        Some(proxy) => Ok(proxy.proxied_url(&url, None)),
        None => Err("Audio proxy not available".to_string()),
    }
}

/// [YinDong 播放引擎移植] 为本地音频文件路径生成本地代理 URL。
/// 代理从磁盘读文件并注入 CORS 头，使 Web Audio API 能处理本地音频。
#[tauri::command]
pub(crate) fn get_local_audio_url(
    state: tauri::State<'_, AudioProxyState>,
    path: String,
) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    match guard.as_ref() {
        Some(proxy) => Ok(proxy.local_url(&path)),
        None => Err("Audio proxy not available".to_string()),
    }
}


