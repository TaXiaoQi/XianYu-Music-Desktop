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
