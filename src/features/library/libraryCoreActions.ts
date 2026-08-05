import type { createPlayerFileManager } from '../playback/playerFileManager';
import type { FolderNode, Song } from '../../types';
import type { ScanLibraryOptions } from './libraryScan';
import type { createLibraryFolderImport } from './libraryFolderImport';
import type { createLibraryFolderTree } from './libraryFolderTree';
import type { createLibraryRuntime } from './libraryRuntime';
import type { LibraryRefreshSummary } from './libraryRefreshSummary';

interface CreateLibraryCoreActionsDeps {
  playerFileManager: ReturnType<typeof createPlayerFileManager>;
  libraryFolderTree: ReturnType<typeof createLibraryFolderTree>;
  libraryFolderImport: ReturnType<typeof createLibraryFolderImport>;
  libraryRuntime: ReturnType<typeof createLibraryRuntime>;
  addToHistory: (song: Song) => Promise<void>;
  refreshLibraryAndCollectSummary: (options?: ScanLibraryOptions) => Promise<LibraryRefreshSummary>;
}

export const createLibraryCoreActions = ({
  playerFileManager,
  libraryFolderTree,
  libraryFolderImport,
  libraryRuntime,
  addToHistory,
  refreshLibraryAndCollectSummary,
}: CreateLibraryCoreActionsDeps) => {
  const deleteFolder = (path: string) =>
    playerFileManager.deleteFolder(path);

  const moveFilePhysical = (sourcePath: string, targetFolderPath: string) =>
    playerFileManager.moveFilePhysical(sourcePath, targetFolderPath);

  const scanLibrary = (options: ScanLibraryOptions = {}) =>
    libraryRuntime.scanLibrary(options);

  const fetchFolderTree = () =>
    libraryFolderTree.fetchFolderTree();

  const ensureFolderChildrenLoaded = (target: string | FolderNode) =>
    libraryFolderTree.ensureFolderChildrenLoaded(target);

  const createFolder = (parentPath: string, folderName: string) =>
    libraryFolderTree.createFolder(parentPath, folderName);

  const toggleFolderNode = (target: string | FolderNode) =>
    libraryFolderTree.toggleFolderNode(target);

  const addFoldersFromStructure = () =>
    libraryFolderImport.addFoldersFromStructure();

  const getSongsInFolder = (folderPath: string) =>
    libraryFolderImport.getSongsInFolder(folderPath);

  const moveFilesToFolder = (paths: string[], targetFolder: string) =>
    playerFileManager.moveFilesToFolder(paths, targetFolder);

  const refreshFolder = async (folderPath: string) => {
    const summary = await playerFileManager.refreshFolder(folderPath);
    await libraryFolderTree.fetchFolderTree();
    await libraryFolderTree.expandFolderPath(folderPath);
    return summary;
  };

  const removeFolder = (folderPath: string) => {
    playerFileManager.removeFolder(folderPath);
  };

  const clearLocalMusic = () => {
    libraryFolderImport.clearLocalMusic();
  };

  const addFolder = () =>
    libraryFolderImport.addFolder();

  const generateOrganizedPath = (song: Song): string =>
    playerFileManager.generateOrganizedPath(song);

  const moveFile = (song: Song, newPath: string) =>
    playerFileManager.moveFile(song, newPath);

  const openInFinder = (path: string) =>
    playerFileManager.openInFinder(path);

  const deleteFromDisk = (song: Song) =>
    playerFileManager.deleteFromDisk(song);

  const refreshAllFolders = () =>
    refreshLibraryAndCollectSummary({
      trigger: 'manual-rescan',
      visibility: 'inline',
    });

  return {
    deleteFolder,
    moveFilePhysical,
    scanLibrary,
    fetchFolderTree,
    ensureFolderChildrenLoaded,
    createFolder,
    toggleFolderNode,
    addFoldersFromStructure,
    getSongsInFolder,
    moveFilesToFolder,
    refreshFolder,
    removeFolder,
    addToHistory,
    clearLocalMusic,
    addFolder,
    generateOrganizedPath,
    moveFile,
    openInFinder,
    deleteFromDisk,
    refreshAllFolders,
  };
};
