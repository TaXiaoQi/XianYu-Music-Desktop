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
import {getLastCloudResolveError} from './cloudPlaybackResolver';
import {lookupCloudMeta} from './cloudHeadMeta';
import {scheduleOnlinePrecache} from './onlinePrecache';
import {sanitizeMediaUrl} from '../../utils/mediaUrl';
import {getDisplayCoverUrl, resolveLocalCoverDataUrl} from '../../utils/coverProxy';
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
import {createPlaybackTimers} from './playbackTimers';
import {createPreviewPlayback} from './previewPlayback';
import {createPlaybackSeek} from './playbackSeek';
import type {PeekedNextSource, PeekedNextTrack} from './playerQueue';
import {
  buildQueueWithInsertedSong as buildQueueWithInsertedSongPure,
  clampResumeTimeToPreviewClip,
  getErrorMessage,
  getSmtcTitle,
  isOriginalOnlinePath,
  isQualitySwitchRequest,
  isSameCurrentlyPlayingSong as isSameCurrentlyPlayingSongPure,
  isStaleRequest,
  shouldFadeOnSwitch as shouldFadeOnSwitchPure,
  shouldStopPreviousAudioBeforeOnlineResolve as shouldStopPreviousAudioBeforeOnlineResolvePure,
} from './playbackPlaySongSupport';
import {createPreloadScheduling} from './playbackPreloadScheduling';
import {createCoverPreparation} from './playbackCoverPreparation';

