use crate::database::{DbState};
use crate::music::{ // 实现
    run_cache_cleanup, FullCoverImageConcurrencyLimit, ThumbnailImageConcurrencyLimit, // 实现
    FULL_COVER_IMAGE_CONCURRENCY_LIMIT, THUMBNAIL_IMAGE_CONCURRENCY_LIMIT, // 实现
};
use crate::player::{init_player};
use crate::player::PlaybackSessionState;
use std::collections::{HashSet};
use std::path::{PathBuf, Path};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex};
use tauri::{ // 实现
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}, // 实现
    Emitter, Manager,
};
use tokio::sync::{Semaphore};

const APP_SHOW_MAIN_EVENT: &str = "app:show-main"; // 实现
const APP_DEEP_LINK_EVENT: &str = "app:deep-link";
const APP_TRAY_MENU_EVENT: &str = "app:tray-menu";
const APP_TRAY_MENU_OPEN_EVENT: &str = "app:tray-menu-open"; // 实现
const DEEP_LINK_SCHEME: &str = "xianyu://";
const MAIN_WINDOW_LABEL: &str = "main"; // 实现
const MINI_PLAYER_WINDOW_LABEL: &str = "mini-player"; // 实现
const TRAY_ID: &str = "tray";
const TRAY_MENU_TRACK_TITLE_ID: &str = "track-title";
const TRAY_MENU_TRACK_ARTIST_ID: &str = "track-artist";
const TRAY_MENU_FAVORITE_ID: &str = "toggle-favorite";
const TRAY_MENU_PREV_ID: &str = "prev-song";
const TRAY_MENU_PLAY_ID: &str = "toggle-play";
const TRAY_MENU_NEXT_ID: &str = "next-song";
const TRAY_MENU_PLAY_MODE_ID: &str = "cycle-play-mode";
const TRAY_MENU_DESKTOP_LYRICS_ID: &str = "open-desktop-lyrics";
const TRAY_MENU_MINI_PLAYER_ID: &str = "show-mini-player";
const TRAY_MENU_SETTINGS_ID: &str = "open-settings";
const TRAY_MENU_QUIT_ID: &str = "quit";

#[derive(serde::Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")] // 实现
pub(crate) struct NativeTrayMenuSong {
    title: Option<String>,
    name: Option<String>,
    artist: Option<String>,
}

#[derive(serde::Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")] // 实现
pub(crate) struct NativeTrayMenuState {
    current_song: Option<NativeTrayMenuSong>,
    is_playing: bool,
    play_mode: i32,
    show_desktop_lyrics: bool,
    is_favorite: bool,
    is_mini_mode: bool,
    use_custom_tray_menu: bool,
}

#[derive(Default)]
pub(crate) struct PendingOpenPaths(pub(crate) Mutex<Vec<String>>);

#[derive(Default)]
pub(crate) struct PendingDeepLinks(pub(crate) Mutex<Vec<String>>);

/// 本次进程是否由开机自启拉起。前端据此决定是否最小化到托盘（配合设置项）。
#[derive(Default)]
pub(crate) struct LaunchedAtStartupState(pub(crate) bool);

pub(crate) struct TrayMenuRuntimeState {
    native_menu_enabled: Mutex<bool>,
    /// 心跳超时导致的降级标记（区别于用户显式配置的原生菜单模式）：
    /// 心跳恢复后的首次右键据此把托盘切回配置模式，降级不再是单向不可逆
    degraded_by_heartbeat: Mutex<bool>,
    native_menu_state: Mutex<NativeTrayMenuState>,
    /// 前端心跳（毫秒时间戳）：webview 崩溃/卡死后停跳，托盘右键据此降级原生菜单
    last_heartbeat_ms: AtomicU64,
    /// 进程启动时刻（毫秒时间戳）：配合心跳识别「前端尚未挂载」的启动期
    started_at_ms: u64,
}

impl TrayMenuRuntimeState {
    fn new(started_at_ms: u64) -> Self {
        Self {
            native_menu_enabled: Mutex::new(false),
            degraded_by_heartbeat: Mutex::new(false),
            native_menu_state: Mutex::new(NativeTrayMenuState::default()),
            last_heartbeat_ms: AtomicU64::new(0),
            started_at_ms,
        }
    }
}

#[derive(Copy, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")] // 实现
struct TrayMenuOpenPayload { // TrayMenuOpenPayload
    x: f64,
    y: f64,
}

