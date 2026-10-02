import {storeToRefs} from 'pinia';
import {watch} from 'vue';
import type {QualityKey, Song} from '../../types';
import {playbackApi} from '../../services/tauri/playbackApi';
import {useDlnaCastStore} from './castStore';
import {usePlaybackStore} from './store';
import {useSettingsStore} from '../settings/store';
import {useLibraryStore} from '../library/store';
import {useUiStore} from '../../shared/stores/ui';
import {useCoverCache} from '../../composables/useCoverCache';
import {useRenderingPower} from '../../composables/renderingPower';
import {useToast} from '../../composables/toast';
import {listen} from '@tauri-apps/api/event';
import {reportUserBehavior} from '../../services/domain/usageStats';
import {useAuthStore} from '../auth/store';
import {preloadAmlLyricPlayer} from '../../components/player/amlLyricPlayerLoader';
import {consumeFlyCoverPromise} from '../../composables/useFlyingCover';
import {getLastPluginError} from '../../services/domain/pluginEngine';
import {prepareOnlinePlayback} from './onlinePlaybackFacade';
import {scheduleOnlinePrecache} from './onlinePrecache';
import {sanitizeMediaUrl} from '../../utils/mediaUrl';
import {getDisplayCoverUrl} from '../../utils/coverProxy';
import {createPlaybackRuntime} from './playbackRuntime';
import {createPlaybackVolumeController} from './playbackVolume';
import {createPlaybackStatistics} from './playbackStatistics';
import {prepareAudioTransfer} from './audioTransferPreparation';
import {createOnlineLyricsLoader, looksWordLevel} from './onlineLyricsLoader';
import {createOnlinePlaybackFailureController} from './onlinePlaybackFailure';
import type {PlaySongOptions} from './playerPlaybackTypes';
import {
  fetchQishuiPreviewInfo,
  hasQishuiPreviewCached,
  isQishuiPluginPath,
  extractPluginTrackId,
} from './onlineFailover';
import {likelyFullCoverPaths, likelyThumbnailPaths} from './coverState';
import {createPlaybackTimers} from './playbackTimers';
import {createPreviewPlayback} from './previewPlayback';
import {createPlaybackSeek} from './playbackSeek';

interface CreatePlayerPlaybackDeps {
  getDisplaySongList: () => Song[];
  addToHistory: (song: Song) => void | Promise<void>;
  loadLyrics: (overrideLyricsRaw?: string) => void | Promise<void>;
  handleAutoNext: () => void;
  onBeforePlay?: (song: Song, options: PlaySongOptions) => void;
}

