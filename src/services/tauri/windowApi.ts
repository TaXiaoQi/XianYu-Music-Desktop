import { tauriInvoke } from './invoke';
import type {
  ForegroundFullscreenState,
  NativeTrayMenuState,
  OwnerBindingState,
  TaskbarTrayGeometry,
  WindowMaterialCapabilities,
} from './contracts';
export type { ForegroundFullscreenState, NativeTrayMenuState, OwnerBindingState, TaskbarTrayGeometry, WindowMaterialCapabilities } from './contracts';

export const windowApi = {
  setMiniBoundaryEnabled: (enabled: boolean) =>
    tauriInvoke('set_mini_boundary_enabled', { enabled }),
  setDarkModeForWindow: (dark: boolean) =>
    tauriInvoke('set_dark_mode_for_window', { dark }),
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
