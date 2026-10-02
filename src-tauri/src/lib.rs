// 模块布局：按「运行时骨架 → 音频/媒体 → 窗口体系 → 工具与系统」的顺序登记。
mod app_runtime; mod audio_convert; mod audio_trim; mod autostart;
pub(crate) mod control_channel; mod custom_fonts; mod database; pub(crate) mod dlna;
pub mod error; mod fallback_verify; mod ffmpeg_bin; mod file_assoc; mod foreground_window;
mod host_crypto; mod install_language; mod music; mod netproxy;
mod player; mod plugin_host; mod plugins; mod power;
mod recognize; mod remote; mod security; mod skin_image;
mod sleep_timer; mod statistics; mod system_audio; mod system_fonts;
mod system_info; mod taskbar; mod toolbox; mod tray_capture; mod webview_settings;
mod window_boundary; mod window_foreground; mod window_fullscreen; mod window_material; mod window_theme;
mod window_z_order;

// ---- 命令导入：运行时与应用生命周期 ----
use app_runtime::{
    consume_pending_deep_links,
    consume_pending_open_paths,
    exit_app,
    handle_single_instance,
    open_devtools,
    restart_app,
    setup_app,
    update_native_tray_menu,
    was_launched_at_startup,
};
use autostart::{
    get_launch_on_startup,
    set_launch_on_startup,
};
use file_assoc::{
    get_audio_file_associations,
    set_audio_file_associations,
};
use install_language::{
    get_install_language,
    set_install_language,
};

// ---- 命令导入：音频转码 / 代理 / 电源 / 识别 / 睡眠定时 ----
use audio_convert::{
    convert_audio,
    detect_ffmpeg,
};
use audio_trim::{
    probe_audio_duration,
    trim_audio,
};
use netproxy::{
    get_network_proxy,
    set_network_proxy,
    test_network_proxy,
};
use power::set_prevent_sleep;
use recognize::{
    cancel_recognize_system_audio,
    recognize_system_audio,
};
use sleep_timer::{
    clear_sleep_timer,
    get_sleep_timer,
    run_sleep_action,
    set_sleep_timer,
};

// ---- 命令导入：控制通道（手机端联动） ----
use control_channel::commands::{
    control_channel_forget_device,
    control_channel_push_now_playing,
    control_channel_push_position,
    control_channel_push_state,
    control_channel_refresh_pairing_code,
    control_channel_set_enabled,
    control_channel_status,
};

// ---- 命令导入：DLNA 投放 ----
use dlna::commands::{
    dlna_cast_get_state,
    dlna_cast_pause,
    dlna_cast_play,
    dlna_cast_seek,
    dlna_cast_set_uri,
    dlna_cast_set_volume,
    dlna_cast_stop,
    dlna_disable_renderer,
    dlna_enable_renderer,
    dlna_renderer_status,
    dlna_search_devices,
    dlna_update_media_token,
};

// ---- 命令导入：字体 / 数据清理 / 签名校验 / 前台窗口 ----
use custom_fonts::{
    import_lyrics_font,
    read_lyrics_font_data_url,
};
use database::{clear_all_app_data};
use fallback_verify::verify_fallback_module_signature;
use foreground_window::{get_foreground_fullscreen_state};
use host_crypto::{
    host_kugou_request_key,
    host_kugou_sign,
    host_linuxapi_encrypt,
    host_migu_sign,
    host_sha256_hex,
    host_weapi_encrypt,
    host_zzc_sign,
};

// ---- 命令导入：音乐库与歌曲元数据 ----
use music::{
    add_library_folder,
    authed_request,
    batch_move_music_files,
    clear_auth_credentials,
    clear_cover_cache,
    clear_song_background,
    create_folder,
    delete_folder,
    delete_music_file,
    decrypt_plugin_lyric,
    extract_palette,
    fetch_lyric_from_source,
    find_alternative_lx_source,
    get_auth_api_secret,
    get_auth_base_url,
    get_auth_credentials,
    get_folder_children,
    get_folder_first_song,
    get_library_album_catalog,
    get_library_artist_catalog,
    get_library_folders,
    get_library_hierarchy,
    get_library_song_paths_by_album,
    get_library_song_paths_by_artist,
    get_library_song_paths_for_all_view,
    get_library_song_paths_for_folder_view,
    get_library_songs_cached,
    get_lx_cover,
    get_song_background,
    get_song_cover,
    get_song_cover_thumbnail,
    get_song_detail,
    get_song_lyrics_for_edit,
    get_song_lyrics_payload,
    is_directory,
    move_file_to_folder,
    move_music_file,
    parse_audio_files,
    parse_lyrics_text,
    parse_music_folder,
    read_lyrics_file,
    remove_library_folder,
    save_artist_avatar,
    save_auth_credentials,
    save_song_background,
    save_song_info,
    save_song_lyrics,
    scan_folder_as_playlists,
    scan_library,
    scan_music_folder,
    search_library_songs,
    set_auth_api_secret,
    set_auth_base_url,
    show_in_folder,
};

