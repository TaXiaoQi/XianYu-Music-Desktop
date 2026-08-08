import { tauriInvoke } from './invoke';
import type { RenameConfig, RenameOperation } from './contracts';

export const toolboxApi = {
  previewRename: (rootPath: string, config: RenameConfig) =>
    tauriInvoke('preview_rename', { rootPath, config }),
  applyRename: (operations: RenameOperation[]) =>
    tauriInvoke('apply_rename', { operations }),
  setGpuAcceleration: (enabled: boolean) =>
    tauriInvoke('set_gpu_acceleration', { enabled }),
  downloadWallpaper: (url: string, filename: string) =>
    tauriInvoke('download_wallpaper', { url, filename }),
  deleteWallpaperFile: (localPath: string) =>
    tauriInvoke('delete_wallpaper_file', { localPath }),
};
