import { libraryApi } from '../services/tauri/libraryApi';
import { createSongPathChannel, historyFingerprint } from './libraryPathCacheKit';
import type { FavoritePathDemand, RecentPathDemand } from './libraryPathCacheKit';

// 收藏/最近播放共用一条检索通道：模块级单例，5 分钟 TTL，容量取默认 96 条。
const collectionChannel = createSongPathChannel({
  ttlMs: 5 * 60 * 1000,
});

const FIELD_MARK = '\u0001';
const PATH_MARK = '\u0002';

export const useLibraryCollectionSongPathCache = () => {
  const fetchFavoritePaths = async (demand: FavoritePathDemand) => {
    const { favoritePaths, query = '', sortMode, detailFilter = null } = demand;
    if (favoritePaths.length < 1) {
      return [] as string[];
    }

    const faceSegment = detailFilter
      ? `${detailFilter.type}${FIELD_MARK}${detailFilter.name}`
      : '';
    const lookupKey = ['favorites', sortMode, query, faceSegment, favoritePaths.join(PATH_MARK)]
      .join(FIELD_MARK);

    return collectionChannel.enqueue(lookupKey, () =>
      libraryApi.getFavoriteSongPathsView(
        favoritePaths, query, sortMode,
        detailFilter?.type, detailFilter?.name,
      ),
    );
  };

  const fetchRecentPaths = async (demand: RecentPathDemand) => {
    const { recentSongs, query = '', sortMode } = demand;
    if (recentSongs.length < 1) {
      return [] as string[];
    }

    const lookupKey = ['recent', sortMode, query, historyFingerprint(recentSongs)]
      .join(FIELD_MARK);

    return collectionChannel.enqueue(lookupKey, () =>
      libraryApi.getRecentSongPathsView(
        recentSongs.map(entry => ({ songPath: entry.path, playedAt: entry.playedAt })),
        query, sortMode,
      ),
    );
  };

  const api = {
    loadFavoriteSongPaths: fetchFavoritePaths, loadRecentSongPaths: fetchRecentPaths,
    clearLibraryCollectionSongPathCache: () => collectionChannel.reset(),
    libraryCollectionSongPathCacheVersion: collectionChannel.changes,
  };
  return api;
};