// ---- 命令导入：播放引擎与流缓存 ----
use player::{
    clear_stream_cache,
    copy_stream_cache,
    flush_playback_session,
    get_audio_device_formats,
    get_audio_visualizer_samples,
    get_current_output_device,
    get_output_devices,
    get_playback_duration,
    get_playback_progress,
    get_playback_ready,
    get_playback_session,
    get_playback_start_failed,
    get_playback_start_failed_info,
    get_playback_start_failed_reason,
    get_stream_cache_dir,
    get_stream_cache_info,
    get_track_loudness_info,
    is_stream_cached,
    load_playback_session,
    mv_proxy_url,
    pause_audio,
    play_audio,
    plugin_host_close_editor,
    plugin_host_editor_states,
    plugin_host_get_parameter_values,
    plugin_host_get_plugin_parameters,
    plugin_host_get_plugin_presets,
    plugin_host_get_rack,
    plugin_host_load_preset,
    plugin_host_open_editor,
    plugin_host_scan_plugins,
    plugin_host_set_parameter,
    plugin_host_set_rack,
    plugin_host_take_process_error,
    prefetch_audio_head,
    resume_audio,
    save_playback_session,
    seek_audio,
    set_audio_output_mode,
    set_equalizer_settings,
    set_output_device,
    set_sound_effect_settings,
    set_stream_cache_dir,
    set_stream_cache_max_size,
    set_volume,
    stop_audio,
    update_loudness_settings,
    update_playback_metadata,
    update_playback_position,
};

// ---- 命令导入：插件引擎与插件脚本资源 ----
use plugin_host::commands::{
    plugin_engine_call,
    plugin_engine_cookie_header_for_domain,
    plugin_engine_destroy,
    plugin_engine_load_lx,
    plugin_engine_load_musicfree,
    plugin_engine_store_import,
};
use plugins::{
    download_audio_to_temp,
    download_video_to_cache,
    plugin_http_request,
    plugin_http_request_binary,
    proxy_image,
    read_file_bytes,
    read_image_base64,
    read_plugin_file,
    remove_cached_background_video,
    save_plugin_script,
};

// ---- 命令导入：远程音源 ----
use remote::{
    add_remote_source,
    clear_remote_cache,
    get_remote_cache_usage,
    get_remote_sources,
    list_remote_directory,
    precache_remote_song,
    remove_remote_source,
    sync_remote_source,
    test_remote_source,
    update_remote_source,
};

// ---- 命令导入：皮肤 / 统计 / 系统信息 ----
use skin_image::import_skin_image;
use statistics::{
    add_to_history,
    clear_listen_stats,
    clear_recent_history,
    export_listen_snapshot,
    export_statistics_file,
    get_behavior_stats,
    get_favorite_album_catalog,
    get_favorite_artist_catalog,
    get_favorite_song_paths_view,
    get_format_distribution,
    get_library_stats,
    get_listen_durations,
    get_quality_distribution,
    get_recent_album_catalog,
    get_recent_history,
    get_recent_playlist_catalog,
    get_recent_song_paths_view,
    import_recent_history,
    import_statistics_file,
    merge_cloud_listen_duration,
    merge_listen_snapshot,
    preview_statistics_import,
    record_play,
    remove_from_recent_history,
    remove_songs_from_history_and_statistics,
    reset_local_statistics,
};
use system_fonts::{get_system_fonts};
use system_info::{
    get_machine_id,
    get_system_info,
};