fn append_unique_paths(target: &mut Vec<String>, incoming: impl IntoIterator<Item = String>) { // append_unique_paths
    let mut seen = target.iter().cloned().collect::<HashSet<_>>(); // 实现

    for path in incoming { // 实现
        if seen.insert(path.clone()) { // 实现
            target.push(path); // 实现
        }
    }
}

/// 启动参数里是否带 `--autostart`（识别「本次由开机自启拉起」）。
/// 字面量取自 autostart.rs，避免写入端与识别端各写一份而漂移。
fn has_autostart_flag(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter()
        .any(|arg| arg.trim() == crate::autostart::AUTOSTART_ARG)
}

fn collect_existing_open_paths( // collect_existing_open_paths
    args: impl IntoIterator<Item = String>, // 实现
    current_exe: Option<&Path>, // 实现
) -> Vec<String> { // 实现
    let mut paths = Vec::new(); // 实现
    let mut seen = HashSet::new(); // 实现

    for arg in args { // 实现
        let trimmed = arg.trim(); // 实现
        if trimmed.is_empty() { // 实现
            continue;
        }

        // 跳过命令行开关（如 `--autostart`），它们不是待打开的文件路径。
        if trimmed.starts_with('-') {
            continue;
        }

        if trimmed.starts_with(DEEP_LINK_SCHEME) || trimmed.contains("://") {
            continue;
        }

        let normalized = crate::music::utils::normalize_path(trimmed); // 实现
        if normalized.is_empty() { // 实现
            continue;
        }

        let candidate = PathBuf::from(&normalized); // 实现
        if !candidate.exists() { // 实现
            continue;
        }

        if current_exe.is_some_and(|exe| exe == candidate.as_path()) { // 实现
            continue;
        }

        if seen.insert(normalized.clone()) { // 实现
            paths.push(normalized); // 实现
        }
    }

    paths
}

fn queue_open_paths<R: tauri::Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) { // 实现
    if paths.is_empty() { // 实现
        return;
    }

    if let Some(state) = app.try_state::<PendingOpenPaths>() { // 实现
        if let Ok(mut pending_paths) = state.0.lock() { // 实现
            append_unique_paths(&mut pending_paths, paths); // 实现
        }
    }
}

fn collect_deep_links(args: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut links = Vec::new();
    let mut seen = HashSet::new(); // 实现
    for arg in args { // 实现
        let trimmed = arg.trim().to_string();
        if trimmed.starts_with(DEEP_LINK_SCHEME) && seen.insert(trimmed.clone()) {
            links.push(trimmed);
        }
    }
    links
}

fn queue_deep_links<R: tauri::Runtime>(app: &tauri::AppHandle<R>, links: Vec<String>) {
    if links.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<PendingDeepLinks>() {
        let has_new = state
            .0
            .lock()
            .map(|mut pending| {
                let before = pending.len();
                append_unique_paths(&mut pending, links);
                pending.len() > before
            })
            .unwrap_or(false);
        if has_new {
            let _ = app.emit(APP_DEEP_LINK_EVENT, ());
        }
    }
}

fn reveal_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) { // 实现
    let mini_player_visible = app // 实现
        .get_webview_window(MINI_PLAYER_WINDOW_LABEL) // 实现
        .and_then(|window| window.is_visible().ok()) // 实现
        .unwrap_or(false); // 实现

    if mini_player_visible { // 实现
        let _ = app.emit(APP_SHOW_MAIN_EVENT, ()); // 实现
        return;
    }

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) { // 实现
        let _ = window.unminimize(); // 实现
        let _ = window.show(); // 实现
        let _ = window.set_focus(); // 实现
    }
}

fn emit_tray_action<R: tauri::Runtime>(app: &tauri::AppHandle<R>, action: &str) {
    let _ = app.emit(APP_TRAY_MENU_EVENT, action);
}

fn emit_tray_menu_open<R: tauri::Runtime>(app: &tauri::AppHandle<R>, x: f64, y: f64) { // 实现
    let _ = app.emit(APP_TRAY_MENU_OPEN_EVENT, TrayMenuOpenPayload { x, y }); // 实现
}

/// 心跳超时阈值：超过该时长未收到前端心跳即认定 webview 不可用。
fn frontend_alive_after_ms() -> u64 {
    12_000
}

