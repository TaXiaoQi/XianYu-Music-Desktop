import { usePlayerCore } from '../playback/playerCore';

export function useLibraryRuntimeActions() {
  const { libraryDomain } = usePlayerCore();
  const {
    addLibraryFolder,
    addLibraryFolderLinked,
    addLibraryFolderPath,
    removeLibraryFolder,
    removeLibraryFolderLinked,
    removeLibraryFolderPath,
    scanLibrary,
    refreshFolder,
    refreshAllFolders,
    fetchFolderTree,
    loadLibrarySongsFromCache,
    ensureFolderChildrenLoaded,
    createFolder,
    deleteFolder,
    toggleFolderNode,
    expandFolderPath,
    moveFilesToFolder,
    deleteFromDisk,
    openInFinder,
    getSongsInFolder,
  } = libraryDomain;

  return {
    addLibraryFolder,
    addLibraryFolderLinked,
    addLibraryFolderPath,
    removeLibraryFolder,
    removeLibraryFolderLinked,
    removeLibraryFolderPath,
    scanLibrary,
    refreshFolder,
    refreshAllFolders,
    fetchFolderTree,
    loadLibrarySongsFromCache,
    ensureFolderChildrenLoaded,
    createFolder,
    deleteFolder,
    toggleFolderNode,
    expandFolderPath,
    moveFilesToFolder,
    deleteFromDisk,
    openInFinder,
    getSongsInFolder,
  };
}
