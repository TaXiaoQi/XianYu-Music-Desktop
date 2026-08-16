import { storeToRefs } from 'pinia';

import { playbackApi } from '../../services/tauri/playbackApi';
import { useLibraryStore } from '../library/store';
import { usePlaybackStore } from './store';
import type { Song } from '../../types';

interface QueuePlaySongOptions {
  updateShuffleHistory?: boolean;
  clearShuffleFuture?: boolean;
  preserveQueue?: boolean;
  insertAfterCurrent?: boolean;
}

interface CreatePlayerQueueDeps {
  playSong: (song: Song, options?: QueuePlaySongOptions) => void | Promise<void>;
  stopPlaybackRuntime: () => void;
  showToast: (message: string, type: 'success' | 'info' | 'error') => void;
}

export const createPlayerQueue = ({
  playSong,
  stopPlaybackRuntime,
  showToast,
}: CreatePlayerQueueDeps) => {
  const SHUFFLE_HISTORY_LIMIT = 256;
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const { currentSong, isPlaying, playMode, playQueue, tempQueue } = storeToRefs(playbackStore);
  const shuffleHistory: string[] = [];
  const shuffleFuture: string[] = [];
  const shuffleRemaining: string[] = [];
  const shuffleCyclePlayed = new Set<string>();
  let shuffleKnownPaths = new Set<string>();
  let shuffleInitialized = false;

  const resetShuffleState = () => {
    shuffleHistory.length = 0;
    shuffleFuture.length = 0;
    shuffleRemaining.length = 0;
    shuffleCyclePlayed.clear();
    shuffleKnownPaths = new Set<string>();
    shuffleInitialized = false;
  };

  const runPlaySong = (song: Song, options?: QueuePlaySongOptions) => {
    void Promise.resolve(playSong(song, options)).catch(error => {
      console.warn('[Audio] queue playSong failed:', error);
    });
  };

  const pushBounded = (target: string[], path: string) => {
    target.push(path);
    if (target.length > SHUFFLE_HISTORY_LIMIT) {
      target.splice(0, target.length - SHUFFLE_HISTORY_LIMIT);
    }
  };

  const shufflePaths = (paths: string[]) => {
    const shuffled = [...paths];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  };

  const replaceShuffleRemaining = (paths: string[]) => {
    shuffleRemaining.splice(0, shuffleRemaining.length, ...paths);
  };

  const removeFromShuffleRemaining = (path: string) => {
    const index = shuffleRemaining.indexOf(path);
    if (index >= 0) {
      shuffleRemaining.splice(index, 1);
    }
  };

  const handleBeforePlay = (song: Song, options: QueuePlaySongOptions = {}) => {
    const shouldUpdateShuffleHistory = options.updateShuffleHistory ?? true;
    const shouldClearShuffleFuture = options.clearShuffleFuture ?? true;
    const previousSong = currentSong.value;

    if (
      playMode.value === 2 &&
      previousSong?.path !== song.path
    ) {
      if (previousSong) {
        shuffleCyclePlayed.add(previousSong.path);
      }
      shuffleCyclePlayed.add(song.path);
      removeFromShuffleRemaining(song.path);

      if (shouldUpdateShuffleHistory && previousSong) {
        pushBounded(shuffleHistory, previousSong.path);
        if (shouldClearShuffleFuture) {
          shuffleFuture.length = 0;
        }
      }
    }
  };

  const getNavigationList = () =>
    playQueue.value.length ? playQueue.value : libraryStore.sourceSongs;

  const findSongByPath = (path: string | undefined, primaryList: Song[] = []) => {
    if (!path) return null;

    const candidateLists = [
      primaryList,
      playQueue.value,
      tempQueue.value,
      libraryStore.sourceSongs,
      libraryStore.canonicalSongs,
      currentSong.value ? [currentSong.value] : [],
    ];

    for (const list of candidateLists) {
      const song = list.find(item => item.path === path);
      if (song) return song;
    }

    return null;
  };

  const syncShuffleRemaining = (list: Song[]) => {
    const paths = [...new Set(list.map(song => song.path))];
    const validPaths = new Set(paths);
    const currentPath = currentSong.value?.path;

    for (const playedPath of shuffleCyclePlayed) {
      if (!validPaths.has(playedPath)) {
        shuffleCyclePlayed.delete(playedPath);
      }
    }

    const retained = shuffleRemaining.filter(path => (
      validPaths.has(path) &&
      path !== currentPath &&
      !shuffleCyclePlayed.has(path)
    ));
    replaceShuffleRemaining(retained);

    if (!shuffleInitialized) {
      shuffleInitialized = true;
      if (currentPath && validPaths.has(currentPath)) {
        shuffleCyclePlayed.add(currentPath);
      }
      replaceShuffleRemaining(shufflePaths(
        paths.filter(path => path !== currentPath && !shuffleCyclePlayed.has(path)),
      ));
    } else {
      const newlyAdded = paths.filter(path => (
        !shuffleKnownPaths.has(path) &&
        path !== currentPath &&
        !shuffleCyclePlayed.has(path) &&
        !shuffleRemaining.includes(path)
      ));
      if (newlyAdded.length > 0) {
        replaceShuffleRemaining(shufflePaths([...shuffleRemaining, ...newlyAdded]));
      }
    }

    shuffleKnownPaths = validPaths;

    // 一轮全部播放后重新洗牌；排除当前歌曲，避免跨轮立即重复。
    if (shuffleRemaining.length === 0 && paths.some(path => path !== currentPath)) {
      shuffleCyclePlayed.clear();
      if (currentPath) {
        shuffleCyclePlayed.add(currentPath);
      }
      replaceShuffleRemaining(shufflePaths(paths.filter(path => path !== currentPath)));
    }
  };

  const takePseudoRandomSong = (list: Song[]) => {
    if (list.length === 0) return null;
    if (list.length === 1) return list[0];

    syncShuffleRemaining(list);
    while (shuffleRemaining.length > 0) {
      const nextPath = shuffleRemaining.shift();
      const nextSong = findSongByPath(nextPath, list);
      if (nextSong && nextSong.path !== currentSong.value?.path) {
        // 先占用本轮名额，避免快速连续点击“下一首”时重复抽到同一首。
        shuffleCyclePlayed.add(nextSong.path);
        return nextSong;
      }
    }

    return list.find(song => song.path !== currentSong.value?.path) ?? list[0];
  };

  const nextSong = () => {
    if (tempQueue.value.length > 0) {
      const [next, ...remainingQueue] = tempQueue.value;
      tempQueue.value = remainingQueue;
      if (next) {
        runPlaySong(next);
        return;
      }
    }

    const navigationList = getNavigationList();
    if (!navigationList.length) return;

    if (playMode.value === 2) {
      const futurePath = shuffleFuture[shuffleFuture.length - 1];
      const futureSong = findSongByPath(futurePath, navigationList);
      if (futureSong) {
        shuffleFuture.pop();
        if (currentSong.value && currentSong.value.path !== futureSong.path) {
          pushBounded(shuffleHistory, currentSong.value.path);
        }
        shuffleCyclePlayed.add(futureSong.path);
        removeFromShuffleRemaining(futureSong.path);
        runPlaySong(futureSong, { updateShuffleHistory: false, clearShuffleFuture: false });
        return;
      }

      const pseudoRandomSong = takePseudoRandomSong(navigationList);
      if (pseudoRandomSong) {
        runPlaySong(pseudoRandomSong);
      }
      return;
    }

    let index = navigationList.findIndex(song => song.path === currentSong.value?.path);
    index = (index + 1) % navigationList.length;
    runPlaySong(navigationList[index]);
  };

  const prevSong = () => {
    const navigationList = getNavigationList();
    if (!navigationList.length) return;

    if (playMode.value === 2) {
      const previousPath = shuffleHistory.pop();
      const previousSong = findSongByPath(previousPath, navigationList);
      if (previousSong) {
        if (currentSong.value) {
          pushBounded(shuffleFuture, currentSong.value.path);
        }
        runPlaySong(previousSong, { updateShuffleHistory: false, clearShuffleFuture: false });
        return;
      }

      const pseudoRandomSong = takePseudoRandomSong(navigationList);
      if (pseudoRandomSong) {
        runPlaySong(pseudoRandomSong);
      }
      return;
    }

    let index = navigationList.findIndex(song => song.path === currentSong.value?.path);
    index = (index - 1 + navigationList.length) % navigationList.length;
    runPlaySong(navigationList[index]);
  };

  const clearQueue = async () => {
    playQueue.value = [];
    tempQueue.value = [];
    resetShuffleState();

    if (isPlaying.value) {
      await playbackApi.pauseAudio();
      isPlaying.value = false;
    }

    stopPlaybackRuntime();
    currentSong.value = null;
  };

  const removeSongFromQueue = (song: Song) => {
    playQueue.value = playQueue.value.filter(item => item.path !== song.path);
    tempQueue.value = tempQueue.value.filter(item => item.path !== song.path);
  };

  const addSongToQueue = (song: Song) => {
    playQueue.value = [...playQueue.value, song];
    showToast('已添加到播放队列', 'success');
  };

  const addSongsToQueue = (songs: Song[]) => {
    if (songs.length === 0) return;
    playQueue.value = [...playQueue.value, ...songs];
    showToast(`已添加 ${songs.length} 首歌曲到播放队列`, 'success');
  };

  const toggleMode = () => {
    playMode.value = (playMode.value + 1) % 3;
    resetShuffleState();
  };

  const playNext = (song: Song) => {
    tempQueue.value = [song, ...tempQueue.value];
    showToast('已添加至下一首播放', 'success');
  };

  return {
    resetShuffleState,
    handleBeforePlay,
    nextSong,
    prevSong,
    clearQueue,
    removeSongFromQueue,
    addSongToQueue,
    addSongsToQueue,
    toggleMode,
    playNext,
  };
};
