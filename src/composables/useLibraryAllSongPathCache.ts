import { useLibraryStore as useLibraryCatalogStore } from '../features/library/store';
import { libraryApi } from '../services/tauri/libraryApi';
import { createSongPathChannel, isStalePathRequest } from './libraryPathCacheKit';
import type { AllViewPathDemand } from './libraryPathCacheKit';

// 「全部音乐」检索通道：模块级单例，5 分钟 TTL，容量取默认 96 条。
const allViewChannel = createSongPathChannel({
  ttlMs: 5 * 60 * 1000,
});

export const useLibraryAllSongPathCache = () => {
  const catalogStore = useLibraryCatalogStore();

  const fetchAllViewPaths = async (demand: AllViewPathDemand) => {
    const { query = '', artistFilter = '', albumFilter = '', sortMode } = demand;

    // 键维度固定为 排序→搜索词→歌手→专辑。
    const lookupKey = [sortMode, query, artistFilter, albumFilter].join('\u0001');

    return allViewChannel.enqueue(
      lookupKey,
      () => libraryApi.getLibrarySongPathsForAllView(query, artistFilter, albumFilter, sortMode),
      {
        // 请求前后数据版本一致才允许回填，避免把旧库的列表写进新库。
        capture: () => catalogStore.libraryDataVersion,
        retains: snapshot => catalogStore.libraryDataVersion === snapshot,
      },
    );
  };

  const api = {
    loadAllViewSongPaths: fetchAllViewPaths,
    clearLibraryAllSongPathCache: () => allViewChannel.reset(),
    libraryAllSongPathCacheVersion: allViewChannel.changes,
  };
  return api;
};

export const isStaleLibraryPathRequestError = isStalePathRequest;