/// 前端启动宽限期：进程启动后该时长内，即使尚未收到任何心跳也视为存活。
/// 前端挂载完成前右键托盘不能触发降级——否则一次启动竞态就会把本次会话
/// 永久钉在原生菜单（前端未崩溃就不会重推配置，降级无法自愈）。
const FRONTEND_BOOT_GRACE_MS: u64 = 60_000;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

/// 前端是否存活：12 秒内有心跳；或从未上报过心跳但进程仍在启动宽限期内
/// （前端尚未挂载完成，不能据此降级，见 FRONTEND_BOOT_GRACE_MS）。
fn frontend_alive<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    let Some(state) = app.try_state::<TrayMenuRuntimeState>() else {
        return false;
    };
    let last = state.last_heartbeat_ms.load(Ordering::Relaxed);
    if last == 0 {
        return now_ms().saturating_sub(state.started_at_ms) < FRONTEND_BOOT_GRACE_MS;
    }
    last + frontend_alive_after_ms() >= now_ms()
}

/// 前端心跳上报：托盘右键据此判断 webview 是否可用（见 on_tray_icon_event）。
#[tauri::command]
pub(crate) fn tray_heartbeat<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    let now = now_ms();
    if let Some(state) = app.try_state::<TrayMenuRuntimeState>() {
        state.last_heartbeat_ms.store(now, Ordering::Relaxed);
    }
}

/// 前端不可用时把托盘降级回原生菜单（含退出项，退出在 Rust 端闭环）。
/// 降级打上 degraded_by_heartbeat 标记：心跳恢复后的首次右键自动切回配置
/// 模式（见 restore_from_degrade_if_needed）。Tauri 的 TrayIcon 无程序化
/// popup，因此本次右键已错过挂载时机，菜单在下次右键时由系统弹出。
fn degrade_to_native_tray_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(state) = app.try_state::<TrayMenuRuntimeState>() {
        if let Ok(mut enabled) = state.native_menu_enabled.lock() {
            *enabled = true;
        }
        if let Ok(mut degraded) = state.degraded_by_heartbeat.lock() {
            *degraded = true;
        }
        let menu_state = state.native_menu_state.lock().ok().map(|value| value.clone());
        if let Some(menu_state) = menu_state {
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                if let Ok(menu) = build_tray_menu(app, &menu_state) {
                    let _ = tray.set_menu(Some(menu));
                }
            }
        }
    }
}

/// 心跳恢复后的首次右键：把「心跳降级」状态切回当前配置模式。
/// 只处理 degraded_by_heartbeat 标记的降级，不覆盖用户显式选择的原生菜单
/// 模式。返回是否已切回自定义菜单模式（调用方据此放行本次呼出事件）。
fn restore_from_degrade_if_needed<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    let Some(state) = app.try_state::<TrayMenuRuntimeState>() else {
        return false;
    };
    let was_degraded = state
        .degraded_by_heartbeat
        .lock()
        .map(|mut value| {
            let was = *value;
            *value = false;
            was
        })
        .unwrap_or(false);
    if !was_degraded {
        return false;
    }
    let menu_state = state.native_menu_state.lock().ok().map(|value| value.clone());
    let Some(menu_state) = menu_state else {
        return false;
    };
    let custom = menu_state.use_custom_tray_menu;
    if set_native_tray_menu_enabled(app, !custom).is_ok() {
        let _ = apply_tray_menu(app, &menu_state);
    }
    custom
}

fn is_native_tray_menu_enabled<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    app.try_state::<TrayMenuRuntimeState>()
        .and_then(|state| state.native_menu_enabled.lock().ok().map(|value| *value))
        .unwrap_or(false)
}

