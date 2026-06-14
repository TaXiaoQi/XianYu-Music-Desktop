import { storeToRefs } from 'pinia';

import { playbackApi } from '../services/tauri/playbackApi';
import { useLibraryStore } from '../features/library/store';
import { usePlaybackStore } from '../features/playback/store';
import type { Song } from '../types';

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

  const resetShuffleState = () => {
    shuffleHistory.length = 0;
    shuffleFuture.length = 0;
  };

  const pushBounded = (target: string[], path: string) => {
    target.push(path);
    if (target.length > SHUFFLE_HISTORY_LIMIT) {
      target.splice(0, target.length - SHUFFLE_HISTORY_LIMIT);
    }
  };

  const handleBeforePlay = (song: Song, options: QueuePlaySongOptions = {}) => {
    const shouldUpdateShuffleHistory = options.updateShuffleHistory ?? true;
    const shouldClearShuffleFuture = options.clearShuffleFuture ?? true;
    const previousSong = currentSong.value;

    if (
      playMode.value === 2 &&
      shouldUpdateShuffleHistory &&
      previousSong &&
      previousSong.path !== song.path
    ) {
      pushBounded(shuffleHistory, previousSong.path);
      if (shouldClearShuffleFuture) {
        shuffleFuture.length = 0;
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

  const pickRandomSong = (list: Song[]) => {
    if (list.length === 0) return null;
    if (list.length === 1) return list[0];

    const currentPath = currentSong.value?.path;
    const candidates = currentPath ? list.filter(song => song.path !== currentPath) : list;
    if (candidates.length === 0) return list[0];
    return candidates[Math.floor(Math.random() * candidates.length)];
  };

  const nextSong = () => {
    if (tempQueue.value.length > 0) {
      const [next, ...remainingQueue] = tempQueue.value;
      tempQueue.value = remainingQueue;
      if (next) {
        playSong(next);
        return;
      }
    }

    const navigationList = getNavigationList();
    if (!navigationList.length) return;

    if (playMode.value === 2) {
      const futureSong = findSongByPath(shuffleFuture.pop(), navigationList);
      if (futureSong) {
        playSong(futureSong, { updateShuffleHistory: false, clearShuffleFuture: false });
        return;
      }

      const randomSong = pickRandomSong(navigationList);
      if (randomSong) {
        playSong(randomSong);
      }
      return;
    }

    let index = navigationList.findIndex(song => song.path === currentSong.value?.path);
    index = (index + 1) % navigationList.length;
    playSong(navigationList[index]);
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
        playSong(previousSong, { updateShuffleHistory: false, clearShuffleFuture: false });
        return;
      }

      const randomSong = pickRandomSong(navigationList);
      if (randomSong) {
        playSong(randomSong);
      }
      return;
    }

    let index = navigationList.findIndex(song => song.path === currentSong.value?.path);
    index = (index - 1 + navigationList.length) % navigationList.length;
    playSong(navigationList[index]);
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