// ---- 命令导入：任务栏窗口 ----
use taskbar::{
    get_taskbar_tray_geometry,
    install_taskbar_zorder_guard,
    refresh_taskbar_window_topmost,
    setup_taskbar_window,
    uninstall_taskbar_zorder_guard,
};

// ---- 命令导入：工具箱（下载 / 更新 / 外部程序 / 对话框存取） ----
use toolbox::{
    apply_rename,
    build_download_basename,
    check_update_by_rust,
    decrypt_qmc_file,
    delete_wallpaper_file,
    download_online_song,
    download_update_file,
    download_wallpaper,
    fetch_image_bytes,
    file_exists,
    finalize_download_extras,
    is_store_build,
    open_external_program,
    preview_rename,
    probe_url_size,
    read_download_history,
    read_state_json,
    refresh_folder_songs,
    register_download_directory,
    register_external_program,
    resolve_download_full_path,
    resolve_download_path,
    run_installer,
    save_bytes_via_dialog,
    save_text_via_dialog,
    set_gpu_acceleration,
    should_disable_gpu_for_startup,
    write_download_history,
    write_state_json,
};

#[cfg(target_os = "windows")]
use toolbox::append_webview2_browser_arg;

// ---- 命令导入：窗口体系（边界 / 全屏 / 材质 / 主题 / 置顶） ----
use window_boundary::set_mini_boundary_enabled;
use window_fullscreen::{
    refresh_immersive_fullscreen,
    set_immersive_fullscreen,
    smart_toggle_maximize,
};
use window_material::{
    get_window_material_capabilities,
    refresh_window_material_active_state,
};
use window_foreground::{describe_foreground_window, force_window_foreground};
use tray_capture::{start_tray_mouse_capture, stop_tray_mouse_capture};
use window_theme::{set_dark_mode_for_window};
use window_z_order::{
    refresh_current_window_topmost,
    start_topmost_guard,
    stop_topmost_guard,
};

// AppHandle/AppWindow 上的 Manager 扩展方法（exit、app_handle 等）。
use tauri::Manager as _;

/// 统一的全局退出路径：先撤各处窗口守卫，再清 WebView 缓存并结束事件循环。
pub fn graceful_shutdown(app: &tauri::AppHandle) {
    window_z_order::shutdown_topmost_guard();
    taskbar::shutdown_taskbar_zorder_guard();
    webview_settings::clear_webview_cache(app);
    app.exit(0);
}

/// 在 Windows 上登记进程级 AppUserModelID，任务栏分组等 shell 集成依赖它。
#[cfg(target_os = "windows")]
fn claim_windows_app_model_id() {
    use windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    let model_id: Vec<u16> = "com.xymusic.desktop".encode_utf16().chain([0u16]).collect();
    let _ = unsafe { SetCurrentProcessExplicitAppUserModelID(model_id.as_ptr()) };
}

/// 非 Windows 平台无需登记 AppUserModelID。
#[cfg(not(target_os = "windows"))]
fn claim_windows_app_model_id() {}

/// 按持久化配置决定是否在启动阶段禁用 GPU 合成（部分驱动与 WebView2 不兼容）。
fn maybe_disable_gpu_for_startup() {
    let gpu_on_blocklist = should_disable_gpu_for_startup();
    if !gpu_on_blocklist {
        return;
    }
    #[cfg(target_os = "windows")]
    append_webview2_browser_arg("--disable-gpu");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
}