fn set_native_tray_menu_enabled<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>, // 实现
    enabled: bool,
) -> Result<(), String> {
    if let Some(state) = app.try_state::<TrayMenuRuntimeState>() {
        let mut native_menu_enabled = state
            .native_menu_enabled
            .lock()
            .map_err(|error| error.to_string())?;
        *native_menu_enabled = enabled;
    }

    if !enabled {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            tray.set_menu(None::<Menu<R>>)
                .map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn set_native_tray_menu_state<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>, // 实现
    state: NativeTrayMenuState,
) -> Result<(), String> {
    if let Some(runtime_state) = app.try_state::<TrayMenuRuntimeState>() {
        let mut native_menu_state = runtime_state
            .native_menu_state
            .lock()
            .map_err(|error| error.to_string())?;
        *native_menu_state = state;
    }

    Ok(())
}

fn clean_track_name(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(name)
        .trim()
        .to_string()
}

fn tray_track_title(state: &NativeTrayMenuState) -> String {
    state
        .current_song
        .as_ref()
        .and_then(|song| {
            song.title
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .or_else(|| {
                    song.name
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(clean_track_name)
                })
        })
        .unwrap_or_else(|| "XianYu Music".to_string())
}

fn tray_track_artist(state: &NativeTrayMenuState) -> String {
    state
        .current_song
        .as_ref()
        .and_then(|song| song.artist.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("本地音乐播放器")
        .to_string()
}

fn tray_play_mode_label(play_mode: i32) -> &'static str {
    match play_mode {
        1 => "单曲循环",
        2 => "随机播放",
        _ => "列表循环",
    }
}

fn build_tray_menu<R: tauri::Runtime>(
    manager: &impl Manager<R>,
    state: &NativeTrayMenuState,
) -> tauri::Result<Menu<R>> {
    let title = MenuItem::with_id(
        manager,
        TRAY_MENU_TRACK_TITLE_ID,
        tray_track_title(state),
        false,
        None::<&str>,
    )?;
    let artist = MenuItem::with_id(
        manager,
        TRAY_MENU_TRACK_ARTIST_ID,
        tray_track_artist(state),
        false,
        None::<&str>,
    )?;
    let separator_top = PredefinedMenuItem::separator(manager)?;
    let favorite = CheckMenuItem::with_id(
        manager,
        TRAY_MENU_FAVORITE_ID,
        "收藏",
        true,
        state.is_favorite,
        None::<&str>,
    )?;
    let prev = MenuItem::with_id(manager, TRAY_MENU_PREV_ID, "上一首", true, None::<&str>)?;
    let play_label = if state.is_playing { "暂停" } else { "播放" };
    let play = MenuItem::with_id(manager, TRAY_MENU_PLAY_ID, play_label, true, None::<&str>)?;
    let next = MenuItem::with_id(manager, TRAY_MENU_NEXT_ID, "下一首", true, None::<&str>)?;
    let mode = MenuItem::with_id(
        manager,
        TRAY_MENU_PLAY_MODE_ID,
        tray_play_mode_label(state.play_mode),
        true,
        None::<&str>,
    )?;
    let separator_controls = PredefinedMenuItem::separator(manager)?;
    let desktop_lyrics = CheckMenuItem::with_id(
        manager,
        TRAY_MENU_DESKTOP_LYRICS_ID,
        "桌面歌词",
        true,
        state.show_desktop_lyrics,
        None::<&str>,
    )?;
    let separator_window = PredefinedMenuItem::separator(manager)?;
    let mini_label = if state.is_mini_mode {
        "恢复主窗口"
    } else {
        "mini窗口"
    };
    let mini = MenuItem::with_id(
        manager,
        TRAY_MENU_MINI_PLAYER_ID,
        mini_label,
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(manager, TRAY_MENU_SETTINGS_ID, "设置", true, None::<&str>)?;
    let separator_quit = PredefinedMenuItem::separator(manager)?;
    let quit = MenuItem::with_id(manager, TRAY_MENU_QUIT_ID, "退出", true, None::<&str>)?;

    Menu::with_items(
        manager,
        &[
            &title,
            &artist,
            &separator_top,
            &favorite,
            &prev,
            &play,
            &next,
            &mode,
            &separator_controls,
            &desktop_lyrics,
            &separator_window,
            &mini,
            &settings,
            &separator_quit,
            &quit,
        ],
    )
}

fn apply_tray_menu<R: tauri::Runtime>(
    manager: &impl Manager<R>,
    state: &NativeTrayMenuState,
) -> tauri::Result<()> {
    if let Some(tray) = manager.app_handle().tray_by_id(TRAY_ID) {
        tray.set_show_menu_on_left_click(false)?;

        if state.use_custom_tray_menu {
            tray.set_menu(None::<Menu<R>>)?;
        } else {
            let menu = build_tray_menu(manager, state)?;
            tray.set_menu(Some(menu))?;
        }
    }
    Ok(())
}

fn install_window_boundary<R: tauri::Runtime>(app: &tauri::App<R>) { // 实现
    #[cfg(windows)]
    {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) { // 实现
            use raw_window_handle::{HasWindowHandle};

            if let Ok(handle) = window.as_ref().window().window_handle() { // 实现
                if let raw_window_handle::RawWindowHandle::Win32(win32) = handle.as_raw() { // 实现
                    crate::window_boundary::install_boundary_subclass(win32.hwnd.get() as isize); // 实现
                }
            }
        }
    }
}

fn build_tray<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<()> { // 实现
    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(
            app.default_window_icon()
                .ok_or_else(|| std::io::Error::other("no default window icon"))?
                .clone(),
        )
        .tooltip("弦予音乐")
        .show_menu_on_left_click(false) // 实现
        .on_menu_event(|app, event| {
            let action = event.id().as_ref();
            match action {
                TRAY_MENU_FAVORITE_ID
                | TRAY_MENU_PREV_ID
                | TRAY_MENU_PLAY_ID
                | TRAY_MENU_NEXT_ID
                | TRAY_MENU_PLAY_MODE_ID
                | TRAY_MENU_DESKTOP_LYRICS_ID
                | TRAY_MENU_MINI_PLAYER_ID
                | TRAY_MENU_SETTINGS_ID => emit_tray_action(app, action),
                TRAY_MENU_QUIT_ID => {
                    // 退出必须在 Rust 端闭环：弹出原生菜单的降级场景多因前端
                    // 已崩溃，emit 无人处理会导致永远无法退出
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| { // 实现
            if let TrayIconEvent::Click { // 实现
                button: MouseButton::Left, // 实现
                button_state: MouseButtonState::Up, // 实现
                ..
            } = event
            {
                reveal_main_window(&tray.app_handle()); // 实现
                return;
            }

            if let TrayIconEvent::Click { // 实现
                button: MouseButton::Right, // 实现
                button_state: MouseButtonState::Up, // 实现
                position,
                ..
            } = event
            {
                let app = tray.app_handle();
                if is_native_tray_menu_enabled(&app) {
                    // 原生菜单挂载中：可能是心跳降级，也可能是用户配置。
                    // 心跳正常即前端已恢复，先把降级态切回配置模式；若切回了
                    // 自定义模式则直接放行本次呼出（配置为原生模式时不切换，
                    // 本次右键仍由系统弹出原生菜单）。
                    if frontend_alive(&app) && restore_from_degrade_if_needed(&app) {
                        emit_tray_menu_open(&app, position.x, position.y);
                    }
                    return;
                }
                if frontend_alive(&app) {
                    emit_tray_menu_open(&app, position.x, position.y);
                    return;
                }
                // 前端心跳超时（webview 崩溃/卡死）：降级挂回原生菜单，
                // 下次右键由系统弹出，保证始终有可用的退出途径
                degrade_to_native_tray_menu(&app);
            }
        })
        .build(app.handle())?; // 实现

    Ok(())
}

// 仅 release 构建使用（debug 不挂单实例插件，见 lib.rs）。
#[cfg(not(debug_assertions))]
pub(crate) fn handle_single_instance<R: tauri::Runtime>( // 实现
    app: &tauri::AppHandle<R>, // 实现
    argv: Vec<String>, // 实现
) {
    let current_exe = std::env::current_exe().ok(); // 实现
    let deep_links = collect_deep_links(argv.iter().cloned());
    let open_paths = collect_existing_open_paths(argv, current_exe.as_deref()); // 实现
    queue_deep_links(app, deep_links);
    queue_open_paths(app, open_paths); // 实现
    let _ = app.emit("app:open-paths", ()); // 实现
    reveal_main_window(app); // 实现
}

#[cfg_attr(
    not(any(target_os = "macos", target_os = "ios", target_os = "android")),
    allow(dead_code)
)]
pub(crate) fn handle_opened_urls<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>, // 实现
    urls: Vec<tauri::Url>,
) {
    let paths: Vec<String> = urls
        .iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| path.exists())
        .map(|path| crate::music::utils::normalize_path(path.to_string_lossy().as_ref()))
        .filter(|normalized| !normalized.is_empty())
        .collect();
    if paths.is_empty() { // 实现
        return;
    }
    queue_open_paths(app, paths);
    let _ = app.emit("app:open-paths", ()); // 实现
    reveal_main_window(app); // 实现
}

