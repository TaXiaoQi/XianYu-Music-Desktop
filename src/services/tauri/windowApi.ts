import { tauriInvoke } from './invoke';
import type {
  ForegroundFullscreenState,
  ForegroundWindowInfo,
  NativeTrayMenuState,
  OwnerBindingState,
  TaskbarTrayGeometry,
  WindowMaterialCapabilities,
} from './contracts';
export type { ForegroundFullscreenState, ForegroundWindowInfo, NativeTrayMenuState, OwnerBindingState, TaskbarTrayGeometry, WindowMaterialCapabilities } from './contracts';

export const windowApi = {
  setMiniBoundaryEnabled: (enabled: boolean) =>
    tauriInvoke('set_mini_boundary_enabled', { enabled }),
  setDarkModeForWindow: (dark: boolean) =>
    tauriInvoke('set_dark_mode_for_window', { dark }),
  /** 把指定标签的窗口强制推到前台（托盘弹窗激活兜底）。 */
  forceWindowForeground: (label: string) =>
    tauriInvoke('force_window_foreground', { label }),
  /** 上报当前前台窗口句柄及是否属于本应用（关外关闭守卫轮询用）。 */
  describeForegroundWindow: () =>
    tauriInvoke('describe_foreground_window') as Promise<ForegroundWindowInfo>,
  /** 托盘菜单显示期间开启关外点击捕获（Win32 低级鼠标钩子，幂等）。 */
  startTrayMouseCapture: (label: string) =>
    tauriInvoke('start_tray_mouse_capture', { label }),
  /** 托盘菜单收起后关闭关外点击捕获（幂等）。 */
  stopTrayMouseCapture: () =>
    tauriInvoke('stop_tray_mouse_capture'),
  getWindowMaterialCapabilities: () =>
    tauriInvoke('get_window_material_capabilities') as Promise<WindowMaterialCapabilities>,
  refreshWindowMaterialActiveState: (keepActive: boolean) =>
    tauriInvoke('refresh_window_material_active_state', { keepActive }),
  getForegroundFullscreenState: () =>
    tauriInvoke('get_foreground_fullscreen_state') as Promise<ForegroundFullscreenState>,
  refreshCurrentWindowTopmost: (enabled: boolean) =>
    tauriInvoke('refresh_current_window_topmost', { enabled }),
  startTopmostGuard: () =>
    tauriInvoke('start_topmost_guard'),
  stopTopmostGuard: () =>
    tauriInvoke('stop_topmost_guard'),
  smartToggleMaximize: () =>
    tauriInvoke('smart_toggle_maximize') as Promise<boolean>,
  setImmersiveFullscreen: (enter: boolean) =>
    tauriInvoke('set_immersive_fullscreen', { enter }) as Promise<boolean>,
  getTaskbarTrayGeometry: () =>
    tauriInvoke('get_taskbar_tray_geometry') as Promise<TaskbarTrayGeometry>,
  refreshTaskbarWindowTopmost: () =>
    tauriInvoke('refresh_taskbar_window_topmost') as Promise<boolean>,
  setupTaskbarWindow: () =>
    tauriInvoke('setup_taskbar_window') as Promise<OwnerBindingState>,
  installTaskbarZorderGuard: () =>
    tauriInvoke('install_taskbar_zorder_guard') as Promise<boolean>,
  uninstallTaskbarZorderGuard: () =>
    tauriInvoke('uninstall_taskbar_zorder_guard'),
  updateNativeTrayMenu: (state: NativeTrayMenuState) =>
    tauriInvoke('update_native_tray_menu', { state }),
  refreshImmersiveFullscreen: () =>
    tauriInvoke('refresh_immersive_fullscreen') as Promise<boolean>,
};
