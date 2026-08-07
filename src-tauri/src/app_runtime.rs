use crate::database::DbState;
use crate::music::{
    run_cache_cleanup, FullCoverImageConcurrencyLimit, ThumbnailImageConcurrencyLimit,
    FULL_COVER_IMAGE_CONCURRENCY_LIMIT, THUMBNAIL_IMAGE_CONCURRENCY_LIMIT,
};
use crate::player::init_player;
use crate::player::PlaybackSessionState;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tokio::sync::Semaphore;

const APP_SHOW_MAIN_EVENT: &str = "app:show-main";
const APP_TRAY_MENU_EVENT: &str = "app:tray-menu";
const APP_TRAY_MENU_OPEN_EVENT: &str = "app:tray-menu-open";
const MAIN_WINDOW_LABEL: &str = "main";
const MINI_PLAYER_WINDOW_LABEL: &str = "mini-player";
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
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeTrayMenuSong {
    title: Option<String>,
    name: Option<String>,
    artist: Option<String>,
}

#[derive(serde::Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
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
pub(crate) struct TrayMenuRuntimeState {
    native_menu_enabled: Mutex<bool>,
    native_menu_state: Mutex<NativeTrayMenuState>,
}

#[derive(serde::Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct TrayMenuOpenPayload {
    x: f64,
    y: f64,
}

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

fn emit_tray_action<R: tauri::Runtime>(app: &tauri::AppHandle<R>, action: &str) {
    let _ = app.emit(APP_TRAY_MENU_EVENT, action);
}

fn emit_tray_menu_open<R: tauri::Runtime>(app: &tauri::AppHandle<R>, x: f64, y: f64) {
    let _ = app.emit(APP_TRAY_MENU_OPEN_EVENT, TrayMenuOpenPayload { x, y });
}

fn is_native_tray_menu_enabled<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    app.try_state::<TrayMenuRuntimeState>()
        .and_then(|state| state.native_menu_enabled.lock().ok().map(|value| *value))
        .unwrap_or(false)
}

fn set_native_tray_menu_enabled<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
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
    app: &tauri::AppHandle<R>,
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
        .unwrap_or_else(|| "XY-Music".to_string())
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
    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("弦予音乐")
        .show_menu_on_left_click(false)
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
                | TRAY_MENU_SETTINGS_ID
                | TRAY_MENU_QUIT_ID => emit_tray_action(app, action),
                _ => {}
            }
        })
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
                let app = tray.app_handle();
                if !is_native_tray_menu_enabled(&app) {
                    emit_tray_menu_open(&app, position.x, position.y);
                }
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
    app.manage(TrayMenuRuntimeState::default());

    let db_state = DbState::new(app.handle())?;

    // 播放会话状态：启动时立即从 SQLite 预加载到内存，
    // 确保副窗口（mini/taskbar/desktop-lyrics）在主窗口恢复前
    // 调用 getPlaybackSession 也能拿到正确数据
    let playback_session = PlaybackSessionState::new();
    if let Err(e) = playback_session.load_from_db(&db_state) {
        eprintln!("[Session] 启动预加载播放会话失败: {}", e);
    }
    app.manage(playback_session);

    app.manage(db_state);

    let player_state = init_player(app.handle());
    app.manage(player_state);

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
pub(crate) fn update_native_tray_menu(
    app: tauri::AppHandle,
    state: NativeTrayMenuState,
) -> Result<(), String> {
    set_native_tray_menu_state(&app, state.clone())?;
    set_native_tray_menu_enabled(&app, !state.use_custom_tray_menu)?;
    apply_tray_menu(&app, &state).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn open_devtools(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or("main window not found")?;
    let _: () = window.open_devtools();
    Ok(())
}