pub(crate) fn setup_app( // setup_app
    app: &mut tauri::App<tauri::Wry>, // 实现
) -> Result<(), Box<dyn std::error::Error>> { // 实现
    // 黑匣子最先装：后续任何启动期 panic 也要有落盘痕迹。
    crate::crash_log::install(app.handle());

    // 网络代理必须在构造任何 HTTP client 之前确定，故放在 setup 的第一步。
    crate::netproxy::load(app.handle());

    // 高占用保命：提升主进程调度优先级并退出 EcoQoS 节流，负载打满时保住
    // 音频与界面响应（仅 Windows，其它平台保持默认调度）。
    crate::process_priority::boost();

    // 托盘兜底：拉起独立守护进程。主进程崩溃/卡死时它弹出可用的兜底托盘
    // （重启/强杀入口），正常退出时收到事件随主进程自退（仅 Windows）。
    crate::tray_daemon::spawn();

    app.manage(PendingOpenPaths::default()); // 实现
    app.manage(PendingDeepLinks::default());
    app.manage(TrayMenuRuntimeState::new(now_ms()));
    app.manage(crate::sleep_timer::SleepTimerState::default());

    // 记录本次是否为开机自启拉起：前端据此决定是否直接最小化到托盘。
    let launched_at_startup = has_autostart_flag(std::env::args());
    app.manage(LaunchedAtStartupState(launched_at_startup));

    let min_size_cfg = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN_WINDOW_LABEL)
        .and_then(|w| match (w.min_width, w.min_height) {
            (Some(w), Some(h)) => Some((w, h)),
            _ => None,
        });
    if let (Some(main), Ok(config_dir), Some((min_w, min_h))) = (
        app.get_webview_window(MAIN_WINDOW_LABEL),
        app.path().app_config_dir(),
        min_size_cfg,
    ) {
        if !config_dir.join(".window-state.json").exists() {
            let scale = main.scale_factor().unwrap_or(1.0);
            let _ = main.set_size(tauri::PhysicalSize::new(min_w * scale, min_h * scale));
            let _ = main.center();
        }
    }

    let db_state = DbState::new(app.handle())?; // 实现

    let playback_session = PlaybackSessionState::new();
    if let Err(e) = playback_session.load_from_db(&db_state) {
        eprintln!("[Session] 启动预加载播放会话失败: {}", e);
    }
    app.manage(playback_session);

    app.manage(db_state); // 实现

    let player_state = init_player(app.handle()); // 实现
    app.manage(player_state); // 实现

    app.manage(ThumbnailImageConcurrencyLimit(Semaphore::new( // 实现
        THUMBNAIL_IMAGE_CONCURRENCY_LIMIT, // 实现
    )));
    app.manage(FullCoverImageConcurrencyLimit(Semaphore::new( // 实现
        FULL_COVER_IMAGE_CONCURRENCY_LIMIT, // 实现
    )));

    let plugin_engine_state = crate::plugin_host::commands::init_engine_state(app.handle());
    // 兜底模块宿主复用插件引擎的 HTTP 桥（SSRF 防护 / client 缓存共享）
    app.manage(crate::fallback_host::commands::init_fallback_state(
        plugin_engine_state.engine.http().clone(),
    ));
    app.manage(plugin_engine_state);

    run_cache_cleanup(app.handle()); // 实现

    let current_exe = std::env::current_exe().ok(); // 实现
    let startup_args: Vec<String> = std::env::args().skip(1).collect();
    let initial_open_paths = // 实现
        collect_existing_open_paths(startup_args.iter().cloned(), current_exe.as_deref());
    queue_open_paths(app.handle(), initial_open_paths); // 实现
    let initial_deep_links = collect_deep_links(startup_args);
    queue_deep_links(app.handle(), initial_deep_links);

    install_window_boundary(app); // 实现
    build_tray(app)?; // 实现

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) { // 实现
        crate::webview_settings::disable_browser_accelerator_keys(&window);
    }

    start_control_channel(app.handle().clone());

    Ok(())
}

