import type { Song } from '../../types';
import {
  cleanupRemovedLibrarySongPaths,
  collectSongPathsInFolderScope,
  isPathInFolderScope,
} from './libraryRemovalCleanup';

interface CreateLibraryFolderRemovalDeps {
  getCandidateSongs: () => Song[];
  getActiveSongPath: () => string | null;
  removeLibraryFolderLinked: (path: string, options?: { showToast?: boolean }) => Promise<unknown>;
  stopPlayback: () => Promise<void>;
  removeFromHistory: (songPaths: string[]) => Promise<void>;
  removeSongStatistics: (songPaths: string[]) => Promise<void>;
  clearCaches: () => void;
}

export const createLibraryFolderRemoval = ({
  getCandidateSongs,
  getActiveSongPath,
  removeLibraryFolderLinked,
  stopPlayback,
  removeFromHistory,
  removeSongStatistics,
  clearCaches,
}: CreateLibraryFolderRemovalDeps) => {
  const collectRemovedLibraryFolderSongPaths = (path: string) =>
    collectSongPathsInFolderScope(getCandidateSongs(), path);

  const removeLibraryFolderLinkedWithCleanup = async (
    path: string,
    options: { showToast?: boolean } = {},
  ): Promise<void> => {
    const removedPaths = collectRemovedLibraryFolderSongPaths(path);
    const activeSongPath = getActiveSongPath();

    if (activeSongPath && isPathInFolderScope(path, activeSongPath)) {
      if (!removedPaths.some(songPath => songPath === activeSongPath)) {
        removedPaths.push(activeSongPath);
      }
      await stopPlayback();
    }

    await removeLibraryFolderLinked(path, options);
    await cleanupRemovedLibrarySongPaths({
      removedPaths,
      removedFolderPath: path,
      stopPlayback,
      removeFromHistory,
      removeSongStatistics,
      clearCaches,
    });
  };

  return {
    collectRemovedLibraryFolderSongPaths,
    removeLibraryFolderLinkedWithCleanup,
  };
};
