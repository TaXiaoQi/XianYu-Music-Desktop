//! 窗口材质能力探测与激活态同步。
//!
//! 按 Windows 构建号判定亚克力/Mica/模糊材质的可用性，并读取系统透明效果开关；
//! 窗口前后台切换时重发 WM_NCACTIVATE，让材质绘制状态与前台状态保持一致。

use serde::{Serialize};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")] // 实现
pub struct WindowMaterialCapabilities { // WindowMaterialCapabilities
  pub is_windows: bool,
  pub supports_acrylic: bool,
  pub supports_mica: bool,
  pub supports_blur: bool,
  pub system_transparency_enabled: Option<bool>,
  pub windows_build_number: Option<u32>,
}

/// 查询当前系统支持的窗口材质能力。
#[tauri::command] // 实现
pub fn get_window_material_capabilities() -> WindowMaterialCapabilities { // get_window_material_capabilities
  platform_capabilities()
}

/// 刷新窗口激活态：前台丢失时通知系统按“未激活”重绘非客户区材质。
#[tauri::command] // 实现
pub fn refresh_window_material_active_state(app: tauri::AppHandle, keep_active: bool) {
  #[cfg(target_os = "windows")]
  sync_nc_activate_state(&app, keep_active);

  #[cfg(not(target_os = "windows"))]
  let _ = (app, keep_active);
}

#[cfg(windows)]
fn platform_capabilities() -> WindowMaterialCapabilities { // platform_capabilities
  let build = probe_build_number();
  WindowMaterialCapabilities {
    is_windows: true,
    // 亚克力随 Windows 10 1809（17763）引入
    supports_acrylic: build.is_some_and(|value| value >= 17763),
    // Mica 随 Windows 11（22000）引入
    supports_mica: build.is_some_and(|value| value >= 22000),
    // 经典模糊仅存在于 Win10；Win11 22H2（22621）起被移除
    supports_blur: build.is_some_and(|value| (10240..22621).contains(&value)),
    system_transparency_enabled: probe_transparency_enabled(),
    windows_build_number: build,
  }
}

#[cfg(not(windows))]
fn platform_capabilities() -> WindowMaterialCapabilities { // platform_capabilities
  WindowMaterialCapabilities {
    is_windows: false,
    supports_acrylic: false,
    supports_mica: false,
    supports_blur: false,
    system_transparency_enabled: None,
    windows_build_number: None,
  }
}

/// 转 UTF-16 并补上 NUL 终止符。
#[cfg(windows)]
fn utf16z(text: &str) -> Vec<u16> {
  text.encode_utf16().chain([0]).collect()
}

/// 通过 ntdll 的 RtlGetVersion 读取系统构建号（绕过应用清单的版本伪装）。
#[cfg(windows)]
fn probe_build_number() -> Option<u32> {
  use std::mem::{size_of, zeroed};
  use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;

  #[link(name = "ntdll")]
  unsafe extern "system" {
    fn RtlGetVersion(lp_version_information: *mut OSVERSIONINFOW) -> i32;
  }

  let mut info: OSVERSIONINFOW = unsafe { zeroed() };
  info.dwOSVersionInfoSize = size_of::<OSVERSIONINFOW>() as u32;

  let succeeded = unsafe { RtlGetVersion(&mut info) } == 0;
  succeeded.then_some(info.dwBuildNumber)
}

/// 读取系统“透明效果”开关（个性化设置中的 EnableTransparency）。
#[cfg(windows)]
fn probe_transparency_enabled() -> Option<bool> {
  use std::{mem::size_of, ptr::null_mut};
  use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

  const PERSONALIZE_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
  const TRANSPARENCY_VALUE: &str = "EnableTransparency";

  let key_wide = utf16z(PERSONALIZE_KEY);
  let value_wide = utf16z(TRANSPARENCY_VALUE);

  let mut dword: u32 = 0;
  let mut dword_size = size_of::<u32>() as u32;

  let status = unsafe {
    RegGetValueW(
      HKEY_CURRENT_USER,
      key_wide.as_ptr(),
      value_wide.as_ptr(),
      RRF_RT_REG_DWORD,
      null_mut(),
      &mut dword as *mut _ as *mut _,
      &mut dword_size,
    )
  };

  (status == 0).then(|| dword != 0)
}

/// 向主窗口投递 WM_NCACTIVATE，使 DWM 按前台/后台状态重绘材质。
#[cfg(windows)]
fn sync_nc_activate_state(app: &tauri::AppHandle, keep_active: bool) {
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
  let in_foreground = unsafe { GetForegroundWindow() } == hwnd;
  let active = keep_active || in_foreground;

  unsafe {
    PostMessageW(
      hwnd,
      WM_NCACTIVATE,
      (active as usize) as WPARAM,
      -1_isize as LPARAM,
    );
  }
}
