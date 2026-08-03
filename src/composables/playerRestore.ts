import type { HistoryItem, Song } from '../types';
import { playerStorage } from '../services/storage/playerStorage';
import { historyApi } from '../services/tauri/historyApi';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import { useCoverCache } from './useCoverCache';

interface PlayerRestoreKeys {
  playerPlaylistPaths: string;
  playerQueuePaths: string;
  playerLastSongPath: string;
  legacyPlayerPlaylist: string;
  legacyPlayerQueue: string;
  legacyPlayerHistory: string;
  legacyPlayerLastSong: string;
}

interface CreatePlayerRestoreDeps {
  keys: PlayerRestoreKeys;
  createSongLookup: (fallbackSongs?: Song[]) => Map<string, Song>;
  resolveSongsFromPaths: (paths: string[], fallbackSongs?: Song[]) => Song[];
  readStoredHistory: (key: string) => HistoryItem[];
  readStoredSongArray: (key: string) => Song[];
  readStoredSong: (key: string) => Song | null;
  readStoredStringArray: (key: string) => string[] | null;
  loadLibrarySongsFromCache: () => Promise<void>;
}

export const createPlayerRestore = ({
  keys,
  createSongLookup,
  resolveSongsFromPaths,
  readStoredHistory,
  readStoredSongArray,
  readStoredSong,
  readStoredStringArray,
  loadLibrarySongsFromCache,
}: CreatePlayerRestoreDeps) => {
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const { loadCover, retainFullCoverPaths, primeCoverPath } = useCoverCache();

  const RECENT_HISTORY_LIMIT = 200;

  // 合并后端最近播放（本地歌曲）与前端持久化的在线最近播放：
  // 按 path 去重、playedAt 取较大值，按 playedAt 降序，截断到上限。
  const mergeRecentHistory = (
    primary: HistoryItem[],
    secondary: HistoryItem[],
  ): HistoryItem[] => {
    const merged = new Map<string, number>();
    [...primary, ...secondary].forEach((item) => {
      if (!item?.path) {
        return;
      }
      const existing = merged.get(item.path);
      if (existing === undefined || item.playedAt > existing) {
        merged.set(item.path, item.playedAt);
      }
    });

    return Array.from(merged.entries())
      .map(([path, playedAt]) => ({ path, playedAt }))
      .sort((left, right) => right.playedAt - left.playedAt)
      .slice(0, RECENT_HISTORY_LIMIT);
  };

  const restoreRecentHistory = async () => {
    const legacyHistory = readStoredHistory(keys.legacyPlayerHistory);
    const onlineHistory = playerStorage.readRecentOnlineHistory();

    try {
      const records = await historyApi.getRecentHistory(200);
      if (records.length > 0 || onlineHistory.length > 0) {
        const backendHistory = records.map(record => ({
          path: record.songPath,
          playedAt: record.playedAt,
        }));
        collectionsStore.setRecentSongs(mergeRecentHistory(backendHistory, onlineHistory));

        if (collectionsStore.recentSongs.length > 0) {
          playerStorage.remove(keys.legacyPlayerHistory);
          return;
        }
      }
    } catch (error) {
      console.warn('get_recent_history failed:', error);
    }

    if (legacyHistory.length === 0 && onlineHistory.length === 0) {
      collectionsStore.setRecentSongs([]);
      return;
    }

    collectionsStore.setRecentSongs(
      mergeRecentHistory(legacyHistory, onlineHistory),
    );

    const importedEntries = legacyHistory.map(item => ({
      songPath: item.path,
      playedAt: Math.floor(item.playedAt / 1000),
    }));

    try {
      await historyApi.importRecentHistory(importedEntries);
      playerStorage.remove(keys.legacyPlayerHistory);
    } catch (error) {
      console.warn('import_recent_history failed:', error);
    }
  };

  const restorePathBackedState = async () => {
    await playbackStore.startupPathsPromise;

    if (
      playbackStore.hasExternalStartupFile
      || playbackStore.playQueue.length > 0
      || playbackStore.currentSong !== null
    ) {
      return;
    }

    const legacySongList = readStoredSongArray(keys.legacyPlayerPlaylist);
    const legacyQueue = readStoredSongArray(keys.legacyPlayerQueue);
    const legacyLastSong = readStoredSong(keys.legacyPlayerLastSong);
    const fallbackSongs = [
      ...legacySongList,
      ...legacyQueue,
      ...(legacyLastSong ? [legacyLastSong] : []),
    ];

    if (libraryStore.canonicalSongs.length === 0) {
      await loadLibrarySongsFromCache();
      if (
        playbackStore.hasExternalStartupFile
        || playbackStore.playQueue.length > 0
        || playbackStore.currentSong !== null
      ) {
        return;
      }
    }

    const storedSongListPaths = readStoredStringArray(keys.playerPlaylistPaths)
      ?? legacySongList.map(song => song.path);
    const storedQueuePaths = readStoredStringArray(keys.playerQueuePaths)
      ?? legacyQueue.map(song => song.path);
    const storedLastSongPath = playerStorage.getString(keys.playerLastSongPath)
      ?? legacyLastSong?.path
      ?? null;

    libraryStore.setSourceSongs(resolveSongsFromPaths(storedSongListPaths, fallbackSongs));
    playbackStore.playQueue = resolveSongsFromPaths(storedQueuePaths, fallbackSongs);

    if (storedLastSongPath) {
      playbackStore.currentSong = createSongLookup(fallbackSongs).get(storedLastSongPath) ?? legacyLastSong;
    }

    if (playbackStore.currentSong?.path) {
      const song = playbackStore.currentSong;
      const songPath = song.path;
      const isOnline = songPath.startsWith('lx://')
        || songPath.startsWith('plugin://')
        || songPath.startsWith('remote://');

      // 在线歌曲封面优先用 cover_thumb_path（网络 URL 或本地缓存路径），
      // 立即填充底栏封面，避免启动时底栏丢封面
      const primedCover = isOnline && song.cover_thumb_path
        ? primeCoverPath(songPath, song.cover_thumb_path)
        : '';

      loadCover(songPath)
        .then(cover => {
          // 本地歌曲：用后端读取的封面；在线歌曲：回退到 primeCoverPath 的结果
          const finalCover = cover || primedCover || '';
          playbackStore.currentCover = finalCover;
          playbackStore.currentCoverFull = finalCover;
          retainFullCoverPaths([]);
        })
        .catch(() => {
          if (primedCover) {
            playbackStore.currentCover = primedCover;
            playbackStore.currentCoverFull = primedCover;
          }
        });
      playbackStore.isSongLoaded = false;
    }
  };

  return {
    restoreRecentHistory,
    restorePathBackedState,
  };
};
