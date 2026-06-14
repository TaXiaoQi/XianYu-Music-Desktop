use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn set_dark_mode_for_window(app: AppHandle, dark: bool) {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;

        const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;

        if let Some(window) = app.get_webview_window("main") {
            if let Ok(handle) = window.as_ref().window().window_handle() {
                if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                    let hwnd = win32.hwnd.get() as *mut core::ffi::c_void;
                    let value: u32 = if dark { 1 } else { 0 };
                    unsafe {
                        DwmSetWindowAttribute(
                            hwnd,
                            DWMWA_USE_IMMERSIVE_DARK_MODE,
                            &value as *const _ as *const _,
                            std::mem::size_of::<u32>() as u32,
                        );
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, dark);
    }
}
