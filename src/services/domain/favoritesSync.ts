/**
 * 收藏歌曲云端同步服务
 *
 * 封装后端 `favorites_sync_upload` / `favorites_sync_download` 接口，
 * 将本地"我的收藏"（含在线歌曲元信息）上传到云端，或从云端拉取。
 *
 * 上传：一次请求将收藏歌曲列表（SyncSongPayload[]）写入服务器文件快照。
 * 下载：一次请求获取完整收藏列表，供本机恢复或排行榜"查看"用户详情展示。
 *
 * 复用 authService 的签名机制（MD5 + 可选 AES 加密）。
 */

import type { Song } from '../../types';
import { signedRequest } from '../auth/authService';
import { songToSyncPayload, syncPayloadToSong, type SyncSongPayload } from './playlistSync';

/** 日志前缀 */
const LOG = '[FavoritesSync]';

function logSyncError(msg: string, ...args: unknown[]) {
  console.error(`${LOG} ${msg}`, ...args);
}

/** 收藏同步上传的响应 */
export interface FavoritesUploadResult {
  song_count: number;
}

/** 收藏同步下载的完整数据 */
export interface FavoritesDownloadData {
  version: number;
  uploaded_at: string;
  timestamp: number;
  stats: {
    song_count: number;
  };
  favorites: SyncSongPayload[];
}

/**
 * 上传当前用户的收藏歌曲列表到云端。
 *
 * 合并模式：携带 `merge: true` 与 `delete_paths`，服务端逐条按 path upsert +
 * 删除 delete_paths，保留云端未被本次涉及的其他收藏（跨设备按键合并）。
 * 不传 delete_paths 时等价于旧行为（merge 模式下仅 upsert 本条集合、不删其他）。
 */
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

/**
 * 下载指定用户的收藏歌曲列表（当前用户恢复或排行榜"查看"用户详情）
 * @param options.skipToken 查看他人公开数据时跳过 token 注入，避免属主校验误判为登录过期
 */
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
