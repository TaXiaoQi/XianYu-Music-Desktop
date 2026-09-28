import { libraryApi } from '../services/tauri/libraryApi';
import { createSongPathChannel } from './libraryPathCacheKit';
import type { FolderViewPathDemand } from './libraryPathCacheKit';

// 文件夹视图检索通道：模块级单例，5 分钟 TTL，容量取默认 96 条。
// 版本号只在显式清空时推进——文件夹列表以目录树数据为准，回填不触发重查。
const folderChannel = createSongPathChannel({
  ttlMs: 5 * 60 * 1000,
  countFillAsChange: false,
});

export const useLibraryFolderSongPathCache = () => {
  const fetchFolderPaths = async (demand: FolderViewPathDemand) => {
    const { folderPath: directory, query = '', sortMode } = demand;
    if (!directory) {
      return [] as string[];
    }

    // 键维度固定为 排序→目录→搜索词。
    const lookupKey = [sortMode, directory, query].join('\u0001');

    return folderChannel.enqueue(lookupKey, () =>
      libraryApi.getLibrarySongPathsForFolderView(directory, query, sortMode),
    );
  };

  const api = {
    loadFolderViewSongPaths: fetchFolderPaths,
    clearLibraryFolderSongPathCache: () => folderChannel.reset(),
    libraryFolderSongPathCacheVersion: folderChannel.changes,
  };
  return api;
};