/// 控制通道：配对鉴权 + 常驻 TCP 监听 + SSDP 通告 + 事件转发 TS。
fn start_control_channel(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let core = crate::control_channel::ControlCore::shared();
        let config_dir = handle
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."));
        core.init_pairing(&config_dir);
        match core.ensure_started().await {
            Ok(port) => eprintln!("[control] listening on port {port}"),
            Err(e) => eprintln!("[control] start failed: {e}"),
        }
        let Some(mut rx) = core.take_event_rx().await else {
            return;
        };
        while let Some(evt) = rx.recv().await {
            match evt {
                crate::control_channel::ServerEvent::ClientConnected { id, name } => {
                    let _ = handle.emit(
                        "desktop-control-client",
                        serde_json::json!({ "connected": true, "id": id, "name": name }),
                    );
                }
                crate::control_channel::ServerEvent::ClientDisconnected { id, name } => {
                    let _ = handle.emit(
                        "desktop-control-client",
                        serde_json::json!({ "connected": false, "id": id, "name": name }),
                    );
                }
                crate::control_channel::ServerEvent::Command { id, action, arg } => {
                    let _ = handle.emit(
                        "desktop-control-cmd",
                        serde_json::json!({ "id": id, "action": action, "arg": arg }),
                    );
                }
            }
        }
    });
}

