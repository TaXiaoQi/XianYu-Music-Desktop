
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
  options?: { deletePaths?: string[]; merge?: boolean },
): Promise<FavoritesUploadResult> {
  const payload: SyncSongPayload[] = songs.map(songToSyncPayload);
  try {
    const body: Record<string, unknown> = {
      user_id: ciyuanxiId,
      favorites: payload,
      // merge=false 为手动覆盖上传：服务端用本次上传全量替换收藏（默认合并，自动同步不受影响）
      merge: options?.merge !== false,
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
  const { songs } = await downloadFavoritesWithLedger(ciyuanxiId, options);
  return songs;
}

/** 下载云端收藏 + 删除广播账本：deletedPaths 为其他端「删除全部/删除云端」
 * 的 path 列表，拉取端据此裁剪本地副本（向后兼容：旧服务端缺省为空）。 */
export async function downloadFavoritesWithLedger(
  ciyuanxiId: string,
  options?: { skipToken?: boolean },
): Promise<{ songs: Song[]; deletedPaths: string[] }> {
  try {
    const data = await signedRequest<FavoritesDownloadData>('favorites_sync_download', {
      user_id: ciyuanxiId,
    }, {
      fetchTimeoutMs: 12_000,
      timeoutMs: 15_000,
      skipToken: options?.skipToken,
    });
    const favorites = data?.favorites ?? [];
    const rawDeleted = (data as { deleted_paths?: unknown } | undefined)?.deleted_paths;
    const deletedPaths = Array.isArray(rawDeleted)
      ? rawDeleted.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : [];
    return { songs: favorites.map(syncPayloadToSong), deletedPaths };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logSyncError(`downloadFavorites 失败: ${msg}`);
    throw e;
  }
}
