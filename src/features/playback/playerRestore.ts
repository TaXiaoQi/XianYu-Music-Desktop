import type { Song } from '../../types';
import { playerStorage } from '../../services/storage/playerStorage';
import type { PlaybackSessionData } from '../../services/tauri/sessionApi';
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

  /**
   * 恢复播放状态
   *
   * 优先从 Rust 会话恢复（单一事实源），无数据时回退到 localStorage。
   *
   * @param rustSession 从 Rust 加载的播放会话数据（可选）
   */
  const restorePathBackedState = async (rustSession?: PlaybackSessionData | null) => {
    await playbackStore.startupPathsPromise;

    if (
      playbackStore.hasExternalStartupFile
      || playbackStore.playQueue.length > 0
      || playbackStore.currentSong !== null
    ) {
      return;
    }

    // 优先使用 Rust 会话数据（单一事实源）
    const hasRustData = rustSession
      && (rustSession.playQueuePaths.length > 0
          || rustSession.currentSongPath
          || rustSession.sourceSongPaths.length > 0);

    if (hasRustData && rustSession) {
      const storedSongListPaths = rustSession.sourceSongPaths;
      const storedQueuePaths = rustSession.playQueuePaths;
      const storedLastSongPath = rustSession.currentSongPath;

      if (libraryStore.canonicalSongs.length === 0) {
        await loadLibrarySongsFromCache();
      }

      // queueSongMeta 中的在线歌曲已由 lifecycle 注入 libraryStore，
      // resolveSongsFromPaths 可直接查到
      libraryStore.setSourceSongs(resolveSongsFromPaths(storedSongListPaths));
      playbackStore.playQueue = resolveSongsFromPaths(storedQueuePaths);

      if (storedLastSongPath) {
        playbackStore.currentSong = createSongLookup().get(storedLastSongPath) ?? null;
      }

      // 恢复播放模式和音量
      if (rustSession.playMode !== undefined) {
        playbackStore.playMode = rustSession.playMode;
      }
      if (rustSession.volume !== undefined) {
        playbackStore.volume = rustSession.volume;
      }

      // 恢复播放进度
      if (rustSession.currentPositionSecs > 0) {
        playbackStore.currentTime = rustSession.currentPositionSecs;
      }

      // 恢复会话级音质覆盖
      if (rustSession.sessionQualityOverride) {
        playbackStore.setSessionQualityOverride(rustSession.sessionQualityOverride as any);
      }
    } else {
      // 回退到 localStorage 恢复（兼容旧版本或 Rust 无数据的情况）
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
