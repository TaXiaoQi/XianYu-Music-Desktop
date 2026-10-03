//! 工具箱模块（纯搬家拆分自原 toolbox.rs 单体文件）。
//!
//! 子模块按职责分组；所有原 `pub` 项在此 re-export，
//! 保证 `crate::toolbox::X` 等外部路径零变化。

mod common;
mod downloads;
mod external;
mod files;
mod images;
mod qmc;
mod rename;
mod state_files;
mod updates;
mod wallpaper;

#[allow(unused_imports)]
pub use downloads::{
    build_download_basename,
    download_online_song,
    read_authorized_download_dir,
    read_download_history,
    register_download_directory,
    resolve_download_full_path,
    resolve_download_path,
    ProbeUrlInfo,
    probe_url_size,
    SongDownloadProgress,
    write_download_history,
};
pub use external::{open_external_program, register_external_program};
pub use files::{file_exists, refresh_folder_songs};
#[allow(unused_imports)]
pub use images::{
    fetch_image_bytes,
    finalize_download_extras,
    pick_save_path,
    save_bytes_via_dialog,
    save_text_via_dialog,
    FinalizeDownloadExtrasRequest,
    FinalizeDownloadExtrasResult,
    FetchedImage,
    SaveDialogFilter,
};
pub use qmc::decrypt_qmc_file;
#[allow(unused_imports)]
pub use rename::{
    apply_rename,
    preview_rename,
    RenameConfig,
    RenameOperation,
    RenamePreview,
};
#[allow(unused_imports)]
pub use state_files::{
    gpu_config_path,
    read_state_json,
    set_gpu_acceleration,
    should_disable_gpu_for_startup,
    write_state_json,
};
#[cfg(windows)]
pub use state_files::append_webview2_browser_arg;
#[allow(unused_imports)]
pub use updates::{
    check_update_by_rust,
    download_update_file,
    is_store_build,
    run_installer,
    DownloadProgress,
};
pub use wallpaper::{
    delete_theme_wallpaper,
    delete_wallpaper_file,
    download_wallpaper,
    save_theme_wallpaper,
};