#[tauri::command] // 实现
pub(crate) fn consume_pending_open_paths( // consume_pending_open_paths
    state: tauri::State<PendingOpenPaths>, // 实现
) -> Result<Vec<String>, String> { // 实现
    let mut pending_paths = state.0.lock().map_err(|error| error.to_string())?; // 实现
    Ok(std::mem::take(&mut *pending_paths)) // 实现
}

#[tauri::command] // 实现
pub(crate) fn consume_pending_deep_links(
    state: tauri::State<PendingDeepLinks>,
) -> Result<Vec<String>, String> { // 实现
    let mut pending = state.0.lock().map_err(|error| error.to_string())?;
    Ok(std::mem::take(&mut *pending))
}

/// 本次进程是否由开机自启拉起（前端据此决定是否最小化到托盘）。
#[tauri::command]
pub(crate) fn was_launched_at_startup(state: tauri::State<LaunchedAtStartupState>) -> bool {
    state.0
}

#[tauri::command] // 实现
pub(crate) fn exit_app(app: tauri::AppHandle) {
    crate::graceful_shutdown(&app);
}

/// 重启应用。给「必须重建进程内 HTTP client 才会完全生效」的设置用（当前是网络代理）。
///
/// 不走 `graceful_shutdown`：那条路径会直接 `app.exit(0)`，退出后不会重启。这里交给
/// Tauri 的 `AppHandle::restart()`——从非主线程调用时它会触发一次正常的退出流程
/// （窗口状态保存、WebView 缓存清理等照常发生），再拉起新进程。
#[tauri::command]
pub(crate) fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    // restart 在主线程直接走 process::restart，不触发 RunEvent::Exit，
    // 需先显式通知守护进程随旧进程退出（新进程会拉起自己的守护进程）
    crate::tray_daemon::signal_exit();
    app.restart()
}

#[tauri::command] // 实现
pub(crate) fn update_native_tray_menu(
    app: tauri::AppHandle,
    state: NativeTrayMenuState,
) -> Result<(), String> {
    set_native_tray_menu_state(&app, state.clone())?;
    set_native_tray_menu_enabled(&app, !state.use_custom_tray_menu)?;
    apply_tray_menu(&app, &state).map_err(|error| error.to_string())
}

#[cfg(any(feature = "devtools", debug_assertions))]
#[tauri::command] // 实现
pub(crate) fn open_devtools(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or("main window not found")?;
    let _: () = window.open_devtools();
    Ok(())
}

#[cfg(not(any(feature = "devtools", debug_assertions)))]
#[tauri::command] // 实现
pub(crate) fn open_devtools(_app: tauri::AppHandle) -> Result<(), String> {
    Err("DevTools 在生产构建中不可用".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn detects_autostart_flag() {
        assert!(has_autostart_flag(args(&["--autostart"])));
        assert!(has_autostart_flag(args(&[
            "C:\\Music\\song.flac",
            "--autostart"
        ])));
        // 单实例转发 argv 时同样能识别。
        assert!(has_autostart_flag(args(&["xianyu://play/1", "--autostart"])));
    }

    #[test]
    fn ignores_absent_or_different_flags() {
        assert!(!has_autostart_flag(args(&[])));
        assert!(!has_autostart_flag(args(&["C:\\Music\\song.flac"])));
        assert!(!has_autostart_flag(args(&["--autostart-extra"])));
    }

    #[test]
    fn autostart_flag_is_not_treated_as_a_path() {
        // 仅有开关、没有真实文件：解析结果应为空，且开关不会混进路径。
        let startup = args(&["--autostart"]);
        let paths = collect_existing_open_paths(startup.iter().cloned(), None);
        assert!(paths.is_empty());
        let deep_links = collect_deep_links(startup);
        assert!(deep_links.is_empty());
    }
}
