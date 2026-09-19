import type { Song } from '../../types';

export type PlaylistType = 'local' | 'online' | 'mixed';

export type SyncSongType = 'local' | 'online';

export interface SyncSongPayload extends Song {
  syncType?: SyncSongType;
  song_hash?: string;
}

export interface SyncResult {
  uploadedPlaylists: number;
  downloadedPlaylists: number;
  uploadedSongs: number;
  downloadedSongs: number;
  errors: string[];
}

export interface SyncIdMapEntry {
  id: string;
  cloudId?: string;
}

export interface FileSyncUploadResult {
  playlist_count: number;
  song_total: number;
  id_map?: SyncIdMapEntry[];
}

export interface FileSyncPlaylistData {
  id: string;
  name: string;
  type?: PlaylistType;
  cloudId?: string;
  cloudCoverUrl?: string;
  isFavorite?: boolean;
  createdAt?: string;
  sourcePluginId?: string;
  sourceUrl?: string;
  sourceRaw?: any;
  songs: SyncSongPayload[];
}

export interface FileSyncDownloadData {
  version: number;
  uploaded_at: string;
  timestamp: number;
  stats: {
    playlist_count: number;
    song_total: number;
  };
  playlists: Array<{
    id: string;
    name: string;
    type?: PlaylistType;
    cloudId?: string;
    cloudCoverUrl?: string;
    isFavorite?: boolean;
    createdAt?: string;
    sourcePluginId?: string;
    sourceUrl?: string;
    sourceRaw?: any;
    songs: SyncSongPayload[];
    deletedSongPaths?: string[];
  }>;
}