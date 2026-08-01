import type { FolderNode, LibraryFolder } from '../../types';
import { tauriInvoke } from './invoke';

export const libraryApi = {
  getLibraryFolders: (): Promise<LibraryFolder[]> => tauriInvoke('get_library_folders'),
  getLibraryHierarchy: (): Promise<FolderNode[]> => tauriInvoke('get_library_hierarchy'),
  getFolderChildren: (folderPath: string): Promise<FolderNode[]> =>
    tauriInvoke('get_folder_children', { folderPath }),
  addLibraryFolder: (path: string): Promise<void> => tauriInvoke('add_library_folder', { path }),
  removeLibraryFolder: (path: string): Promise<void> => tauriInvoke('remove_library_folder', { path }),
  createFolder: (parentPath: string, folderName: string) =>
    tauriInvoke('create_folder', { parentPath, folderName }),
  refreshFolderSongs: (folderPath: string, minimumDurationSeconds = 0) =>
    tauriInvoke('refresh_folder_songs', { folderPath, minimumDurationSeconds }),
};
