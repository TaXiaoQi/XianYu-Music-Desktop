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
  deletedSongPaths?: string[];
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

// ==================== v2 下载协议：服务端 diff ops ====================
// 与 Server 端 compute_download_ops（sync_diff.rs）的 json! 序列化逐字段对齐。

export interface SyncOpsStats {
  playlist_count: number;
  song_total: number;
}

/** 云端有、上报无此歌单 → 全量建单（playlist 为云端快照原样）。 */
export interface SyncOpCreatePlaylist {
  type: 'create_playlist';
  playlist: FileSyncDownloadData['playlists'][number];
}

/** song_hash 不在上报集合中的云歌曲（服务端已排除 tombstone）。 */
export interface SyncOpAddSongs {
  type: 'add_songs';
  cloudId: string;
  /** 云端快照的歌单本地 id，供客户端 cloudId 缺失时兜底匹配 */
  id?: string;
  songs: SyncSongPayload[];
}

/** 云端 tombstone 路径，与 v1 下载 deletedSongPaths 语义一致。 */
export interface SyncOpRemoveSongs {
  type: 'remove_songs';
  cloudId: string;
  id?: string;
  paths: string[];
}

/** 仅差异字段 patch（cloudCoverUrl/sourcePluginId/sourceUrl，与今日下载合并一致）。 */
export interface SyncOpUpdatePlaylistMeta {
  type: 'update_playlist_meta';
  cloudId: string;
  id?: string;
  cloudCoverUrl?: string;
  sourcePluginId?: string;
  sourceUrl?: string;
}

export type SyncOp =
  | SyncOpCreatePlaylist
  | SyncOpAddSongs
  | SyncOpRemoveSongs
  | SyncOpUpdatePlaylistMeta;

export interface SyncOpsDownloadData {
  ops: SyncOp[];
  stats: SyncOpsStats;
  snapshot_timestamp: number;
}