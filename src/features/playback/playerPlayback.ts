import {storeToRefs} from 'pinia';
import {watch} from 'vue';
import type {QualityKey, Song} from '../../types';
import {playbackApi} from '../../services/tauri/playbackApi';
import {usePlaybackStore} from './store';
import {useSettingsStore} from '../settings/store';
import {useLibraryStore} from '../library/store';
import {useUiStore} from '../../shared/stores/ui';
import {useCoverCache} from '../../composables/useCoverCache';
import {useRenderingPower} from '../../composables/renderingPower';
import {fetchLxSongLyricsRaw} from '../../services/lxLyricFetcher';
import {useToast} from '../../composables/toast';
import {reportUserBehavior} from '../../services/usageStats';
import {useAuthStore} from '../auth/store';
import {preloadAmlLyricPlayer} from '../../components/player/amlLyricPlayerLoader';
import {consumeFlyCoverPromise} from '../../composables/useFlyingCover';
import {getStoredPlugins, pluginGetLyric} from '../../services/pluginEngine';
import {getOnlineAvailableQualities, resolveOnlineAudio} from './onlinePlaybackResolver';

interface PlaySongOptions {
  updateShuffleHistory?: boolean;
  clearShuffleFuture?: boolean;
  preserveQueue?: boolean;
  insertAfterCurrent?: boolean;
  startTime?: number;
  continueStatisticsSession?: boolean;
  /** [内部] 自动换源上下文，递归 playSong 时传递已失败源集合防死循环 */
  _sourceSwitchCtx?: {
    originKey: string;
    failedSources: Set<string>;
  };
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
let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let periodicFlushTimerId: ReturnType<typeof setInterval> | null = null;
// [渐入渐出] 淡入淡出动画帧 ID，用于取消正在进行的音量渐变
let fadeFrameId: number | null = null;
// [渐入渐出] 当前渐变 Promise 的 resolve 函数；取消时调用以确保 await 不会永久挂起
let fadeResolveFn: (() => void) | null = null;
// [渐入渐出] 追踪后端实际输出音量（0-1），用于 fade 中途打断后从中断点继续
let currentBackendVolume = 1;
// [快速操作] togglePlay 调用 token，每次调用递增；过时的 async 流程通过对比 token 提前退出
let togglePlayToken = 0;
let playRequestId = 0;
// [暂停竞态] 在线歌曲起播需要先异步解析直链（可能几秒）。这期间用户按暂停时，
// togglePlay 只能把 isPlaying 置 false —— 音频还没创建，pause 无处可施；
// 随后 playSong 跑完又会把状态设回播放中并真的出声，表现为「点暂停没反应」。
// 这里记录「哪个 playRequestId 已被用户取消」，playSong 在真正启动播放前后据此中止。
let cancelledPlayRequestId = -1;
let latestSeekRequestId = 0;
let playbackAnchorTime = 0;
let playbackStartOffset = 0;
let sessionStartTime: number | null = null;
let accumulatedTime = 0;
let currentPlayCountRecorded = false;
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
const libraryStore = useLibraryStore();
const uiStore = useUiStore();
const authStore = useAuthStore();
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

