
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
  /** 用户变量值（如卡密），随备份迁移到其他端；缺失视为旧版备份 */
  userVariables?: Record<string, string>;
}

export interface AppBackupData {
  playlists: BackupPlaylistEntry[];
  favorites?: Song[];
  plugins: BackupPluginEntry[];
  settings: AppSettings | null;
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
  /** 备份文件是否已加密 */
  encrypted?: boolean;
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