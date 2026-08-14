/**
 * 云端歌单同步服务
 *
 * 封装后端 `api/index.php` 的歌单管理接口，提供本地歌单与云端歌单之间的
 * 双向同步能力。所有请求复用 authService 的签名机制（MD5 + 可选 AES 加密）。
 *
 * 后端接口一览（action=xxx）：
 * - delete_playlist
 * - file_sync_upload_start / file_sync_upload_chunk / file_sync_upload_finish / file_sync_download
 */

import type { Song } from '../types';
import { signedRequest } from './auth/authService';
import { getStoredAuth } from './auth/authService';
import type { SignedRequestOptions } from './auth/authService';
import { isPluginSong } from '../utils/pluginSong';
import { isRemoteSong } from '../utils/remoteSong';
import { md5 } from './auth/md5';

/** 日志前缀，方便在控制台筛选歌单同步相关日志 */
const LOG = '[PlaylistSync]';

function logSync(_msg: string, ..._args: unknown[]) {
}

function logSyncError(msg: string, ...args: unknown[]) {
  console.error(`${LOG} ${msg}`, ...args);
}

// ==================== 类型定义 ====================

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

// ==================== 工具函数 ====================

/** 获取当前登录用户的弦予号 */
export function getCiyuanxiId(): string | null {
  const auth = getStoredAuth();
  return auth?.user?.ciyuanxi_id ?? null;
}

/** 判断是否为在线歌曲（非本地文件） */
export function isOnlineSong(song: Song): boolean {
  return (
    isRemoteSong(song)
    || isPluginSong(song)
    || song.path?.startsWith('lx://') === true
    || song.path?.startsWith('plugin://') === true
    || song.path?.startsWith('http://') === true
    || song.path?.startsWith('https://') === true
  );
}

/** 自动识别歌曲来源类型，与备份导出逻辑保持一致 */
export function classifySyncSong(song: Song): SyncSongType {
  if (song.source_type === 'local') return 'local';
  if (song.source_type === 'remote' || song.source_type === 'plugin') return 'online';
  return isOnlineSong(song) ? 'online' : 'local';
}

/** 自动识别歌单类型：纯本地、纯在线或混合 */
export function classifySyncPlaylist(songs: Song[]): PlaylistType {
  if (songs.length === 0) return 'local';
  const types = new Set(songs.map(classifySyncSong));
  if (types.size === 1) {
    return types.has('local') ? 'local' : 'online';
  }
  return 'mixed';
}

/**
 * 为本地 Song 生成云端 song_hash。
 * 优先使用 path 的 hash（保证同一首歌在不同设备间 hash 一致），
 * 回退到 name|artist|source 组合。
 */
function generateSongHash(song: Song): string {
  // 在线歌曲用 path 作为唯一标识的 hash 基础
  if (isOnlineSong(song) && song.path) {
    return md5(song.path);
  }
  // 本地歌曲用 name|artist 组合
  const name = song.title || song.name || '';
  const artist = song.artist || '';
  return md5(`${name}|${artist}|local`);
}

/** 将本地 Song 转换为备份同款同步歌曲，保留完整元数据并加来源标记 */
export function songToSyncPayload(song: Song): SyncSongPayload {
  return {
    ...JSON.parse(JSON.stringify(song)),
    syncType: classifySyncSong(song),
    song_hash: generateSongHash(song),
  };
}

/** 将同步歌曲恢复成 Song */
export function syncPayloadToSong(song: SyncSongPayload): Song {
  const payload = song as SyncSongPayload;
  const title = payload.title || payload.name || '';
  const artist = payload.artist || '未知艺术家';
  const album = payload.album || '未知专辑';
  const artistNames = payload.artist_names?.length
    ? payload.artist_names
    : artist.split(/[、,/&]|\sft\.?\s/i).map(s => s.trim()).filter(Boolean);

  return {
    ...payload,
    name: payload.name || title,
    title,
    path: payload.path,
    artist,
    artist_names: artistNames.length > 0 ? artistNames : [artist],
    effective_artist_names: payload.effective_artist_names?.length
      ? payload.effective_artist_names
      : (artistNames.length > 0 ? artistNames : [artist]),
    album,
    album_artist: payload.album_artist || artist,
    album_key: payload.album_key || `${album}-${artist}`,
    is_various_artists_album: payload.is_various_artists_album ?? false,
    collapse_artist_credits: payload.collapse_artist_credits ?? false,
    duration: payload.duration || 0,
    source_type: payload.source_type ?? (payload.syncType === 'online' ? 'remote' : 'local'),
  };
}