let togglePlayToken = 0;
let playRequestId = 0;
let cancelledPlayRequestId = -1;
// 最近一次在线 Rust 起播上下文：后端流下载中途失败事件（online-stream-failed）用它定位当前歌曲并触发换源
let onlineStreamFailureCtx: {
  url: string;
  song: Song;
  options: PlaySongOptions;
  requestId: number;
} | null = null;
let shareLinkPlaybackActive = false;
const getSmtcTitle = (song: Song) => song.title?.trim() || song.name.replace(/\.[^/.]+$/, '');
const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

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
    volume,
    playQueue,
    playQueuePaths,
    playMode,
    tempQueue,
    tempQueuePaths,
    currentAvailableQualities,
  } = storeToRefs(playbackStore);
  const { showPlayerDetail } = storeToRefs(uiStore);

  const {
    setManagedTimeout,
    clearManagedTimeout,
    clearManagedShortTimers,
  } = createPlaybackTimers();

  let playbackRuntimeController = undefined as unknown as ReturnType<typeof createPlaybackRuntime>;
  let playbackVolumeController = undefined as unknown as ReturnType<typeof createPlaybackVolumeController>;
  let playbackStatisticsController = undefined as unknown as ReturnType<typeof createPlaybackStatistics>;
  let onlineLyricsLoader = undefined as unknown as ReturnType<typeof createOnlineLyricsLoader>;
  let onlinePlaybackFailureController = undefined as unknown as ReturnType<typeof createOnlinePlaybackFailureController>;

  const clearVolumeRestoreTimer = () => playbackVolumeController?.clearRestoreTimer();
  const scheduleBackendVolumeRestore = (restoreVol: number, shouldRestore?: () => boolean) => {
    playbackVolumeController?.scheduleBackendRestore(restoreVol, shouldRestore);
  };
  const getCurrentBackendVolume = () => playbackVolumeController?.getCurrentVolume() ?? playbackStore.volume / 100;
  const setCurrentBackendVolume = (value: number) => playbackVolumeController?.setCurrentVolume(value);

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

  const stopPlaybackRuntime = () => playbackRuntimeController?.stop();
  const startPlaybackRuntime = () => playbackRuntimeController?.start();
  const resetPlaybackProgressTracking = () => playbackRuntimeController?.resetProgressTracking();
  const reanchorPlaybackClock = (time: number) => playbackRuntimeController?.reanchor(time);

  const cancelFade = () => playbackVolumeController?.cancelFade();
  const fadeVolumeTo = (targetVolume: number, durationMs: number, startVolumeOverride?: number) =>
    playbackVolumeController?.fadeTo(targetVolume, durationMs, startVolumeOverride) ?? Promise.resolve();

  const previewPlayback = createPreviewPlayback({
    getCurrentSong: () => currentSong.value,
    getCurrentTime: () => currentTime.value,
    reanchorPlaybackClock,
    patchCurrentSong: (song) => { currentSong.value = song; },
    patchQueueSongMeta: (path, patch) => playbackStore.patchQueueSongMeta(path, patch),
    showToast: (message, type) => showToast(message, type),
  });
  const {
    getActivePreviewClip,
    setActivePreviewClip,
    getPreviewPath,
    setPreviewPath,
    getPreviewDetectedPath,
    setPreviewDetectedPath,
    handlePreviewClipDetected,
  } = previewPlayback;

  const seek = createPlaybackSeek({
    getCurrentSong: () => currentSong.value,
    getCurrentTime: () => currentTime.value,
    isPlaying: () => isPlaying.value,
    isCasting: () => dlnaCast.isCasting,
    castSeek: (time) => dlnaCast.castSeek(time),
    seekAudio: (payload) => playbackApi.seekAudio(payload),
    accumulateForSeek: () => playbackStatisticsController.accumulateForSeek(),
    stopPlaybackRuntime,
    startPlaybackRuntime,
    reanchorPlaybackClock,
    getActivePreviewClip,
    setManagedTimeout,
    togglePlay: () => togglePlay(),
  });
  const {
    seekTo,
    playAt,
    handleSeek,
    stepSeek,
    handleSeekCompleted,
  } = seek;

  const flushPlaySession = () => playbackStatisticsController?.flush();
  const startStatisticsSession = () => playbackStatisticsController?.startSession();

  const preflightKnownFailedPlugin = (song: Song) =>
    onlinePlaybackFailureController?.preflightKnownFailedPlugin(song) ?? false;

  const handleOnlinePlaybackFailure = async (
    song: Song,
    options: PlaySongOptions,
    requestId: number,
    shouldFade: boolean | null,
  ) => {
    await onlinePlaybackFailureController?.handleFailure(song, options, requestId, shouldFade);
    if (shouldFade) setCurrentBackendVolume(playbackStore.volume / 100);
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
      const preflightResult = preflightKnownFailedPlugin(song);
      if (preflightResult instanceof Promise ? await preflightResult : preflightResult) return;
    }

    const requestId = ++playRequestId;
    clearVolumeRestoreTimer();

    cancelledPlayRequestId = -1;
    const fadeEnabled = settingsStore.settings.audio.fadeInOutEnabled;
    const fadeDuration = settingsStore.settings.audio.fadeInOutDurationMs;

    const isQualitySwitch = !!options.continueStatisticsSession
      && !!previousSong
      && previousSong.path === song.path;

    let audioFilePath = song.cue_source_path || song.path;
    const isOriginalOnlineSong = audioFilePath.startsWith('lx://') || audioFilePath.startsWith('plugin://');

    const shouldStopPreviousAudioBeforeOnlineResolve = isOriginalOnlineSong
      && (isPlaying.value || playbackStore.isPlaying)
      && (previousSong?.path !== song.path || isQualitySwitch);

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

    // 歌词链独立于音源解析并行发起（而非等音频 resolve 后再跑），在线歌词往往比音频多
    // 次后端往返（am lyricBoth/lyricWord），串行会进一步拉大「歌词晚到」的差距。
    // 必须定义在音源解析分支之外——音源解析失败时歌词链路仍需独立可用。
    // 与音频解析并行发起，不等音频 resolve。
    void onlineLyricsLoader?.loadForSong(song, requestId);

    const previousAudioStopPromise = shouldStopPreviousAudioBeforeOnlineResolve
      ? playbackApi.stopAudio().then(() => {}).catch(() => {})
      : null;
    if (shouldStopPreviousAudioBeforeOnlineResolve) {
      stopPlaybackRuntime();
    }

    const onlineAudioPreparationPromise = prepareOnlinePlayback({
      audioFilePath,
      song,
      requestedQuality: (playbackStore.sessionQualityOverride
        || settingsStore.settings.audio.onlineDefaultQuality || '320k') as QualityKey,
      fallbackBehavior: settingsStore.settings.audio.onlineQualityFallbackBehavior ?? 'lower',
      preFetchedUrl: song.remote_source_id,
    }).catch((error) => {
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
    if (previousAudioStopPromise) {
      await previousAudioStopPromise;
      if (requestId !== playRequestId) return;
    }
    if (!options.continueStatisticsSession) {
      playbackStatisticsController.reset();
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
          currentCover.value = getDisplayCoverUrl(normalizedCover); // 实现
          currentCoverPath.value = song.path;
        } else if (!immediateCover) {
          currentCover.value = '';
          currentCoverPath.value = '';
        }
        if (!currentCoverFull.value) {
          currentCoverFull.value = getDisplayCoverUrl(normalizedCover) || ''; // 实现
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
    if (getPreviewPath() !== song.path) {
      setActivePreviewClip(null);
      setPreviewPath('');
      setPreviewDetectedPath('');
      if (isQishuiPluginPath(song.path)) {
        const prewarmTrackId = extractPluginTrackId(song.path);
        if (prewarmTrackId && !hasQishuiPreviewCached(prewarmTrackId)) {
          void fetchQishuiPreviewInfo(prewarmTrackId);
        }
      }
    }
    const activeClip = getActivePreviewClip();
    if (activeClip) {
      resumeTime = Math.max(
        activeClip.start,
        Math.min(resumeTime, activeClip.start + activeClip.duration - 1),
      );
    }
    reanchorPlaybackClock(resumeTime);
    resetPlaybackProgressTracking();
    startPlaybackRuntime();

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
      + Math.round((resumeTime - (activeClip?.start ?? 0)) * 1000);

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
        if (pluginHeaders) { // 实现
          song.remote_headers = pluginHeaders; // 实现
        }
        if (resolvedOnlineAudio.currentPlayingQuality) {
          playbackStore.currentPlayingQuality = resolvedOnlineAudio.currentPlayingQuality;
        }
        if (resolvedOnlineAudio.currentPlayingAudioUrl) {
          playbackStore.currentPlayingAudioUrl = resolvedOnlineAudio.currentPlayingAudioUrl;
        }
        // 同 getLyric 链：旧数据为逐行而新数据含词级（尖括号或 QRC XML）时升级覆盖
        if (resolvedOnlineAudio.lyricsRaw
          && (!song.lyrics_raw?.trim()
            || (!looksWordLevel(song.lyrics_raw) && looksWordLevel(resolvedOnlineAudio.lyricsRaw)))) {
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

      const preparedAudioTransfer = await prepareAudioTransfer(audioFilePath, pluginHeaders);
      const actualAudioPath = preparedAudioTransfer.audioPath;

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
            if (normalizedCover) { // 实现
              currentCover.value = getDisplayCoverUrl(normalizedCover); // 实现
            } else if (!immediateCover) {
              currentCover.value = '';
            }
            if (!currentCoverFull.value) {
              currentCoverFull.value = getDisplayCoverUrl(normalizedCover) || ''; // 实现
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
              // 本地歌用磁盘缩略图路径（peekCoverUrl 是 UI loopback 地址，
              // Rust 端自抓会拿空导致渲染端封面 0 字节）
              cover: dlnaCast.castCoverSource(song.path) || (song.cover_thumb_path || '').trim(),
              duration: Math.floor(song.duration),
              headers: pluginHeaders,
              startOffsetMs: startOffsetMs || undefined,
              lyrics: song.lyrics_raw ?? '',
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
          onlineStreamFailureCtx = { url: finalAudioPath, song, options, requestId };
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
            setCurrentBackendVolume(playbackStore.volume / 100);
            void playbackApi.setVolume(getCurrentBackendVolume()).catch(() => {});
          }
          isPlaying.value = false;
          isSongLoaded.value = false;
          stopPlaybackRuntime();
          return;
        }

        if (rustOk) {
          if (shouldFadeOnSwitch) {
            setCurrentBackendVolume(0);
            try { await playbackApi.setVolume(0); } catch {}
            finishRustPlaybackStart();
            void fadeVolumeTo(playbackStore.volume / 100, effectiveFadeDuration, 0);
          } else {
            setCurrentBackendVolume(playbackStore.volume / 100);
            try { await playbackApi.setVolume(getCurrentBackendVolume()); } catch {}
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
              lyrics: song.lyrics_raw ?? '',
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
              lyrics: song.lyrics_raw ?? '',
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
            setCurrentBackendVolume(0);
            try { await playbackApi.setVolume(0); } catch {}
          }
          void fadeVolumeTo(playbackStore.volume / 100, effectiveFadeDuration, 0);
        } else {
          setCurrentBackendVolume(playbackStore.volume / 100);
          void playbackApi.setVolume(getCurrentBackendVolume()).catch(() => {});
        }

        void currentThumbnailLoad
          .then(async ([cover, coverPath]) => {
            if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
              return;
            }

            const normalizedCover = cover || '';
            const normalizedCoverPath = coverPath || '';
            if (normalizedCover) { // 实现
              currentCover.value = getDisplayCoverUrl(normalizedCover); // 实现
            } else if (!immediateCover) {
              currentCover.value = '';
            }
            if (!currentCoverFull.value) {
              currentCoverFull.value = getDisplayCoverUrl(normalizedCover) || ''; // 实现
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
        setCurrentBackendVolume(playbackStore.volume / 100);
        void playbackApi.setVolume(getCurrentBackendVolume()).catch(() => {});
      }
      isPlaying.value = false;
      isSongLoaded.value = false;
      playbackStatisticsController.pauseSession();
      stopPlaybackRuntime();
    }
  };

  playbackVolumeController = createPlaybackVolumeController({
    setBackendVolume: (nextVolume) => playbackApi.setVolume(nextVolume),
    setManagedTimeout,
    clearManagedTimeout,
  });

  playbackStatisticsController = createPlaybackStatistics({
    volume,
    isPlaying,
    getCurrentSong: () => currentSong.value,
    getUser: () => authStore.user,
    setActiveOutputMode: (mode) => { playbackStore.activeOutputMode = mode; },
    reportBehavior: (payload) => reportUserBehavior(payload as unknown as Parameters<typeof reportUserBehavior>[0]),
    recordPlay: (payload) => playbackApi.recordPlay(payload),
    getTitle: getSmtcTitle,
    getCurrentTime: () => currentTime.value,
    getOutputDevice: () => playbackApi.getCurrentOutputDevice(),
  });

  onlineLyricsLoader = createOnlineLyricsLoader({
    getCurrentSong: () => currentSong.value,
    setCurrentSong: (nextSong) => { currentSong.value = nextSong; },
    patchSongMeta: (path, patch) => libraryStore.patchSongMeta(path, patch),
    patchQueueSongMeta: (path, patch) => playbackStore.patchQueueSongMeta(path, patch),
    loadLyrics,
    isCurrentRequest: (nextSong, requestId) => requestId === playRequestId && currentSong.value?.path === nextSong.path,
  });

  playbackRuntimeController = createPlaybackRuntime({
    currentSong,
    currentTime,
    isPlaying,
    isSongLoaded,
    isMainWindowLowPower,
    isSeeking: seek.isSeeking,
    isCasting: () => dlnaCast.isCasting,
    getCastPosition: () => dlnaCast.interpolatedPosition(),
    getCastDuration: () => dlnaCast.tvDuration,
    patchSongDuration: (targetSong, duration) => {
      currentSong.value = {...targetSong, duration};
      libraryStore.patchSongMeta(targetSong.path, {duration} as Partial<Song>);
      playbackStore.patchQueueSongMeta(targetSong.path, {duration});
    },
    getActivePreviewClip,
    setActivePreviewClip,
    getPreviewPath,
    setPreviewPath,
    getPreviewDetectedPath,
    setPreviewDetectedPath,
    onPreviewDetected: handlePreviewClipDetected,
    onAutoNext: handleAutoNext,
    flushStatistics: flushPlaySession,
    startStatisticsSession,
  });

  onlinePlaybackFailureController = createOnlinePlaybackFailureController({
    playbackApi: {
      stopAudio: () => playbackApi.stopAudio(),
      setVolume: (nextVolume) => playbackApi.setVolume(nextVolume),
    },
    playbackStore,
    settingsStore,
    getCurrentSong: () => currentSong.value,
    setIsPlaying: (playing) => { isPlaying.value = playing; },
    setIsSongLoaded: (loaded) => { isSongLoaded.value = loaded; },
    stopPlaybackRuntime,
    showToast: (message, type) => showToast(message, type as 'success' | 'error' | 'info' | undefined),
    handleAutoNext,
    playSong,
    getPlayRequestId: () => playRequestId,
    isShareLinkPlaybackActive: () => shareLinkPlaybackActive,
  });

  // 在线音频流播放中途下载失败：后端通常表现为自然播完，这里显式接管换源。
  listen<{url: string; reason?: string}>('online-stream-failed', async (event) => {
    const ctx = onlineStreamFailureCtx;
    if (!ctx || !currentSong.value || !isPlaying.value) return;
    if (currentSong.value.path !== ctx.song.path) return;
    const failUrl = String(event.payload.url || '');
    if (failUrl !== ctx.url && sanitizeMediaUrl(failUrl) !== sanitizeMediaUrl(ctx.url)) return;
    onlineStreamFailureCtx = null;
    console.warn(`[Audio] 在线音频流播放中断，尝试自动换源: ${event.payload.reason || '未知原因'}`);
    await handleOnlinePlaybackFailure(ctx.song, ctx.options, ctx.requestId, false);
  }).catch(() => {});

  const pauseSong = async () => {
    playbackStatisticsController.pauseSession();
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
      playbackStatisticsController.pauseSession();
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
      const currentVolume = getCurrentBackendVolume();
      const startVol = currentVolume < targetVol - 0.01
        ? currentVolume
        : 0;
      if (startVol === 0) {
        setCurrentBackendVolume(0);
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

  const dispose = () => {
    playbackRuntimeController.dispose();
    playbackVolumeController.dispose();
    playbackStatisticsController.dispose();
    onlinePlaybackFailureController.reset();
    stopPlaybackRuntime();
    cancelFade();
    clearVolumeRestoreTimer();
    clearManagedShortTimers();
    onlineStreamFailureCtx = null;
    togglePlayToken += 1;
    playRequestId += 1;
    cancelledPlayRequestId = -1;
    seek.invalidateSeek();
    stopPowerModeWatcher();
  };

  const stopPowerModeWatcher = watch(isMainWindowLowPower, () => {
    if (currentSong.value && isPlaying.value && !seek.isSeeking()) {
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
