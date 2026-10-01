import type { createPlayerLibraryFileFacade } from '../playback/playerLibraryFileFacade';
import type { FolderNode, Song } from '../../types';
import type { ScanLibraryOptions } from './libraryScan';
import type { createLibraryFolderImport } from './libraryFolderImport';
import type { createLibraryFolderTree } from './libraryFolderTree';
import type { createLibraryRuntime } from './libraryRuntime';
import type { LibraryRefreshSummary } from './libraryRefreshSummary';
import { useStatisticsStore } from '../statistics/store';

interface CreateLibraryCoreActionsDeps {
  libraryFileFacade: ReturnType<typeof createPlayerLibraryFileFacade>;
  libraryFolderTree: ReturnType<typeof createLibraryFolderTree>;
  libraryFolderImport: ReturnType<typeof createLibraryFolderImport>;
  libraryRuntime: ReturnType<typeof createLibraryRuntime>;
  addToHistory: (song: Song) => Promise<void>;
  refreshLibraryAndCollectSummary: (options?: ScanLibraryOptions) => Promise<LibraryRefreshSummary>;
}

export const createLibraryCoreActions = ({
  libraryFileFacade,
  libraryFolderTree,
  libraryFolderImport,
  libraryRuntime,
  addToHistory,
  refreshLibraryAndCollectSummary,
}: CreateLibraryCoreActionsDeps) => {
  const deleteFolder = (path: string) =>
    libraryFileFacade.deleteFolder(path);

  const moveFilePhysical = (sourcePath: string, targetFolderPath: string) =>
    libraryFileFacade.moveFilePhysical(sourcePath, targetFolderPath);

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
    libraryFileFacade.moveFilesToFolder(paths, targetFolder);

  const refreshFolder = async (folderPath: string) => {
    const summary = await libraryFileFacade.refreshFolder(folderPath);
    if (summary && typeof summary === 'object' && 'hasChanges' in summary && !summary.hasChanges) {
      return summary;
    }
    await libraryFolderTree.fetchFolderTree();
    await libraryFolderTree.expandFolderPath(folderPath);
    void useStatisticsStore().refreshStats();
    return summary;
  };

  const removeFolder = (folderPath: string) => {
    libraryFileFacade.removeFolder(folderPath);
  };

  const clearLocalMusic = () => {
    libraryFolderImport.clearLocalMusic();
  };

  const addFolder = () =>
    libraryFolderImport.addFolder();

  const generateOrganizedPath = (song: Song): string =>
    libraryFileFacade.generateOrganizedPath(song);

  const moveFile = (song: Song, newPath: string) =>
    libraryFileFacade.moveFile(song, newPath);

  const openInFinder = (path: string) =>
    libraryFileFacade.openInFinder(path);

  const deleteFromDisk = (song: Song) =>
    libraryFileFacade.deleteFromDisk(song);

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
