import type { Song } from '../../types';

export const MINI_PLAYER_WINDOW_LABEL = 'mini-player';
export const MINI_PLAYER_STATE_EVENT = 'mini-player:state';
export const MINI_PLAYER_STATE_APPLIED_EVENT = 'mini-player:state-applied';
export const MINI_PLAYER_ACTION_EVENT = 'mini-player:action';
export const MINI_PLAYER_REQUEST_STATE_EVENT = 'mini-player:request-state';
export const MINI_PLAYER_READY_EVENT = 'mini-player:ready';
export const MINI_PLAYER_VISIBILITY_EVENT = 'mini-player:visibility';
export const MINI_PLAYER_BOUNDS_EVENT = 'mini-player:bounds';
export const MINI_PLAYER_BOUNDS_KEY = 'mini_player_window_bounds';
export const APP_SHOW_MAIN_EVENT = 'app:show-main';

// mf-style 布局：400 x 144（主体行 88 + 进度条行 20 + 底部控件行 36）
export const MINI_PLAYER_WINDOW_WIDTH = 400;
export const MINI_PLAYER_WINDOW_BASE_HEIGHT = 144;
export const MINI_PLAYER_WINDOW_EXPANDED_HEIGHT = 516;

// 音量独立小窗
export const VOLUME_POPOVER_WINDOW_LABEL = 'volume-popover';
export const VOLUME_POPOVER_WINDOW_WIDTH = 180;
export const VOLUME_POPOVER_WINDOW_HEIGHT = 56;
export const VOLUME_POPOVER_STATE_EVENT = 'volume-popover:state';
export const VOLUME_POPOVER_ACTION_EVENT = 'volume-popover:action';
export const VOLUME_POPOVER_VISIBILITY_EVENT = 'volume-popover:visibility';

export interface VolumePopoverStatePayload {
  volume: number;
}

export type VolumePopoverAction =
  | { type: 'set-volume'; volume: number }
  | { type: 'toggle-mute' }
  | { type: 'close' };

export interface MiniPlayerWindowBounds {
  x: number;
  y: number;
}

export interface MiniPlayerStatePayload {
  currentSong: Song | null;
  coverUrl: string;
  isPlaying: boolean;
  isDarkTheme: boolean;
  volume: number;
  queue: Song[];
  lyricText: string;
  windowMaterial: 'none' | 'mica' | 'acrylic' | 'blur';
  windowBlurTint: number;
  currentTime: number;
  duration: number;
  isFavorite: boolean;
  playMode: number; // 0=顺序, 1=单曲循环, 2=随机
  desktopLyricsEnabled: boolean;
}

export type MiniPlayerAction =
  | { type: 'toggle-play' }
  | { type: 'prev-song' }
  | { type: 'next-song' }
  | { type: 'set-volume'; volume: number }
  | { type: 'toggle-mute' }
  | { type: 'play-song'; song: Song }
  | { type: 'close' }
  | { type: 'restore-main' }
  | { type: 'seek'; time: number }
  | { type: 'toggle-favorite' }
  | { type: 'cycle-play-mode' }
  | { type: 'toggle-desktop-lyrics' };
