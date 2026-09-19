#[cfg(target_os = "windows")]
pub fn disable_browser_accelerator_keys(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;

    let _ = window.with_webview(|webview| unsafe {
        let controller = webview.controller();

        let core = match controller.CoreWebView2() {
            Ok(core) => core,
            Err(_) => return,
        };

        let settings = match core.Settings() {
            Ok(s) => s,
            Err(_) => return,
        };

        let settings3 = match settings.cast::<ICoreWebView2Settings3>() {
            Ok(s) => s,
            Err(_) => return,
        };

        let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
    });
}

#[cfg(not(target_os = "windows"))]
pub fn disable_browser_accelerator_keys(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
pub fn clear_webview_cache(app: &tauri::AppHandle) {
    use std::fs;
    use tauri::Manager;

    let Ok(local_data_dir) = app.path().app_local_data_dir() else {
        return;
    };
    let ebwebview = local_data_dir.join("EBWebView");
    if !ebwebview.is_dir() {
        return;
    }

    const CACHE_DIRS: &[&str] = &[
        "Default/Cache",
        "Default/Code Cache",
        "Default/GPUCache",
        "Default/DawnGraphiteCache",
        "Default/DawnWebGPUCache",
        "Default/Shared Dictionary",
        "Default/Service Worker/CacheStorage",
        "component_crx_cache",
        "extensions_crx_cache",
        "GrShaderCache",
        "ShaderCache",
        "GPUPersistentCache",
        "hyphen-data",
        "Subresource Filter",
        "Speech Recognition",
        "Crashpad",
    ];

    for rel in CACHE_DIRS {
        let dir = ebwebview.join(rel);
        if dir.is_dir() {
            let _ = fs::remove_dir_all(&dir);
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn clear_webview_cache(_app: &tauri::AppHandle) {}
