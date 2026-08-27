import type { Song } from '../../types';

/** 与应用备份导出一致的歌单类型 */
export type PlaylistType = 'local' | 'online' | 'mixed';

/** 同步文件中的歌曲类型 */
export type SyncSongType = 'local' | 'online';

/** 新版文件同步歌曲：保留完整 Song 元数据，并额外标记来源类型 */
export interface SyncSongPayload extends Song {
  syncType?: SyncSongType;
  song_hash?: string;
}

/** 同步结果摘要 */
export interface SyncResult {
  uploadedPlaylists: number;
  downloadedPlaylists: number;
  uploadedSongs: number;
  downloadedSongs: number;
  errors: string[];
}

/** 文件同步上传的歌单数据格式 */
export interface FileSyncPlaylistData {
  id: string;
  name: string;
  type?: PlaylistType;
  cloudId?: number;
  cloudCoverUrl?: string;
  isFavorite?: boolean;
  createdAt?: string;
  songs: SyncSongPayload[];
}

/** 文件同步下载的完整数据 */
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
    cloudId?: number;
    cloudCoverUrl?: string;
    isFavorite?: boolean;
    createdAt?: string;
    songs: SyncSongPayload[];
  }>;
}