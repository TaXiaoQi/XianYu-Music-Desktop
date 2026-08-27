/**
 * 云端歌单同步 · 网络/文件存储接口。
 *
 * 封装后端 `api/index.php` 的歌单管理接口，复用 authService 的签名机制
 * （MD5 + 可选 AES 加密）。含删除云端歌单、以及基于服务器文件存储的
 * 分块上传/一次性下载（支持万首歌单）。
 */

import { signedRequest } from '../auth/authService';
import type { SignedRequestOptions } from '../auth/authService';
import type { FileSyncPlaylistData, FileSyncDownloadData } from './playlistSyncTypes';

/** 日志前缀，方便在控制台筛选歌单同步相关日志 */
const LOG = '[PlaylistSync]';

function logSync(_msg: string, ..._args: unknown[]) {
}

function logSyncError(msg: string, ...args: unknown[]) {
  console.error(`${LOG} ${msg}`, ...args);
}

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
 * @param options.skipToken 查看他人公开数据时跳过 token 注入，避免属主校验误判为登录过期
 */
export async function fileSyncDownload(
  ciyuanxiId: string,
  options?: { skipToken?: boolean },
): Promise<FileSyncDownloadData | null> {
  logSync(`fileSyncDownload → user_id=${ciyuanxiId}`);
  try {
    const data = await signedRequest<FileSyncDownloadData>('file_sync_download', {
      user_id: ciyuanxiId,
    }, {
      skipToken: options?.skipToken,
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