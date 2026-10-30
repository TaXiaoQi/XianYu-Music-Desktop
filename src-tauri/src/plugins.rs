use std::error::Error;
#[path = "plugin_commands/cloud.rs"]
mod cloud;
#[path = "plugin_commands/downloads.rs"]
mod downloads;
#[path = "plugin_commands/files.rs"]
mod files;
#[path = "plugin_commands/http.rs"]
mod http;
#[path = "plugin_commands/images.rs"]
mod images;

pub(crate) use cloud::{
    close_oauth_login_window, close_webview_login_window, cloud_proxy,
    enforce_main_size_on_resize, open_oauth_login_window, open_webview_login_window,
};
pub(crate) use downloads::{
    download_audio_to_temp, download_video_to_cache, remove_cached_background_video,
};
pub(crate) use files::{read_file_bytes, read_plugin_file, save_plugin_script};
pub(crate) use http::{clear_cached_http_clients, plugin_http_request, plugin_http_request_binary};
pub(crate) use images::{proxy_image, read_image_base64};

pub(crate) fn format_reqwest_error(err: reqwest::Error) -> String {
    let mut parts = Vec::new();
    parts.push(err.to_string());
    let mut source = err.source();
    while let Some(s) = source {
        parts.push(s.to_string());
        source = s.source();
    }
    parts.join(" -> ")
}
