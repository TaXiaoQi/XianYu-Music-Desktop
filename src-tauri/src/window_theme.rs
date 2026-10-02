//! 窗口沉浸式深色模式开关。
//!
//! 通过 DWM 属性（编号 20）切换窗口标题栏的深浅色外观，
//! 供前端主题切换时同步原生窗口装饰。仅在 Windows 平台实际生效。

/// 切换指定 Webview 窗口的 DWM 沉浸式深色模式。
#[tauri::command] // 实现
pub fn set_dark_mode_for_window(window: tauri::WebviewWindow, dark: bool) {
  #[cfg(target_os = "windows")]
  apply_immersive_dark(&window, dark);

  #[cfg(not(target_os = "windows"))]
  let _ = (window, dark);
}

/// Windows 平台实现：定位 Win32 句柄后写入 DWM 属性。
#[cfg(target_os = "windows")]
fn apply_immersive_dark(window: &tauri::WebviewWindow, dark: bool) {
  use raw_window_handle::{HasWindowHandle, RawWindowHandle};
  use windows_sys::Win32::Graphics::Dwm as native_dwm;

  // 官方文档取值：DWMWA_USE_IMMERSIVE_DARK_MODE = 20
  const IMMERSIVE_DARK_ATTR: u32 = 20;

  let borrowed_window = window.as_ref().window();
  let Ok(handle) = borrowed_window.window_handle() else {
    return;
  };
  let win32 = match handle.as_raw() {
    RawWindowHandle::Win32(win32) => win32,
    _ => return,
  };

  // 属性载荷：1 开启深色，0 恢复浅色
  let flag: u32 = u32::from(dark);
  let flag_ptr = &flag as *const u32 as *const core::ffi::c_void;
  let target_hwnd = win32.hwnd.get() as *mut core::ffi::c_void;

  unsafe {
    native_dwm::DwmSetWindowAttribute(
      target_hwnd,
      IMMERSIVE_DARK_ATTR,
      flag_ptr,
      core::mem::size_of::<u32>() as u32,
    );
  }
}
