//! 窗口材质能力探测与激活态同步。
//!
//! 按 Windows 构建号判定亚克力/Mica/模糊材质的可用性，并读取系统透明效果开关；
//! macOS 依赖系统 NSVisualEffectView，恒定上报毛玻璃（blur）可用；
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

/// 运行时切换窗口不透明态（仅 macOS 有实际行为）。
///
/// macOS 上透明窗口（transparent: true）不具备系统缩放动画：放大时 WebView
/// 层不跟随 live resize，只会在放大结束后“跳一下”。因此采用智能切换——
/// 无材质（none）时把 NSWindow 切回不透明 + 实底色，恢复系统缩放动画；
/// 毛玻璃（blur）时再切回透明以透出 NSVisualEffectView。
#[tauri::command] // 实现
pub fn set_window_opaque_state(
  app: tauri::AppHandle,
  opaque: bool,
  red: f64,
  green: f64,
  blue: f64,
) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  return set_ns_window_opaque(&app, opaque, red, green, blue);

  #[cfg(not(target_os = "macos"))]
  {
    let _ = (app, opaque, red, green, blue);
    Ok(())
  }
}

/// macOS 实现：同步切换 NSWindow 与 WKWebView 两层的不透明状态。
///
/// 透明窗口实际由两层透明叠加构成（见 vendor/wry-0.57.0/src/wkwebview/mod.rs）：
/// 1. NSWindow：tao 因 transparent:true 创建时 setOpaque(false)；
/// 2. WKWebView：wry 以私有 KVC 键 drawsBackground 关掉内容底色（含 config 与实例层）。
/// 只切 NSWindow 不够——WebView 层 live resize 仍走透明合成路径，缩放动画依旧缺失。
/// 颜色参数为 0..1 的 sRGB 分量（opaque=false 时背景固定为全透明）。
#[cfg(target_os = "macos")]
fn set_ns_window_opaque(
  app: &tauri::AppHandle,
  opaque: bool,
  red: f64,
  green: f64,
  blue: f64,
) -> Result<(), String> {
  use objc2::msg_send;
  use objc2::rc::Retained;
  use objc2::runtime::NSObjectProtocol;
  use objc2::ClassType;
  use objc2_app_kit::{NSColor, NSView, NSWindow};
  use objc2_foundation::{NSArray, NSObjectNSKeyValueCoding, NSNumber, ns_string};
  use objc2_web_kit::WKWebView;
  use tauri::Manager;

  let Some(window) = app.get_webview_window("main") else {
    return Err("main 窗口不存在".into());
  };

  let background = if opaque {
    unsafe {
      NSColor::colorWithSRGBRed_green_blue_alpha(
        red.clamp(0.0, 1.0),
        green.clamp(0.0, 1.0),
        blue.clamp(0.0, 1.0),
        1.0,
      )
    }
  } else {
    unsafe { NSColor::clearColor() }
  };

  // 第 1 层：NSWindow（tao 层）
  let ns_window_ptr = window.ns_window().map_err(|error| error.to_string())? as *mut NSWindow;
  // SAFETY: ns_window 指针由 tauri 返回、指向当前存活的 NSWindow；
  // 此处仅同步调用 setter，不把引用保存到事件循环之外。
  let ns_window = unsafe { ns_window_ptr.as_ref() }.ok_or("ns_window 指针为空")?;
  ns_window.setOpaque(opaque);
  ns_window.setBackgroundColor(Some(&background));

  // 第 2 层：WKWebView（wry 层，drawsBackground 与 wry 运行时 set_background_color 用同一私有 KVC 键）。
  // 注意 tauri 的 ns_view() 返回的是 wry 的父容器视图（WryWebViewParent），
  // 直接对它 KVC 写 drawsBackground 会抛 NSUnknownKeyException 导致启动崩溃
  // （见 2026-10-30 崩溃日志），因此先在子视图里按类型找到真正的 WKWebView。
  let parent_ptr = window.ns_view().map_err(|error| error.to_string())? as *mut NSView;
  // SAFETY: ns_view 指针由 tauri 返回、指向当前存活的父容器视图，仅同步读取。
  let parent = unsafe { parent_ptr.as_ref() }.ok_or("ns_view 指针为空")?;
  // SAFETY: subviews 是 NSView 的标准属性，返回值由调用方 retain。
  let subviews: Retained<NSArray<NSView>> = unsafe { msg_send![parent, subviews] };
  let webview = subviews
    .iter()
    .find(|view| view.isKindOfClass(WKWebView::class()))
    .ok_or("父容器视图中未找到 WKWebView")?;
  // SAFETY: isKindOfClass 已确认对象确实是 WKWebView，借用周期不超出 parent。
  let webview: &WKWebView = unsafe { &*(std::ptr::from_ref(&*webview) as *const WKWebView) };
  unsafe {
    let draws_background = NSNumber::numberWithBool(opaque);
    webview.setValue_forKey(Some(&draws_background), ns_string!("drawsBackground"));
    // overscroll 区域底色（macOS 12+ 公开 API），不透明时与窗口实底保持一致
    webview.setUnderPageBackgroundColor(opaque.then_some(&background));
  }
  Ok(())
}

