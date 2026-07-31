use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowMaterialCapabilities {
    pub is_windows: bool,
    pub supports_acrylic: bool,
    pub supports_mica: bool,
    pub supports_blur: bool,
    pub system_transparency_enabled: Option<bool>,
    pub windows_build_number: Option<u32>,
}

#[tauri::command]
pub fn get_window_material_capabilities() -> WindowMaterialCapabilities {
    platform_capabilities()
}

#[tauri::command]
pub fn refresh_window_material_active_state(app: tauri::AppHandle, keep_active: bool) {
    #[cfg(target_os = "windows")]
    refresh_platform_window_material_active_state(app, keep_active);

    #[cfg(not(target_os = "windows"))]
    let _ = (app, keep_active);
}

#[cfg(target_os = "windows")]
fn platform_capabilities() -> WindowMaterialCapabilities {
    let build = query_windows_build_number();
    let supports_acrylic = matches!(build, Some(value) if value >= 17763);
    let supports_mica = matches!(build, Some(value) if value >= 22000);
    let supports_blur = matches!(build, Some(value) if value >= 10240 && value < 22621);

    WindowMaterialCapabilities {
        is_windows: true,
        supports_acrylic,
        supports_mica,
        supports_blur,
        system_transparency_enabled: query_transparency_enabled(),
        windows_build_number: build,
    }
}

#[cfg(target_os = "windows")]
fn refresh_platform_window_material_active_state(app: tauri::AppHandle, keep_active: bool) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use tauri::Manager;
    use windows_sys::Win32::Foundation::{LPARAM, WPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, PostMessageW, WM_NCACTIVATE,
    };

    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let binding = window.as_ref().window();
    let Ok(handle) = binding.window_handle() else {
        return;
    };

    let RawWindowHandle::Win32(win32) = handle.as_raw() else {
        return;
    };

    let hwnd = win32.hwnd.get() as *mut core::ffi::c_void;
    let is_foreground = unsafe { GetForegroundWindow() == hwnd };
    let active = keep_active || is_foreground;

    unsafe {
        PostMessageW(
            hwnd,
            WM_NCACTIVATE,
            (if active { 1 } else { 0 }) as WPARAM,
            -1_isize as LPARAM,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn platform_capabilities() -> WindowMaterialCapabilities {
    WindowMaterialCapabilities {
        is_windows: false,
        supports_acrylic: false,
        supports_mica: false,
        supports_blur: false,
        system_transparency_enabled: None,
        windows_build_number: None,
    }
}

#[cfg(target_os = "windows")]
fn query_windows_build_number() -> Option<u32> {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;

    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn RtlGetVersion(lp_version_information: *mut OSVERSIONINFOW) -> i32;
    }

    unsafe {
        let mut version: OSVERSIONINFOW = zeroed();
        version.dwOSVersionInfoSize = size_of::<OSVERSIONINFOW>() as u32;

        if RtlGetVersion(&mut version) == 0 {
            Some(version.dwBuildNumber)
        } else {
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn query_transparency_enabled() -> Option<bool> {
    use std::{mem::size_of, ptr::null_mut};
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

    let sub_key: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\0"
        .encode_utf16()
        .collect();
    let value_name: Vec<u16> = "EnableTransparency\0".encode_utf16().collect();

    let mut value: u32 = 0;
    let mut value_size = size_of::<u32>() as u32;

    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            sub_key.as_ptr(),
            value_name.as_ptr(),
            RRF_RT_REG_DWORD,
            null_mut(),
            &mut value as *mut _ as *mut _,
            &mut value_size,
        )
    };

    if status == 0 {
        Some(value != 0)
    } else {
        None
    }
}
