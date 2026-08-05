import type { useFileImport } from '../../composables/useFileImport';
import type { createPlayerFileManager } from '../playback/playerFileManager';
import type { createLibraryFolderTree } from './libraryFolderTree';
import type { createLibraryRuntime } from './libraryRuntime';
import type { useLibrarySync } from './useLibrarySync';

type PlayerFileManager = ReturnType<typeof createPlayerFileManager>;
type LibraryFolderTree = ReturnType<typeof createLibraryFolderTree>;
type LibraryRuntime = ReturnType<typeof createLibraryRuntime>;

interface CreateLibraryDomainDeps {
  librarySync: ReturnType<typeof useLibrarySync>;
  fileImportActions: ReturnType<typeof useFileImport>;
  removeFolder: PlayerFileManager['removeFolder'];
  moveFile: PlayerFileManager['moveFile'];
  generateOrganizedPath: PlayerFileManager['generateOrganizedPath'];
  openInFinder: PlayerFileManager['openInFinder'];
  deleteFromDisk: PlayerFileManager['deleteFromDisk'];
  moveFilesToFolder: PlayerFileManager['moveFilesToFolder'];
  deleteFolder: PlayerFileManager['deleteFolder'];
  moveFilePhysical: PlayerFileManager['moveFilePhysical'];
  fetchFolderTree: LibraryFolderTree['fetchFolderTree'];
  ensureFolderChildrenLoaded: LibraryFolderTree['ensureFolderChildrenLoaded'];
  createFolder: LibraryFolderTree['createFolder'];
  toggleFolderNode: LibraryFolderTree['toggleFolderNode'];
  libraryFolderTree: LibraryFolderTree;
  libraryRuntime: LibraryRuntime;
}

export const createLibraryDomain = ({
  librarySync,
  fileImportActions,
  removeFolder,
  moveFile,
  generateOrganizedPath,
  openInFinder,
  deleteFromDisk,
  moveFilesToFolder,
  deleteFolder,
  moveFilePhysical,
  fetchFolderTree,
  ensureFolderChildrenLoaded,
  createFolder,
  toggleFolderNode,
  libraryFolderTree,
  libraryRuntime,
}: CreateLibraryDomainDeps) => ({
  ...librarySync,
  ...fileImportActions,
  removeFolder,
  moveFile,
  generateOrganizedPath,
  openInFinder,
  deleteFromDisk,
  moveFilesToFolder,
  deleteFolder,
  moveFilePhysical,
  fetchFolderTree,
  ensureFolderChildrenLoaded,
  createFolder,
  toggleFolderNode,
  expandFolderPath: (targetPath: string) => libraryFolderTree.expandFolderPath(targetPath),
  loadLibrarySongsFromCache: () => libraryRuntime.loadLibrarySongsFromCache(),
});
