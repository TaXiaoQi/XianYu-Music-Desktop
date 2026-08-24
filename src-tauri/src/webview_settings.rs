/// Disable WebView2 browser accelerator keys (F5, Ctrl+F, Ctrl+P, etc.)
/// at the native WebView2 level by setting AreBrowserAcceleratorKeysEnabled to false.
///
/// This prevents the browser's built-in shortcuts from being invoked,
/// rather than intercepting the key events after they fire.
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

/// 应用退出时清理 WebView2 缓存目录（EBWebView）。
///
/// 只删除可再生的缓存数据（HTTP 缓存、代码缓存、着色器缓存、组件缓存等），
/// 保留 Local Storage / Session Storage / IndexedDB / Preferences 等用户数据。
/// 目的：让 $LOCALAPPDATA 目录在卸载时只剩少量文件，避免 NSIS RmDir /r
/// 逐个删除数百个小文件导致卸载卡顿。
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
