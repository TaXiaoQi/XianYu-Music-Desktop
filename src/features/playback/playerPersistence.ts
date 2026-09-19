import { storeToRefs } from 'pinia';
import { toRaw } from 'vue';
import type { Song } from '../../types';
import { isRemoteSong } from '../../utils/remoteSong';
import { playerStorage } from '../../services/storage/playerStorage';
import { useCollectionsStore } from '../collections/store';
import { useLibraryStore } from '../library/store';
import { usePlaybackStore } from './store';
import { useSettingsStore } from '../settings/store';

interface PlayerPersistenceKeys {
  playerPlaylistPaths: string;
  playerQueuePaths: string;
  legacyPlayerPlaylist: string;
  legacyPlayerQueue: string;
}

export const createPlayerPersistence = ({ keys }: { keys: PlayerPersistenceKeys }) => {
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const settingsStore = useSettingsStore();
  const {
    artistCustomOrder,
    albumCustomOrder,
    folderCustomOrder,
    localCustomOrder,
    sourceSongPaths,
  } = storeToRefs(libraryStore);
  const { playQueuePaths } = storeToRefs(playbackStore);
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const isOnlineSongPath = (path: string) =>
    path.startsWith('lx://') || path.startsWith('remote://') || path.startsWith('plugin://');

  const collectRecentOnlineHistory = () =>
    collectionsStore.recentSongs.filter(item => isOnlineSongPath(item.path));

  const collectQueueSongMeta = (): Record<string, Song> => {
    const meta: Record<string, Song> = {};
    const paths = new Set<string>([
      ...playQueuePaths.value,
      ...sourceSongPaths.value,
    ]);
    paths.forEach((path) => {
      if (!path) return;
      const song = libraryStore.getSongByPath(path);
      if (song && isRemoteSong(song)) {
        meta[path] = song;
      }
    });
    return meta;
  };

  const flushPersistedState = async () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }

    const rawPlaylists = JSON.parse(JSON.stringify(toRaw(collectionsStore.playlists)));

    await playerStorage.writePlaylistsAsync(rawPlaylists);

    playerStorage.writePlayerState({
      playlistPathKey: keys.playerPlaylistPaths,
      queuePathKey: keys.playerQueuePaths,
      legacyPlaylistKey: keys.legacyPlayerPlaylist,
      legacyQueueKey: keys.legacyPlayerQueue,
      sourceSongPaths: sourceSongPaths.value,
      watchedFolders: libraryStore.watchedFolders,
      favoritePaths: collectionsStore.favoritePaths,
      favoriteSongMeta: collectionsStore.favoriteSongMeta,
      favoriteCollections: collectionsStore.favoriteCollections,
      recentSongMeta: collectionsStore.recentSongMeta,
      recentOnlineHistory: collectRecentOnlineHistory(),
      queueSongMeta: collectQueueSongMeta(),
      playlists: rawPlaylists,
      settings: settingsStore.settings,
      playQueuePaths: playQueuePaths.value,
      artistCustomOrder: artistCustomOrder.value,
      albumCustomOrder: albumCustomOrder.value,
      folderCustomOrder: folderCustomOrder.value,
      localCustomOrder: localCustomOrder.value,
    });
  };

  const schedulePersistedState = () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
      void flushPersistedState().catch(e => {
        if (e?.name !== 'QuotaExceededError' && e?.code !== 22) {
          console.error('[persist] flushPersistedState failed:', e);
        }
      });
    }, 200);
  };

  const dispose = () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
  };

  return {
    flushPersistedState,
    schedulePersistedState,
    dispose,
  };
};
