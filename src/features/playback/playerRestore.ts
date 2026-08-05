import type { Song } from '../../types';
import { playerStorage } from '../../services/storage/playerStorage';
import { useLibraryStore } from '../library/store';
import { usePlaybackStore } from './store';
import { useCoverCache } from '../../composables/useCoverCache';

interface PlayerRestoreKeys {
  playerPlaylistPaths: string;
  playerQueuePaths: string;
  playerLastSongPath: string;
  legacyPlayerPlaylist: string;
  legacyPlayerQueue: string;
  legacyPlayerLastSong: string;
}

interface CreatePlayerRestoreDeps {
  keys: PlayerRestoreKeys;
  createSongLookup: (fallbackSongs?: Song[]) => Map<string, Song>;
  resolveSongsFromPaths: (paths: string[], fallbackSongs?: Song[]) => Song[];
  readStoredSongArray: (key: string) => Song[];
  readStoredSong: (key: string) => Song | null;
  readStoredStringArray: (key: string) => string[] | null;
  loadLibrarySongsFromCache: () => Promise<void>;
}

export const createPlayerRestore = ({
  keys,
  createSongLookup,
  resolveSongsFromPaths,
  readStoredSongArray,
  readStoredSong,
  readStoredStringArray,
  loadLibrarySongsFromCache,
}: CreatePlayerRestoreDeps) => {
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const { loadCover, retainFullCoverPaths, primeCoverPath } = useCoverCache();

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
    restorePathBackedState,
  };
};
