import { ref } from 'vue';

import type { FolderSortMode } from '../services/storage/playerStorage';
import { tauriInvoke } from '../services/tauri/invoke';
import { MemoryCache } from '../utils/MemoryCache';

type BackendFolderSortMode = Exclude<FolderSortMode, 'custom'>;

const FOLDER_VIEW_PATH_CACHE_TTL_MS = 5 * 60 * 1000;
const FOLDER_VIEW_PATH_CACHE_MAX_ENTRIES = 96;

const folderViewPathCache = new MemoryCache<string, string[]>({
  maxEntries: FOLDER_VIEW_PATH_CACHE_MAX_ENTRIES,
  ttlMs: FOLDER_VIEW_PATH_CACHE_TTL_MS,
});

const inFlightRequests = new Map<string, Promise<string[]>>();
const cacheVersion = ref(0);

const makeCacheKey = (
  folderPath: string,
  query: string,
  sortMode: BackendFolderSortMode,
) => `${sortMode}\u0001${folderPath}\u0001${query}`;

export function useLibraryFolderSongPathCache() {
  const loadFolderViewSongPaths = async ({
    folderPath,
    query = '',
    sortMode,
  }: {
    folderPath: string;
    query?: string;
    sortMode: BackendFolderSortMode;
  }) => {
    if (!folderPath) {
      return [];
    }

    const cacheKey = makeCacheKey(folderPath, query, sortMode);
    const cached = folderViewPathCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = tauriInvoke('get_library_song_paths_for_folder_view', {
      folderPath,
      query,
      sortMode,
    })
      .then((paths) => {
        folderViewPathCache.set(cacheKey, paths);
        cacheVersion.value += 1;
        return paths;
      })
      .finally(() => {
        inFlightRequests.delete(cacheKey);
      });

    inFlightRequests.set(cacheKey, request);
    return request;
  };

  return {
    loadFolderViewSongPaths,
    clearLibraryFolderSongPathCache: () => {
      folderViewPathCache.clear();
      inFlightRequests.clear();
      cacheVersion.value += 1;
    },
    libraryFolderSongPathCacheVersion: cacheVersion,
  };
}
