
import type { Song } from '../../types';
import { signedRequest } from '../auth/authService';
import { songToSyncPayload, syncPayloadToSong, type SyncSongPayload } from './playlistSync';

const LOG = '[FavoritesSync]';

function logSyncError(msg: string, ...args: unknown[]) {
  console.error(`${LOG} ${msg}`, ...args);
}

export interface FavoritesUploadResult {
  song_count: number;
}

export interface FavoritesDownloadData {
  version: number;
  uploaded_at: string;
  timestamp: number;
  stats: {
    song_count: number;
  };
  favorites: SyncSongPayload[];
}

export async function uploadFavorites(
  ciyuanxiId: string,
  songs: Song[],
  options?: { deletePaths?: string[] },
): Promise<FavoritesUploadResult> {
  const payload: SyncSongPayload[] = songs.map(songToSyncPayload);
  try {
    const body: Record<string, unknown> = {
      user_id: ciyuanxiId,
      favorites: payload,
      merge: true,
    };
    const del = options?.deletePaths ?? [];
    if (del.length > 0) {
      body.delete_paths = del;
    }
    const data = await signedRequest<FavoritesUploadResult>('favorites_sync_upload', body, {
      fetchTimeoutMs: 12_000,
      timeoutMs: 15_000,
    });
    return data ?? { song_count: 0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logSyncError(`uploadFavorites 失败: ${msg}`);
    throw e;
  }
}

export async function downloadFavorites(
  ciyuanxiId: string,
  options?: { skipToken?: boolean },
): Promise<Song[]> {
  try {
    const data = await signedRequest<FavoritesDownloadData>('favorites_sync_download', {
      user_id: ciyuanxiId,
    }, {
      fetchTimeoutMs: 12_000,
      timeoutMs: 15_000,
      skipToken: options?.skipToken,
    });
    const favorites = data?.favorites ?? [];
    return favorites.map(syncPayloadToSong);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logSyncError(`downloadFavorites 失败: ${msg}`);
    throw e;
  }
}