// ==================== API 封装 ====================

/** 删除云端歌单 */
export async function deleteCloudPlaylist(
  ciyuanxiId: string,
  playlistId: number,
): Promise<void> {
  await signedRequest('delete_playlist', {
    user_id: ciyuanxiId,
    playlist_id: playlistId,
  });
}

// ==================== 文件存储同步 ====================
// 使用服务器端文件存储（非数据库），支持万首歌单的快速上传/下载
// 上传：分块发送 → 服务器合并为 JSON 文件
// 下载：一次请求获取完整 JSON 文件

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

/** 每块最多包含的歌曲数（~450KB/块，远低于宝塔 WAF 缓冲区限制，减少请求次数） */
const MAX_SONGS_PER_CHUNK = 1500;

/** 并发上传的块数（有重试机制保护，5 路并发可大幅缩短总耗时） */
const FILE_SYNC_CONCURRENCY = 5;

/** 分块上传失败后的最大重试次数 */
const FILE_SYNC_MAX_RETRIES = 3;

/** 分块上传的自定义超时（毫秒）：60s，比默认 25s 更宽松，避免服务器并发写入时偶发卡顿 */
const FILE_SYNC_CHUNK_TIMEOUT_MS = 60_000;

/** 重试间隔基数（毫秒），实际间隔 = base * (attempt + 1)，递增退避 */
const FILE_SYNC_RETRY_BASE_DELAY = 1_500;

/**
 * 将歌单数据按歌曲数拆分为多个小块。
 * 单个歌单的歌曲可能跨越多块，后端 upload_finish 会按歌单 id 合并。
 */
function splitPlaylistsIntoChunks(
  playlists: FileSyncPlaylistData[],
  maxSongsPerChunk: number,
): FileSyncPlaylistData[][] {
  const chunks: FileSyncPlaylistData[][] = [];
  let currentChunk: FileSyncPlaylistData[] = [];
  let currentSongCount = 0;

  for (const pl of playlists) {
    if (pl.songs.length === 0) {
      // 空歌单单独成块
      currentChunk.push({ ...pl, songs: [] });
      continue;
    }

    // 如果当前块已有内容且加入这个歌全会超限，先保存当前块
    if (currentSongCount > 0 && currentSongCount + pl.songs.length > maxSongsPerChunk) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentSongCount = 0;
    }

    // 如果单个歌单的歌曲数就超过上限，拆分这个歌单
    if (pl.songs.length > maxSongsPerChunk) {
      for (let i = 0; i < pl.songs.length; i += maxSongsPerChunk) {
        const songSlice = pl.songs.slice(i, i + maxSongsPerChunk);
        chunks.push([{ ...pl, songs: songSlice }]);
      }
    } else {
      currentChunk.push({ ...pl });
      currentSongCount += pl.songs.length;
    }
  }

  // 保存最后一个块
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * 带重试的 signedRequest 封装：失败后自动重试，递增退避。
 * 适用于分块上传等容错性要求高的场景。
 */