  // [性能优化] 将 addToHistory 延迟到空闲时执行，避免其触发的响应式级联阻塞播放启动。
  // addToHistory 会修改 recentSongs（触发 IPC 序列化所有歌单）和 songCatalogVersion
  // （触发 canonicalSongs/playQueue/currentViewSongs 等 computed 级联重算），
  // 歌单和歌曲数量越多，级联开销越大，导致飞封面动画和起播卡顿。
  // addToHistory 仅影响历史记录和最近播放列表，不影响当前播放，可安全延迟。
  const scheduleAddToHistory = (song: Song) => {
    const idle = typeof window !== 'undefined'
      ? (window as any).requestIdleCallback as
        | ((callback: () => void, options?: { timeout?: number }) => number)
        | undefined
      : undefined;

    if (idle) {
      idle(() => addToHistory(song), { timeout: 2000 });
    } else {
      setTimeout(() => addToHistory(song), 500);
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

    const requestIdle = typeof window !== 'undefined'
      ? (window as any).requestIdleCallback as
        | ((callback: () => void, options?: { timeout?: number }) => number)
        | undefined
      : undefined;

    if (requestIdle) {
      requestIdle(preload, { timeout: 1500 });
    } else {
      setTimeout(preload, 0);
    }
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
    pushUniquePath(tempQueuePaths.value[0]);

    // [性能优化] 用 playQueuePaths（string[]）查找索引，避免 playQueue.value 物化所有歌曲对象
    const queuePaths = playQueuePaths.value;
    const currentIndex = queuePaths.indexOf(song.path);
    if (currentIndex >= 0 && queuePaths.length > 1) {
      pushUniquePath(queuePaths[(currentIndex - 1 + queuePaths.length) % queuePaths.length]);
      pushUniquePath(queuePaths[(currentIndex + 1) % queuePaths.length]);
    }

    if (playMode.value === 2) {
      const candidatePaths = queuePaths.length
        ? queuePaths
        : getDisplaySongList().map(s => s.path);
      const randomPaths = candidatePaths
        .filter(p => p !== song.path)
        .slice(0, 5);
      randomPaths.forEach(p => pushUniquePath(p));
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
    if (periodicFlushTimerId !== null) {
      clearInterval(periodicFlushTimerId);
      periodicFlushTimerId = null;
    }
  };

  // [渐入渐出] 取消正在进行的音量渐变动画
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

  // [渐入渐出] 将实际输出音量从当前值渐变到目标值（不影响 playbackStore.volume 显示值）
  // startVolumeOverride 用于指定起始音量（如切歌淡入时从 0 开始），不传则从 currentBackendVolume 继续（支持中途打断）
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
      // 淡入用 easeInQuad（前慢后快，声音慢慢浮现），淡出用 easeOutQuad（前快后慢，声音慢慢消失）。
      // 两者在 50% 处都经过 25%，保证淡入/淡出时长相等且对称。
      // 之前两者都用 easeOutQuad，导致淡入前半段音量就到 75%，听感上淡入时长只有淡出的一半。
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
          // 确保最终设置精确的目标音量
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

    // [定时刷新] 每 30 秒将听歌时长刷写到统计数据库。
    // 同一次播放仅首个有效分片计入播放次数，后续分片只累计时长。
    periodicFlushTimerId = setInterval(() => {
      if (isPlaying.value && currentSong.value) {
        flushPlaySession();
        sessionStartTime = Date.now();
      }
    }, 30_000);

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
          // 在线歌（流式下载）拖动进度条或中途缓冲时，后端进度可能停滞数秒才恢复。
          // 若沿用 2 轮阈值会被误判为播放结束而自动切下一首，故对在线歌放宽阈值。
          const isOnlineStream = !!song.path
            && (song.path.startsWith('http://')
              || song.path.startsWith('https://')
              || song.path.startsWith('lx://')
              || song.path.startsWith('plugin://')
              || song.path.startsWith('remote://'));
          const requiredStalledTicks = isOnlineStream ? 6 : 2;
          if (stalledProgressTicks >= requiredStalledTicks && (unknownDuration || nearEnd)) {
            stalledProgressTicks = 0;
            handleAutoNext();
            return;
          }
        } else {
          stalledProgressTicks = 0;
        }
        lastRawProgress = rawTime;

        // [在线歌曲时长修正] Song.duration 可能为 0（插件未返回时长），
        // 从 Rust 音频引擎获取解码后的实际时长，更新 currentSong 和 libraryStore
        const songForDuration = currentSong.value;
        if (songForDuration && (!songForDuration.duration || songForDuration.duration <= 0)) {
          try {
            const backendDuration = await playbackApi.getPlaybackDuration();
            if (backendDuration > 0) {
              const newDuration = Math.floor(backendDuration);
              currentSong.value = {...songForDuration, duration: newDuration};
              libraryStore.patchSongMeta(songForDuration.path, { duration: newDuration } as Partial<Song>);
              playbackStore.patchQueueSongMeta(songForDuration.path, { duration: newDuration });
            }
          } catch {}
        }
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
    const shouldPersist = totalDuration >= 10 || (currentPlayCountRecorded && totalDuration > 0);

    // 上报用户播放行为到后台统计（不受 shouldPersist 限制，确保切歌/暂停都能及时上报）
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

  /**
   * 统一处理在线播放失败：状态清理 + 自动换源（lx://）+ onlineFailureBehavior
   *
   * 触发场景：
   * 1. lx:// URL 解析失败（插件获取直链失败，token 过期/无权限/接口异常等），
   *    audioFilePath 仍是 lx:// 开头，无法走在线或本地播放
   * 2. 在线直链走 Rust 后端起播探测失败（403/不支持Range/解码失败/超时）
   *
   * @returns 调用方应在调用后立即 return（已处理完所有失败后续）
   */
  const handleOnlinePlaybackFailure = async (
    song: Song,
    options: PlaySongOptions,
    requestId: number,
    shouldFade: boolean | null,
  ): Promise<void> => {
    try { await playbackApi.stopAudio(); } catch {}
    // [渐入渐出] 起播失败时恢复后端音量到用户设定值
    if (shouldFade) {
      currentBackendVolume = playbackStore.volume / 100;
      void playbackApi.setVolume(currentBackendVolume).catch(() => {});
    }
    isPlaying.value = false;
    isSongLoaded.value = false;
    stopPlaybackRuntime();
    console.error('[Audio] 在线音频播放失败');

    // [自动换源] lx:// 歌曲起播失败时，尝试其他落雪音源播放同一首歌
    const autoSwitchEnabled = settingsStore.settings.audio.autoSwitchSourceOnFailure ?? true;
    if (autoSwitchEnabled && song.path.startsWith('lx://')) {
      const currentSource = song.path.slice('lx://'.length).split('/')[0];
      // 复用或初始化换源上下文：failedSources 单调增长，防止递归死循环
      const switchCtx = options._sourceSwitchCtx ?? {
        originKey: `${song.name}|${song.artist}`,
        failedSources: new Set<string>(),
      };
      switchCtx.failedSources.add(currentSource);

      let alternativeSong: Song | null = null;
      try {
        const { findAlternativeLxSource } = await import('../../services/lxSourceFallback');
        alternativeSong = await findAlternativeLxSource(song, switchCtx.failedSources);
      } catch (e: any) {
        console.warn(`[Audio] 自动换源查找异常: ${e?.message || e}`);
      }

      // [竞态检查] 搜索期间用户可能已切歌
      if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
        return;
      }

      if (alternativeSong) {
        const { getLxSourceDisplayName } = await import('../../services/lxSourceFallback');
        const newSource = alternativeSong.path.slice('lx://'.length).split('/')[0];
        // [封面回退] 若新源搜索结果未返回封面 URL（部分平台不返回 img），
        // 复用原歌曲封面（同一首歌，封面图通常相同）
        if (!alternativeSong.cover_thumb_path && song.cover_thumb_path) {
          alternativeSong.cover_thumb_path = song.cover_thumb_path;
        }
        showToast(`已自动切换到 ${getLxSourceDisplayName(newSource)} 音源`, 'info');
        // preserveQueue: 保持队列不变，仅切 currentSong；递归传递上下文以便新源失败时继续换源
        await playSong(alternativeSong, {
          preserveQueue: true,
          _sourceSwitchCtx: switchCtx,
        });
        return;
      }
      // alternativeSong 为 null：所有源穷尽或均未匹配，继续走下方 onlineFailureBehavior
    }

    const failureBehavior = settingsStore.settings.audio.onlineFailureBehavior ?? 'skip';
    if (failureBehavior === 'skip') {
      setTimeout(() => {
        if (currentSong.value?.path === song.path) handleAutoNext();
      }, 400);
    }
    // 'stop'：保持停止，不做额外处理
  };