interface CreatePlayerPlaybackDeps {
  getDisplaySongList: () => Song[];
  addToHistory: (song: Song) => void | Promise<void>;
  loadLyrics: (overrideLyricsRaw?: string) => void | Promise<void>;
  handleAutoNext: () => void;
  /** 无缝预拼接：队列侧「下一首」解析（不推进队列） */
  peekNextTrack?: () => PeekedNextTrack | null;
  /** 无缝拼接切换生效后按来源分支推进队列 */
  advanceQueueForSplicedSong?: (song: Song, source: PeekedNextSource) => void;
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

export const createPlayerPlayback = ({
  getDisplaySongList,
  addToHistory,
  loadLyrics,
  handleAutoNext,
  peekNextTrack,
  advanceQueueForSplicedSong,
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

  // —— 无缝播放（预拼接下一首）——
  // 已成功入槽的预拼接曲目及其队列来源；拼接生效（transitioned）或人为干预时清除。
  let pendingGapless: PeekedNextTrack | null = null;

  /** 无缝拼接只认本地磁盘文件（含 QMC/CUE 载体）；插件/在线/网盘链路退回普通切歌。 */
  const isGaplessEligiblePath = (path: string) =>
    !!path
    && !path.startsWith('http://')
    && !path.startsWith('https://')
    && !path.startsWith('plugin://')
    && !path.startsWith('lx://')
    && !path.startsWith('cloud://');

  const clearPendingGapless = (cancelBackend = true) => {
    const hadPending = pendingGapless !== null;
    pendingGapless = null;
    if (hadPending && cancelBackend && !dlnaCast.isCasting) {
      void playbackApi.cancelPrepareNext().catch(() => {});
    }
  };

  /** 把「下一首」的解码链提前建好放进后端交接槽；当前曲自然播完时后端无缝接上。 */
  const maybePrepareNextTrack = () => {
    pendingGapless = null;
    const current = currentSong.value;
    if (!current || !isPlaying.value || dlnaCast.isCasting) return;
    if (!settingsStore.settings.audio.gaplessEnabled) return;
    if (!isGaplessEligiblePath(current.cue_source_path || current.path)) return;
    const peeked = peekNextTrack?.();
    if (!peeked) return;
    if (!isGaplessEligiblePath(peeked.song.cue_source_path || peeked.song.path)) return;
    const balance = settingsStore.settings.audio.volumeBalance;
    const currentPath = current.path;
    void playbackApi.prepareNextTrack({
      path: peeked.song.cue_source_path || peeked.song.path,
      forPath: current.cue_source_path || current.path,
      songId: peeked.song.id ?? null,
      volumeBalanceEnabled: balance?.enabled ?? false,
      gainOffsetDb: balance?.gainOffsetDb ?? 0,
      preventClipping: balance?.preventClipping ?? true,
    }).then((ok) => {
      // 异步期间曲子已被人为切走则丢弃（后端也会按 for_path 校验）
      if (ok && currentSong.value?.path === currentPath) {
        pendingGapless = peeked;
      }
    }).catch(() => {});
  };


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

  const { scheduleLyricsPlayerPreload, scheduleAddToHistory } = createPreloadScheduling({
    isMainWindowLowPower: () => isMainWindowLowPower.value,
    preloadLyricPlayer: preloadAmlLyricPlayer,
    setManagedTimeout,
    addToHistory,
  });

  const buildQueueWithInsertedSong = (song: Song, previousSong: Song | null, queue: Song[]) =>
    buildQueueWithInsertedSongPure(song, previousSong, queue);

  const { prepareDetailFullCovers, getLikelyThumbnailPaths } = createCoverPreparation({
    showPlayerDetail: () => showPlayerDetail.value,
    tempQueue: () => tempQueue.value,
    playQueue: () => playQueue.value,
    tempQueuePaths: () => tempQueuePaths.value,
    playQueuePaths: () => playQueuePaths.value,
    playMode: () => playMode.value,
    getDisplaySongList,
    retainFullCoverPaths,
  });

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
    const isSameCurrentlyPlayingSong = isSameCurrentlyPlayingSongPure(
      song,
      previousSong,
      isPlaying.value,
      options,
    );

    if (isSameCurrentlyPlayingSong) {
      return;
    }

    if (song.path.startsWith('plugin://') && !options._sourceSwitchCtx) {
      const preflightResult = preflightKnownFailedPlugin(song);
      if (preflightResult instanceof Promise ? await preflightResult : preflightResult) return;
    }

    const requestId = ++playRequestId;
    clearVolumeRestoreTimer();
    // 人为换曲：作废预拼接状态并通知后端清槽（新链路会重新装备）
    clearPendingGapless();

    cancelledPlayRequestId = -1;
    const fadeEnabled = settingsStore.settings.audio.fadeInOutEnabled;
    const fadeDuration = settingsStore.settings.audio.fadeInOutDurationMs;

    const isQualitySwitch = isQualitySwitchRequest(song, previousSong, options);

    let audioFilePath = song.cue_source_path || song.path;
    const isOriginalOnlineSong = isOriginalOnlinePath(audioFilePath);

    const shouldStopPreviousAudioBeforeOnlineResolve = shouldStopPreviousAudioBeforeOnlineResolvePure(
      audioFilePath,
      isPlaying.value,
      playbackStore.isPlaying,
      previousSong,
      song,
      isQualitySwitch,
    );

    const shouldFadeOnSwitch = shouldFadeOnSwitchPure(
      fadeEnabled,
      isPlaying.value,
      previousSong,
      song,
    );

    const effectiveFadeDuration = fadeDuration;

    let usingDownloadedAudioFile = false;
    let pluginHeaders: Record<string, string> | null = null;
    let pluginEkey: string | undefined = undefined;
    let pluginCek: string | undefined = undefined;
    let pluginFullBuffer = false;
    let pluginStreamCacheKey: string | null | undefined = undefined;

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
    // TODO(cover-diag): 临时诊断，定位起播丢封面后移除
    console.warn('[cover-diag] 起播封面输入 ' + JSON.stringify({
      thumb: song.cover_thumb_path ?? null,
      cachedCover: cachedCover ? `${cachedCover.length}::${cachedCover}` : null,
      persistedCover: persistedCover ? `${persistedCover.length}::${persistedCover}` : null,
    }));
    let displayCover = '';
    // 索引封面已回填标记：loadCover 对 cloud:// 走 ensure_cached_path（下载
    // 音频再提封面），慢路径失败返回空时不得清掉索引回填的封面（2026-10
    // 百度播放实测：列表封面正常、播放页被空结果分支清成占位图）。
    let cloudCoverApplied = false;
    const isLocalFilePath = (p: string | undefined | null): p is string =>
      !!p && /^[A-Za-z]:[\\/]/.test(p);
    // data URL 兜底（移动端 Image.file 的桌面等价物）：asset 协议对共享
    // 数据目录的封面渲染不稳定（2026-10 起播实测：URL 合法、asset 作用域
    // 已放行、控制台无报错却仍不渲染），播放页封面改由 rust 读字节内联，
    // 绕开 asset/CSP/file:// 三层约束。
    const applyCoverDataUrl = (rawPath: string) => {
      void resolveLocalCoverDataUrl(rawPath).then((dataUrl) => {
        // TODO(cover-diag): 临时诊断，定位起播丢封面后移除
        console.warn('[cover-diag] data URL 兜底', {
          input: rawPath.slice(-40),
          ok: !!dataUrl,
          len: dataUrl?.length ?? 0,
        });
        if (!dataUrl) return;
        if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;
        currentCover.value = dataUrl;
        currentCoverFull.value = dataUrl;
      });
    };
    if (isLocalFilePath(song.cover_thumb_path)) {
      applyCoverDataUrl(song.cover_thumb_path);
    }
    if (immediateCover) {
      displayCover = getDisplayCoverUrl(immediateCover, (dataUrl) => {
        if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;
        currentCover.value = dataUrl;
        currentCoverFull.value = dataUrl;
      });
      currentCover.value = displayCover;
      currentCoverPath.value = coverLookupPath;
      // asset/本地形态的索引封面同步转 data URL，防止后到覆盖丢失渲染
      applyCoverDataUrl(immediateCover);
    }
    currentCoverFull.value = cachedFullCover || displayCover || immediateCover || '';
    if (!immediateCover && coverLookupPath.startsWith('cloud://')) {
      // 网盘曲目实例未带回填字段时，查持久化元数据索引兜底起播封面
      void lookupCloudMeta(coverLookupPath).then((meta) => {
        // TODO(cover-diag): 临时诊断
        console.warn('[cover-diag] 索引兜底', { hit: !!meta?.coverPath, cover: meta?.coverPath?.slice(-60) ?? null });
        if (!meta?.coverPath) return;
        if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;
        song.cover_thumb_path = meta.coverPath;
        const cloudDisplay = getDisplayCoverUrl(meta.coverPath);
        currentCover.value = cloudDisplay;
        currentCoverFull.value = cloudDisplay;
        currentCoverPath.value = coverLookupPath;
        cloudCoverApplied = true;
        if (isLocalFilePath(meta.coverPath)) {
          applyCoverDataUrl(meta.coverPath);
        }
      });
    }
    preloadPriorityCovers(getLikelyThumbnailPaths(song));
    const currentThumbnailLoad = isLxSong
      ? Promise.resolve([immediateCover || '', cachedCoverPath] as [string, string])
      : Promise.all([loadCover(coverLookupPath), loadCoverPath(coverLookupPath)]);
    void currentThumbnailLoad
      .then(([cover]) => {
        if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) {
          return;
        }

        const normalizedCover = cover || '';
        // TODO(cover-diag): 临时诊断
        console.warn('[cover-diag] 缩略图加载返回', { cover: normalizedCover ? normalizedCover.slice(0, 70) : '(空)' });
        if (normalizedCover) {
          currentCover.value = getDisplayCoverUrl(normalizedCover);
          currentCoverPath.value = song.path;
          // asset/本地形态同步转 data URL：本分支常后于起播 data URL 到达，
          // 不转换会把已渲染的 data URL 覆盖回不渲染的 asset URL
          applyCoverDataUrl(normalizedCover);
        } else if (!immediateCover && !cloudCoverApplied) {
          currentCover.value = '';
          currentCoverPath.value = '';
        }
        if (!currentCoverFull.value) {
          currentCoverFull.value = getDisplayCoverUrl(normalizedCover) || '';
          applyCoverDataUrl(normalizedCover);
        }
      })
      .catch(() => {
        if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path) || immediateCover) {
          return;
        }
        currentCover.value = '';
        currentCoverPath.value = '';
      });
    if (showPlayerDetail.value && !cachedFullCover) {
      void loadFullCover(song.path)
        .then((fullCoverUrl) => {
          if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path) || !fullCoverUrl) {
            return;
          }

          currentCoverFull.value = fullCoverUrl;
          applyCoverDataUrl(fullCoverUrl);
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
    resumeTime = clampResumeTimeToPreviewClip(resumeTime, activeClip);
    reanchorPlaybackClock(resumeTime);
    resetPlaybackProgressTracking();
    startPlaybackRuntime();

    let historyRecordedForRequest = false;
    const recordStartedSongToHistory = () => {
      if (
        historyRecordedForRequest
        || isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)
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
        pluginFullBuffer = resolvedOnlineAudio.fullBuffer === true;
        pluginStreamCacheKey = resolvedOnlineAudio.streamCacheKey ?? undefined;
        if (pluginHeaders) {
          song.remote_headers = pluginHeaders;
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
              if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;
              currentCover.value = dataUrl;
              currentCoverFull.value = dataUrl;
            });
            currentCover.value = displayCover;
            currentCoverPath.value = song.path;
            currentCoverFull.value = displayCover;
            void resolveLocalCoverDataUrl(resolvedOnlineAudio.coverThumbPath).then((dataUrl) => {
              if (!dataUrl) return;
              if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;
              currentCover.value = dataUrl;
              currentCoverFull.value = dataUrl;
            });
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
        } else if (audioFilePath.startsWith('cloud://')) {
          showToast(getLastCloudResolveError() || '网盘播放失败', 'error');
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
            if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) {
              return;
            }

            const normalizedCover = cover || '';
            const normalizedCoverPath = coverPath || '';
            if (normalizedCover) {
              currentCover.value = getDisplayCoverUrl(normalizedCover);
              void resolveLocalCoverDataUrl(normalizedCover).then((dataUrl) => {
                if (!dataUrl) return;
                if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;
                currentCover.value = dataUrl;
              });
            } else if (!immediateCover) {
              currentCover.value = '';
            }
            if (!currentCoverFull.value) {
              currentCoverFull.value = getDisplayCoverUrl(normalizedCover) || '';
              void resolveLocalCoverDataUrl(normalizedCover).then((dataUrl) => {
                if (!dataUrl || currentCoverFull.value) return;
                if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;
                currentCoverFull.value = dataUrl;
              });
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
            fullBuffer: pluginFullBuffer || undefined,
            cacheKey: pluginStreamCacheKey,
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
          if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) {
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
          if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;
          if (cancelledPlayRequestId === requestId) {
            isPlaying.value = false;
            isSongLoaded.value = false;
            stopPlaybackRuntime();
            loadLyrics();
            return;
          }
        }

        const rustOk = await tryPlayOnlineViaRust();
        if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;

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
          // 云端曲目：头部缓存起播后安排内嵌元数据探针（封面/歌词/时长回填）
          if (pluginFullBuffer) {
            void playbackApi.probeCloudTrackMeta({
              url: audioFilePath,
              cloudPath: song.path,
              durationHint: Math.floor(song.duration),
            }).catch(() => {});
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
          if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;

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
          if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;
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
          if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;

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
        // 本地曲起播成功：预拼接「下一首」，曲终时后端无缝接上
        maybePrepareNextTrack();

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
            if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) {
              return;
            }

            const normalizedCover = cover || '';
            const normalizedCoverPath = coverPath || '';
            if (normalizedCover) {
              currentCover.value = getDisplayCoverUrl(normalizedCover);
              void resolveLocalCoverDataUrl(normalizedCover).then((dataUrl) => {
                if (!dataUrl) return;
                if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;
                currentCover.value = dataUrl;
              });
            } else if (!immediateCover) {
              currentCover.value = '';
            }
            if (!currentCoverFull.value) {
              currentCoverFull.value = getDisplayCoverUrl(normalizedCover) || '';
              void resolveLocalCoverDataUrl(normalizedCover).then((dataUrl) => {
                if (!dataUrl || currentCoverFull.value) return;
                if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;
                currentCoverFull.value = dataUrl;
              });
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
      if (isStaleRequest(requestId, playRequestId, currentSong.value?.path, song.path)) return;

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
    isGaplessPending: () => pendingGapless !== null,
    onGaplessStuck: () => { pendingGapless = null; },
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

  // 无缝拼接切换生效（后端已开始输出下一首）：采纳预拼接曲目，按来源分支推进队列，
  // 并做与 playSong 成功路径一致的最小状态变更（进度基线/歌词/封面/媒体信息/统计）。
  listen<{seq: number; durationSecs: number}>('playback:transitioned', (event) => {
    const pending = pendingGapless;
    pendingGapless = null;
    if (!pending) {
      // 预拼接状态丢失（如交叉中途 seek 作废后槽位残留再拼接）：按普通自动切歌对齐
      handleAutoNext();
      return;
    }
    const spliced = pending.song;
    advanceQueueForSplicedSong?.(spliced, pending.source);
    onlineStreamFailureCtx = null;

    if (event.payload?.durationSecs && event.payload.durationSecs > 0
      && (!spliced.duration || spliced.duration <= 0)) {
      spliced.duration = Math.floor(event.payload.durationSecs);
    }

    scheduleLyricsPlayerPreload(spliced);
    currentSong.value = spliced;
    isPlaying.value = true;
    isSongLoaded.value = true;

    flushPlaySession();
    startStatisticsSession();
    scheduleAddToHistory(spliced);
    reanchorPlaybackClock(0);
    resetPlaybackProgressTracking();
    void loadLyrics();

    const coverLookupPath = spliced.cue_source_path || spliced.path;
    const cachedCover = peekCoverUrl(coverLookupPath) || spliced.cover_thumb_path || '';
    currentCoverPath.value = coverLookupPath;
    if (cachedCover) {
      const display = getDisplayCoverUrl(cachedCover);
      currentCover.value = display;
      currentCoverFull.value = display;
      void resolveLocalCoverDataUrl(cachedCover).then((dataUrl) => {
        if (!dataUrl || currentSong.value?.path !== spliced.path) return;
        currentCover.value = dataUrl;
        currentCoverFull.value = dataUrl;
      });
    } else {
      currentCover.value = '';
      currentCoverFull.value = '';
      void loadCover(coverLookupPath).then((cover) => {
        if (currentSong.value?.path !== spliced.path) return;
        const display = getDisplayCoverUrl(cover || '');
        if (display) {
          currentCover.value = display;
          currentCoverFull.value = display;
        }
        void resolveLocalCoverDataUrl(cover || '').then((dataUrl) => {
          if (!dataUrl || currentSong.value?.path !== spliced.path) return;
          currentCover.value = dataUrl;
          currentCoverFull.value = dataUrl;
        });
      }).catch(() => {});
    }
    preloadPriorityCovers(getLikelyThumbnailPaths(spliced));

    void playbackApi.updatePlaybackMetadata({
      title: getSmtcTitle(spliced),
      artist: spliced.artist || 'Unknown Artist',
      album: spliced.album || 'Unknown Album',
      cover: spliced.cover_thumb_path || '',
      duration: Math.floor(spliced.duration || 0),
      isPlaying: true,
    }).catch(() => {});

    // 链式预拼接「下一首的下一首」
    maybePrepareNextTrack();
  }).catch(() => {});

  // 后端判定无法拼接（装备缺失/会话不符/采样率声道不一致）：撤回抑制，曲终回落普通自动切歌。
  // 回执路径按后端语义为「被拒预拼接所属的当前曲」；兼容匹配下一首路径以防语义回退。
  listen<string>('playback:prepare-rejected', (event) => {
    const rejectedPath = event.payload;
    const currentKey = currentSong.value
      ? (currentSong.value.cue_source_path || currentSong.value.path)
      : '';
    if (rejectedPath && currentKey && rejectedPath === currentKey) {
      pendingGapless = null;
      return;
    }
    if (pendingGapless
      && (pendingGapless.song.cue_source_path || pendingGapless.song.path) === rejectedPath) {
      pendingGapless = null;
    }
  }).catch(() => {});

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

  // 云端曲目内嵌元数据就绪（封面/歌词/时长）：回填曲库/播放队列，并刷新播放页。
  listen<{
    cloudPath: string;
    lyricsRaw?: string | null;
    coverPath?: string | null;
    durationSecs?: number | null;
  }>('cloud-track-meta-ready', (event) => {
    const meta = event.payload;
    if (!meta?.cloudPath) return;
    const patch: Partial<Song> = {};
    if (meta.coverPath) patch.cover_thumb_path = meta.coverPath;
    if (meta.lyricsRaw) patch.lyrics_raw = meta.lyricsRaw;
    if (meta.durationSecs && meta.durationSecs > 0) patch.duration = meta.durationSecs;
    if (Object.keys(patch).length === 0) return;
    libraryStore.patchSongMeta(meta.cloudPath, patch);
    playbackStore.patchQueueSongMeta(meta.cloudPath, patch);
    if (currentSong.value?.path !== meta.cloudPath) return;
    if (meta.coverPath) {
      const display = getDisplayCoverUrl(meta.coverPath);
      currentCover.value = display;
      currentCoverFull.value = display;
      currentCoverPath.value = meta.cloudPath;
      void resolveLocalCoverDataUrl(meta.coverPath).then((dataUrl) => {
        if (!dataUrl || currentSong.value?.path !== meta.cloudPath) return;
        currentCover.value = dataUrl;
        currentCoverFull.value = dataUrl;
      });
    }
    if (meta.lyricsRaw) {
      void loadLyrics();
    }
  }).catch(() => {});

  const pauseSong = async () => {
    playbackStatisticsController.pauseSession();
    flushPlaySession();
    // 暂停会拆掉后端无缝装备：预拼接状态一并作废，恢复后再重准备
    clearPendingGapless();

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
      // 暂停会拆掉后端无缝装备：预拼接状态一并作废，恢复后再重准备
      clearPendingGapless();

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
    // 恢复播放：暂停时后端无缝装备已拆，这里重新预拼接「下一首」
    maybePrepareNextTrack();
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
    clearPendingGapless(false);
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
