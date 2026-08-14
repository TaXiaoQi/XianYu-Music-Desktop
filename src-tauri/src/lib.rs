mod app_runtime;
mod custom_fonts;
mod database;
pub mod error;
mod foreground_window;
mod music;
mod player;
mod plugins;
mod recognize;
mod remote;
mod security;
mod statistics;
mod system_audio;
mod system_fonts;
mod taskbar;
mod toolbox;
mod webview_settings;
mod window_boundary;
mod window_fullscreen;
mod window_material;
mod window_theme;
mod window_z_order;

use app_runtime::{
    consume_pending_open_paths, exit_app, handle_single_instance, open_devtools, setup_app,
    update_native_tray_menu,
};
use custom_fonts::{import_lyrics_font, read_lyrics_font_data_url};
use database::clear_all_app_data;
use foreground_window::get_foreground_fullscreen_state;
use music::{
    add_library_folder, add_sidebar_folder, authed_request, batch_move_music_files,
    clear_auth_credentials, clear_cover_cache, clear_lx_all_cache, clear_lx_url_cache,
    clear_song_background,
    create_folder, delete_folder, delete_music_file, extract_palette, fetch_lyric_from_source,
    find_alternative_lx_source, get_auth_api_secret, get_auth_base_url, get_auth_credentials,
    get_folder_children, get_folder_first_song, get_library_album_catalog, get_library_artist_catalog,
    get_library_folders, get_library_hierarchy, get_library_song_paths_by_album,
    get_library_song_paths_by_artist, get_library_song_paths_for_all_view,
    get_library_song_paths_for_folder_view, get_library_songs_by_paths, get_library_songs_cached,
    get_lx_cover, get_sidebar_folders, get_sidebar_hierarchy, get_song_background, get_song_cover,
    get_song_cover_thumbnail, get_song_detail, get_song_lyrics, get_song_lyrics_for_edit,
    get_song_lyrics_payload, is_directory, move_file_to_folder, move_music_file, parse_audio_files,
    parse_lyrics_text, parse_music_folder, read_lyrics_file, remove_library_folder,
    remove_sidebar_folder, resolve_lx_music_url, resolve_lx_with_quality_fallback,
    save_artist_avatar, save_auth_credentials, save_song_background, save_song_info,
    save_song_lyrics, scan_folder_as_playlists, scan_library, scan_music_folder,
    search_library_songs, set_auth_api_secret, set_auth_base_url, show_in_folder, signed_post_json,
};
use player::{
    clear_stream_cache, copy_stream_cache, flush_playback_session, get_audio_visualizer_samples,
    get_current_output_device, get_output_devices, get_playback_duration, get_playback_progress,
    get_playback_ready, get_playback_session, get_playback_start_failed, get_stream_cache_info,
    get_track_loudness_info, is_stream_cached, load_playback_session, pause_audio, play_audio,
    resume_audio, save_playback_session, seek_audio, set_audio_output_mode, set_equalizer_settings,
    set_output_device, set_playback_speed, set_sound_effect_settings, set_stream_cache_max_size,
    set_volume, stop_audio, update_loudness_settings, update_playback_metadata,
    update_playback_position, wait_stream_complete,
};
use plugins::{
    download_audio_to_temp, plugin_http_request, plugin_http_request_binary, proxy_image,
    read_file_bytes, read_plugin_file,
};
use recognize::{cancel_recognize_system_audio, recognize_system_audio, recognize_with_pcm};
use remote::{
    add_remote_source, clear_remote_cache, get_remote_cache_usage, get_remote_sources,
    list_remote_directory, precache_remote_song, remove_remote_source, sync_remote_source,
    test_remote_source, update_remote_source,
};
use statistics::{
    add_to_history, clear_recent_history, export_statistics_file, get_behavior_stats,
    get_favorite_album_catalog, get_favorite_artist_catalog, get_favorite_song_paths_view,
    get_format_distribution, get_library_stats, get_listen_durations, get_quality_distribution,
    get_recent_album_catalog, get_recent_history, get_recent_playlist_catalog,
    get_recent_song_paths_view, import_recent_history, import_statistics_file,
    preview_statistics_import, record_play, remove_from_recent_history,
    remove_songs_from_history_and_statistics, reset_local_statistics,
};
use system_fonts::get_system_fonts;
use taskbar::{
    get_taskbar_tray_geometry, install_taskbar_zorder_guard, refresh_taskbar_window_topmost,
    setup_taskbar_window, shutdown_taskbar_zorder_guard, uninstall_taskbar_zorder_guard,
};
use tauri::Manager;
use toolbox::{
    apply_rename, build_download_basename, check_update_by_rust, decrypt_qmc_file, download_online_song,
    download_update_file, download_wallpaper, delete_wallpaper_file, embed_audio_metadata, fetch_announcement,
    fetch_image_bytes, file_exists, finalize_download_extras, open_external_program,
    preview_rename, probe_url_size, read_download_history, read_state_json, refresh_folder_songs,
    resolve_download_full_path, resolve_download_path, run_installer, save_download_bytes,
    save_download_lyrics, set_gpu_acceleration, write_download_history, write_state_json,
    write_text_file,
};