async function signedRequestWithRetry<T>(
  action: string,
  body: Record<string, unknown>,
  options: SignedRequestOptions,
  maxRetries: number = FILE_SYNC_MAX_RETRIES,
  retryLabel?: string,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await signedRequest<T>(action, body, options);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        const delay = FILE_SYNC_RETRY_BASE_DELAY * (attempt + 1);
        logSyncError(`signedRequestWithRetry: ${retryLabel ?? action} 第 ${attempt + 1}/${maxRetries} 次重试（${delay}ms 后）, error=${msg}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        logSyncError(`signedRequestWithRetry: ${retryLabel ?? action} 重试 ${maxRetries} 次后仍失败, error=${msg}`);
      }
    }
  }
  throw lastError;
}

/**
 * 文件同步上传：将所有歌单分块上传到服务器文件存储
 * 1. upload_start: 初始化
 * 2. upload_chunk × N: 分块上传（按歌曲数拆分，每块最多 MAX_SONGS_PER_CHUNK 首）
 *    - 每块失败自动重试最多 FILE_SYNC_MAX_RETRIES 次
 *    - 使用 60s 超时，比默认 25s 更宽松
 * 3. upload_finish: 合并保存（同 id 歌单的歌曲自动合并）
 */
export async function fileSyncUpload(
  ciyuanxiId: string,
  playlists: FileSyncPlaylistData[],
): Promise<{ playlist_count: number; song_total: number }> {
  logSync(`fileSyncUpload → user_id=${ciyuanxiId}, playlists=${playlists.length}`);
  const totalSongs = playlists.reduce((sum, pl) => sum + pl.songs.length, 0);
  logSync(`fileSyncUpload: 总歌曲数=${totalSongs}`);

  // upload_start / upload_finish 的超时配置：比默认更宽松，并自动重试
  const startFinishTimeoutOptions: SignedRequestOptions = {
    fetchTimeoutMs: 45_000,
    timeoutMs: 50_000,
  };

  // 1. 开始上传（带重试，防止服务器 PHP-FPM worker 耗尽时排队超时）
  await signedRequestWithRetry(
    'file_sync_upload_start',
    { user_id: ciyuanxiId },
    startFinishTimeoutOptions,
    FILE_SYNC_MAX_RETRIES,
    'upload_start',
  );

  // 2. 按歌曲数拆分块
  const chunks = splitPlaylistsIntoChunks(playlists, MAX_SONGS_PER_CHUNK);
  logSync(`fileSyncUpload: 分为 ${chunks.length} 块, 每块最多 ${MAX_SONGS_PER_CHUNK} 首歌`);

  const chunkTimeoutOptions: SignedRequestOptions = {
    fetchTimeoutMs: FILE_SYNC_CHUNK_TIMEOUT_MS,
    timeoutMs: FILE_SYNC_CHUNK_TIMEOUT_MS + 5_000, // 外层比 fetch 多 5s
  };

  // 并发上传
  for (let i = 0; i < chunks.length; i += FILE_SYNC_CONCURRENCY) {
    const batch = chunks.slice(i, i + FILE_SYNC_CONCURRENCY);
    const batchStart = i;

    const results = await Promise.allSettled(
      batch.map(async (chunk, j) => {
        const chunkIndex = batchStart + j;
        const songCount = chunk.reduce((s, pl) => s + pl.songs.length, 0);
        const label = `chunk ${chunkIndex + 1}/${chunks.length}`;
        logSync(`fileSyncUpload: 上传第 ${chunkIndex + 1}/${chunks.length} 块, 歌单数=${chunk.length}, 歌曲数=${songCount}`);
        const data = await signedRequestWithRetry<{ chunk_index: number; total_chunks: number }>(
          'file_sync_upload_chunk',
          {
            user_id: ciyuanxiId,
            chunk_index: chunkIndex,
            total_chunks: chunks.length,
            chunk_data: chunk,
          },
          chunkTimeoutOptions,
          FILE_SYNC_MAX_RETRIES,
          label,
        );
        return { chunkIndex, data };
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        logSyncError(`fileSyncUpload: 分块上传失败（重试后仍失败）, error=`, result.reason);
        throw result.reason;
      }
    }
  }

  // 3. 完成合并（带重试，合并大量分块可能耗时较长）
  logSync(`fileSyncUpload: 所有分块上传完成, 发送 upload_finish`);
  const finishData = await signedRequestWithRetry<{ playlist_count: number; song_total: number }>(
    'file_sync_upload_finish',
    { user_id: ciyuanxiId },
    startFinishTimeoutOptions,
    FILE_SYNC_MAX_RETRIES,
    'upload_finish',
  );
  logSync(`fileSyncUpload ← 完成: playlist_count=${finishData.playlist_count}, song_total=${finishData.song_total}`);
  return finishData;
}

/**
 * 文件同步下载：一次请求获取完整歌单数据
 */
export async function fileSyncDownload(ciyuanxiId: string): Promise<FileSyncDownloadData | null> {
  logSync(`fileSyncDownload → user_id=${ciyuanxiId}`);
  try {
    const data = await signedRequest<FileSyncDownloadData>('file_sync_download', {
      user_id: ciyuanxiId,
    });
    const playlistCount = data?.playlists?.length ?? 0;
    const songTotal = data?.stats?.song_total ?? 0;
    logSync(`fileSyncDownload ← playlists=${playlistCount}, songs=${songTotal}`);
    return data;
  } catch (e) {
    logSyncError(`fileSyncDownload 失败:`, e);
    throw e;
  }
}
