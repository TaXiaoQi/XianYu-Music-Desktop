import type { Ref } from 'vue';
import type { Song } from '../../types';

export const APP_TRAY_MENU_EVENT = 'app:tray-menu';
export const APP_TRAY_MENU_OPEN_EVENT = 'app:tray-menu-open';
export const TRAY_MENU_WINDOW_LABEL = 'tray-menu';
export const TRAY_MENU_STATE_EVENT = 'tray-menu:state';
export const TRAY_MENU_READY_EVENT = 'tray-menu:ready';
export const TRAY_MENU_PANEL_WIDTH = 210;
export const TRAY_MENU_WINDOW_WIDTH = TRAY_MENU_PANEL_WIDTH;
export const TRAY_MENU_WINDOW_HEIGHT = 268;

export type TrayMenuAction =
  | 'prev-song'
  | 'toggle-play'
  | 'next-song'
  | 'cycle-play-mode'
  | 'show-mini-player'
  | 'open-desktop-lyrics'
  | 'open-settings'
  | 'quit'
  | 'toggle-favorite';

export interface TrayMenuOpenPayload {
  x: number;
  y: number;
}

export interface TrayMenuStatePayload {
  currentSong: Song | null;
  isPlaying: boolean;
  isDarkTheme: boolean;
  playMode: number;
  showDesktopLyrics: boolean;
  isFavorite: boolean;
  isMiniMode: boolean;
  windowMaterial: 'none' | 'mica' | 'acrylic' | 'blur';
  windowBlurTint: number;
}

export interface TrayMenuActionDeps {
  prevSong: () => void;
  togglePlay: () => void | Promise<unknown>;
  nextSong: () => void;
  playMode: Ref<number>;
  cyclePlayMode: () => void;
  isMiniMode: Ref<boolean>;
  showDesktopLyrics: Ref<boolean>;
  revealMainWindow: () => Promise<unknown>;
  openSettings: () => Promise<unknown>;
  quitApp: () => Promise<unknown>;
  toggleFavorite: () => void | Promise<unknown>;
}

export async function handleTrayMenuAction(action: TrayMenuAction, deps: TrayMenuActionDeps) {
  switch (action) {
    case 'prev-song':
      deps.prevSong();
      break;
    case 'toggle-play':
      await deps.togglePlay();
      break;
    case 'next-song':
      deps.nextSong();
      break;
    case 'cycle-play-mode':
      deps.cyclePlayMode();
      break;
    case 'show-mini-player':
      // 切换 mini 模式：已开启则恢复主窗口，未开启则进入 mini 模式
      if (deps.isMiniMode.value) {
        deps.isMiniMode.value = false;
        await deps.revealMainWindow();
      } else {
        deps.isMiniMode.value = true;
      }
      break;
    case 'toggle-favorite':
      await deps.toggleFavorite();
      break;
    case 'open-desktop-lyrics':
      deps.showDesktopLyrics.value = true;
      break;
    case 'open-settings':
      deps.isMiniMode.value = false;
      await deps.openSettings();
      await deps.revealMainWindow();
      break;
    case 'quit':
      await deps.quitApp();
      break;
    default:
      break;
  }
}
