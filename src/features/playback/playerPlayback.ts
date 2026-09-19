import {storeToRefs} from 'pinia';
import {watch} from 'vue';
import {listen} from '@tauri-apps/api/event';
import type {QualityKey, Song} from '../../types';
import type {AudioOutputStatus} from '../../services/tauri/contracts';
import {playbackApi} from '../../services/tauri/playbackApi';
import {pluginApi} from '../../services/tauri/pluginApi';
import {useDlnaCastStore} from './castStore';
import {usePlaybackStore} from './store';
import {useSettingsStore} from '../settings/store';
import {useLibraryStore} from '../library/store';
import {useUiStore} from '../../shared/stores/ui';
import {useCoverCache} from '../../composables/useCoverCache';
import {useRenderingPower} from '../../composables/renderingPower';
import {fetchLxSongLyricsRaw} from '../../services/domain/lxLyricFetcher';
import {useToast} from '../../composables/toast';
import {reportUserBehavior} from '../../services/domain/usageStats';
import {useAuthStore} from '../auth/store';
import {preloadAmlLyricPlayer} from '../../components/player/amlLyricPlayerLoader';
import {consumeFlyCoverPromise} from '../../composables/useFlyingCover';
import {getStoredPlugins, getLastPluginError, pluginGetLyric} from '../../services/domain/pluginEngine';
import {describePlatform, findMatchingPlugin} from '../../services/domain/pluginBackupSong';
import {checkDownloadExists} from '../../services/domain/downloadHistory';
import {getOnlineAvailableQualities, resolveOnlineAudio} from './onlinePlaybackResolver';
import {scheduleOnlinePrecache} from './onlinePrecache';
import {sanitizeMediaUrl} from '../../utils/mediaUrl';
import {getDisplayCoverUrl} from '../../utils/coverProxy';
import {getPluginBilibiliCookies} from '../../services/domain/pluginCookieStore';
import {clearOnlineLyricsUnavailable, markOnlineLyricsUnavailable} from '../../composables/lyrics/state';
import {
  fetchQishuiPreviewInfo,
  hasQishuiPreviewCached,
  isPluginPath,
  isPreviewLikeStream,
  isQishuiPluginPath,
  extractPluginTrackId,
  formatPreviewClock,
  type PreviewClipInfo,
} from './onlineFailover';
import {
  evaluateStallAutoNext,
  LOW_POWER_PROGRESS_UPDATE_MS,
  type PlaybackProgressPayload,
} from './playbackTiming';
import {likelyFullCoverPaths, likelyThumbnailPaths} from './coverState';

interface PlaySongOptions {
  updateShuffleHistory?: boolean;
  clearShuffleFuture?: boolean;
  preserveQueue?: boolean;
  insertAfterCurrent?: boolean;
  startTime?: number;
  continueStatisticsSession?: boolean;
  forceReplay?: boolean;
  shareLinkPlayback?: boolean;
  _sourceSwitchCtx?: {
    originKey: string;
    failedSources: Set<string>;
  };
  _siblingTriedPluginIds?: Set<string>;
}

interface SeekCompletedPayload {
  request_id: number;
  time: number;
}

interface CreatePlayerPlaybackDeps {
  getDisplaySongList: () => Song[];
  addToHistory: (song: Song) => void | Promise<void>;
  loadLyrics: (overrideLyricsRaw?: string) => void | Promise<void>;
  handleAutoNext: () => void;
  onBeforePlay?: (song: Song, options: PlaySongOptions) => void;
}

let progressFrameId: number | null = null;
let progressTimerId: ReturnType<typeof setTimeout> | null = null;
let progressUnlisten: (() => void) | null = null;
let progressListeningActive = false;
let periodicFlushTimerId: ReturnType<typeof setInterval> | null = null;
let fadeFrameId: number | null = null;
let fadeResolveFn: (() => void) | null = null;
let currentBackendVolume = 1;
let togglePlayToken = 0;
let playRequestId = 0;
let cancelledPlayRequestId = -1;
let lastHandledOnlineFailure: {
  path: string;
  requestId: number;
  handledAt: number;
} | null = null;
const recentOnlineFailurePaths = new Map<string, number>();
const knownFailedPluginPrefixes = new Set<string>();
let shareLinkPlaybackActive = false;
let latestSeekRequestId = 0;
let playbackAnchorTime = 0;
let playbackStartOffset = 0;
let sessionStartTime: number | null = null;
let accumulatedTime = 0;
let currentPlayCountRecorded = false;
let hasAudioOutputDevice = true;
let lastOutputValid = true;
let deviceStatusUnlisten: (() => void) | null = null;
let volumeValidityWatcher: ReturnType<typeof watch> | null = null;
let isSeeking = false;
let lastRawProgress = -1;
let stalledProgressTicks = 0;
let volumeRestoreTimerId: ReturnType<typeof setTimeout> | null = null;
let volumeRestoreToken = 0;
const shortTimerIds = new Set<ReturnType<typeof setTimeout>>();

const getSmtcTitle = (song: Song) => song.title?.trim() || song.name.replace(/\.[^/.]+$/, '');
const ONLINE_FAILURE_LOOP_GUARD_MS = 30_000;
const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

// ==================== [试听片段] 在线音源试听流处理 ====================

let activePreviewClip: PreviewClipInfo | null = null;
let previewClipPath = '';
let previewDetectedPath = '';

