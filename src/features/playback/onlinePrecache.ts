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

const MAX_PREFETCH_SONGS = 5;
const PREFETCH_TTL_MS = 10 * 60_000;

const recentPrefetchAt = new Map<string, number>();

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

  const resolved = await resolveOnlineQualityUrl(
    song,
    requestedQuality,
    fallbackBehavior,
    availableQualities,
    undefined,
    { includePlaybackExtras: true },
  );
  if (!resolved?.url) return;

  seedSharedProbeUrl(song, resolved.quality, resolved.url);

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