#[cfg(target_os = "windows")]
use toolbox::{append_webview2_browser_arg, should_disable_gpu_for_startup};
use window_boundary::set_mini_boundary_enabled;
use window_fullscreen::{
    refresh_immersive_fullscreen, save_window_placement, set_immersive_fullscreen,
    set_taskbar_fullscreen_flag, smart_toggle_maximize,
};
use window_material::{get_window_material_capabilities, refresh_window_material_active_state};
use window_theme::set_dark_mode_for_window;
use window_z_order::{
    refresh_current_window_topmost, shutdown_topmost_guard, start_topmost_guard, stop_topmost_guard,
};

/// 优雅退出：先向后台守护线程发送 WM_QUIT 使其退出消息循环，
/// 再调用 app.exit(0) 触发 Tauri 事件循环退出（让 cargo tauri dev 能正常清理 Vite）。
/// 若 2 秒内事件循环仍未退出（如播放器线程或 single-instance 插件阻塞），
/// 兜底线程强制 std::process::exit(0) 终止进程。
pub fn graceful_shutdown(app: &tauri::AppHandle) {
    shutdown_topmost_guard();
    shutdown_taskbar_zorder_guard();
    app.exit(0);
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(2));
        std::process::exit(0);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(dependency_on_unit_never_type_fallback)]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        if should_disable_gpu_for_startup() {
            append_webview2_browser_arg("--disable-gpu");
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_single_instance(app, argv);
        }))
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::Destroyed = event {
                    graceful_shutdown(window.app_handle());
                }
            }
        })
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&[
                    "desktop-lyrics",
                    "mini-player",
                    "taskbar-player",
                    "tray-menu",
                ])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| setup_app(app))
        .invoke_handler(tauri::generate_handler![
            scan_music_folder,
            parse_audio_files,
            parse_music_folder,
            scan_folder_as_playlists,
            get_song_cover_thumbnail,
            get_song_cover,
            extract_palette,
            authed_request,
            signed_post_json,
            save_auth_credentials,
            get_auth_credentials,
            clear_auth_credentials,
            set_auth_base_url,
            get_auth_base_url,
            set_auth_api_secret,
            get_auth_api_secret,
            clear_cover_cache,
            get_song_lyrics,
            read_lyrics_file,
            parse_lyrics_text,
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
            pause_audio,
            stop_audio,
            resume_audio,
            seek_audio,
            set_volume,
            set_playback_speed,
            get_playback_progress,
            get_playback_duration,
            get_playback_ready,
            get_playback_start_failed,
            get_audio_visualizer_samples,
            get_track_loudness_info,
            update_loudness_settings,
            set_equalizer_settings,
            set_sound_effect_settings,
            preview_rename,
            apply_rename,
            get_output_devices,
            get_current_output_device,
            set_output_device,
            set_audio_output_mode,
            set_stream_cache_max_size,
            get_stream_cache_info,
            clear_stream_cache,
            is_stream_cached,
            copy_stream_cache,
            wait_stream_complete,
            get_library_folders,
            is_directory,
            save_artist_avatar,
            add_library_folder,
            remove_library_folder,
            get_library_songs_cached,
            get_library_songs_by_paths,
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
            // Deprecated compatibility commands for legacy sidebar_folders.
            get_sidebar_folders,
            add_sidebar_folder,
            remove_sidebar_folder,
            get_sidebar_hierarchy,
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
            get_quality_distribution,
            get_format_distribution,
            clear_all_app_data,
            open_external_program,
            file_exists,
            refresh_folder_songs,
            set_mini_boundary_enabled,
            set_immersive_fullscreen,
            refresh_immersive_fullscreen,
            save_window_placement,
            set_taskbar_fullscreen_flag,
            smart_toggle_maximize,
            get_window_material_capabilities,
            refresh_window_material_active_state,
            get_foreground_fullscreen_state,
            set_dark_mode_for_window,
            refresh_current_window_topmost,
            start_topmost_guard,
            stop_topmost_guard,
            plugin_http_request,
            plugin_http_request_binary,
            read_plugin_file,
            read_file_bytes,
            proxy_image,
            download_audio_to_temp,
            recognize_system_audio,
            cancel_recognize_system_audio,
            recognize_with_pcm,
            consume_pending_open_paths,
            get_system_fonts,
            import_lyrics_font,
            read_lyrics_font_data_url,
            setup_taskbar_window,
            get_taskbar_tray_geometry,
            install_taskbar_zorder_guard,
            refresh_taskbar_window_topmost,
            uninstall_taskbar_zorder_guard,
            exit_app,
            update_native_tray_menu,
            set_gpu_acceleration,
            check_update_by_rust,
            download_update_file,
            download_online_song,
            decrypt_qmc_file,
            download_wallpaper,
            delete_wallpaper_file,
            probe_url_size,
            read_download_history,
            write_download_history,
            save_download_bytes,
            save_download_lyrics,
            write_text_file,
            embed_audio_metadata,
            fetch_image_bytes,
            resolve_download_path,
            resolve_download_full_path,
            build_download_basename,
            finalize_download_extras,
            run_installer,
            fetch_announcement,
            write_state_json,
            read_state_json,
            open_devtools,
            fetch_lyric_from_source,
            resolve_lx_music_url,
            get_lx_cover,
            clear_lx_url_cache,
            find_alternative_lx_source,
            resolve_lx_with_quality_fallback,
            clear_lx_all_cache,
            save_playback_session,
            load_playback_session,
            get_playback_session,
            update_playback_position,
            flush_playback_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