export const createPlayerPlayback = ({
  getDisplaySongList,
  addToHistory,
  loadLyrics,
  handleAutoNext,
  onBeforePlay,
}: CreatePlayerPlaybackDeps) => {
  const playbackStore = usePlaybackStore();
const settingsStore = useSettingsStore();
const libraryStore = useLibraryStore();
const uiStore = useUiStore();
const authStore = useAuthStore();
const dlnaCast = useDlnaCastStore();
  const { showToast } = useToast();
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
    playQueuePaths,
    playMode,
    tempQueue,
    tempQueuePaths,
    currentAvailableQualities,
  } = storeToRefs(playbackStore);
  const { showPlayerDetail } = storeToRefs(uiStore);

  const syncStatisticsValidity = () => {
    const valid = playbackStore.volume >= 1 && hasAudioOutputDevice;
    if (valid === lastOutputValid) return;
    lastOutputValid = valid;
    if (valid) {
      if (isPlaying.value) sessionStartTime = Date.now();
    } else if (isPlaying.value && sessionStartTime) {
      accumulatedTime += (Date.now() - sessionStartTime) / 1000;
      sessionStartTime = null;
    }
  };

  const startStatisticsSession = () => {
    sessionStartTime = (playbackStore.volume >= 1 && hasAudioOutputDevice) ? Date.now() : null;
  };

  listen<AudioOutputStatus>('audio-output-device-changed', (event) => {
    hasAudioOutputDevice = event.payload.active_device_name != null;
    playbackStore.activeOutputMode = event.payload.active_output_mode;
    syncStatisticsValidity();
  }).then(fn => { deviceStatusUnlisten = fn; }).catch(() => {});

  playbackApi.getCurrentOutputDevice()
    .then(status => {
      hasAudioOutputDevice = status.active_device_name != null;
      playbackStore.activeOutputMode = status.active_output_mode;
      syncStatisticsValidity();
    })
    .catch(() => {});

  volumeValidityWatcher = watch(() => playbackStore.volume, () => {
    syncStatisticsValidity();
  });

  const setManagedTimeout = (callback: () => void, delay: number) => {
    const timerId = setTimeout(() => {
      shortTimerIds.delete(timerId);
      callback();
    }, delay);
    shortTimerIds.add(timerId);
    return timerId;
  };

  const clearManagedShortTimers = () => {
    shortTimerIds.forEach(timerId => clearTimeout(timerId));
    shortTimerIds.clear();
  };

  const pruneRecentOnlineFailurePaths = (now = Date.now()) => {
    for (const [path, failedAt] of recentOnlineFailurePaths) {
      if (now - failedAt > ONLINE_FAILURE_LOOP_GUARD_MS) {
        recentOnlineFailurePaths.delete(path);
      }
    }
  };

  const clearVolumeRestoreTimer = () => {
    volumeRestoreToken += 1;
    if (volumeRestoreTimerId !== null) {
      clearTimeout(volumeRestoreTimerId);
      shortTimerIds.delete(volumeRestoreTimerId);
      volumeRestoreTimerId = null;
    }
  };

  const scheduleBackendVolumeRestore = (restoreVol: number, shouldRestore?: () => boolean) => {
    clearVolumeRestoreTimer();
    const token = ++volumeRestoreToken;
    volumeRestoreTimerId = setManagedTimeout(() => {
      volumeRestoreTimerId = null;
      if (token !== volumeRestoreToken || (shouldRestore && !shouldRestore())) {
        return;
      }
      currentBackendVolume = restoreVol;
      void playbackApi.setVolume(restoreVol).catch(() => {});
    }, 200);
  };

  const scheduleAddToHistory = (song: Song) => {
    const idle = typeof window !== 'undefined' && 'requestIdleCallback' in window
      ? window.requestIdleCallback.bind(window)
      : undefined;

    if (idle) {
      idle(() => addToHistory(song), { timeout: 2000 });
    } else {
      setManagedTimeout(() => {
        void addToHistory(song);
      }, 500);
    }
  };

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

  const scheduleLyricsPlayerPreload = (song: Song) => {
    const songPath = song.cue_source_path || song.path;
    if (!songPath.startsWith('lx://') && !songPath.startsWith('plugin://')) {
      return;
    }

    const preload = () => {
      if (!isMainWindowLowPower.value) {
        void preloadAmlLyricPlayer().catch(() => {});
      }
    };

    const requestIdle = typeof window !== 'undefined' && 'requestIdleCallback' in window
      ? window.requestIdleCallback.bind(window)
      : undefined;

    if (requestIdle) {
      requestIdle(preload, { timeout: 1500 });
    } else {
      setManagedTimeout(preload, 0);
    }
  };

  const prepareDetailFullCovers = (song: Song) => {
    if (!showPlayerDetail.value) {
      return [];
    }

    const retainedPaths = likelyFullCoverPaths({song, tempQueue: tempQueue.value, playQueue: playQueue.value});
    retainFullCoverPaths(retainedPaths);
    return retainedPaths;
  };

  const getLikelyThumbnailPaths = (song: Song) => {
    return likelyThumbnailPaths({
      song,
      tempQueuePaths: tempQueuePaths.value,
      playQueuePaths: playQueuePaths.value,
      playMode: playMode.value,
      getDisplaySongList,
    });
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
    progressListeningActive = false;
    if (progressUnlisten) {
      progressUnlisten();
      progressUnlisten = null;
    }
    if (periodicFlushTimerId !== null) {
      clearInterval(periodicFlushTimerId);
      periodicFlushTimerId = null;
    }
  };

  const cancelFade = () => {
    if (fadeFrameId !== null) {
      cancelAnimationFrame(fadeFrameId);
      fadeFrameId = null;
    }
    if (fadeResolveFn) {
      const fn = fadeResolveFn;
      fadeResolveFn = null;
      fn();
    }
  };

  const fadeVolumeTo = (targetVolume: number, durationMs: number, startVolumeOverride?: number): Promise<void> => {
    return new Promise((resolve) => {
      cancelFade();
      const startVolume = startVolumeOverride ?? currentBackendVolume;
      const targetVol = Math.max(0, Math.min(1, targetVolume));
      if (Math.abs(startVolume - targetVol) < 0.005 || durationMs <= 0) {
        currentBackendVolume = targetVol;
        void playbackApi.setVolume(targetVol).catch(() => {});
        resolve();
        return;
      }
      const startTime = performance.now();
      const isFadeIn = targetVol > startVolume;
      const step = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        const eased = isFadeIn
          ? progress * progress
          : 1 - (1 - progress) * (1 - progress);
        const currentVol = startVolume + (targetVol - startVolume) * eased;
        currentBackendVolume = currentVol;
        void playbackApi.setVolume(currentVol).catch(() => {});
        if (progress < 1) {
          fadeFrameId = requestAnimationFrame(step);
        } else {
          fadeFrameId = null;
          fadeResolveFn = null;
          currentBackendVolume = targetVol;
          void playbackApi.setVolume(targetVol).catch(() => {});
          resolve();
        }
      };
      fadeResolveFn = resolve;
      fadeFrameId = requestAnimationFrame(step);
    });
  };

  const reanchorPlaybackClock = (time: number) => {
    playbackAnchorTime = performance.now();
    playbackStartOffset = time;
    currentTime.value = time;
  };

  const handlePreviewClipDetected = async (song: Song, actualDuration: number) => {
    previewDetectedPath = song.path;
    const trackId = isQishuiPluginPath(song.path) ? extractPluginTrackId(song.path) : '';
    const previewInfo = trackId ? await fetchQishuiPreviewInfo(trackId) : null;

    if (currentSong.value?.path !== song.path) return;

    if (previewInfo && Math.abs(previewInfo.duration - actualDuration) <= 3) {
      activePreviewClip = { start: previewInfo.start, duration: actualDuration };
      previewClipPath = song.path;
      reanchorPlaybackClock(previewInfo.start + currentTime.value);
      showToast(
        `「${getSmtcTitle(song)}」为 VIP 试听片段（${Math.round(actualDuration)} 秒，${formatPreviewClock(previewInfo.start)} 起），完整播放请配置插件登录或更换音源`,
        'info',
      );
    } else {
      activePreviewClip = { start: 0, duration: actualDuration };
      previewClipPath = song.path;
      const flooredDuration = Math.floor(actualDuration);
      if (song.duration !== flooredDuration) {
        currentSong.value = { ...song, duration: flooredDuration };
        playbackStore.patchQueueSongMeta(song.path, { duration: flooredDuration });
      }
      reanchorPlaybackClock(Math.min(currentTime.value, actualDuration));
      showToast(
        `当前音源仅为试听片段（约 ${flooredDuration} 秒），完整播放请更换音源或配置插件登录`,
        'info',
      );
    }
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

      if (dlnaCast.isCasting) {
        currentTime.value = dlnaCast.interpolatedPosition();
        const tvDur = dlnaCast.tvDuration;
        const songForDur = currentSong.value;
        if (tvDur > 0.5 && songForDur && (!songForDur.duration || songForDur.duration <= 0)) {
          const newDuration = Math.floor(tvDur);
          currentSong.value = {...songForDur, duration: newDuration};
          libraryStore.patchSongMeta(songForDur.path, {duration: newDuration} as Partial<Song>);
          playbackStore.patchQueueSongMeta(songForDur.path, {duration: newDuration});
        }
      } else {
        const now = performance.now();
        const delta = (now - playbackAnchorTime) / 1000.0;
        currentTime.value = playbackStartOffset + delta;
      }

      const endTime = activePreviewClip
        ? activePreviewClip.start + activePreviewClip.duration
        : currentSong.value.duration;
      if (endTime > 0 && currentTime.value >= endTime - 0.3) {
        handleAutoNext();
        return;
      }

      scheduleUpdate(update);
    };

    scheduleUpdate(update);

    periodicFlushTimerId = setInterval(() => {
      if (isPlaying.value && currentSong.value) {
        flushPlaySession();
        startStatisticsSession();
      }
    }, 30_000);

    progressListeningActive = true;
    listen<PlaybackProgressPayload>('playback:progress', (event) => {
      if (!progressListeningActive || !isPlaying.value || isSeeking || dlnaCast.isCasting) return;

      const {position: rawTime, duration} = event.payload;
      if (
        activePreviewClip
        && duration > 0
        && Math.abs(duration - activePreviewClip.duration) > 3
      ) {
        activePreviewClip = null;
        previewClipPath = '';
        previewDetectedPath = '';
      }
      const offsetSec = (currentSong.value?.cue_start_offset || 0) / 1000;
      const previewStart = activePreviewClip?.start ?? 0;
      const adjustedTime = Math.max(0, rawTime - offsetSec + previewStart);
      if (Math.abs(adjustedTime - currentTime.value) > 0.05) {
        reanchorPlaybackClock(adjustedTime);
      }

      const songForPreviewCheck = currentSong.value;
      if (
        songForPreviewCheck
        && previewDetectedPath !== songForPreviewCheck.path
        && isPluginPath(songForPreviewCheck.path)
        && isPreviewLikeStream(duration, songForPreviewCheck.duration)
      ) {
        void handlePreviewClipDetected(songForPreviewCheck, duration);
      }

      const song = currentSong.value;
      if (song) {
        const {stalledProgressTicks: ticks, shouldAutoAdvance} = evaluateStallAutoNext({
          song,
          rawTime,
          lastRawProgress,
          stalledProgressTicks,
          activePreviewClip,
        });
        stalledProgressTicks = ticks;
        if (shouldAutoAdvance) {
          handleAutoNext();
          return;
        }
      } else {
        stalledProgressTicks = 0;
      }
      lastRawProgress = rawTime;

      const songForDuration = currentSong.value;
      if (songForDuration && (!songForDuration.duration || songForDuration.duration <= 0) && duration > 0) {
        const newDuration = Math.floor(duration);
        currentSong.value = {...songForDuration, duration: newDuration};
        libraryStore.patchSongMeta(songForDuration.path, {duration: newDuration} as Partial<Song>);
        playbackStore.patchQueueSongMeta(songForDuration.path, {duration: newDuration});
      }
    }).then(unlisten => {
      if (!progressListeningActive) {
        unlisten();
      } else {
        progressUnlisten = unlisten;
      }
    });
  };

  const flushPlaySession = () => {
    const song = currentSong.value;
    if (!song) return;

    if (playbackStore.volume < 1 || !hasAudioOutputDevice) {
      sessionStartTime = null;
      return;
    }

    let currentSession = 0;
    if (isPlaying.value && sessionStartTime) {
      currentSession = (Date.now() - sessionStartTime) / 1000;
    }

    const totalDuration = accumulatedTime + currentSession;
    const shouldPersist = totalDuration >= 10 || (currentPlayCountRecorded && totalDuration > 0);

    const user = authStore.user;
    let songSource = 'local';
    if (song.path.startsWith('lx://')) {
      songSource = song.path.slice('lx://'.length).split('/')[0] || 'lx';
    } else if (song.path.startsWith('http://') || song.path.startsWith('https://')) {
      songSource = 'online';
    } else if (song.path.startsWith('plugin://')) {
      songSource = song.path.slice('plugin://'.length).split('/')[0] || 'plugin';
    }
    reportUserBehavior({
      song_id: song.id != null ? String(song.id) : song.path,
      song_name: song.name,
      singer: song.artist || '',
      song_hash: song.path,
      source: songSource,
      action: totalDuration >= 10 ? (currentPlayCountRecorded ? 'switch' : 'play') : 'switch',
      listen_duration: Math.floor(totalDuration),
      play_count: totalDuration >= 10 && !currentPlayCountRecorded ? 1 : 0,
      ciyuanxi_id: user?.ciyuanxi_id,
      user_id: user?.id ? Number(user.id) : undefined,
    });

    if (shouldPersist) {
      const countAsPlay = !currentPlayCountRecorded;
      if (countAsPlay) currentPlayCountRecorded = true;
      playbackApi.recordPlay({
        songPath: song.path,
        listenedMs: Math.floor(totalDuration * 1000),
        durationMs: Math.floor(song.duration * 1000),
        title: getSmtcTitle(song),
        artist: song.artist || '',
        album: song.album || '',
        trackNumber: song.track_number,
        countAsPlay,
      })
        .catch(error => console.warn('record_play failed:', error));
    }

    accumulatedTime = shouldPersist ? 0 : totalDuration;
    sessionStartTime = null;
  };

  const trySiblingPluginPlayback = async (
    song: Song,
    options: PlaySongOptions,
    requestId: number,
  ): Promise<boolean> => {
    try {
      const searchResult = song.rawData as { pluginId?: string; platform?: string } | undefined;
      if (!searchResult?.pluginId) return false;

      let platformLabel = searchResult.platform || '';
      if (!platformLabel.trim()) {
        const segment = (song.cue_source_path || song.path || '').slice('plugin://'.length).split('/')[0] || '';
        try { platformLabel = decodeURIComponent(segment); } catch { platformLabel = segment; }
      }
      if (!platformLabel.trim()) return false;

      const tried = options._siblingTriedPluginIds ?? new Set<string>();
      tried.add(searchResult.pluginId);
      const candidates = getStoredPlugins().filter(p => p.enabled && !tried.has(p.id));
      const sibling = findMatchingPlugin(describePlatform(platformLabel), candidates, 'musicfree');
      if (!sibling) return false;

      if (requestId !== playRequestId || currentSong.value?.path !== song.path) return false;

      console.info(`[Audio] 自动换源 · 同平台插件重试: ${sibling.name} (${sibling.id.slice(0, 8)}…)`);
      searchResult.pluginId = sibling.id;
      song.plugin_id = sibling.id;
      await playSong(song, {
        preserveQueue: true,
        _sourceSwitchCtx: options._sourceSwitchCtx,
        _siblingTriedPluginIds: tried,
      });
      return true;
    } catch (error) {
      console.warn(`[Audio] 同平台插件重试异常: ${getErrorMessage(error)}`);
      return false;
    }
  };

  const handleOnlinePlaybackFailure = async (
    song: Song,
    options: PlaySongOptions,
    requestId: number,
    shouldFade: boolean | null,
  ): Promise<void> => {
    const now = Date.now();
    const isDuplicateFailure = !!(
      lastHandledOnlineFailure
      && lastHandledOnlineFailure.path === song.path
      && (
        lastHandledOnlineFailure.requestId === requestId
        || now - lastHandledOnlineFailure.handledAt < 3000
      )
    );
    if (isDuplicateFailure) {
      console.warn('[Audio] 已忽略重复的在线播放失败处理:', {
        path: song.path,
        requestId,
      });
    } else {
      lastHandledOnlineFailure = {
        path: song.path,
        requestId,
        handledAt: now,
      };
      recentOnlineFailurePaths.set(song.path, now);
      pruneRecentOnlineFailurePaths(now);
    }

    try { await playbackApi.stopAudio(); } catch {}
    if (shouldFade) {
      currentBackendVolume = playbackStore.volume / 100;
      void playbackApi.setVolume(currentBackendVolume).catch(() => {});
    }
    isPlaying.value = false;
    isSongLoaded.value = false;
    stopPlaybackRuntime();
    console.error('[Audio] 在线音频播放失败');

    if (isDuplicateFailure) {
      return;
    }

    const isSharePlayback = shareLinkPlaybackActive;
    const shareFailureBehavior = settingsStore.settings.sharePlaybackFailureBehavior ?? 'pause';
    if (isSharePlayback && song.path.startsWith('lx://') && shareFailureBehavior === 'pause') {
      showToast('分享歌曲播放失败，已暂停', 'error');
      return;
    }
    const failureBehavior = settingsStore.settings.audio.onlineFailureBehavior ?? 'skip';
    const autoSwitchEnabled = failureBehavior === 'autoswitch';
    const isPluginSong = song.path.startsWith('plugin://');
    const allowAutoSwitch = (song.path.startsWith('lx://') || isPluginSong)
      && (autoSwitchEnabled || (isSharePlayback && shareFailureBehavior === 'replace'));
    if (allowAutoSwitch) {
      if (isPluginSong) {
        const switched = await trySiblingPluginPlayback(song, options, requestId);
        if (switched) return;
        if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;
      }

      const switchCtx = options._sourceSwitchCtx ?? {
        originKey: `${song.name}|${song.artist}`,
        failedSources: new Set<string>(),
      };
      if (song.path.startsWith('lx://')) {
        switchCtx.failedSources.add(song.path.slice('lx://'.length).split('/')[0]);
      } else {
        const searchResult = song.rawData as { platform?: string } | undefined;
        let platformLabel = searchResult?.platform || '';
        if (!platformLabel.trim()) {
          const segment = (song.cue_source_path || song.path || '').slice('plugin://'.length).split('/')[0] || '';
          try { platformLabel = decodeURIComponent(segment); } catch { platformLabel = segment; }
        }
        switchCtx.failedSources.add(describePlatform(platformLabel).lxSource ?? 'plugin');
      }

      let alternativeSong: Song | null = null;
      try {
        const { findAlternativeLxSource } = await import('../../services/domain/lxSourceFallback');
        alternativeSong = await findAlternativeLxSource(song, switchCtx.failedSources);
      } catch (error) {
        console.warn(`[Audio] 自动换源查找异常: ${getErrorMessage(error)}`);
      }

      if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
        return;
      }

      if (alternativeSong) {
        const { getLxSourceDisplayName } = await import('../../services/domain/lxSourceFallback');
        const newSource = alternativeSong.path.slice('lx://'.length).split('/')[0];
        if (!alternativeSong.cover_thumb_path && song.cover_thumb_path) {
          alternativeSong.cover_thumb_path = song.cover_thumb_path;
        }
        showToast(`已自动切换到 ${getLxSourceDisplayName(newSource)} 音源`, 'info');
        await playSong(alternativeSong, {
          preserveQueue: true,
          _sourceSwitchCtx: switchCtx,
          _siblingTriedPluginIds: options._siblingTriedPluginIds,
        });
        return;
      }
    }

    if (isSharePlayback) {
      showToast('分享歌曲播放失败，未找到可替换音源', 'error');
      return;
    }

    if (allowAutoSwitch) {
      showToast('已自动换源无果，请重试或更换音源', 'error');
      return;
    }

    if (failureBehavior === 'skip') {
      if (song.path.startsWith('plugin://')) {
        const withoutScheme = song.path.slice('plugin://'.length);
        const slashIdx = withoutScheme.indexOf('/');
        if (slashIdx >= 0) {
          const prefix = 'plugin://' + withoutScheme.slice(0, slashIdx + 1);
          knownFailedPluginPrefixes.add(prefix);
        }
      }

      const isLikelyPlayable = (item: Song): boolean => {
        if (recentOnlineFailurePaths.has(item.path)) return false;
        if (item.path.startsWith('plugin://')) {
          for (const prefix of knownFailedPluginPrefixes) {
            if (item.path.startsWith(prefix)) return false;
          }
        }
        return true;
      };

      const queueSongs = [...playbackStore.tempQueue, ...playbackStore.playQueue];
      const hasAlternativeQueueSong = queueSongs.some(item =>
        item.path !== song.path && isLikelyPlayable(item),
      );

      if (!hasAlternativeQueueSong) {
        if (knownFailedPluginPrefixes.size > 0 && queueSongs.every(item =>
          !isLikelyPlayable(item) || item.path === song.path,
        )) {
          showToast('同步的在线歌曲在此设备上无法播放，请通过插件重新搜索添加', 'error');
        }
        console.warn('[Audio] 在线音频播放失败，但队列中没有其它未失败歌曲，停止而不是循环请求');
        return;
      }

      if (knownFailedPluginPrefixes.size > 0) {
        const now = Date.now();
        for (const item of queueSongs) {
          if (item.path === song.path) continue;
          if (!item.path.startsWith('plugin://')) continue;
          for (const prefix of knownFailedPluginPrefixes) {
            if (item.path.startsWith(prefix)) {
              recentOnlineFailurePaths.set(item.path, now);
              break;
            }
          }
        }
      }

      setManagedTimeout(() => {
        if (currentSong.value?.path === song.path) handleAutoNext();
      }, 400);
    }
  };

  const playSong = async (song: Song, options: PlaySongOptions = {}) => {
    if (!options._sourceSwitchCtx) {
      shareLinkPlaybackActive = !!options.shareLinkPlayback;
    }
    const previousSong = currentSong.value;
    const isSameCurrentlyPlayingSong = !!previousSong
      && previousSong.path === song.path
      && isPlaying.value
      && !options.continueStatisticsSession
      && options.startTime === undefined
      && !options.forceReplay
      && !options._sourceSwitchCtx;

    if (isSameCurrentlyPlayingSong) {
      return;
    }

    if (song.path.startsWith('plugin://') && !options._sourceSwitchCtx) {
      const withoutScheme = song.path.slice('plugin://'.length);
      const slashIdx = withoutScheme.indexOf('/');
      if (slashIdx >= 0) {
        const prefix = 'plugin://' + withoutScheme.slice(0, slashIdx + 1);
        if (knownFailedPluginPrefixes.has(prefix)) {
          const alreadyFailedRecently = recentOnlineFailurePaths.has(song.path);
          recentOnlineFailurePaths.set(song.path, Date.now());
          const queueSongs = [...playbackStore.tempQueue, ...playbackStore.playQueue];
          const hasPlayable = queueSongs.some(item => {
            if (recentOnlineFailurePaths.has(item.path)) return false;
            if (!item.path.startsWith('plugin://')) return true;
            const ws = item.path.slice('plugin://'.length);
            const si = ws.indexOf('/');
            if (si < 0) return true;
            return !knownFailedPluginPrefixes.has('plugin://' + ws.slice(0, si + 1));
          });
          if (!hasPlayable) {
            showToast('同步的在线歌曲在此设备上无法播放，请通过插件重新搜索添加', 'error');
            console.warn('[Audio] 队列中无可播放歌曲（所有 plugin:// 均属于已知失败来源），停止');
            try { await playbackApi.stopAudio(); } catch {}
            isPlaying.value = false;
            isSongLoaded.value = false;
            stopPlaybackRuntime();
            return;
          }
          if (alreadyFailedRecently) {
            return;
          }
          handleAutoNext();
          return;
        }
      }
    }

    const requestId = ++playRequestId;
    clearVolumeRestoreTimer();

    cancelledPlayRequestId = -1;
    if (lastHandledOnlineFailure?.path !== song.path) {
      lastHandledOnlineFailure = null;
    }
    pruneRecentOnlineFailurePaths();

    const fadeEnabled = settingsStore.settings.audio.fadeInOutEnabled;
    const fadeDuration = settingsStore.settings.audio.fadeInOutDurationMs;

    const isQualitySwitch = !!options.continueStatisticsSession
      && !!previousSong
      && previousSong.path === song.path;

    let audioFilePath = song.cue_source_path || song.path;
    const isOriginalOnlineSong = audioFilePath.startsWith('lx://') || audioFilePath.startsWith('plugin://');

    const shouldStopPreviousAudioBeforeOnlineResolve = isOriginalOnlineSong
      && isPlaying.value
      && !!previousSong
      && (previousSong.path !== song.path || isQualitySwitch);

    const shouldFadeOnSwitch = fadeEnabled
      && isPlaying.value
      && !!previousSong
      && previousSong.path !== song.path;

    const effectiveFadeDuration = fadeDuration;

    let usingDownloadedAudioFile = false;
    let pluginHeaders: Record<string, string> | null = null;
    let pluginEkey: string | undefined = undefined;
    let pluginCek: string | undefined = undefined;

    currentAvailableQualities.value = null;
    playbackStore.currentPlayingQuality = null;
    playbackStore.currentPlayingAudioUrl = null;
    if (previousSong && previousSong.path !== song.path) {
      playbackStore.sessionQualityOverride = null;
    }

    const onlineAudioPreparationPromise = (async () => {
      let preparedAudioFilePath = audioFilePath;
      let preparedUsingDownloadedAudioFile = false;
      let preparedAvailableQualities: QualityKey[] | null = null;

      if (isOriginalOnlineSong) {
        const downloadedRecord = await checkDownloadExists(preparedAudioFilePath);
        if (downloadedRecord?.filePath) {
          preparedAudioFilePath = downloadedRecord.filePath;
          preparedUsingDownloadedAudioFile = true;
        }
      }

      if (isOriginalOnlineSong && !preparedUsingDownloadedAudioFile) {
        try {
          preparedAvailableQualities = await getOnlineAvailableQualities(preparedAudioFilePath, song);
        } catch { /* ignore: 音质列表获取失败不影响播放 */ }
      }

      if (isOriginalOnlineSong && !preparedUsingDownloadedAudioFile) {
        const requestedQuality = (playbackStore.sessionQualityOverride
          || settingsStore.settings.audio.onlineDefaultQuality || '320k') as QualityKey;
        const fallbackBehavior = settingsStore.settings.audio.onlineQualityFallbackBehavior ?? 'lower';
        const resolvedOnlineAudio = await resolveOnlineAudio({
          audioFilePath: preparedAudioFilePath,
          song,
          requestedQuality,
          fallbackBehavior,
          availableQualities: preparedAvailableQualities,
          preFetchedUrl: song.remote_source_id,
        });
        return {
          audioFilePath: resolvedOnlineAudio.audioFilePath,
          usingDownloadedAudioFile: preparedUsingDownloadedAudioFile,
          availableQualities: preparedAvailableQualities,
          resolvedOnlineAudio,
        };
      }

      return {
        audioFilePath: preparedAudioFilePath,
        usingDownloadedAudioFile: preparedUsingDownloadedAudioFile,
        availableQualities: preparedAvailableQualities,
        resolvedOnlineAudio: null,
      };
    })().catch((error) => {
      console.warn('[Audio] 在线音频预解析失败:', error);
      return {
        audioFilePath,
        usingDownloadedAudioFile: false,
        availableQualities: null,
        resolvedOnlineAudio: null,
      };
    });

    if (shouldFadeOnSwitch) {
      fadeVolumeTo(0, effectiveFadeDuration).catch(() => {});
    } else {
      cancelFade();
    }

    if (requestId !== playRequestId) return;

    flushPlaySession();
    if (shouldStopPreviousAudioBeforeOnlineResolve) {
      try { await playbackApi.stopAudio(); } catch {}
      stopPlaybackRuntime();
      sessionStartTime = null;
      if (requestId !== playRequestId) return;
    }
    if (!options.continueStatisticsSession) {
      accumulatedTime = 0;
      currentPlayCountRecorded = false;
    }
    onBeforePlay?.(song, options);

    const preserveQueue = options.preserveQueue ?? false;
    currentSong.value = song;
    scheduleLyricsPlayerPreload(song);

    if (!preserveQueue) {
      if (options.insertAfterCurrent) {
        playQueue.value = buildQueueWithInsertedSong(song, previousSong, playQueue.value);
      } else {
        const displaySongList = getDisplaySongList();
        if (displaySongList.some(item => item.path === song.path)) {
          const displayPaths = displaySongList.map(s => s.path);
          playbackStore.setQueueFromPaths(displayPaths, displaySongList);
        } else if (!playQueuePaths.value.includes(song.path)) {
          if (playQueuePaths.value.length === 0) {
            playbackStore.setQueueFromPaths([song.path], [song]);
          } else {
            playbackStore.setQueueFromPaths([...playQueuePaths.value, song.path], [song]);
          }
        }
      }
    }


    const retainedFullCoverPaths = prepareDetailFullCovers(song);

    isPlaying.value = true;
    isSongLoaded.value = false;
    const coverLookupPath = song.cue_source_path || song.path;
    const isLxSong = coverLookupPath.startsWith('lx://');
    const cachedCover = peekCoverUrl(coverLookupPath);
    const cachedCoverPath = peekCoverPath(coverLookupPath) || song.cover_thumb_path || '';
    const persistedCover = isLxSong
      ? (song.cover_thumb_path || '')
      : primeCoverPath(coverLookupPath, song.cover_thumb_path);
    const cachedFullCover = getFullCoverUrl(coverLookupPath);
    const immediateCover = cachedCover || persistedCover;
    let displayCover = '';
    if (immediateCover) {
      displayCover = getDisplayCoverUrl(immediateCover, (dataUrl) => {
        if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;
        currentCover.value = dataUrl;
        currentCoverFull.value = dataUrl;
      });
      currentCover.value = displayCover;
      currentCoverPath.value = coverLookupPath;
    }
    currentCoverFull.value = cachedFullCover || displayCover || immediateCover || '';
    preloadPriorityCovers(getLikelyThumbnailPaths(song));
    const currentThumbnailLoad = isLxSong
      ? Promise.resolve([immediateCover || '', cachedCoverPath] as [string, string])
      : Promise.all([loadCover(coverLookupPath), loadCoverPath(coverLookupPath)]);
    void currentThumbnailLoad
      .then(([cover]) => {
        if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
          return;
        }

        const normalizedCover = cover || '';
        if (normalizedCover) {
          currentCover.value = getDisplayCoverUrl(normalizedCover);
          currentCoverPath.value = song.path;
        } else if (!immediateCover) {
          currentCover.value = '';
          currentCoverPath.value = '';
        }
        if (!currentCoverFull.value) {
          currentCoverFull.value = getDisplayCoverUrl(normalizedCover) || '';
        }
      })
      .catch(() => {
        if (requestId !== playRequestId || currentSong.value?.path !== song.path || immediateCover) {
          return;
        }
        currentCover.value = '';
        currentCoverPath.value = '';
      });
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
    let resumeTime = Math.max(0, Math.min(requestedStartTime, song.duration || requestedStartTime));

    stopPlaybackRuntime();
    if (previewClipPath !== song.path) {
      activePreviewClip = null;
      previewClipPath = '';
      previewDetectedPath = '';
      if (isQishuiPluginPath(song.path)) {
        const prewarmTrackId = extractPluginTrackId(song.path);
        if (prewarmTrackId && !hasQishuiPreviewCached(prewarmTrackId)) {
          void fetchQishuiPreviewInfo(prewarmTrackId);
        }
      }
    }
    if (activePreviewClip) {
      resumeTime = Math.max(
        activePreviewClip.start,
        Math.min(resumeTime, activePreviewClip.start + activePreviewClip.duration - 1),
      );
    }
    reanchorPlaybackClock(resumeTime);
    startPlaybackRuntime();
    accumulatedTime = 0;
    sessionStartTime = null;
    lastRawProgress = -1;
    stalledProgressTicks = 0;

    let historyRecordedForRequest = false;
    const recordStartedSongToHistory = () => {
      if (
        historyRecordedForRequest
        || requestId !== playRequestId
        || currentSong.value?.path !== song.path
        || cancelledPlayRequestId === requestId
      ) {
        return;
      }

      historyRecordedForRequest = true;
      scheduleAddToHistory(currentSong.value ?? song);
    };

    const startOffsetMs = cueStartOffset
      + Math.round((resumeTime - (activePreviewClip?.start ?? 0)) * 1000);

    try {
      const preparedOnlineAudio = await onlineAudioPreparationPromise;
      if (requestId !== playRequestId) return;

      audioFilePath = preparedOnlineAudio.audioFilePath;
      usingDownloadedAudioFile = preparedOnlineAudio.usingDownloadedAudioFile;
      currentAvailableQualities.value = preparedOnlineAudio.availableQualities;

      if (!usingDownloadedAudioFile && preparedOnlineAudio.resolvedOnlineAudio) {
        const resolvedOnlineAudio = preparedOnlineAudio.resolvedOnlineAudio;
        const sanitizedAudioFilePath = sanitizeMediaUrl(audioFilePath);
        if (sanitizedAudioFilePath && sanitizedAudioFilePath !== audioFilePath) {
          console.warn('[Audio] 播放前兜底清洗在线 URL:', {
            before: audioFilePath.slice(0, 120),
            after: sanitizedAudioFilePath.slice(0, 120),
          });
          audioFilePath = sanitizedAudioFilePath;
          if (resolvedOnlineAudio.currentPlayingAudioUrl) {
            resolvedOnlineAudio.currentPlayingAudioUrl = sanitizedAudioFilePath;
          }
        }
        if (audioFilePath && !audioFilePath.startsWith('http://') && !audioFilePath.startsWith('https://')) {
          const idx1 = audioFilePath.indexOf('https://');
          const idx2 = audioFilePath.indexOf('http://');
          const idx = idx1 >= 0 ? idx1 : idx2;
          if (idx >= 0) {
            console.warn('[Audio] sanitizeMediaUrl 失败，indexOf 强制提取 URL:', {
              before: audioFilePath.slice(0, 120),
              after: audioFilePath.substring(idx, idx + 120),
            });
            audioFilePath = audioFilePath.substring(idx);
            while (audioFilePath.length > 0) {
              const c = audioFilePath.charCodeAt(audioFilePath.length - 1);
              if (c === 0x2c || c === 0x3b || c === 0x60 || c === 0x27 || c === 0x22 || c <= 0x20) {
                audioFilePath = audioFilePath.substring(0, audioFilePath.length - 1);
              } else break;
            }
            if (resolvedOnlineAudio.currentPlayingAudioUrl) {
              resolvedOnlineAudio.currentPlayingAudioUrl = audioFilePath;
            }
          }
        }
        pluginHeaders = resolvedOnlineAudio.pluginHeaders;
        pluginEkey = resolvedOnlineAudio.ekey;
        pluginCek = resolvedOnlineAudio.cek;
        if (pluginHeaders) {
          song.remote_headers = pluginHeaders;
        }
        if (resolvedOnlineAudio.currentPlayingQuality) {
          playbackStore.currentPlayingQuality = resolvedOnlineAudio.currentPlayingQuality;
        }
        if (resolvedOnlineAudio.currentPlayingAudioUrl) {
          playbackStore.currentPlayingAudioUrl = resolvedOnlineAudio.currentPlayingAudioUrl;
        }
        if (!song.lyrics_raw?.trim() && resolvedOnlineAudio.lyricsRaw) {
          song.lyrics_raw = resolvedOnlineAudio.lyricsRaw;
        }
        if (!song.cover_thumb_path && resolvedOnlineAudio.coverThumbPath) {
          song.cover_thumb_path = resolvedOnlineAudio.coverThumbPath;
          if (requestId === playRequestId && currentSong.value?.path === song.path) {
            const displayCover = getDisplayCoverUrl(resolvedOnlineAudio.coverThumbPath, (dataUrl) => {
              if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;
              currentCover.value = dataUrl;
              currentCoverFull.value = dataUrl;
            });
            currentCover.value = displayCover;
            currentCoverPath.value = song.path;
            currentCoverFull.value = displayCover;
          }
        }
      }

    if (requestId !== playRequestId) return;

    if (!usingDownloadedAudioFile && song.path.startsWith('lx://') && !song.lyrics_raw?.trim()) {
      clearOnlineLyricsUnavailable(song.path);
      void fetchLxSongLyricsRaw(song)
        .then((lyricsRaw) => {
          if (!lyricsRaw) {
            console.warn('[Lyrics] LX 歌词获取返回空:', song.path);
            if (requestId === playRequestId && currentSong.value?.path === song.path) {
              markOnlineLyricsUnavailable(song.path);
            }
            return;
          }
          if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
            return;
          }

          song.lyrics_raw = lyricsRaw;
          libraryStore.patchSongMeta(song.path, { lyrics_raw: lyricsRaw } as Partial<Song>);
          playbackStore.patchQueueSongMeta(song.path, { lyrics_raw: lyricsRaw });
          currentSong.value = {...currentSong.value, lyrics_raw: lyricsRaw};
          void loadLyrics(lyricsRaw);
        })
        .catch(error => {
          console.warn('[Lyrics] LX 在线歌词获取失败:', error);
          if (requestId === playRequestId && currentSong.value?.path === song.path) {
            markOnlineLyricsUnavailable(song.path);
          }
        });
    }

    if (!usingDownloadedAudioFile && song.path.startsWith('plugin://') && !song.lyrics_raw?.trim()) {
      clearOnlineLyricsUnavailable(song.path);
      const pluginSearchResult = song.rawData;
      if (pluginSearchResult?.pluginId) {
        void (async () => {
          try {
            const plugins = getStoredPlugins();
            const pluginSource = plugins.find(p => p.id === pluginSearchResult.pluginId && p.enabled);
            if (!pluginSource) {
              console.warn('[Lyrics] plugin:// 未找到启用的插件:', pluginSearchResult.pluginId);
              if (requestId === playRequestId && currentSong.value?.path === song.path) {
                markOnlineLyricsUnavailable(song.path);
              }
              return;
            }
            const lyricData = await pluginGetLyric(pluginSource, pluginSearchResult);
            if (!lyricData?.lyricsRaw) {
              console.warn('[Lyrics] plugin:// 歌词获取为空:', pluginSource.name);
              if (requestId === playRequestId && currentSong.value?.path === song.path) {
                markOnlineLyricsUnavailable(song.path);
              }
              return;
            }
            if (
              requestId !== playRequestId
              || currentSong.value?.path !== song.path
            ) {
              return;
            }
            song.lyrics_raw = lyricData.lyricsRaw;
            libraryStore.patchSongMeta(song.path, { lyrics_raw: lyricData.lyricsRaw } as Partial<Song>);
            playbackStore.patchQueueSongMeta(song.path, { lyrics_raw: lyricData.lyricsRaw });
            currentSong.value = {...currentSong.value, lyrics_raw: lyricData.lyricsRaw};
            void loadLyrics(lyricData.lyricsRaw);
          } catch (error) {
            console.warn('[Lyrics] plugin:// 在线歌词获取失败:', error);
            if (requestId === playRequestId && currentSong.value?.path === song.path) {
              markOnlineLyricsUnavailable(song.path);
            }
          }
        })();
      } else {
        markOnlineLyricsUnavailable(song.path);
      }
    }
      const flyPromise = consumeFlyCoverPromise();

      const isNetworkAudio = audioFilePath.startsWith('http://') || audioFilePath.startsWith('https://');

      if (!isNetworkAudio && audioFilePath.startsWith('lx://')) {
        console.warn('[Audio] lx:// 直链解析失败（audioFilePath 仍为 lx://）:', {
          path: song.path,
          audioFilePath: audioFilePath.slice(0, 150),
          requestedQuality: (playbackStore.sessionQualityOverride || settingsStore.settings.audio.onlineDefaultQuality || '320k'),
          hasRawData: !!song.rawData,
          hasTypes: !!(song as any)._types || !!(song as any).rawData?._types,
        });
        await handleOnlinePlaybackFailure(song, options, requestId, shouldFadeOnSwitch);
        return;
      }

      if (!isNetworkAudio && isOriginalOnlineSong && !usingDownloadedAudioFile) {
        console.warn('[Audio] 在线插件解析后不是有效 http(s) URL:', {
          originalPath: song.path,
          resolvedPathPrefix: audioFilePath.slice(0, 120),
        });
        const pluginError = getLastPluginError();
        if (pluginError.includes('60 秒试听')) {
          showToast('该音源仅能获取 60 秒试听，已跳过', 'error');
        } else if (pluginError.includes('该音源无法提供此歌曲')) {
          showToast(`${pluginError}，已跳过`, 'error');
        }
        await handleOnlinePlaybackFailure(song, options, requestId, shouldFadeOnSwitch);
        return;
      }

      let actualAudioPath = audioFilePath;
      if (isNetworkAudio && (audioFilePath.includes('.m4s') || audioFilePath.includes('bilivideo.com') || audioFilePath.includes('bilivideo.cn'))) {
        try {
          const m4sHeaders: Record<string, string> = { ...(pluginHeaders ?? {}) };
          const ensureEffectiveHeader = (want: string, value: string): void => {
            const lower = want.toLowerCase();
            let foundKey: string | null = null;
            let foundVal = '';
            for (const [k, v] of Object.entries(m4sHeaders)) {
              if (k.toLowerCase() === lower) {
                foundKey = k;
                foundVal = String(v ?? '');
                break;
              }
            }
            if (!foundKey || !/^https?:\/\//i.test(foundVal)) {
              if (foundKey) delete m4sHeaders[foundKey];
              m4sHeaders[want] = value;
            }
          };
          ensureEffectiveHeader('Referer', 'https://www.bilibili.com');
          ensureEffectiveHeader('Origin', 'https://www.bilibili.com');
          if (!Object.keys(m4sHeaders).some(key => key.toLowerCase() === 'cookie')) {
            const bilibiliCookies = await getPluginBilibiliCookies();
            if (bilibiliCookies) {
              m4sHeaders.Cookie = bilibiliCookies;
            }
          }
          const tempPath = await pluginApi.downloadAudioToTemp(audioFilePath, m4sHeaders);
          if (tempPath) {
            actualAudioPath = tempPath;
          }
        } catch (error) {
          console.warn('[Audio] m4s 下载到临时文件失败:', getErrorMessage(error));
        }
      }

      const isM4sLocal = actualAudioPath !== audioFilePath;

      const finishRustPlaybackStart = () => {
        isSongLoaded.value = true;
        startStatisticsSession();
        loadLyrics();
        reanchorPlaybackClock(resumeTime);
        recordStartedSongToHistory();

        void currentThumbnailLoad
          .then(async ([cover, coverPath]) => {
            if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
              return;
            }

            const normalizedCover = cover || '';
            const normalizedCoverPath = coverPath || '';
            if (normalizedCover) {
              currentCover.value = getDisplayCoverUrl(normalizedCover);
            } else if (!immediateCover) {
              currentCover.value = '';
            }
            if (!currentCoverFull.value) {
              currentCoverFull.value = getDisplayCoverUrl(normalizedCover) || '';
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
      };

      const tryPlayOnlineViaRust = async (): Promise<boolean> => {
        const audioPathStr = String(audioFilePath == null ? '' : audioFilePath);
        const finalAudioPath = sanitizeMediaUrl(audioPathStr)
          || audioPathStr.replace(/^[`'"\s]+|[`'"\s]+$/g, '')
          || audioPathStr;

        if (dlnaCast.isCasting) {
          try {
            await dlnaCast.castFromPlayAudio({
              path: finalAudioPath,
              title: getSmtcTitle(song),
              artist: song.artist || 'Unknown Artist',
              album: song.album || 'Unknown Album',
              cover: peekCoverUrl(song.path) || '',
              duration: Math.floor(song.duration),
              headers: pluginHeaders,
              startOffsetMs: startOffsetMs || undefined,
            });
            return true;
          } catch (error) {
            console.warn('[Audio] 投屏 castSetUri 失败:', getErrorMessage(error));
            return false;
          }
        }

        try {
          await playbackApi.playAudio({
            path: finalAudioPath,
            title: getSmtcTitle(song),
            artist: song.artist || 'Unknown Artist',
            album: song.album || 'Unknown Album',
            cover: cachedCoverPath,
            duration: Math.floor(song.duration),
            outputMode: settingsStore.settings.audio.outputMode,
            startOffsetMs: startOffsetMs || undefined,
            songId: song.id ?? undefined,
            volumeBalanceEnabled: settingsStore.settings.audio.volumeBalance?.enabled,
            gainOffsetDb: settingsStore.settings.audio.volumeBalance?.gainOffsetDb,
            preventClipping: settingsStore.settings.audio.volumeBalance?.preventClipping,
            headers: pluginHeaders,
            ekey: pluginEkey,
            cek: pluginCek,
            dsdNativePassthrough: settingsStore.settings.audio.dsdNativePassthrough,
            outputBitPerfect: settingsStore.settings.audio.outputBitPerfect,
          });
        } catch (error) {
          console.warn('[Audio] 在线直链 playAudio 调用失败:', getErrorMessage(error));
          return false;
        }

        const READY_TIMEOUT_MS = 20000;
        const PROBE_INTERVAL_MS = 200;
        const probeStart = Date.now();
        let ready = false;
        while (Date.now() - probeStart < READY_TIMEOUT_MS) {
          if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
            return true;
          }
          try {
            const failInfo = await playbackApi.getPlaybackStartFailedInfo();
            if (failInfo.failed) {
              console.warn('[Audio] 在线直链走 Rust 起播失败（后端报错）:', failInfo.reason ?? '(无详细原因)');
              return false;
            }
          } catch (e) {
            console.warn('[Audio] 起播失败探测命令异常（忽略，继续探测 ready）:', e);
          }
          try {
            if (!ready) {
              ready = await playbackApi.getPlaybackReady();
            }
            if (ready) {
              return true;
            }
          } catch { /* ignore, keep probing */ }
          await new Promise(resolve => setTimeout(resolve, PROBE_INTERVAL_MS));
        }

        console.warn('[Audio] 在线直链走 Rust 起播探测失败（未就绪）');
        return false;
      };

      if (isNetworkAudio && !isM4sLocal) {

        if (flyPromise) {
          await Promise.race([
            flyPromise,
            new Promise<void>(resolve => setTimeout(resolve, 1200)),
          ]);
          if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;
          if (cancelledPlayRequestId === requestId) {
            isPlaying.value = false;
            isSongLoaded.value = false;
            stopPlaybackRuntime();
            loadLyrics();
            return;
          }
        }

        const rustOk = await tryPlayOnlineViaRust();
        if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

        if (cancelledPlayRequestId === requestId) {
          try { await playbackApi.stopAudio(); } catch {}
          if (shouldFadeOnSwitch) {
            currentBackendVolume = playbackStore.volume / 100;
            void playbackApi.setVolume(currentBackendVolume).catch(() => {});
          }
          isPlaying.value = false;
          isSongLoaded.value = false;
          stopPlaybackRuntime();
          return;
        }

        if (rustOk) {
          if (shouldFadeOnSwitch) {
            currentBackendVolume = 0;
            try { await playbackApi.setVolume(0); } catch {}
            finishRustPlaybackStart();
            void fadeVolumeTo(playbackStore.volume / 100, effectiveFadeDuration, 0);
          } else {
            currentBackendVolume = playbackStore.volume / 100;
            try { await playbackApi.setVolume(currentBackendVolume); } catch {}
            finishRustPlaybackStart();
          }
          scheduleOnlinePrecache(
            settingsStore.settings.audio.onlineDefaultQuality || '320k',
            settingsStore.settings.audio.onlineQualityFallbackBehavior ?? 'lower',
          );
        } else {
          console.warn('[Audio] Rust 起播失败（tryPlayOnlineViaRust=false）:', {
            path: song.path,
            audioFilePath: audioFilePath.slice(0, 150),
          });
          await handleOnlinePlaybackFailure(song, options, requestId, shouldFadeOnSwitch);
          return;
        }
      } else {

        const playBeforeFlyCover = !!flyPromise;

        const localPlayAudioParams = {
          path: actualAudioPath,
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
          dsdNativePassthrough: settingsStore.settings.audio.dsdNativePassthrough,
          outputBitPerfect: settingsStore.settings.audio.outputBitPerfect,
        };

        if (playBeforeFlyCover) {
          if (dlnaCast.isCasting) {
            await dlnaCast.castFromPlayAudio({
              path: localPlayAudioParams.path,
              title: localPlayAudioParams.title,
              artist: localPlayAudioParams.artist,
              album: localPlayAudioParams.album,
              cover: localPlayAudioParams.cover,
              duration: localPlayAudioParams.duration,
              startOffsetMs: localPlayAudioParams.startOffsetMs,
            });
          } else {
            await playbackApi.playAudio(localPlayAudioParams);
          }
          if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

          if (cancelledPlayRequestId === requestId) {
            isSongLoaded.value = true;
            isPlaying.value = false;
            stopPlaybackRuntime();
            try { await playbackApi.pauseAudio(); } catch {}
            loadLyrics();
            return;
          }
        }

        if (flyPromise) {
          await Promise.race([
            flyPromise,
            new Promise<void>(resolve => setTimeout(resolve, 1200)),
          ]);
          if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;
          if (cancelledPlayRequestId === requestId) {
            if (playBeforeFlyCover) {
              isSongLoaded.value = true;
              try { await playbackApi.pauseAudio(); } catch {}
            } else {
              isSongLoaded.value = false;
            }
            isPlaying.value = false;
            stopPlaybackRuntime();
            loadLyrics();
            return;
          }
        }

        if (!playBeforeFlyCover) {
          if (dlnaCast.isCasting) {
            await dlnaCast.castFromPlayAudio({
              path: localPlayAudioParams.path,
              title: localPlayAudioParams.title,
              artist: localPlayAudioParams.artist,
              album: localPlayAudioParams.album,
              cover: localPlayAudioParams.cover,
              duration: localPlayAudioParams.duration,
              startOffsetMs: localPlayAudioParams.startOffsetMs,
            });
          } else {
            await playbackApi.playAudio(localPlayAudioParams);
          }
          if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

          if (cancelledPlayRequestId === requestId) {
            isSongLoaded.value = true;
            isPlaying.value = false;
            stopPlaybackRuntime();
            try { await playbackApi.pauseAudio(); } catch {}
            loadLyrics();
            return;
          }
        }

        isSongLoaded.value = true;
        startStatisticsSession();
        loadLyrics();
        startPlaybackRuntime();
        recordStartedSongToHistory();

        if (shouldFadeOnSwitch) {
          if (!playBeforeFlyCover) {
            currentBackendVolume = 0;
            try { await playbackApi.setVolume(0); } catch {}
          }
          void fadeVolumeTo(playbackStore.volume / 100, effectiveFadeDuration, 0);
        } else {
          currentBackendVolume = playbackStore.volume / 100;
          void playbackApi.setVolume(currentBackendVolume).catch(() => {});
        }

        void currentThumbnailLoad
          .then(async ([cover, coverPath]) => {
            if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
              return;
            }

            const normalizedCover = cover || '';
            const normalizedCoverPath = coverPath || '';
            if (normalizedCover) {
              currentCover.value = getDisplayCoverUrl(normalizedCover);
            } else if (!immediateCover) {
              currentCover.value = '';
            }
            if (!currentCoverFull.value) {
              currentCoverFull.value = getDisplayCoverUrl(normalizedCover) || '';
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
      }
    } catch {
      if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

      if (shouldFadeOnSwitch) {
        currentBackendVolume = playbackStore.volume / 100;
        void playbackApi.setVolume(currentBackendVolume).catch(() => {});
      }
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

    flushPlaySession();

    if (!isSongLoaded.value) {
      cancelledPlayRequestId = playRequestId;
    }

    const fadeEnabled = settingsStore.settings.audio.fadeInOutEnabled;
    const fadeDuration = settingsStore.settings.audio.fadeInOutDurationMs;
    if (fadeEnabled && isPlaying.value && isSongLoaded.value) {
      await fadeVolumeTo(0, fadeDuration);
    }

    isPlaying.value = false;
    if (dlnaCast.isCasting) {
      await dlnaCast.castPause();
    } else {
      await playbackApi.pauseAudio();
    }
    stopPlaybackRuntime();

    if (fadeEnabled) {
      const restoreVol = playbackStore.volume / 100;
      scheduleBackendVolumeRestore(restoreVol);
    }
  };

  const togglePlay = async () => {
    if (!currentSong.value) return;

    const fadeEnabled = settingsStore.settings.audio.fadeInOutEnabled;
    const fadeDuration = settingsStore.settings.audio.fadeInOutDurationMs;

    const wasPlaying = isPlaying.value;
    isPlaying.value = !wasPlaying;
    const myToken = ++togglePlayToken;

    if (wasPlaying) {
      // === 暂停分支 ===
      if (sessionStartTime) {
        accumulatedTime += (Date.now() - sessionStartTime) / 1000;
        sessionStartTime = null;
      }

      flushPlaySession();

      if (!isSongLoaded.value) {
        cancelledPlayRequestId = playRequestId;
      }

      if (fadeEnabled && isSongLoaded.value) {
        await fadeVolumeTo(0, fadeDuration);
        if (myToken !== togglePlayToken) return;
      }

      await (dlnaCast.isCasting ? dlnaCast.castPause() : playbackApi.pauseAudio());
      if (myToken !== togglePlayToken) return;
      stopPlaybackRuntime();

      if (fadeEnabled) {
        const restoreVol = playbackStore.volume / 100;
        scheduleBackendVolumeRestore(restoreVol, () => myToken === togglePlayToken);
      }
      return;
    }

    // === 播放分支 ===
    cancelFade();
    clearVolumeRestoreTimer();
    cancelledPlayRequestId = -1;

    if (!isSongLoaded.value) {
      await playSong(currentSong.value, {
        startTime: currentTime.value,
        continueStatisticsSession: true,
      });
      return;
    }

    if (fadeEnabled) {
      const targetVol = playbackStore.volume / 100;
      const startVol = currentBackendVolume < targetVol - 0.01
        ? currentBackendVolume
        : 0;
      if (startVol === 0) {
        currentBackendVolume = 0;
        try { await playbackApi.setVolume(0); } catch {}
      }
      if (myToken !== togglePlayToken) return;
      await (dlnaCast.isCasting ? dlnaCast.castPlay() : playbackApi.resumeAudio());
      startStatisticsSession();
      startPlaybackRuntime();
      void fadeVolumeTo(targetVol, fadeDuration, startVol);
    } else {
      await (dlnaCast.isCasting ? dlnaCast.castPlay() : playbackApi.resumeAudio());
      startStatisticsSession();
      startPlaybackRuntime();
    }
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
    let targetTime = trackDuration > 0
      ? Math.max(0, Math.min(newTime, trackDuration))
      : Math.max(0, newTime);
    if (activePreviewClip) {
      targetTime = Math.max(
        activePreviewClip.start,
        Math.min(targetTime, activePreviewClip.start + activePreviewClip.duration - 0.5),
      );
    }
    const requestId = ++latestSeekRequestId;
    reanchorPlaybackClock(targetTime);

    try {
      const offsetSec = (currentSong.value.cue_start_offset || 0) / 1000;
      const seekClipTime = targetTime + offsetSec - (activePreviewClip?.start ?? 0);
      if (dlnaCast.isCasting) {
        await dlnaCast.castSeek(Math.max(0, seekClipTime));
        isSeeking = false;
      } else {
        await playbackApi.seekAudio({
          time: Math.max(0, seekClipTime),
          isPlaying: isPlaying.value,
          requestId,
        });
      }
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
      setManagedTimeout(() => {
        if (!isPlaying.value) {
          void togglePlay().catch(error => console.warn('[Audio] playAt togglePlay failed:', error));
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
    const trackTime = Math.max(0, payload.time - offsetSec + (activePreviewClip?.start ?? 0));
    reanchorPlaybackClock(trackTime);
  };

  const dispose = () => {
    stopPlaybackRuntime();
    cancelFade();
    clearVolumeRestoreTimer();
    clearManagedShortTimers();
    progressUnlisten = null;
    progressListeningActive = false;
    deviceStatusUnlisten?.();
    deviceStatusUnlisten = null;
    volumeValidityWatcher?.();
    volumeValidityWatcher = null;
    currentBackendVolume = playbackStore.volume / 100;
    togglePlayToken += 1;
    playRequestId += 1;
    cancelledPlayRequestId = -1;
    lastHandledOnlineFailure = null;
    recentOnlineFailurePaths.clear();
    knownFailedPluginPrefixes.clear();
    latestSeekRequestId += 1;
    playbackAnchorTime = 0;
    playbackStartOffset = 0;
    sessionStartTime = null;
    accumulatedTime = 0;
    currentPlayCountRecorded = false;
    isSeeking = false;
    lastRawProgress = -1;
    stalledProgressTicks = 0;
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
