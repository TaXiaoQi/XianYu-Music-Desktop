import type { Song } from '../../types';

/**
 * 备份文件导入服务 · 类型定义（叶子）。
 * 供 backupImportSong / backupImportParse / backupImportMatch
 * 及门面 backupImport 复用。
 */

export interface ImportedPlaylist {
  name: string;
  songs: Song[];
}

export type BackupFormat = 'bakamusic' | 'musicfree' | 'unknown';