  const playSong = async (song: Song, options: PlaySongOptions = {}) => {
    const previousSong = currentSong.value;
    const isSameCurrentlyPlayingSong = !!previousSong
      && previousSong.path === song.path
      && isPlaying.value
      && !options.continueStatisticsSession
      && options.startTime === undefined
      && !options._sourceSwitchCtx;

    // 重复点击正在播放的同一首歌时不重新加载，避免进度被重置、音频重建和封面动画重复触发。
    // 音质切换、自动换源、指定起播时间等内部重播请求仍继续执行。
    if (isSameCurrentlyPlayingSong) {
      return;
    }

    const requestId = ++playRequestId;

    // 新的播放请求：清掉上一次可能残留的取消标记
    cancelledPlayRequestId = -1;

    // [渐入渐出] 切歌时先淡出当前正在播放的歌曲，避免新歌起播前旧歌仍在出声。
    // 本地、在线均适用：在线歌 URL 解析期间旧歌会持续淡出，解析完成新歌起播后再淡入。
    const fadeEnabled = settingsStore.settings.audio.fadeInOutEnabled;
    const fadeDuration = settingsStore.settings.audio.fadeInOutDurationMs;

    // [音质切换防爆音] 同一首歌切换音质（continueStatisticsSession=true）时，
    // 旧音频仍在播放中直接被替换会产生爆音/失真。此时无论渐入渐出是否开启，
    // 都做一次短过渡（未开启时用 150ms），避免 DC offset 突变。
    const isQualitySwitch = !!options.continueStatisticsSession
      && !!previousSong
      && previousSong.path === song.path;

    const shouldFadeOnSwitch = (fadeEnabled || isQualitySwitch)
      && isPlaying.value
      && !!previousSong
      && (previousSong.path !== song.path || isQualitySwitch);

    const effectiveFadeDuration = isQualitySwitch && !fadeEnabled
      ? 150
      : fadeDuration;

    if (shouldFadeOnSwitch) {
      await fadeVolumeTo(0, effectiveFadeDuration);
    } else {
      cancelFade();
    }

    // [可打断] fade-out 期间用户可能再次点击播放另一首歌，此时 playRequestId 已递增、
    // cancelFade 已 resolve 旧的 fade promise。若不检查，旧的 playSong 会继续处理旧歌曲，
    // 与新的 playSong 产生竞态（旧歌覆盖新歌的 currentSong/queue/playAudio）。
    if (requestId !== playRequestId) return;

    flushPlaySession();
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
        // [性能优化] 用路径数组直接设置队列，避免 playQueue.value 物化所有歌曲对象。
        // 同一容器内切歌时路径未变 → setQueueFromPaths 内部 areSamePaths 短路返回，
        // 不触发 normalizeSongs / pruneFallbackSongs / 响应式更新。
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

    // [音质跟踪] 切歌时重置实际播放音质，URL 解析成功后重新设置
    playbackStore.currentPlayingQuality = null;
    // [缓存复用] 切歌时清空上一首的音频直链，URL 解析成功后重新记录
    playbackStore.currentPlayingAudioUrl = null;
    // [会话音质] 切换到不同歌曲时清空底部栏会话级音质覆盖，让新歌优先应用设置页的在线播放音质。
    // 同一首歌重播（如底部栏切音质触发的 replay）保留覆盖，以确保切音质立即生效。
    if (previousSong && previousSong.path !== song.path) {
      playbackStore.sessionQualityOverride = null;
    }

    // [歌词获取] LX/plugin:// 歌曲的异步歌词获取已移至 URL 解析之后，
    // 确保插件实例已初始化且 musicUrl 请求已完成（部分插件依赖 song-specific 状态）。

    const retainedFullCoverPaths = prepareDetailFullCovers(song);

    isPlaying.value = true;
    isSongLoaded.value = false;
    const coverLookupPath = song.cue_source_path || song.path;
    // [落雪] lx:// 协议歌曲的 cover_thumb_path 是远程 URL，直接使用不走 convertFileSrc
    const isLxSong = coverLookupPath.startsWith('lx://');
    const cachedCover = peekCoverUrl(coverLookupPath);
    const cachedCoverPath = peekCoverPath(coverLookupPath) || song.cover_thumb_path || '';
    const persistedCover = isLxSong
      ? (song.cover_thumb_path || '')
      : primeCoverPath(coverLookupPath, song.cover_thumb_path);
    const cachedFullCover = getFullCoverUrl(coverLookupPath);
    const immediateCover = cachedCover || persistedCover;
    if (immediateCover) {
      currentCover.value = immediateCover;
      currentCoverPath.value = coverLookupPath;
    }
    currentCoverFull.value = cachedFullCover || immediateCover || '';
    preloadPriorityCovers(getLikelyThumbnailPaths(song));
    // [落雪] lx:// 歌曲跳过本地封面加载（loadCover 会调用后端读取本地文件）
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
          currentCover.value = normalizedCover;
          currentCoverPath.value = song.path;
        } else if (!immediateCover) {
          // 保留上一首封面只用于遮盖异步加载阶段；确认当前歌曲确实没有封面后清空，
          // 让底栏显示默认音乐占位图，避免旧封面残留或封面区域完全空白。
          currentCover.value = '';
          currentCoverPath.value = '';
        }
        if (!currentCoverFull.value) {
          currentCoverFull.value = normalizedCover || '';
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
    const resumeTime = Math.max(0, Math.min(requestedStartTime, song.duration || requestedStartTime));

    stopPlaybackRuntime();
    reanchorPlaybackClock(resumeTime);
    accumulatedTime = 0;
    sessionStartTime = null;
    lastRawProgress = -1;
    stalledProgressTicks = 0;

    // [性能优化] 延迟 addToHistory 调用，避免 recentSongs 变更触发的响应式级联
    // （IPC 序列化所有歌单 + songCatalogVersion 递增导致 computed 重算）阻塞播放启动和飞封面动画。
    // addToHistory 仅影响历史记录和最近播放列表，不影响当前播放，可安全延迟到空闲时执行。
    scheduleAddToHistory(song);

    // [预获取优化] 音质列表获取与 URL 解析并行执行，减少起播延迟
    // 音质列表独立于播放流程，可在后台并行获取
    currentAvailableQualities.value = null;
    const qSongPath = song.cue_source_path || song.path;
    const qualityListPromise = (async () => {
      try {
        currentAvailableQualities.value = await getOnlineAvailableQualities(qSongPath, song);
      } catch { /* ignore: 音质列表获取失败不影响播放 */ }
    })();

    let audioFilePath = song.cue_source_path || song.path;
    // 插件返回的自定义请求头（防盗链 Cookie/Referer 等），随 URL 一起传递给播放器
    let pluginHeaders: Record<string, string> | null = null;
    const startOffsetMs = cueStartOffset + Math.round(resumeTime * 1000);

    // [音质列表] 在 URL 解析前等待音质列表获取完成，确保后续音质回退逻辑能正确过滤
    await qualityListPromise;

    // [可打断] 音质列表获取期间用户可能切歌，需检查是否仍是当前请求
    if (requestId !== playRequestId) return;

    const requestedQuality = (playbackStore.sessionQualityOverride
      || settingsStore.settings.audio.onlineDefaultQuality || '320k') as QualityKey;
    const fallbackBehavior = settingsStore.settings.audio.onlineQualityFallbackBehavior ?? 'lower';
    const resolvedOnlineAudio = await resolveOnlineAudio({
      audioFilePath,
      song,
      requestedQuality,
      fallbackBehavior,
      availableQualities: playbackStore.currentAvailableQualities,
      preFetchedUrl: song.remote_source_id,
    });
    audioFilePath = resolvedOnlineAudio.audioFilePath;
    pluginHeaders = resolvedOnlineAudio.pluginHeaders;
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
    }

