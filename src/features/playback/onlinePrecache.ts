/**
 * 在线歌曲预缓存（双端对齐能力）。
 *
 * 本首在线歌开播成功后，对播放队列之后最多 5 首在线歌预取：
 *   1. 音质元数据 + 目标音质直链（以播放设置音质为主，不可用按回退策略降级/升级）
 *   2. 封面、歌词（经 resolveOnlineQualityUrl includePlaybackExtras 一并带回并落库）
 *   3. 目标音质的约 15 秒片头音频字节（Rust audio_head_cache，内存有界）
 *
 * 存储约束：片头仅保留约 15 秒音频（按音质估算 0.25–6MB），
 * Rust 侧 12 条 / 24MB / 15 分钟 TTL 三重上限，只驻内存不落盘。
 * 切到下一首时：起播解析命中播种直链（无插件解析等待），
 * stream_cache 注入片头并断点续传，实现秒开。
 */
import type { Song, QualityKey } from '../../types';
import {
  getOnlineAvailableQualities,
  withBilibiliStreamCookie,
} from './onlinePlaybackResolver';
import { resolveOnlineQualityUrl } from '../../services/domain/downloadService';
import { isDownloadableOnlineSong } from '../../services/domain/downloadFormat';
import { seedSharedProbeUrl } from '../../services/domain/qualitySharedProbe';
import { normalizeMediaRequestHeaders } from '../../utils/mediaUrl';
import { playbackApi } from '../../services/tauri/playbackApi';
import { useLibraryStore } from '../library/store';
import { usePlaybackStore } from './store';

/** 预取范围：队列后续 5 首 */
const MAX_PREFETCH_SONGS = 5;
/** 同一首歌预取结果复用窗口：窗口内不重复请求 */
const PREFETCH_TTL_MS = 10 * 60_000;

/** 歌曲身份键 → 最近一次预取时刻 */
const recentPrefetchAt = new Map<string, number>();

/**
 * 各音质档「15 秒片头」估算字节数（≈15s × 档位码率 × 1.1 余量）。
 * Rust 侧另有 8MB 硬上限兜底。
 */
const HEAD_BYTES_BY_QUALITY: Record<QualityKey, number> = {
  mgg: 260_000,
  '128k': 260_000,
  '192k': 380_000,
  '320k': 630_000,
  flac: 2_700_000,
  flac24bit: 3_300_000,
  hires: 4_600_000,
  vinyl: 3_300_000,
  dolby: 3_300_000,
  atmos: 3_300_000,
  atmos_plus: 4_400_000,
  master: 5_800_000,
};

const estimateHeadBytes = (quality: QualityKey): number =>
  HEAD_BYTES_BY_QUALITY[quality] ?? 2_700_000;

function pruneRecent(): void {
  const now = Date.now();
  for (const [key, at] of recentPrefetchAt) {
    if (now - at > PREFETCH_TTL_MS) recentPrefetchAt.delete(key);
  }
}

/**
 * 预取单首歌：解析目标音质直链（含歌词/封面附加信息）→ 播种共享探测 →
 * 歌词/封面落到歌曲元数据 → 预取约 15 秒片头字节。
 */
async function prefetchOneSong(
  song: Song,
  requestedQuality: QualityKey,
  fallbackBehavior: 'lower' | 'higher' | 'pause',
): Promise<void> {
  const songKey = song.cue_source_path || song.path;
  pruneRecent();
  if (recentPrefetchAt.has(songKey)) return;
  recentPrefetchAt.set(songKey, Date.now());

  const audioFilePath = songKey;
  let availableQualities: QualityKey[] | null = null;
  try {
    availableQualities = await getOnlineAvailableQualities(audioFilePath, song);
  } catch { /* ignore: 音质列表获取失败不阻塞预取 */ }

  // 单档解析（内部按回退策略走候选链），带回歌词/封面附加信息
  const resolved = await resolveOnlineQualityUrl(
    song,
    requestedQuality,
    fallbackBehavior,
    availableQualities,
    undefined,
    { includePlaybackExtras: true },
  );
  if (!resolved?.url) return;

  // [播种] 把预取直链注入共享探测：起播时直接命中，跳过插件解析等待
  seedSharedProbeUrl(song, resolved.quality, resolved.url);

  // [歌词/封面落库] 对齐播放链路：写入 library songPool 与队列 fallback，
  // 使稍后切到该歌时歌词/封面立即可用
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const metaPatch: Partial<Song> = {};
  if (!song.lyrics_raw?.trim() && resolved.lyricsRaw?.trim()) {
    metaPatch.lyrics_raw = resolved.lyricsRaw;
  }
  if (!song.cover_thumb_path && resolved.coverThumbPath) {
    metaPatch.cover_thumb_path = resolved.coverThumbPath;
  }
  if (Object.keys(metaPatch).length > 0) {
    libraryStore.patchSongMeta(song.path, metaPatch);
    playbackStore.patchQueueSongMeta(song.path, metaPatch);
  }

  // [片头预取] 与播放同源的请求头（含 B 站 Cookie 合并），Rust 侧内存缓存
  const headers = await withBilibiliStreamCookie(
    resolved.url,
    normalizeMediaRequestHeaders(resolved.url, resolved.headers ?? null),
  );
  if (headers && !song.remote_headers) {
    libraryStore.patchSongMeta(song.path, { remote_headers: headers });
  }
  await playbackApi.prefetchAudioHead({
    url: resolved.url,
    headers,
    maxBytes: estimateHeadBytes(resolved.quality),
  });
}

/**
 * 本首在线歌开播成功后调用：确定可预知的「下一首」序列并逐首预取。
 *
 * - 单曲循环：无下一首，跳过
 * - 随机模式：下一首不可预知，跳过（避免无意义流量）
 * - 临时队列非空：临时队列即接下来的播放顺序
 * - 否则：主队列当前歌曲之后的顺序列表（循环取首尾相接）
 */
export function scheduleOnlinePrecache(
  requestedQuality: QualityKey,
  fallbackBehavior: 'lower' | 'higher' | 'pause',
): void {
  try {
    const playbackStore = usePlaybackStore();

    if (playbackStore.playMode === 1 || playbackStore.playMode === 2) return;

    const currentPath = playbackStore.currentSongPath;
    if (!currentPath) return;

    let upcoming: Song[] = [];
    if (playbackStore.tempQueue.length > 0) {
      upcoming = playbackStore.tempQueue.slice(0, MAX_PREFETCH_SONGS);
    } else {
      const queue = playbackStore.playQueue;
      const idx = queue.findIndex(s => s.path === currentPath);
      if (idx < 0) return;
      const ordered = idx + 1 < queue.length
        ? queue.slice(idx + 1)
        : [];
      upcoming = ordered
        .filter(s => s && isDownloadableOnlineSong(s))
        .slice(0, MAX_PREFETCH_SONGS);
    }
    upcoming = upcoming.filter(s => s && isDownloadableOnlineSong(s));
    if (upcoming.length === 0) return;

    // 串行逐首预取：避免 5 首并发打满带宽影响当前播放缓冲
    void (async () => {
      for (const song of upcoming) {
        try {
          await prefetchOneSong(song, requestedQuality, fallbackBehavior);
        } catch (e) {
          console.warn('[OnlinePrecache] 预取下一首失败:', song.path, e);
        }
      }
    })();
  } catch (e) {
    console.warn('[OnlinePrecache] 预缓存调度失败:', e);
  }
}
