//! mac 应用菜单栏：本地化标准菜单（应用名 / 文件 / 编辑 / 显示 / 控制 / 窗口）。
//!
//! Tauri 默认菜单的子菜单标题是英文硬编码（File/Edit/View/...），中文系统下
//! 不符合 mac 原生观感。这里按应用内语言设置重建整份菜单：预置项（撤销、
//! 拷贝、全屏、隐藏等）走系统 selector，快捷键与行为由 AppKit 保证；标题由
//! 我们按语言传入。前端就绪后会按用户设置的语言调用 set_app_menu_language
//! 校正（默认跟随系统语言）。
//!
//! 「控制」子菜单承载播放功能（播放/上一首/下一首/收藏/播放模式/桌面歌词/
//! mini 窗口/设置），action id 与托盘原生菜单共用，事件经 app_runtime 的
//! handle_app_menu_event 转发前端 handleTrayMenuAction 处理；动态标题与
//! 勾选态跟随前端推送的 NativeTrayMenuState（托盘状态推送链路复用）。
//!
//! 仅 macOS 挂菜单：Windows/Linux 的窗口菜单会渲染进窗口内容区，不适用。

// 非 macOS 平台仅编译跨平台 stub，主体（菜单构建/文案表）无消费者属预期
#![cfg_attr(not(target_os = "macos"), allow(dead_code, unused_imports))]

use std::sync::Mutex;

