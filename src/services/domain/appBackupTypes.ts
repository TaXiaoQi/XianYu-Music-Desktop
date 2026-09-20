
import type { Song, PluginSource, AppSettings } from '../../types';

export const APP_BACKUP_SCHEMA = 'xianyu-music.app-backup';
export const APP_BACKUP_VERSION = 2;

// 三端名称（settings 分槽 / platform 标记用），与移动端/腕上端保持一致。
export const BACKUP_PLATFORM_MOBILE = 'mobile';
export const BACKUP_PLATFORM_DESKTOP = 'desktop';
export const BACKUP_PLATFORM_WATCH = 'watch';

// 本端（桌面端）写入 / 读取的 settings 槽位键。
export const BACKUP_DESKTOP_SETTING_SLOT = BACKUP_PLATFORM_DESKTOP;

export type PlaylistType = 'local' | 'online' | 'mixed';

export interface BackupPlaylistEntry {
  name: string;
  type: PlaylistType;
  songs: Song[];
  createdAt?: string;
  isFavorite?: boolean;
}

export interface BackupPluginEntry {
  source: PluginSource;
  script: string;
  /** 用户变量值（如卡密），随备份迁移到其他端；缺失视为旧版备份 */
  userVariables?: Record<string, string>;
}

/** 最近播放条目：`playedAt` 单位为秒（跨端统一），`song` 为可选的歌曲元数据 */
export interface BackupRecentHistoryEntry {
  path: string;
  playedAt: number;
  song?: Song;
}

/** 设置按端分槽存储，各端只写/只读自己的槽位，避免跨端互相覆盖 */
export interface AppBackupSettingsSlots {
  mobile?: AppSettings | null;
  desktop?: AppSettings | null;
  watch?: AppSettings | null;
}

export interface AppBackupData {
  playlists: BackupPlaylistEntry[];
  favorites?: Song[];
  plugins: BackupPluginEntry[];
  recentHistory?: BackupRecentHistoryEntry[];
  settings: AppBackupSettingsSlots | null;
}

export interface AppBackupSummary {
  playlistCount: number;
  localPlaylistCount: number;
  onlinePlaylistCount: number;
  mixedPlaylistCount: number;
  totalSongs: number;
  localSongs: number;
  onlineSongs: number;
  favoriteCount: number;
  pluginCount: number;
  hasSettings: boolean;
  recentCount?: number;
  /** 备份文件是否已加密 */
  encrypted?: boolean;
}

export interface AppBackup {
  schema: string;
  version: number;
  createdAt: string;
  /** 导出端标记：mobile / desktop / watch */
  platform?: string;
  data: AppBackupData;
}

export interface AppBackupSummary {
  playlistCount: number;
  localPlaylistCount: number;
  onlinePlaylistCount: number;
  mixedPlaylistCount: number;
  totalSongs: number;
  localSongs: number;
  onlineSongs: number;
  favoriteCount: number;
  pluginCount: number;
  hasSettings: boolean;
  recentCount?: number;
}

export interface AppBackupExportResult {
  json: string;
  summary: AppBackupSummary;
}

export interface AppBackupImportResult {
  summary: AppBackupSummary;
  importedPlaylists: number;
  importedFavorites: number;
  importedPlugins: number;
  skippedPlugins: number;
  settingsApplied: boolean;
  importedRecent?: number;
  errors: string[];
}

export function classifySong(song: Song): 'local' | 'online' {
  if (song.source_type === 'local') return 'local';
  if (song.source_type === 'remote' || song.source_type === 'plugin') return 'online';

  const path = song.path || '';
  if (path.startsWith('plugin://') || path.startsWith('lx://') || path.startsWith('http://') || path.startsWith('https://')) {
    return 'online';
  }
  return 'local';
}

export function classifyPlaylist(songs: Song[]): PlaylistType {
  if (songs.length === 0) return 'local';
  const types = new Set(songs.map(classifySong));
  if (types.size === 1) {
    return types.has('local') ? 'local' : 'online';
  }
  return 'mixed';
}