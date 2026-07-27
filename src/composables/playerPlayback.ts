import { storeToRefs } from 'pinia';
import { watch } from 'vue';
import type { Song } from '../types';
import { playbackApi } from '../services/tauri/playbackApi';
import { usePlaybackStore } from '../features/playback/store';
import { useSettingsStore } from '../features/settings/store';
import { useUiStore } from '../shared/stores/ui';
import { useCoverCache } from './useCoverCache';
import { useRenderingPower } from './renderingPower';

interface PlaySongOptions {
  updateShuffleHistory?: boolean;
  clearShuffleFuture?: boolean;
  preserveQueue?: boolean;
  insertAfterCurrent?: boolean;
  startTime?: number;
}

interface SeekCompletedPayload {
  request_id: number;
  time: number;
}

interface CreatePlayerPlaybackDeps {
  getDisplaySongList: () => Song[];
  addToHistory: (song: Song) => void | Promise<void>;
  loadLyrics: () => void | Promise<void>;
  handleAutoNext: () => void;
  onBeforePlay?: (song: Song, options: PlaySongOptions) => void;
}

let progressFrameId: number | null = null;
let progressTimerId: ReturnType<typeof setTimeout> | null = null;
let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let playRequestId = 0;
let latestSeekRequestId = 0;
let playbackAnchorTime = 0;
let playbackStartOffset = 0;
let sessionStartTime: number | null = null;
let accumulatedTime = 0;
let isSeeking = false;
// duration 未知时用于检测播放结束：记录上次后端进度及停滞轮次
let lastRawProgress = -1;
let stalledProgressTicks = 0;

const getSmtcTitle = (song: Song) => song.title?.trim() || song.name.replace(/\.[^/.]+$/, '');
const LOW_POWER_PROGRESS_UPDATE_MS = 1000;

