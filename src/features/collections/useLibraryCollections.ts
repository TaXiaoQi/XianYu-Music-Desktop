import { storeToRefs } from 'pinia';
import type { Song } from '../../types';
import { playerStorage } from '../../services/storage/playerStorage';
import { historyApi } from '../../services/tauri/historyApi';
import { useCollectionsStore } from './store';
import { useLibraryStore } from '../library/store';
import { isPluginSong } from '../../utils/pluginSong';
import { isRemoteSong } from '../../utils/remoteSong';
import { reportDailyLikeSignals } from '../../services/domain/dailyRecommendFeedback';
import router from '../../router';
import { useHomeNavigation } from '../../composables/useHomeNavigation';
import { useAddToPlaylistDialog } from './addToPlaylistDialog';

// 旧版本把播放历史存放在该键下，现已迁移至后端；访问历史时顺带清理。
const LEGACY_HISTORY_STORAGE_KEY = 'player_history';

export function useLibraryCollections() {
  const store = useCollectionsStore();
  const homeNav = useHomeNavigation(router);
  const storeRefs = storeToRefs(store);
  const dialog = useAddToPlaylistDialog();

  /** 历史相关操作后统一清理旧版本地历史键。 */
  const purgeLegacyHistoryStorage = () => {
    playerStorage.remove(LEGACY_HISTORY_STORAGE_KEY);
  };

  const createPlaylist = (name: string, initialSongs: string[] = [], fullSongs?: Song[]) =>
    store.createPlaylist(name, initialSongs, fullSongs);

  const renamePlaylist = (playlistId: string, name: string) =>
    store.renamePlaylist(playlistId, name);

  const setPlaylistCover = (playlistId: string, coverPath: string | null) =>
    store.setPlaylistCover(playlistId, coverPath);

  /** 删除歌单；若当前正停留在该歌单页，则退回「全部音乐」。 */
  const deletePlaylist = (playlistId: string) => {
    const removed = store.deletePlaylist(playlistId);
    if (!removed) {
      return false;
    }

    const route = router.currentRoute.value;
    const isViewingDeletedPlaylist =
      route.path === '/' && route.query.view === 'playlist' && route.query.filter === playlistId;
    if (isViewingDeletedPlaylist) {
      void homeNav.openHomeAll({ replace: true });
    }

    return removed;
  };

  const addToPlaylist = (targetPlaylistId: string, songPath: string) =>
    store.addToPlaylist(targetPlaylistId, songPath);

  const removeFromPlaylist = (targetPlaylistId: string, songPath: string) =>
    store.removeFromPlaylist(targetPlaylistId, songPath);

  const addSongsToPlaylist = (playlistId: string, songPaths: string[], fullSongs?: Song[]) =>
    store.addSongsToPlaylist(playlistId, songPaths, fullSongs);

  const setPlaylistSource = (
    playlistId: string,
    source: { sourcePluginId?: string; sourceUrl?: string; sourceRaw?: any } | null,
  ) => store.setPlaylistSource(playlistId, source);

  const applySourceSync = (playlistId: string, sourceSongs: Song[], fullSync: boolean) =>
    store.applySourceSync(playlistId, sourceSongs, fullSync);

  const reorderPlaylists = (fromIndex: number, toIndex: number) =>
    store.reorderPlaylists(fromIndex, toIndex);

  const getSongsFromPlaylist = (playlistId: string) =>
    store.getSongsFromPlaylist(playlistId);

  const viewPlaylist = (targetPlaylistId: string) => {
    void homeNav.openHomePlaylist(targetPlaylistId);
  };

  /* —— 收藏（红心） —— */

  /** 在线歌曲（远端/插件/LX 协议）需要额外维护元数据与曲库补挂。 */
  const isOnlineSong = (song: Song) =>
    isRemoteSong(song)
    || isPluginSong(song)
    || song.path?.startsWith('lx://') === true;

  /** 入参既可以是 Song 对象也可以是裸路径，统一解析成路径。 */
  const resolveSongPath = (candidate: Song | string | null | undefined): string | null => {
    if (candidate === null || candidate === undefined) {
      return null;
    }
    return typeof candidate === 'string' ? candidate : candidate.path;
  };

  const isFavorite = (candidate: Song | string | null | undefined) =>
    store.isFavoritePath(resolveSongPath(candidate));

  const toggleFavorite = (candidate: Song | string) => {
    const path = resolveSongPath(candidate);
    if (path === null || path === '') {
      return false;
    }

    const nowFavorited = store.toggleFavoritePath(path);
    const song = typeof candidate === 'string' ? null : candidate;

    if (nowFavorited && song !== null) {
      void reportDailyLikeSignals(
        [{ songName: song.title ?? '', singer: song.artist ?? '' }],
        'favorite',
      );
    }

    if (song !== null && isOnlineSong(song)) {
      const libraryStore = useLibraryStore();
      if (nowFavorited) {
        store.setFavoriteSongMeta(path, song);
        libraryStore.setExtraSong(song);
      } else {
        store.removeFavoriteSongMeta(path);
        // 只有该路径不再被最近播放引用时才从曲库补挂表移除。
        if (!(path in store.recentSongMeta)) {
          libraryStore.removeExtraSong(path);
        }
      }
    }

    return nowFavorited;
  };

  const removeFavoritePaths = (targets: string[]) => {
    store.removeFavoritePaths(targets);
    const libraryStore = useLibraryStore();
    for (const path of targets) {
      libraryStore.removeExtraSong(path);
    }
  };

  const clearFavorites = (): void => {
    const onlineFavoritedPaths = Object.keys(store.favoriteSongMeta);
    store.clearFavorites();

    const libraryStore = useLibraryStore();
    for (const path of onlineFavoritedPaths) {
      libraryStore.removeExtraSong(path);
    }
  };

  /* —— 播放历史 —— */

  const addToHistory = async (song: Song): Promise<void> => {
    store.addRecentSong(song);
    purgeLegacyHistoryStorage();

    if (isOnlineSong(song)) {
      const libraryStore = useLibraryStore();
      store.setRecentSongMeta(song.path, song);
      libraryStore.setExtraSong(song);
    }

    historyApi.addToHistory(song.path).catch((failure: unknown) =>
      console.warn(`add_to_history failed:`, failure));
  };

  const removeFromHistory = async (targetPaths: string[]): Promise<void> => {
    if (targetPaths.length === 0) {
      return;
    }

    // 记下需要同步清理曲库补挂的在线歌曲路径（后续还要判断收藏占用）。
    const onlineMetaPaths = targetPaths.filter(path => path in store.recentSongMeta);

    store.removeRecentSongs(targetPaths);
    purgeLegacyHistoryStorage();

    if (onlineMetaPaths.length > 0) {
      const libraryStore = useLibraryStore();
      for (const path of onlineMetaPaths) {
        if (!(path in store.favoriteSongMeta)) {
          libraryStore.removeExtraSong(path);
        }
      }
    }

    await historyApi.removeFromRecentHistory(targetPaths).catch((failure: unknown) => {
      console.warn(`remove_from_recent_history failed:`, failure);
    });
  };

  const clearHistory = async (): Promise<void> => {
    const clearedOnlinePaths = Object.keys(store.recentSongMeta);

    store.clearRecentSongs();
    purgeLegacyHistoryStorage();

    if (clearedOnlinePaths.length > 0) {
      const libraryStore = useLibraryStore();
      for (const path of clearedOnlinePaths) {
        if (!(path in store.favoriteSongMeta)) {
          libraryStore.removeExtraSong(path);
        }
      }
    }

    await historyApi.clearRecentHistory().catch((failure: unknown) => {
      console.warn(`clear_recent_history failed:`, failure);
    });
  };

  const openAddToPlaylistDialog = (targets: string | string[]) =>
    dialog.openAddToPlaylistDialog(targets);

  return {
    ...storeRefs,
    createPlaylist,
    renamePlaylist,
    setPlaylistCover,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    addSongsToPlaylist,
    setPlaylistSource,
    applySourceSync,
    reorderPlaylists,
    getSongsFromPlaylist,
    viewPlaylist,
    isFavorite,
    toggleFavorite,
    removeFavoritePaths,
    clearFavorites,
    addToHistory,
    removeFromHistory,
    clearHistory,
    openAddToPlaylistDialog,
  };
}
