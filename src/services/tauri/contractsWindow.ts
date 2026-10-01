export interface WindowMaterialCapabilities {
  isWindows: boolean;
  supportsAcrylic: boolean;
  supportsMica: boolean;
  supportsBlur: boolean;
  systemTransparencyEnabled: boolean | null;
  windowsBuildNumber: number | null;
}

export interface ForegroundFullscreenState {
  isFullscreen: boolean;
}

/** 前台窗口快照：句柄 + 是否属于本应用（托盘菜单关外守卫轮询用）。 */
export interface ForegroundWindowInfo {
  hwnd: number;
  owned_by_app: boolean;
}

export interface TaskbarTrayGeometry {
  taskbar_rect_physical: RectPhysical;
  tray_rect_physical: RectPhysical | null;
  taskbar_hwnd_changed: boolean;
  owner_binding: OwnerBindingState;
  source: GeometrySource;
  scale_factor: number;
}

export interface RectPhysical {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type OwnerBindingState = 'bound' | 'failed' | 'unsupported' | 'already_bound';
export type GeometrySource = 'tray' | 'taskbar_fallback';

export interface NativeTrayMenuState {
  currentSong?: NativeTrayMenuSong | null;
  isPlaying: boolean;
  playMode: number;
  showDesktopLyrics: boolean;
  isFavorite: boolean;
  isMiniMode: boolean;
  useCustomTrayMenu: boolean;
}

export interface NativeTrayMenuSong {
  title?: string | null;
  name?: string | null;
  artist?: string | null;
}
