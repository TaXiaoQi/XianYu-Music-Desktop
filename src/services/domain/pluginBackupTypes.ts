import type { PluginSource, Song } from '../../types';
import type { LxSearchResultItem } from './lxMusicSdk';


export type SupportedPluginBackupFormat = 'bakamusic' | 'musicfree' | 'lxmusic';

export const STRINGIFIED_TRACK_ID_BACKUP_VERSION = 2;
export const CURRENT_TRACK_ID_BACKUP_VERSION = 3;

export interface PluginBackupPlaylist {
  name: string;
  songs: Song[];
  originalSongCount: number;
}

export interface PluginBackupFailedSong {
  playlist: string;
  title: string;
  artist: string;
  platform: string;
  reason: string;
  reasonCode: 'missing-plugin' | 'invalid-song';
}

export interface PluginBackupAssociation {
  pluginId: string;
  pluginName: string;
  pluginFormat: PluginSource['format'];
  enabled: boolean;
  platform: string;
  songCount: number;
}

export interface MissingBackupPlugin {
  platform: string;
  songCount: number;
}

export interface PreparedPluginBackupImport {
  format: SupportedPluginBackupFormat;
  sourcePlaylistCount: number;
  totalSongCount: number;
  importedSongCount: number;
  playlists: PluginBackupPlaylist[];
  failures: PluginBackupFailedSong[];
  associations: PluginBackupAssociation[];
  missingPlugins: MissingBackupPlugin[];
  backupVersion: number | null;
  migratedTrackIds: boolean;
  migratedTrackIdCount: number;
}

export type LxSourceKey = LxSearchResultItem['source'];

export interface PlatformDescriptor {
  displayName: string;
  normalized: string;
  canonical: string;
  lxSource?: LxSourceKey;
}