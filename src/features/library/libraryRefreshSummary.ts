import type { Ref } from 'vue';

import type { ScanLibraryOptions } from './libraryScan';
import { syncRemovedLibrarySongPreferences } from './libraryRemovalCleanup';

export interface LibraryRefreshSummary {
  removedCount: number;
  removedPaths: string[];
}

interface CreateLibraryRefreshSummaryDeps {
  getCanonicalSongPaths: () => string[];
  currentSongPath: Ref<string | null>;
  scanLibrary: (options?: ScanLibraryOptions) => Promise<unknown>;
  removeFromHistory: (songPaths: string[]) => Promise<void>;
  refreshStateSongReferences: () => void;
  stopPlayback: () => Promise<void>;
  showToast: (message: string, type: 'success' | 'info' | 'error') => void;
}

export const createLibraryRefreshSummary = ({
  getCanonicalSongPaths,
  currentSongPath,
  scanLibrary,
  removeFromHistory,
  refreshStateSongReferences,
  stopPlayback,
  showToast,
}: CreateLibraryRefreshSummaryDeps) => {
  const refreshLibraryAndCollectSummary = async (
    options: ScanLibraryOptions = { trigger: 'manual-rescan', visibility: 'inline' },
  ): Promise<LibraryRefreshSummary> => {
    const previousPaths = [...getCanonicalSongPaths()];
    const previousPathSet = new Set(previousPaths);
    const activeSongPath = currentSongPath.value;

    await scanLibrary(options);

    const currentPathSet = new Set(getCanonicalSongPaths());
    const removedPaths = previousPaths.filter(path => !currentPathSet.has(path));

    if (removedPaths.length > 0) {
      syncRemovedLibrarySongPreferences(removedPaths);
      await removeFromHistory(removedPaths);
      refreshStateSongReferences();
    }

    if (activeSongPath && previousPathSet.has(activeSongPath) && !currentPathSet.has(activeSongPath)) {
      await stopPlayback();
      showToast('当前歌曲已不存在', 'info');
    }

    return {
      removedCount: removedPaths.length,
      removedPaths,
    };
  };

  return {
    refreshLibraryAndCollectSummary,
  };
};
