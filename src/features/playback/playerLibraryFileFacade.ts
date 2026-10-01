import type { createPlayerFileManager } from './playerFileManager';
import type { Song } from '../../types';

interface CreatePlayerLibraryFileFacadeDeps {
  playerFileManager: ReturnType<typeof createPlayerFileManager>;
}

export const createPlayerLibraryFileFacade = ({
  playerFileManager,
}: CreatePlayerLibraryFileFacadeDeps) => ({
  deleteFolder: (path: string) => playerFileManager.deleteFolder(path),
  moveFilePhysical: (sourcePath: string, targetFolderPath: string) =>
    playerFileManager.moveFilePhysical(sourcePath, targetFolderPath),
  moveFilesToFolder: (paths: string[], targetFolder: string) =>
    playerFileManager.moveFilesToFolder(paths, targetFolder),
  refreshFolder: (folderPath: string) => playerFileManager.refreshFolder(folderPath),
  removeFolder: (folderPath: string) => playerFileManager.removeFolder(folderPath),
  generateOrganizedPath: (song: Song) => playerFileManager.generateOrganizedPath(song),
  moveFile: (song: Song, newPath: string) => playerFileManager.moveFile(song, newPath),
  openInFinder: (path: string) => playerFileManager.openInFinder(path),
  deleteFromDisk: (song: Song) => playerFileManager.deleteFromDisk(song),
  refreshAllFolders: () => playerFileManager.refreshAllFolders(),
});