/// 运行期事件分发：苹果/移动平台把系统“打开文件”事件转交深链处理。
fn dispatch_run_event(app_handle: &tauri::AppHandle, event: tauri::RunEvent) {
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
    if let tauri::RunEvent::Opened { urls } = event {
        app_runtime::handle_opened_urls(app_handle, urls);
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
    let _ = (app_handle, event);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(dependency_on_unit_never_type_fallback)]
pub fn run() {
    claim_windows_app_model_id();
    maybe_disable_gpu_for_startup();

    // 各插件先在局部构造，再按原顺序挂到 Builder 上。
    let single_instance_plugin = tauri_plugin_single_instance::init(|relaunch_app, argv, _cwd| {
        handle_single_instance(relaunch_app, argv);
    });
    let window_state_plugin = tauri_plugin_window_state::Builder::default()
        .with_denylist(&["desktop-lyrics", "mini-player", "taskbar-player", "tray-menu"])
        .build();
    let dialog_plugin = tauri_plugin_dialog::init();
    let shortcut_plugin = tauri_plugin_global_shortcut::Builder::new().build();
    let opener_plugin = tauri_plugin_opener::init();
    let http_plugin = tauri_plugin_http::init();

    let desktop = tauri::Builder::default()
        .plugin(single_instance_plugin)
        .on_window_event(|window, event| {
            let main_window_gone = window.label() == "main";
            if main_window_gone && matches!(event, tauri::WindowEvent::Destroyed) {
                graceful_shutdown(window.app_handle());
            }
        })
        .plugin(window_state_plugin)
        .plugin(dialog_plugin)
        .plugin(shortcut_plugin)
        .plugin(opener_plugin)
        .plugin(http_plugin)
        .setup(|ctx| setup_app(ctx))
        .invoke_handler(tauri::generate_handler![
            convert_audio,
            detect_ffmpeg,
            probe_audio_duration,
            trim_audio,
            scan_music_folder,
            parse_audio_files,
            parse_music_folder,
            scan_folder_as_playlists,
            get_song_cover_thumbnail,
            get_song_cover,
            extract_palette,
            authed_request,
            save_auth_credentials,
            get_auth_credentials,
            clear_auth_credentials,
            set_auth_base_url,
            get_auth_base_url,
            set_auth_api_secret,
            get_auth_api_secret,
            clear_cover_cache,
            read_lyrics_file,
            parse_lyrics_text, // 歌词解析命令
            get_song_lyrics_payload,
            get_song_lyrics_for_edit,
            save_song_lyrics,
            save_song_info,
            save_song_background,
            get_song_background,
            clear_song_background,
            get_song_detail,
            batch_move_music_files,
            move_music_file,
            show_in_folder,
            delete_music_file,
            play_audio,
            update_playback_metadata,
            dlna_search_devices,
            dlna_cast_set_uri,
            dlna_cast_play,
            dlna_cast_pause,
            dlna_cast_stop,
            dlna_cast_seek,
            dlna_cast_set_volume,
            dlna_cast_get_state,
            dlna_update_media_token,
            dlna_enable_renderer,
            dlna_disable_renderer,
            dlna_renderer_status,
            control_channel_status,
            control_channel_set_enabled,
            control_channel_refresh_pairing_code,
            control_channel_forget_device,
            control_channel_push_state,
            control_channel_push_now_playing,
            control_channel_push_position,
            pause_audio,
            stop_audio,
            resume_audio,
            seek_audio,
            set_volume,
            get_playback_progress,
            get_playback_duration,
            get_playback_ready,
            get_playback_start_failed,
            get_playback_start_failed_reason,
            get_playback_start_failed_info,
            get_audio_visualizer_samples,
            get_track_loudness_info,
            update_loudness_settings,
            set_equalizer_settings,
            set_sound_effect_settings, // 音效参数命令
            plugin_host_scan_plugins,
            plugin_host_get_rack,
            plugin_host_set_rack,
            plugin_host_get_plugin_parameters,
            plugin_host_get_parameter_values,
            plugin_host_set_parameter,
            plugin_host_get_plugin_presets,
            plugin_host_load_preset,
            plugin_host_open_editor,
            plugin_host_close_editor,
            plugin_host_editor_states,
            plugin_host_take_process_error,
            preview_rename,
            apply_rename,
            get_output_devices,
            get_current_output_device,
            get_audio_device_formats,
            set_output_device,
            set_audio_output_mode,
            set_prevent_sleep,
            set_stream_cache_max_size,
            set_stream_cache_dir,
            get_stream_cache_dir,
            get_stream_cache_info,
            clear_stream_cache,
            is_stream_cached,
            copy_stream_cache,
            prefetch_audio_head,
            get_library_folders,
            is_directory,
            save_artist_avatar,
            add_library_folder,
            remove_library_folder,
            get_library_songs_cached,
            search_library_songs,
            get_library_artist_catalog,
            get_library_album_catalog,
            get_library_song_paths_by_artist,
            get_library_song_paths_by_album,
            get_library_song_paths_for_all_view,
            get_library_song_paths_for_folder_view,
            get_remote_sources,
            test_remote_source,
            add_remote_source,
            update_remote_source,
            remove_remote_source,
            sync_remote_source,
            precache_remote_song,
            get_remote_cache_usage,
            clear_remote_cache,
            list_remote_directory,
            scan_library,
            get_library_hierarchy,
            get_folder_children,
            create_folder,
            delete_folder,
            move_file_to_folder,
            get_folder_first_song,
            get_library_stats,
            add_to_history,
            record_play,
            get_recent_history,
            get_favorite_artist_catalog,
            get_favorite_album_catalog,
            get_favorite_song_paths_view,
            get_recent_album_catalog,
            get_recent_song_paths_view,
            get_recent_playlist_catalog,
            import_recent_history,
            export_statistics_file,
            preview_statistics_import,
            import_statistics_file,
            remove_from_recent_history,
            remove_songs_from_history_and_statistics,
            clear_recent_history,
            reset_local_statistics,
            get_behavior_stats,
            get_listen_durations,
            merge_cloud_listen_duration,
            export_listen_snapshot,
            merge_listen_snapshot,
            clear_listen_stats,
            get_quality_distribution,
            get_format_distribution,
            clear_all_app_data,
            open_external_program,
            register_external_program,
            register_download_directory,
            file_exists,
            refresh_folder_songs,
            set_mini_boundary_enabled,
            set_immersive_fullscreen,
            refresh_immersive_fullscreen,
            smart_toggle_maximize,
            get_window_material_capabilities,
            refresh_window_material_active_state, // 窗口材质刷新命令
            get_foreground_fullscreen_state,
            set_dark_mode_for_window,
            force_window_foreground,
            describe_foreground_window,
            start_tray_mouse_capture,
            stop_tray_mouse_capture,
            refresh_current_window_topmost,
            start_topmost_guard,
            stop_topmost_guard,
            plugin_http_request,
            plugin_http_request_binary,
            plugin_engine_load_musicfree,
            plugin_engine_load_lx,
            plugin_engine_call,
            plugin_engine_destroy,
            plugin_engine_store_import,
            plugin_engine_cookie_header_for_domain,
            host_zzc_sign,
            host_kugou_sign,
            host_kugou_request_key,
            host_migu_sign,
            host_linuxapi_encrypt,
            host_weapi_encrypt,
            host_sha256_hex,
            verify_fallback_module_signature,
            read_plugin_file,
            save_plugin_script,
            read_file_bytes,
            read_image_base64,
            import_skin_image,
            proxy_image,
            download_audio_to_temp,
            download_video_to_cache,
            remove_cached_background_video,
            mv_proxy_url,
            recognize_system_audio,
            cancel_recognize_system_audio,
            consume_pending_open_paths,
            consume_pending_deep_links,
            get_system_fonts,
            get_system_info,
            get_machine_id,
            import_lyrics_font,
            read_lyrics_font_data_url,
            setup_taskbar_window,
            get_taskbar_tray_geometry,
            install_taskbar_zorder_guard,
            refresh_taskbar_window_topmost,
            uninstall_taskbar_zorder_guard,
            exit_app,
            restart_app,
            get_network_proxy,
            set_network_proxy,
            test_network_proxy,
            update_native_tray_menu,
            set_gpu_acceleration,
            check_update_by_rust,
            download_update_file,
            download_online_song,
            decrypt_qmc_file,
            download_wallpaper, // 壁纸下载命令
            delete_wallpaper_file,
            probe_url_size,
            read_download_history, // 读取下载历史
            write_download_history, // 写入下载历史
            save_text_via_dialog,
            save_bytes_via_dialog,
            fetch_image_bytes,
            resolve_download_path,
            resolve_download_full_path,
            build_download_basename,
            finalize_download_extras,
            run_installer,
            is_store_build,
            write_state_json, // 写状态文件
            read_state_json, // 读状态文件
            open_devtools,
            fetch_lyric_from_source,
            decrypt_plugin_lyric,
            get_lx_cover,
            find_alternative_lx_source,
            save_playback_session,
            load_playback_session,
            get_playback_session,
            update_playback_position,
            flush_playback_session,
            get_install_language,
            set_install_language,
            get_launch_on_startup,
            set_launch_on_startup,
            was_launched_at_startup,
            get_audio_file_associations,
            set_audio_file_associations,
            set_sleep_timer,
            clear_sleep_timer,
            get_sleep_timer,
            run_sleep_action,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    desktop.run(dispatch_run_event);
}