    // [可打断] lx:///plugin:// URL 解析期间用户可能切歌，需检查是否仍是当前请求
    if (requestId !== playRequestId) return;

    // [歌词获取] URL 解析完成后启动异步歌词请求。
    // 移至此处确保插件实例已初始化且 musicUrl 请求已完成（部分 LX 插件依赖 song-specific 状态才能获取歌词）。
    // LX 歌曲：通过落雪插件引擎或直接 API 获取歌词
    if (song.path.startsWith('lx://') && !song.lyrics_raw?.trim()) {
      void fetchLxSongLyricsRaw(song)
        .then((lyricsRaw) => {
          if (!lyricsRaw) {
            console.warn('[Lyrics] LX 歌词获取返回空:', song.path);
            return;
          }
          if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
            console.log('[Lyrics] LX 歌词获取成功但已被切歌:', song.path);
            return;
          }

          song.lyrics_raw = lyricsRaw;
          // [修复] 同步更新 library store 中的 songPool 条目。
          // 当歌曲在 songPool（由 protectedPaths 保护的在线收藏）中时，currentSong computed getter 会返回
          // songPool 中的对象而非入参 song 或 fallback。若不更新池中对象，
          // loadLyrics 读到的 currentSong.lyrics_raw 仍为空，导致歌词加载超时。
          libraryStore.patchSongMeta(song.path, { lyrics_raw: lyricsRaw } as Partial<Song>);
          playbackStore.patchQueueSongMeta(song.path, { lyrics_raw: lyricsRaw });
          currentSong.value = {...currentSong.value, lyrics_raw: lyricsRaw};
          console.log('[Lyrics] LX 歌词设置成功，调用 loadLyrics:', { path: song.path, lyricsLen: lyricsRaw.length });
          void loadLyrics(lyricsRaw);
        })
        .catch(error => console.warn('[Lyrics] LX 在线歌词获取失败:', error));
    }

    // [歌词获取] plugin:// 歌曲：通过 pluginGetLyric 补获歌词（支持逐字歌词）
    // 播放入口可能已通过 pluginGetMusicInfo 获取歌词并设置到 lyrics_raw，此处仅在为空时补获
    if (song.path.startsWith('plugin://') && !song.lyrics_raw?.trim()) {
      const pluginSearchResult = song.rawData;
      if (pluginSearchResult?.pluginId) {
        void (async () => {
          try {
            const plugins = getStoredPlugins();
            const pluginSource = plugins.find(p => p.id === pluginSearchResult.pluginId && p.enabled);
            if (!pluginSource) {
              console.warn('[Lyrics] plugin:// 未找到启用的插件:', pluginSearchResult.pluginId);
              return;
            }
            const lyricData = await pluginGetLyric(pluginSource, pluginSearchResult);
            if (!lyricData?.lyricsRaw) {
              console.warn('[Lyrics] plugin:// 歌词获取为空:', pluginSource.name);
              return;
            }
            if (
              requestId !== playRequestId
              || currentSong.value?.path !== song.path
            ) {
              return;
            }
            song.lyrics_raw = lyricData.lyricsRaw;
            // [修复] 同步更新 library store 池中条目（与 LX 歌词处理一致）
            libraryStore.patchSongMeta(song.path, { lyrics_raw: lyricData.lyricsRaw } as Partial<Song>);
            playbackStore.patchQueueSongMeta(song.path, { lyrics_raw: lyricData.lyricsRaw });
            currentSong.value = {...currentSong.value, lyrics_raw: lyricData.lyricsRaw};
            void loadLyrics(lyricData.lyricsRaw);
          } catch (error) {
            console.warn('[Lyrics] plugin:// 在线歌词获取失败:', error);
          }
        })();
      }
    }

    try {
      // [飞封面同步] consumeFlyCoverPromise 取出飞封面 Promise（取出后立即清除，避免后续误等）。
      // - 在线歌曲：在 playAudio 前等待飞封面（URL 解析已在上游并行完成）
      // - 本地歌曲（开启渐入渐出）：先 playAudio（fade-out 已将音量降为0，加载不发声），
      //   再等待飞封面，实现加载与动画并行，封面飞到后淡入播放
      const flyPromise = consumeFlyCoverPromise();

      const isNetworkAudio = audioFilePath.startsWith('http://') || audioFilePath.startsWith('https://');

      // [lx:// URL 解析失败] 落雪插件获取直链失败（token 过期/无权限/接口异常等），
      // audioFilePath 仍是 lx:// 开头，既非在线直链也非本地文件，直接触发失败处理（含自动换源）
      if (!isNetworkAudio && audioFilePath.startsWith('lx://')) {
        await handleOnlinePlaybackFailure(song, options, requestId, shouldFadeOnSwitch);
        return;
      }

      // [B站 m4s] 先通过后端异步下载到临时文件，再作为本地文件播放
      // 避免 RemoteRangeReader 阻塞 + HTML5 Audio 不支持 m4s 格式
      let actualAudioPath = audioFilePath;
      if (isNetworkAudio && (audioFilePath.includes('.m4s') || audioFilePath.includes('bilivideo.com'))) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const tempPath = await invoke<string>('download_audio_to_temp', {
            url: audioFilePath,
            headers: { 'Referer': 'https://www.bilibili.com' },
          });
          if (tempPath) {
            actualAudioPath = tempPath;
          }
        } catch (e: any) {
          console.warn('[Audio] m4s 下载到临时文件失败:', e?.message);
        }
      }

      // m4s 已下载为本地文件时按本地文件走 Rust 后端
      const isM4sLocal = actualAudioPath !== audioFilePath;

      // [Rust 播放收尾] 本地文件与在线直链走 Rust 成功后共用的收尾逻辑：
      // 置加载状态、加载歌词、启动播放时钟、更新 SMTC 与封面
      const finishRustPlaybackStart = () => {
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
      };

      // [在线走 Rust] 所有在线音频统一通过 Rust 后端流式下载到临时文件 + 本地引擎播放。
      // 成功返回 true；失败返回 false 由调用方处理错误。
      const tryPlayOnlineViaRust = async (): Promise<boolean> => {
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
            songId: song.id ?? undefined,
            volumeBalanceEnabled: settingsStore.settings.audio.volumeBalance?.enabled,
            gainOffsetDb: settingsStore.settings.audio.volumeBalance?.gainOffsetDb,
            preventClipping: settingsStore.settings.audio.volumeBalance?.preventClipping,
            headers: pluginHeaders,
          });
        } catch (e: any) {
          console.warn('[Audio] 在线直链 playAudio 调用失败:', e?.message || e);
          return false;
        }

        // [起播探测] play_audio 是异步投递命令：调用立即返回，真正的取流/解码/播放在后台线程进行。
        // 若远程取流失败（防盗链 403 / 不支持 Range / 解码失败），后端不会抛错，需前端探测。
        //
        // 判定就绪的主信号：getPlaybackReady()（sample_rate>0，即 Decoder::new 成功）。
        // - 对支持 Range 的流：解码器读到文件头即就绪，通常很快。
        // - 对不支持 Range 的直链：后端会整曲下载到内存后才解码，可能耗时数秒到十几秒，
        //   因此给较长超时；只要期间 ready 变 true 就算成功，不误判为失败。
        //
        // [优化] ready 后立即返回，不再等待进度推进 0.3 秒。
        // 流式文件已在 play_audio 中等待 512KB 缓冲（约 15 秒音频），
        // decoder ready 即意味着已有足够数据开始播放，无需额外等待。
        const READY_TIMEOUT_MS = 20000;
        const PROBE_INTERVAL_MS = 200;
        const probeStart = Date.now();
        let ready = false;
        while (Date.now() - probeStart < READY_TIMEOUT_MS) {
          if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
            return true; // 已被新切歌请求接管，无需回退
          }
          try {
            // 硬失败（403 / 不支持 Range / 解码失败）：后端已置位，立即回退，不必死等超时
            if (await playbackApi.getPlaybackStartFailed()) {
              console.warn('[Audio] 在线直链走 Rust 起播失败（后端报错）');
              return false;
            }
            if (!ready) {
              ready = await playbackApi.getPlaybackReady();
            }
            if (ready) {
              // decoder 就绪即可，不再等待进度推进
              return true;
            }
          } catch { /* ignore, keep probing */ }
          await new Promise(resolve => setTimeout(resolve, PROBE_INTERVAL_MS));
        }

        console.warn('[Audio] 在线直链走 Rust 起播探测失败（未就绪）');
        return false;
      };

      if (isNetworkAudio && !isM4sLocal) {
        // [在线播放重构] 所有在线音乐统一走 Rust 后端：流式下载到临时文件 + 本地引擎播放。
        // Rust 后端处理下载、解码、设备切换恢复全流程。

        // [飞封面同步] 在线歌曲 URL 解析耗时远超 520ms 飞行时间，此 await 通常已 resolve。
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

        // 用户在解析直链期间按了暂停：停掉刚起来的播放并保持暂停态，不要继续出声
        if (cancelledPlayRequestId === requestId) {
          try { await playbackApi.stopAudio(); } catch {}
          // [渐入渐出] 暂停时恢复后端音量到用户设定值
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
            // [渐入渐出] 淡入：新歌从 0 音量起播，然后渐变到目标音量
            currentBackendVolume = 0;
            try { await playbackApi.setVolume(0); } catch {}
            finishRustPlaybackStart();
            void fadeVolumeTo(playbackStore.volume / 100, effectiveFadeDuration, 0);
          } else {
            // 确保后端已接管，音量同步到后端
            currentBackendVolume = playbackStore.volume / 100;
            try { await playbackApi.setVolume(currentBackendVolume); } catch {}
            finishRustPlaybackStart();
          }
        } else {
          // [在线播放起播失败] Rust 后端探测确认起播失败（403/不支持Range/解码失败/超时）
          await handleOnlinePlaybackFailure(song, options, requestId, shouldFadeOnSwitch);
          return;
        }
      } else {
        // 本地音频走 Rust 后端播放

        // [飞封面并行优化] 无论是否开启渐入渐出，都将 playAudio 提前到飞封面等待之前。
        // playAudio 是 IPC 调用（前端 await 即释放主线程），与飞封面动画并行执行。
        //
        // 渐入渐出开启时：fade-out 已将音量降为 0，playAudio 加载新歌但不发声。
        // 渐入渐出关闭时：playAudio 直接以用户音量加载并播放，飞封面动画掩盖起播延迟。
        //
        // 此前非 fade 场景先 await flyPromise（520ms）再 playAudio，导致：
        // 1. 飞封面动画虽已启动但主线程被同步代码占用，动画首帧延迟（"卡半秒才开始飞"）
        // 2. playAudio 在 520ms 后才开始，起播延迟叠加
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
        };

        if (playBeforeFlyCover) {
          // fade-out 已将 currentBackendVolume 置为 0（渐入渐出场景），playAudio 加载但不发声
          // 非渐入渐出场景 currentBackendVolume 为用户音量，playAudio 加载并直接播放
          await playbackApi.playAudio(localPlayAudioParams);
          if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

          // 用户在加载期间按了暂停：立刻暂停后端，保持暂停态
          if (cancelledPlayRequestId === requestId) {
            isSongLoaded.value = true;
            isPlaying.value = false;
            stopPlaybackRuntime();
            try { await playbackApi.pauseAudio(); } catch {}
            loadLyrics();
            return;
          }
        }

        // 等待飞封面动画飞抵底部栏
        // playBeforeFlyCover 时歌曲已静音加载，此处仅等动画完成
        // 非 playBeforeFlyCover（无飞封面）时跳过
        if (flyPromise) {
          await Promise.race([
            flyPromise,
            new Promise<void>(resolve => setTimeout(resolve, 1200)),
          ]);
          if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;
          if (cancelledPlayRequestId === requestId) {
            if (playBeforeFlyCover) {
              // playAudio 已调用，需暂停后端
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
          // 标准流程：无飞封面时直接 playAudio
          await playbackApi.playAudio(localPlayAudioParams);
          if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

          // 用户在起播期间按了暂停：立刻暂停后端，保持暂停态
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
        sessionStartTime = Date.now();
        loadLyrics();
        startPlaybackRuntime();

        // [渐入渐出] 淡入或设置音量
        if (shouldFadeOnSwitch) {
          // playBeforeFlyCover 时 volume 已为 0（来自 fade-out）；非 playBeforeFlyCover 时显式置 0
          if (!playBeforeFlyCover) {
            currentBackendVolume = 0;
            try { await playbackApi.setVolume(0); } catch {}
          }
          void fadeVolumeTo(playbackStore.volume / 100, effectiveFadeDuration, 0);
        } else {
          // [渐入渐出] 非切歌场景（首次播放/恢复播放）：同步后端音量追踪值，
          // 避免 currentBackendVolume 停留在模块初始值 1，导致首次淡出时音量跳变
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
      }
    } catch {
      // [异常兜底] 仅处理状态清理，不执行起播失败行为
      // 起播失败行为已移至 rustOk===false 路径，仅在线引擎完全无法生效时执行
      if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

      // [渐入渐出] 异常时恢复后端音量到用户设定值
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

    // 暂停时立即刷写当前播放会话到统计数据库，确保听歌时长实时更新
    flushPlaySession();

    // 歌曲仍在起播过程中（在线歌曲解析直链期间）：标记本次请求已取消，
    // 避免 playSong 拿到直链后继续出声
    if (!isSongLoaded.value) {
      cancelledPlayRequestId = playRequestId;
    }

    // [渐入渐出] 淡出：渐变音量到0后再暂停
    const fadeEnabled = settingsStore.settings.audio.fadeInOutEnabled;
    const fadeDuration = settingsStore.settings.audio.fadeInOutDurationMs;
    if (fadeEnabled && isPlaying.value && isSongLoaded.value) {
      await fadeVolumeTo(0, fadeDuration);
    }

    isPlaying.value = false;
    await playbackApi.pauseAudio();
    stopPlaybackRuntime();

    // [渐入渐出] 淡出完成后延迟恢复后端音量：
    // pauseAudio 后 WASAPI 可能仍在播放已提交的缓冲区尾部，立即把音量从 0 拉回原值
    // 会让残余缓冲区以原音量突然发声，造成破音。等待 200ms 确保缓冲区播完后再恢复。
    if (fadeEnabled) {
      const restoreVol = playbackStore.volume / 100;
      setTimeout(() => {
        currentBackendVolume = restoreVol;
        void playbackApi.setVolume(restoreVol).catch(() => {});
      }, 200);
    }
  };

  const togglePlay = async () => {
    if (!currentSong.value) return;

    const fadeEnabled = settingsStore.settings.audio.fadeInOutEnabled;
    const fadeDuration = settingsStore.settings.audio.fadeInOutDurationMs;

    // [快速操作] 立即翻转 isPlaying，让并发的 togglePlay 调用看到正确状态。
    // 例如：第一次点击（暂停）进入 await fade，第二次点击（播放）会看到 isPlaying=false 从而进入播放分支。
    const wasPlaying = isPlaying.value;
    isPlaying.value = !wasPlaying;
    const myToken = ++togglePlayToken;

    if (wasPlaying) {
      // === 暂停分支 ===
      if (sessionStartTime) {
        accumulatedTime += (Date.now() - sessionStartTime) / 1000;
        sessionStartTime = null;
      }

      // 暂停时立即刷写当前播放会话到统计数据库，确保听歌时长实时更新
      flushPlaySession();

      // 若当前歌曲仍在起播过程中（在线歌曲解析直链期间），标记该次请求已被取消，
      // 让 playSong 在拿到直链后不要继续出声。
      if (!isSongLoaded.value) {
        cancelledPlayRequestId = playRequestId;
      }

      // [渐入渐出] 淡出：从当前音量渐变到0后再暂停
      if (fadeEnabled && isSongLoaded.value) {
        await fadeVolumeTo(0, fadeDuration);
        // 被新的 togglePlay 取消（用户快速点了播放）：不再执行 pauseAudio，让播放分支接管
        if (myToken !== togglePlayToken) return;
      }

      await playbackApi.pauseAudio();
      if (myToken !== togglePlayToken) return;
      stopPlaybackRuntime();

      // [渐入渐出] 淡出完成后延迟恢复后端音量：
      // pauseAudio 后 WASAPI 可能仍在播放已提交的缓冲区尾部，立即把音量从 0 拉回原值
      // 会让残余缓冲区以原音量突然发声，造成破音。等待 200ms 确保缓冲区播完后再恢复。
      if (fadeEnabled) {
        const restoreVol = playbackStore.volume / 100;
        setTimeout(() => {
          if (myToken !== togglePlayToken) return;
          currentBackendVolume = restoreVol;
          void playbackApi.setVolume(restoreVol).catch(() => {});
        }, 200);
      }
      return;
    }

    // === 播放分支 ===
    // 用户重新点了播放，撤销之前的取消标记，并取消可能正在进行的淡出
    cancelFade();
    cancelledPlayRequestId = -1;

    if (!isSongLoaded.value) {
      // playSong 内部会自行设置 isPlaying / 启动播放时钟，这里直接返回避免重复
      await playSong(currentSong.value, {
        startTime: currentTime.value,
        continueStatisticsSession: true,
      });
      return;
    }

    // [渐入渐出] 淡入：从当前后端音量渐变到目标音量。
    // - 中途打断（淡出途中点播放）：currentBackendVolume 是中间值，从此处继续淡入，听感更自然
    // - 正常暂停后恢复：currentBackendVolume ≈ 目标值（暂停时已恢复），需从 0 开始淡入
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
      await playbackApi.resumeAudio();
      sessionStartTime = Date.now();
      startPlaybackRuntime();
      void fadeVolumeTo(targetVol, fadeDuration, startVol);
    } else {
      await playbackApi.resumeAudio();
      sessionStartTime = Date.now();
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
