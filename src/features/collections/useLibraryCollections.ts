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

const LEGACY_PLAYER_HISTORY_KEY = 'player_history';

export function useLibraryCollections() {
  const collectionsStore = useCollectionsStore();
  const { openHomeAll, openHomePlaylist } = useHomeNavigation(router);
  const collectionsRefs = storeToRefs(collectionsStore);
  const { openAddToPlaylistDialog: openDialog } = useAddToPlaylistDialog();

  const createPlaylist = (name: string, initialSongs: string[] = [], fullSongs?: Song[]) =>
    collectionsStore.createPlaylist(name, initialSongs, fullSongs);

  const renamePlaylist = (id: string, name: string) =>
    collectionsStore.renamePlaylist(id, name);

  const setPlaylistCover = (id: string, coverPath: string | null) =>
    collectionsStore.setPlaylistCover(id, coverPath);

  const deletePlaylist = (id: string) => {
    const deleted = collectionsStore.deletePlaylist(id);
    const currentRoute = router.currentRoute.value;
    const openedPlaylistId =
      currentRoute.path === '/' && currentRoute.query.view === 'playlist'
        ? currentRoute.query.filter
        : undefined;

    if (deleted && openedPlaylistId === id) {
      void openHomeAll({ replace: true });
    }

    return deleted;
  };

  const addToPlaylist = (playlistId: string, path: string) =>
    collectionsStore.addToPlaylist(playlistId, path);

  const removeFromPlaylist = (playlistId: string, path: string) =>
    collectionsStore.removeFromPlaylist(playlistId, path);

  const addSongsToPlaylist = (playlistId: string, songPaths: string[], fullSongs?: Song[]) =>
    collectionsStore.addSongsToPlaylist(playlistId, songPaths, fullSongs);

  const setPlaylistSource = (
    id: string,
    source: { sourcePluginId?: string; sourceUrl?: string; sourceRaw?: any } | null,
  ) => collectionsStore.setPlaylistSource(id, source);

  const applySourceSync = (id: string, sourceSongs: Song[], fullSync: boolean) =>
    collectionsStore.applySourceSync(id, sourceSongs, fullSync);

  const reorderPlaylists = (from: number, to: number) =>
    collectionsStore.reorderPlaylists(from, to);

  const getSongsFromPlaylist = (playlistId: string) =>
    collectionsStore.getSongsFromPlaylist(playlistId);

  const viewPlaylist = (playlistId: string) => {
    void openHomePlaylist(playlistId);
  };

  const isOnlineSong = (song: Song) =>
    isRemoteSong(song)
    || isPluginSong(song)
    || song.path?.startsWith('lx://') === true;

  const resolveSongPath = (target: Song | string | null | undefined) => {
    if (!target) {
      return null;
    }

    return typeof target === 'string' ? target : target.path;
  };

  const isFavorite = (target: Song | string | null | undefined) =>
    collectionsStore.isFavoritePath(resolveSongPath(target));

  const toggleFavorite = (target: Song | string) => {
    const path = resolveSongPath(target);
    if (!path) {
      return false;
    }

    const isFavoriteNow = collectionsStore.toggleFavoritePath(path);
    const song = typeof target === 'string' ? null : target;

    if (isFavoriteNow && song) {
      void reportDailyLikeSignals(
        [{ songName: song.title ?? '', singer: song.artist ?? '' }],
        'favorite',
      );
    }

    if (song && isOnlineSong(song)) {
      const libraryStore = useLibraryStore();
      if (isFavoriteNow) {
        collectionsStore.setFavoriteSongMeta(path, song);
        libraryStore.setExtraSong(song);
      } else {
        collectionsStore.removeFavoriteSongMeta(path);
        if (!(path in collectionsStore.recentSongMeta)) {
          libraryStore.removeExtraSong(path);
        }
      }
    }

    return isFavoriteNow;
  };

  const removeFavoritePaths = (paths: string[]) => {
    collectionsStore.removeFavoritePaths(paths);
    const libraryStore = useLibraryStore();
    paths.forEach(path => libraryStore.removeExtraSong(path));
  };

  const clearFavorites = () => {
    const removedPaths = Object.keys(collectionsStore.favoriteSongMeta);
    collectionsStore.clearFavorites();
    const libraryStore = useLibraryStore();
    removedPaths.forEach(path => libraryStore.removeExtraSong(path));
  };

  const addToHistory = async (song: Song) => {
    collectionsStore.addRecentSong(song);
    playerStorage.remove(LEGACY_PLAYER_HISTORY_KEY);

    if (isOnlineSong(song)) {
      const libraryStore = useLibraryStore();
      collectionsStore.setRecentSongMeta(song.path, song);
      libraryStore.setExtraSong(song);
    }

    historyApi.addToHistory(song.path).catch(error => {
      console.warn('add_to_history failed:', error);
    });
  };

  const removeFromHistory = async (songPaths: string[]) => {
    if (songPaths.length === 0) {
      return;
    }

    const onlineMetaPaths = songPaths.filter(path => path in collectionsStore.recentSongMeta);

    collectionsStore.removeRecentSongs(songPaths);
    playerStorage.remove(LEGACY_PLAYER_HISTORY_KEY);

    if (onlineMetaPaths.length > 0) {
      const libraryStore = useLibraryStore();
      onlineMetaPaths.forEach((path) => {
        if (!(path in collectionsStore.favoriteSongMeta)) {
          libraryStore.removeExtraSong(path);
        }
      });
    }

    try {
      await historyApi.removeFromRecentHistory(songPaths);
    } catch (error) {
      console.warn('remove_from_recent_history failed:', error);
    }
  };

  const clearHistory = async () => {
    const clearedOnlinePaths = Object.keys(collectionsStore.recentSongMeta);

    collectionsStore.clearRecentSongs();
    playerStorage.remove(LEGACY_PLAYER_HISTORY_KEY);

    if (clearedOnlinePaths.length > 0) {
      const libraryStore = useLibraryStore();
      clearedOnlinePaths.forEach((path) => {
        if (!(path in collectionsStore.favoriteSongMeta)) {
          libraryStore.removeExtraSong(path);
        }
      });
    }

    try {
      await historyApi.clearRecentHistory();
    } catch (error) {
      console.warn('clear_recent_history failed:', error);
    }
  };

  const openAddToPlaylistDialog = (songPaths: string | string[]) => openDialog(songPaths);

  return {
    ...collectionsRefs,
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