export const createPlayerPlayback = ({
  getDisplaySongList,
  addToHistory,
  loadLyrics,
  handleAutoNext,
  onBeforePlay,
}: CreatePlayerPlaybackDeps) => {
  const playbackStore = usePlaybackStore();
  const settingsStore = useSettingsStore();
  const uiStore = useUiStore();
  const { isMainWindowLowPower } = useRenderingPower();
  const {
    loadCover,
    loadCoverPath,
    primeCoverPath,
    loadFullCover,
    peekCoverUrl,
    peekCoverPath,
    getFullCoverUrl,
    preloadPriorityCovers,
    preloadFullCovers,
    retainFullCoverPaths,
  } = useCoverCache();
  const {
    currentCover,
    currentCoverPath,
    currentCoverFull,
    currentSong,
    currentTime,
    isPlaying,
    isSongLoaded,
    playQueue,
    playMode,
    tempQueue,
  } = storeToRefs(playbackStore);
  const { showPlayerDetail } = storeToRefs(uiStore);

  const buildQueueWithInsertedSong = (song: Song, previousSong: Song | null, queue: Song[]) => {
    if (previousSong?.path === song.path) {
      return queue.length > 0 ? [...queue] : [song];
    }

    const queueWithoutSong = queue.filter(item => item.path !== song.path);

    if (!previousSong) {
      return [song];
    }

    const baseQueue = queueWithoutSong.length > 0 ? queueWithoutSong : [previousSong];
    const currentIndex = baseQueue.findIndex(item => item.path === previousSong.path);

    if (currentIndex === -1) {
      return [previousSong, song, ...baseQueue];
    }

    return [
      ...baseQueue.slice(0, currentIndex + 1),
      song,
      ...baseQueue.slice(currentIndex + 1),
    ];
  };

  const getLikelyFullCoverPaths = (song: Song) => {
    const retainedPaths: string[] = [song.path];
    const pushUniquePath = (path: string | undefined) => {
      if (!path || retainedPaths.includes(path)) {
        return;
      }

      retainedPaths.push(path);
    };

    pushUniquePath(tempQueue.value[0]?.path);

    const queue = playQueue.value;
    const currentIndex = queue.findIndex(item => item.path === song.path);
    if (currentIndex >= 0 && queue.length > 1) {
      pushUniquePath(queue[(currentIndex - 1 + queue.length) % queue.length]?.path);
      pushUniquePath(queue[(currentIndex + 1) % queue.length]?.path);
    }

    return retainedPaths.slice(0, 4);
  };

  const prepareDetailFullCovers = (song: Song) => {
    if (!showPlayerDetail.value) {
      return [];
    }

    const retainedPaths = getLikelyFullCoverPaths(song);
    retainFullCoverPaths(retainedPaths);
    return retainedPaths;
  };

  const getLikelyThumbnailPaths = (song: Song) => {
    const paths: string[] = [];
    const pushUniquePath = (path: string | undefined) => {
      if (!path || paths.includes(path)) {
        return;
      }
      paths.push(path);
    };

    pushUniquePath(song.path);
    pushUniquePath(tempQueue.value[0]?.path);

    const queue = playQueue.value;
    const currentIndex = queue.findIndex(item => item.path === song.path);
    if (currentIndex >= 0 && queue.length > 1) {
      pushUniquePath(queue[(currentIndex - 1 + queue.length) % queue.length]?.path);
      pushUniquePath(queue[(currentIndex + 1) % queue.length]?.path);
    }

    if (playMode.value === 2) {
      const randomCandidates = (queue.length ? queue : getDisplaySongList())
        .filter(item => item.path !== song.path)
        .slice(0, 5);
      randomCandidates.forEach(item => pushUniquePath(item.path));
    }

    return paths;
  };

  const stopPlaybackRuntime = () => {
    if (progressFrameId !== null) {
      cancelAnimationFrame(progressFrameId);
      progressFrameId = null;
    }
    if (progressTimerId !== null) {
      clearTimeout(progressTimerId);
      progressTimerId = null;
    }
    if (syncIntervalId !== null) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
  };

  const reanchorPlaybackClock = (time: number) => {
    playbackAnchorTime = performance.now();
    playbackStartOffset = time;
    currentTime.value = time;
  };

  const startPlaybackRuntime = () => {
    stopPlaybackRuntime();
    reanchorPlaybackClock(currentTime.value);

    const scheduleUpdate = (update: FrameRequestCallback) => {
      if (isMainWindowLowPower.value) {
        progressTimerId = setTimeout(() => {
          progressTimerId = null;
          update(performance.now());
        }, LOW_POWER_PROGRESS_UPDATE_MS);
        return;
      }

      progressFrameId = requestAnimationFrame(update);
    };

    const update = () => {
      if (!currentSong.value || !isPlaying.value) return;

      const now = performance.now();
      const delta = (now - playbackAnchorTime) / 1000.0;
      currentTime.value = playbackStartOffset + delta;

      if (currentSong.value.duration > 0 && currentTime.value >= currentSong.value.duration) {
        handleAutoNext();
        return;
      }

      scheduleUpdate(update);
    };

    scheduleUpdate(update);
    syncIntervalId = setInterval(async () => {
      if (!isPlaying.value || isSeeking) return;

      try {
        const rawTime = await playbackApi.getPlaybackProgress();
        const offsetSec = (currentSong.value?.cue_start_offset || 0) / 1000;
        const adjustedTime = Math.max(0, rawTime - offsetSec);
        if (Math.abs(adjustedTime - currentTime.value) > 0.05) {
          reanchorPlaybackClock(adjustedTime);
        }

        // 播放结束兜底检测：后端进度连续两轮（≥2s）停滞且已播放过则视为结束
        // - duration 未知：直接视为结束
        // - duration 已知：仅当进度已接近 duration（相差 ≤3s）时视为结束，
        //   避免中段缓冲（如远程流）造成误判；同时弥补 metadata 时长略大于实际
        //   音频时长导致 currentTime 被 reanchor 拉回、永远到不了 duration 的问题
        const song = currentSong.value;
        if (song && rawTime > 0 && Math.abs(rawTime - lastRawProgress) < 0.05) {
          stalledProgressTicks += 1;
          const unknownDuration = !song.duration || song.duration <= 0;
          const nearEnd = song.duration > 0 && rawTime >= song.duration - 3;
          if (stalledProgressTicks >= 2 && (unknownDuration || nearEnd)) {
            stalledProgressTicks = 0;
            handleAutoNext();
            return;
          }
        } else {
          stalledProgressTicks = 0;
        }
        lastRawProgress = rawTime;
      } catch {}
    }, 1000);
  };

  const flushPlaySession = () => {
    const song = currentSong.value;
    if (!song) return;

    let currentSession = 0;
    if (isPlaying.value && sessionStartTime) {
      currentSession = (Date.now() - sessionStartTime) / 1000;
    }

    const totalDuration = accumulatedTime + currentSession;
    if (totalDuration >= 10) {
      playbackApi.recordPlay({
        songPath: song.path,
        listenedMs: Math.floor(totalDuration * 1000),
        durationMs: Math.floor(song.duration * 1000),
        title: getSmtcTitle(song),
        artist: song.artist || '',
        album: song.album || '',
        trackNumber: song.track_number,
      })
        .catch(error => console.warn('record_play failed:', error));
    }

    accumulatedTime = 0;
    sessionStartTime = null;
  };

  const playSong = async (song: Song, options: PlaySongOptions = {}) => {
    const requestId = ++playRequestId;
    const previousSong = currentSong.value;

    flushPlaySession();
    onBeforePlay?.(song, options);

    const preserveQueue = options.preserveQueue ?? false;
    currentSong.value = song;

    if (!preserveQueue) {
      if (options.insertAfterCurrent) {
        playQueue.value = buildQueueWithInsertedSong(song, previousSong, playQueue.value);
      } else {
        const displaySongList = getDisplaySongList();
        if (displaySongList.some(item => item.path === song.path)) {
          playQueue.value = displaySongList;
        } else if (!playQueue.value.some(item => item.path === song.path)) {
          if (playQueue.value.length === 0) {
            playQueue.value = [song];
          } else {
            playQueue.value = [...playQueue.value, song];
          }
        }
      }
    }

    const retainedFullCoverPaths = prepareDetailFullCovers(song);

    isPlaying.value = true;
    isSongLoaded.value = false;
    const coverLookupPath = song.cue_source_path || song.path;
    const cachedCover = peekCoverUrl(coverLookupPath);
    const cachedCoverPath = peekCoverPath(coverLookupPath) || song.cover_thumb_path || '';
    const persistedCover = primeCoverPath(coverLookupPath, song.cover_thumb_path);
    const cachedFullCover = getFullCoverUrl(coverLookupPath);
    const immediateCover = cachedCover || persistedCover;
    if (immediateCover) {
      currentCover.value = immediateCover;
      currentCoverPath.value = coverLookupPath;
    }
    currentCoverFull.value = cachedFullCover || immediateCover || '';
    preloadPriorityCovers(getLikelyThumbnailPaths(song));
    const currentThumbnailLoad = Promise.all([loadCover(coverLookupPath), loadCoverPath(coverLookupPath)]);
    void currentThumbnailLoad
      .then(([cover]) => {
        if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
          return;
        }

        const normalizedCover = cover || '';
        if (normalizedCover) {
          currentCover.value = normalizedCover;
          currentCoverPath.value = song.path;
        } else if (!immediateCover) {
          currentCoverPath.value = '';
        }
        if (!currentCoverFull.value) {
          currentCoverFull.value = normalizedCover || '';
        }
      })
      .catch(() => {});
    if (showPlayerDetail.value && !cachedFullCover) {
      void loadFullCover(song.path)
        .then((fullCoverUrl) => {
          if (requestId !== playRequestId || currentSong.value?.path !== song.path || !fullCoverUrl) {
            return;
          }

          currentCoverFull.value = fullCoverUrl;
        })
        .catch(() => {});
    }
    if (retainedFullCoverPaths.length > 1) {
      preloadFullCovers(retainedFullCoverPaths.filter(path => path !== song.path));
    }
    const cueStartOffset = song.cue_start_offset || 0;
    const requestedStartTime = Number.isFinite(options.startTime) ? (options.startTime as number) : 0;
    const resumeTime = Math.max(0, Math.min(requestedStartTime, song.duration || requestedStartTime));

    stopPlaybackRuntime();
    reanchorPlaybackClock(resumeTime);
    accumulatedTime = 0;
    sessionStartTime = null;
    lastRawProgress = -1;
    stalledProgressTicks = 0;

    addToHistory(song);

    const audioFilePath = song.cue_source_path || song.path;
    const startOffsetMs = cueStartOffset + Math.round(resumeTime * 1000);

    try {
      await playbackApi.playAudio({
        path: audioFilePath,
        title: getSmtcTitle(song),
        artist: song.artist || 'Unknown Artist',
        album: song.album || 'Unknown Album',
        cover: cachedCoverPath,
        duration: Math.floor(song.duration),
        outputMode: settingsStore.settings.audio.outputMode,
        startOffsetMs: startOffsetMs || undefined,
        songId: song.id,
        volumeBalanceEnabled: settingsStore.settings.audio.volumeBalance?.enabled,
        gainOffsetDb: settingsStore.settings.audio.volumeBalance?.gainOffsetDb,
        preventClipping: settingsStore.settings.audio.volumeBalance?.preventClipping,
      });
      if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

      isSongLoaded.value = true;
      sessionStartTime = Date.now();
      loadLyrics();
      startPlaybackRuntime();

      void currentThumbnailLoad
        .then(async ([cover, coverPath]) => {
          if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
            return;
          }

          const normalizedCover = cover || '';
          const normalizedCoverPath = coverPath || '';
          currentCover.value = normalizedCover;
          if (!currentCoverFull.value) {
            currentCoverFull.value = normalizedCover;
          }

          await playbackApi.updatePlaybackMetadata({
            title: getSmtcTitle(song),
            artist: song.artist || 'Unknown Artist',
            album: song.album || 'Unknown Album',
            cover: normalizedCoverPath,
            duration: Math.floor(song.duration),
            isPlaying: isPlaying.value,
          }).catch(() => {});
        })
        .catch(() => {});
    } catch {
      if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

      isPlaying.value = false;
      isSongLoaded.value = false;
      sessionStartTime = null;
      stopPlaybackRuntime();
    }
  };

  const pauseSong = async () => {
    if (isPlaying.value && sessionStartTime) {
      accumulatedTime += (Date.now() - sessionStartTime) / 1000;
      sessionStartTime = null;
    }

    isPlaying.value = false;
    await playbackApi.pauseAudio();
    stopPlaybackRuntime();
  };

  const togglePlay = async () => {
    if (!currentSong.value) return;

    if (isPlaying.value) {
      if (sessionStartTime) {
        accumulatedTime += (Date.now() - sessionStartTime) / 1000;
        sessionStartTime = null;
      }

      await playbackApi.pauseAudio();
      isPlaying.value = false;
      stopPlaybackRuntime();
      return;
    }

    if (!isSongLoaded.value) {
      await playSong(currentSong.value, { startTime: currentTime.value });
    } else {
      await playbackApi.resumeAudio();
      sessionStartTime = Date.now();
    }

    isPlaying.value = true;
    startPlaybackRuntime();
  };

  const seekTo = async (newTime: number) => {
    if (!currentSong.value) return;

    if (isPlaying.value && sessionStartTime) {
      accumulatedTime += (Date.now() - sessionStartTime) / 1000;
      sessionStartTime = Date.now();
    }

    isSeeking = true;
    stopPlaybackRuntime();
    const trackDuration = currentSong.value.duration;
    // duration 未知/为 0 时不对上限进行 clamp，否则 seekTo 任意时间都会被压缩到 0
    // 导致点击歌词从头播放
    const targetTime = trackDuration > 0
      ? Math.max(0, Math.min(newTime, trackDuration))
      : Math.max(0, newTime);
    const requestId = ++latestSeekRequestId;
    reanchorPlaybackClock(targetTime);

    try {
      const offsetSec = (currentSong.value.cue_start_offset || 0) / 1000;
      await playbackApi.seekAudio({
        time: targetTime + offsetSec,
        isPlaying: isPlaying.value,
        requestId,
      });
      reanchorPlaybackClock(targetTime);
      if (isPlaying.value) {
        startPlaybackRuntime();
      }
    } catch (error) {
      isSeeking = false;
      if (isPlaying.value) {
        startPlaybackRuntime();
      }
      throw error;
    }
  };

  const playAt = async (time: number) => {
    await seekTo(time);
    if (!isPlaying.value) {
      setTimeout(async () => {
        if (!isPlaying.value) {
          await togglePlay();
        }
      }, 150);
    }
  };

  const handleSeek = async (event: MouseEvent) => {
    if (!currentSong.value) return;

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    await seekTo(progress * currentSong.value.duration);
  };

  const stepSeek = async (step: number) => {
    if (!currentSong.value) return;
    await seekTo(currentTime.value + step);
  };

  const handleSeekCompleted = (payload: SeekCompletedPayload) => {
    if (payload.request_id !== latestSeekRequestId) return;

    isSeeking = false;
    const offsetSec = (currentSong.value?.cue_start_offset || 0) / 1000;
    const trackTime = Math.max(0, payload.time - offsetSec);
    reanchorPlaybackClock(trackTime);
  };

  const dispose = () => {
    stopPlaybackRuntime();
    stopPowerModeWatcher();
  };

  const stopPowerModeWatcher = watch(isMainWindowLowPower, () => {
    if (currentSong.value && isPlaying.value && !isSeeking) {
      startPlaybackRuntime();
    }
  });

  return {
    flushPlaySession,
    playSong,
    pauseSong,
    togglePlay,
    seekTo,
    playAt,
    handleSeek,
    stepSeek,
    handleSeekCompleted,
    stopPlaybackRuntime,
    dispose,
  };
};
