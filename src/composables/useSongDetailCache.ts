import { tauriInvoke } from '../services/tauri/invoke';
import type { SongDetail } from '../types';
import { MemoryCache } from '../utils/MemoryCache';

const SONG_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const SONG_DETAIL_CACHE_MAX_ENTRIES = 8;

const songDetailCache = new MemoryCache<string, SongDetail>({
  maxEntries: SONG_DETAIL_CACHE_MAX_ENTRIES,
  ttlMs: SONG_DETAIL_CACHE_TTL_MS,
});

const inFlightRequests = new Map<string, Promise<SongDetail>>();

export function useSongDetailCache() {
  const loadSongDetail = async (path: string) => {
    if (!path) {
      return null;
    }

    const cached = songDetailCache.get(path);
    if (cached) {
      return cached;
    }

    const inFlight = inFlightRequests.get(path);
    if (inFlight) {
      return inFlight;
    }

    const request = tauriInvoke('get_song_detail', { path })
      .then((detail) => {
        songDetailCache.set(path, detail);
        return detail;
      })
      .finally(() => {
        inFlightRequests.delete(path);
      });

    inFlightRequests.set(path, request);
    return request;
  };

  return {
    loadSongDetail,
    clearSongDetailCache: () => {
      songDetailCache.clear();
      inFlightRequests.clear();
    },
  };
}
