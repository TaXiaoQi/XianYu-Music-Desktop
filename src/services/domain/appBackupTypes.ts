/**
 * 应用备份 · 类型与分类工具（叶子）。
 */

import type { Song, PluginSource, AppSettings } from '../../types';

export const APP_BACKUP_SCHEMA = 'xianyu-music.app-backup';
export const APP_BACKUP_VERSION = 1;

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
}

export interface AppBackupData {
  playlists: BackupPlaylistEntry[];
  /** 收藏歌曲（完整 Song 元信息，含本地与在线），含路径与元信息 */
  favorites?: Song[];
  plugins: BackupPluginEntry[];
  settings: AppSettings | null;
}

export interface AppBackup {
  schema: string;
  version: number;
  createdAt: string;
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
  errors: string[];
}

/**
 * 判断歌曲来源类型
 * - path 以 plugin:// 或 lx:// 开头 → online
 * - path 以 file:/// 或普通文件路径开头 → local
 * - source_type 字段优先判断
 */
export function classifySong(song: Song): 'local' | 'online' {
  if (song.source_type === 'local') return 'local';
  if (song.source_type === 'remote' || song.source_type === 'plugin') return 'online';

  const path = song.path || '';
  if (path.startsWith('plugin://') || path.startsWith('lx://') || path.startsWith('http://') || path.startsWith('https://')) {
    return 'online';
  }
  return 'local';
}

/** 对歌单进行类型分类 */
export function classifyPlaylist(songs: Song[]): PlaylistType {
  if (songs.length === 0) return 'local';
  const types = new Set(songs.map(classifySong));
  if (types.size === 1) {
    return types.has('local') ? 'local' : 'online';
  }
  return 'mixed';
}