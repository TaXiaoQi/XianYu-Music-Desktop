import { storeToRefs } from 'pinia';
import type { Song } from '../types';
import { isRemoteSong } from '../utils/remoteSong';
import { playerStorage } from '../services/storage/playerStorage';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { useSettingsStore } from '../features/settings/store';

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

  // 收集最近播放中的在线歌曲条目（含 playedAt），用于持久化。
  // 后端 play_history 不记录在线歌曲，需靠前端持久化在重启后还原其最近播放记录。
  const collectRecentOnlineHistory = () =>
    collectionsStore.recentSongs.filter(item => isOnlineSongPath(item.path));

  // 收集队列/歌单中所有在线歌（lx:// 等）的完整 Song 元数据。
  // 队列持久化只存 path，在线歌不在本地库，若不额外保存元数据，重启恢复时非收藏在线歌
  // 会因查不到而整首从队列丢失。这里把它们的完整 Song（含 duration）一并存下。
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

  const flushPersistedState = () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }

    playerStorage.writePlayerState({
      playlistPathKey: keys.playerPlaylistPaths,
      queuePathKey: keys.playerQueuePaths,
      legacyPlaylistKey: keys.legacyPlayerPlaylist,
      legacyQueueKey: keys.legacyPlayerQueue,
      sourceSongPaths: sourceSongPaths.value,
      watchedFolders: libraryStore.watchedFolders,
      favoritePaths: collectionsStore.favoritePaths,
      favoriteSongMeta: collectionsStore.favoriteSongMeta,
      recentSongMeta: collectionsStore.recentSongMeta,
      recentOnlineHistory: collectRecentOnlineHistory(),
      queueSongMeta: collectQueueSongMeta(),
      playlists: collectionsStore.playlists,
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
      flushPersistedState();
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