use tauri::{
    menu::{AboutMetadata, CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Runtime,
};

// 控制子菜单 action id 与托盘原生菜单共用；相关条目仅 macOS 菜单构建消费
#[cfg(target_os = "macos")]
use crate::app_runtime::{
    current_native_tray_menu_state, NativeTrayMenuState, TRAY_MENU_DESKTOP_LYRICS_ID,
    TRAY_MENU_FAVORITE_ID, TRAY_MENU_MINI_PLAYER_ID, TRAY_MENU_NEXT_ID, TRAY_MENU_PLAY_ID,
    TRAY_MENU_PLAY_MODE_ID, TRAY_MENU_PREV_ID, TRAY_MENU_SETTINGS_ID,
};

/// 应用名（菜单里反复出现：隐藏/退出/关于等）
const APP_NAME: &str = "弦予音乐";
const APP_NAME_EN: &str = "XianYu Music";

/// 最近一次应用菜单语言（set_app_menu_language 写入；托盘状态变化重建时复用）
#[cfg(target_os = "macos")]
static MENU_LANGUAGE: Mutex<Option<String>> = Mutex::new(None);

/// 三个语言包的菜单文案；与前端 AppLanguage（zh-CN / zh-TW / en-US）一一对应
#[derive(Clone, Copy)]
struct MenuText {
    about: &'static str,
    hide: &'static str,
    hide_others: &'static str,
    show_all: &'static str,
    quit: &'static str,
    file: &'static str,
    close_window: &'static str,
    edit: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    view: &'static str,
    fullscreen: &'static str,
    controls: &'static str,
    play: &'static str,
    pause: &'static str,
    prev_song: &'static str,
    next_song: &'static str,
    favorite: &'static str,
    mode_loop: &'static str,
    mode_repeat_one: &'static str,
    mode_shuffle: &'static str,
    desktop_lyrics: &'static str,
    mini_player: &'static str,
    mini_restore: &'static str,
    settings: &'static str,
    window: &'static str,
    minimize: &'static str,
    zoom: &'static str,
    bring_all_to_front: &'static str,
}

const ZH_CN: MenuText = MenuText {
    about: "关于弦予音乐",
    hide: "隐藏弦予音乐",
    hide_others: "隐藏其他",
    show_all: "显示全部",
    quit: "退出弦予音乐",
    file: "文件",
    close_window: "关闭窗口",
    edit: "编辑",
    undo: "撤销",
    redo: "重做",
    cut: "剪切",
    copy: "拷贝",
    paste: "粘贴",
    select_all: "全选",
    view: "显示",
    fullscreen: "进入全屏幕",
    controls: "控制",
    play: "播放",
    pause: "暂停",
    prev_song: "上一首",
    next_song: "下一首",
    favorite: "收藏歌曲",
    mode_loop: "列表循环",
    mode_repeat_one: "单曲循环",
    mode_shuffle: "随机播放",
    desktop_lyrics: "桌面歌词",
    mini_player: "mini 窗口",
    mini_restore: "恢复主窗口",
    settings: "设置…",
    window: "窗口",
    minimize: "最小化",
    zoom: "缩放",
    bring_all_to_front: "前置全部窗口",
};

const ZH_TW: MenuText = MenuText {
    about: "關於弦予音樂",
    hide: "隱藏弦予音樂",
    hide_others: "隱藏其他",
    show_all: "顯示全部",
    quit: "結束弦予音樂",
    file: "檔案",
    close_window: "關閉視窗",
    edit: "編輯",
    undo: "復原",
    redo: "重做",
    cut: "剪下",
    copy: "拷貝",
    paste: "貼上",
    select_all: "全選",
    view: "顯示方式",
    fullscreen: "進入全螢幕",
    controls: "控制",
    play: "播放",
    pause: "暫停",
    prev_song: "上一首",
    next_song: "下一首",
    favorite: "收藏歌曲",
    mode_loop: "列表循環",
    mode_repeat_one: "單曲循環",
    mode_shuffle: "隨機播放",
    desktop_lyrics: "桌面歌詞",
    mini_player: "mini 視窗",
    mini_restore: "回復主視窗",
    settings: "設定…",
    window: "視窗",
    minimize: "縮到最小",
    zoom: "縮放",
    bring_all_to_front: "將此程式所有視窗移至最前",
};

const EN_US: MenuText = MenuText {
    about: "About XianYu Music",
    hide: "Hide XianYu Music",
    hide_others: "Hide Others",
    show_all: "Show All",
    quit: "Quit XianYu Music",
    file: "File",
    close_window: "Close Window",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    select_all: "Select All",
    view: "View",
    fullscreen: "Enter Full Screen",
    controls: "Controls",
    play: "Play",
    pause: "Pause",
    prev_song: "Previous",
    next_song: "Next",
    favorite: "Favorite Song",
    mode_loop: "List Loop",
    mode_repeat_one: "Repeat One",
    mode_shuffle: "Shuffle",
    desktop_lyrics: "Desktop Lyrics",
    mini_player: "Mini Player",
    mini_restore: "Restore Main Window",
    settings: "Settings…",
    window: "Window",
    minimize: "Minimize",
    zoom: "Zoom",
    bring_all_to_front: "Bring All to Front",
};

impl MenuText {
    /// 前端 AppLanguage（'zh-CN' / 'zh-TW' / 'en-US'）→ 文案表；未知值回落简体
    fn for_language(language: &str) -> Self {
        match language {
            "zh-TW" => ZH_TW,
            "en-US" => EN_US,
            _ => ZH_CN,
        }
    }
}

/// 启动期系统语言探测：读 macOS 当前 locale（NSLocale currentLocale，
/// 形如 zh-CN / zh-Hant-TW / en_CN）。前端就绪后仍会按应用内语言设置校正。
#[cfg(target_os = "macos")]
pub fn system_menu_language() -> String {
    use objc2::rc::autoreleasepool;
    use objc2_foundation::NSLocale;

    let locale = NSLocale::currentLocale();
    let identifier = locale.localeIdentifier();
    let code = autoreleasepool(|pool| unsafe { identifier.to_str(pool) }.to_string());
    let lower = code.to_ascii_lowercase();
    if lower.starts_with("zh-hant") || lower.starts_with("zh-tw") || lower.starts_with("zh-hk") || lower.starts_with("zh-mo") {
        "zh-TW".to_string()
    } else if lower.starts_with("en") {
        "en-US".to_string()
    } else {
        "zh-CN".to_string()
    }
}

/// 构建（或按语言/状态重建）mac 应用菜单并挂到应用上；第一个子菜单自动成为应用菜单
#[cfg(target_os = "macos")]
fn build_and_apply<R: Runtime>(
    app: &AppHandle<R>,
    text: &MenuText,
    app_name: &str,
    state: &NativeTrayMenuState,
) -> tauri::Result<()> {
    // 应用菜单：关于 / 隐藏 / 显示全部 / 退出（快捷键由系统预置项自带）
    let app_submenu = Submenu::with_id(app, "app-menu", app_name, true)?;
    app_submenu.append(&PredefinedMenuItem::about(
        app,
        Some(text.about),
        Some(AboutMetadata {
            name: Some(app_name.to_string()),
            version: Some(app.package_info().version.to_string()),
            ..Default::default()
        }),
    )?)?;
    app_submenu.append(&PredefinedMenuItem::separator(app)?)?;
    app_submenu.append(&PredefinedMenuItem::hide(app, Some(text.hide))?)?;
    app_submenu.append(&PredefinedMenuItem::hide_others(app, Some(text.hide_others))?)?;
    app_submenu.append(&PredefinedMenuItem::show_all(app, Some(text.show_all))?)?;
    app_submenu.append(&PredefinedMenuItem::separator(app)?)?;
    app_submenu.append(&PredefinedMenuItem::quit(app, Some(text.quit))?)?;

    // 文件：关闭窗口（Cmd+W）
    let file_submenu = Submenu::with_id(app, "file-menu", text.file, true)?;
    file_submenu.append(&PredefinedMenuItem::close_window(app, Some(text.close_window))?)?;

    // 编辑：文本编辑标准项（Webview 内的撤销/拷贝/粘贴等靠这些 selector 生效）
    let edit_submenu = Submenu::with_id(app, "edit-menu", text.edit, true)?;
    edit_submenu.append(&PredefinedMenuItem::undo(app, Some(text.undo))?)?;
    edit_submenu.append(&PredefinedMenuItem::redo(app, Some(text.redo))?)?;
    edit_submenu.append(&PredefinedMenuItem::separator(app)?)?;
    edit_submenu.append(&PredefinedMenuItem::cut(app, Some(text.cut))?)?;
    edit_submenu.append(&PredefinedMenuItem::copy(app, Some(text.copy))?)?;
    edit_submenu.append(&PredefinedMenuItem::paste(app, Some(text.paste))?)?;
    edit_submenu.append(&PredefinedMenuItem::select_all(app, Some(text.select_all))?)?;

    // 显示：全屏（Ctrl+Cmd+F，系统自带动画与绿键同源）
    let view_submenu = Submenu::with_id(app, "view-menu", text.view, true)?;
    view_submenu.append(&PredefinedMenuItem::fullscreen(app, Some(text.fullscreen))?)?;

    // 控制：播控与常用功能，与托盘菜单同一批 action，事件转发前端处理
    let controls_submenu = Submenu::with_id(app, "controls-menu", text.controls, true)?;
    let play_label = if state.is_playing { text.pause } else { text.play };
    controls_submenu.append(&MenuItem::with_id(
        app,
        TRAY_MENU_PLAY_ID,
        play_label,
        true,
        None::<&str>,
    )?)?;
    controls_submenu.append(&MenuItem::with_id(
        app,
        TRAY_MENU_PREV_ID,
        text.prev_song,
        true,
        None::<&str>,
    )?)?;
    controls_submenu.append(&MenuItem::with_id(
        app,
        TRAY_MENU_NEXT_ID,
        text.next_song,
        true,
        None::<&str>,
    )?)?;
    controls_submenu.append(&CheckMenuItem::with_id(
        app,
        TRAY_MENU_FAVORITE_ID,
        text.favorite,
        true,
        state.is_favorite,
        None::<&str>,
    )?)?;
    let mode_label = match state.play_mode {
        1 => text.mode_repeat_one,
        2 => text.mode_shuffle,
        _ => text.mode_loop,
    };
    controls_submenu.append(&MenuItem::with_id(
        app,
        TRAY_MENU_PLAY_MODE_ID,
        mode_label,
        true,
        None::<&str>,
    )?)?;
    controls_submenu.append(&PredefinedMenuItem::separator(app)?)?;
    controls_submenu.append(&CheckMenuItem::with_id(
        app,
        TRAY_MENU_DESKTOP_LYRICS_ID,
        text.desktop_lyrics,
        true,
        state.show_desktop_lyrics,
        None::<&str>,
    )?)?;
    let mini_label = if state.is_mini_mode {
        text.mini_restore
    } else {
        text.mini_player
    };
    controls_submenu.append(&MenuItem::with_id(
        app,
        TRAY_MENU_MINI_PLAYER_ID,
        mini_label,
        true,
        None::<&str>,
    )?)?;
    controls_submenu.append(&PredefinedMenuItem::separator(app)?)?;
    controls_submenu.append(&MenuItem::with_id(
        app,
        TRAY_MENU_SETTINGS_ID,
        text.settings,
        true,
        None::<&str>,
    )?)?;

    // 窗口：最小化 / 缩放 / 前置全部窗口
    let window_submenu = Submenu::with_id(app, "window-menu", text.window, true)?;
    window_submenu.append(&PredefinedMenuItem::minimize(app, Some(text.minimize))?)?;
    window_submenu.append(&PredefinedMenuItem::maximize(app, Some(text.zoom))?)?;
    window_submenu.append(&PredefinedMenuItem::separator(app)?)?;
    window_submenu.append(&PredefinedMenuItem::bring_all_to_front(app, Some(text.bring_all_to_front))?)?;

    let menu = Menu::with_items(
        app,
        &[
            &app_submenu,
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &controls_submenu,
            &window_submenu,
        ],
    )?;
    app.set_menu(menu)?;
    Ok(())
}

/// 按语言构建并挂载菜单（记录语言，供托盘状态变化时刷新复用）
#[cfg(target_os = "macos")]
pub fn apply_app_menu<R: Runtime>(app: &AppHandle<R>, language: &str) -> tauri::Result<()> {
    if let Ok(mut cached) = MENU_LANGUAGE.lock() {
        *cached = Some(language.to_string());
    }
    let text = MenuText::for_language(language);
    let app_name = if language == "en-US" { APP_NAME_EN } else { APP_NAME };
    let state = current_native_tray_menu_state(app);
    build_and_apply(app, &text, app_name, &state)
}

/// 托盘状态变化（播放/收藏/桌面歌词等）时按最近语言重建，刷新动态项
#[cfg(target_os = "macos")]
pub fn refresh_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let language = MENU_LANGUAGE
        .lock()
        .ok()
        .and_then(|cached| cached.clone())
        .unwrap_or_else(system_menu_language);
    let text = MenuText::for_language(&language);
    let app_name = if language == "en-US" { APP_NAME_EN } else { APP_NAME };
    let state = current_native_tray_menu_state(app);
    build_and_apply(app, &text, app_name, &state)
}

/// 非 mac 平台占位：无原生菜单栏概念，保持默认（不渲染任何菜单）
#[cfg(not(target_os = "macos"))]
pub fn apply_app_menu<R: Runtime>(_app: &AppHandle<R>, _language: &str) -> tauri::Result<()> {
    Ok(())
}

/// 前端命令：应用内语言设置变化时重建菜单（'zh-CN' / 'zh-TW' / 'en-US'）
#[tauri::command]
pub(crate) fn set_app_menu_language(app: AppHandle, language: String) -> Result<(), String> {
    apply_app_menu(&app, &language).map_err(|error| error.to_string())
}