/// mac 兜底：强制把主窗口补成 Overlay 原生标题栏（系统红绿灯）。
///
/// `tauri build --config` 对 app.windows 的合并并未可靠编进二进制（dev 正常、
/// 打包产物退回基础配置的 decorations:false）；窗口状态插件的 decorated 回写
/// 已通过排除 DECORATIONS 修复（见 app_runtime::WINDOW_STATE_FLAGS）。此处
/// 运行时直接补齐 NSWindow styleMask：Titled/Closable/Miniaturizable/Resizable/
/// FullSizeContentView + 透明标题栏 + 隐藏标题，恢复系统红绿灯、原生圆角与
/// 系统缩放动画。对已处 Overlay 的窗口是幂等空操作。
#[cfg(target_os = "macos")]
pub fn ensure_macos_native_title_bar(window: &tauri::WebviewWindow) -> Result<(), String> {
  use objc2_app_kit::{NSWindow, NSWindowTitleVisibility, NSWindowStyleMask};

  let ns_window_ptr = window.ns_window().map_err(|error| error.to_string())? as *mut NSWindow;
  // SAFETY: ns_window 指针由 tauri 返回、指向当前存活的 NSWindow；setter 绑定为 safe，
  // 但仍要求主线程调用（setup 阶段满足）。
  let ns_window = unsafe { ns_window_ptr.as_ref() }.ok_or("ns_window 指针为空")?;
  let mut mask = ns_window.styleMask();
  // 无边框窗口带 Borderless 位，与 Titled 并存时标题栏行为异常，先摘掉。
  mask.remove(NSWindowStyleMask::Borderless);
  mask |= NSWindowStyleMask::Titled
    | NSWindowStyleMask::Closable
    | NSWindowStyleMask::Miniaturizable
    | NSWindowStyleMask::Resizable
    | NSWindowStyleMask::FullSizeContentView;
  ns_window.setStyleMask(mask);
  ns_window.setTitlebarAppearsTransparent(true);
  ns_window.setTitleVisibility(NSWindowTitleVisibility::Hidden);
  Ok(())
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

/// macOS：无 mica / acrylic，但可通过 NSVisualEffectView 提供系统级毛玻璃
/// （前端 blur 档映射为 underWindowBackground 材质），故上报 supports_blur。
#[cfg(target_os = "macos")]
fn platform_capabilities() -> WindowMaterialCapabilities { // platform_capabilities
  WindowMaterialCapabilities {
    is_windows: false,
    supports_acrylic: false,
    supports_mica: false,
    supports_blur: true,
    system_transparency_enabled: None,
    windows_build_number: None,
  }
}

#[cfg(not(any(windows, target_os = "macos")))]
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
