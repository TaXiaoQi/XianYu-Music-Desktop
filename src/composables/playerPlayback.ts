import { storeToRefs } from 'pinia';
import { watch } from 'vue';
import type { Song, QualityKey } from '../types';
import { QUALITY_META, resolveOnlinePlayQuality } from '../types';
import { playbackApi } from '../services/tauri/playbackApi';
import { usePlaybackStore } from '../features/playback/store';
import { useSettingsStore } from '../features/settings/store';
import { useLibraryStore } from '../features/library/store';
import { useUiStore } from '../shared/stores/ui';
import { useCoverCache } from './useCoverCache';
import { useRenderingPower } from './renderingPower';
import { fetchLxSongLyricsRaw } from '../services/lxLyricFetcher';
import { useToast } from './toast';
import { reportUserBehavior } from '../services/usageStats';
import { useAuthStore } from '../features/auth/store';
import { preloadAmlLyricPlayer } from '../components/player/amlLyricPlayerLoader';
import { useSoundEffectStore } from '../features/playback/soundEffectStore';

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
// [YinDong 播放引擎移植] HTML5 Audio 元素（默认共享模式播放路径）
let networkAudio: HTMLAudioElement | null = null;
// 是否走 Rust 后端播放（WASAPI 独占模式）；false = HTML5 Audio 默认路径
let isBackendPlayback = false;
let currentPlayCountRecorded = false;
let isSeeking = false;
// duration 未知时用于检测播放结束：记录上次后端进度及停滞轮次
let lastRawProgress = -1;
let stalledProgressTicks = 0;

const getSmtcTitle = (song: Song) => song.title?.trim() || song.name.replace(/\.[^/.]+$/, '');
const LOW_POWER_PROGRESS_UPDATE_MS = 1000;

// [YinDong 播放引擎移植] 暴露当前播放路径给可视化器等模块
// true = WASAPI 独占（Rust 播放，频谱走 Rust get_audio_visualizer_samples）
// false = HTML5 Audio（Web Audio，频谱走 AnalyserNode）
export const isBackendPlaybackActive = (): boolean => isBackendPlayback;

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
    playMode,
    tempQueue,
    currentAvailableQualities,
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

    const requestIdle = (window as any).requestIdleCallback as
      | ((callback: () => void, options?: { timeout?: number }) => number)
      | undefined;

    if (requestIdle) {
      requestIdle(preload, { timeout: 1500 });
    } else {
      window.setTimeout(preload, 0);
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

  // [YinDong 播放引擎移植] 双路径播放控制辅助函数
  // 设置播放音量（WASAPI 独占走 Rust setVolume，HTML5 Audio 走 audio.volume）
  const setPlaybackVolume = (vol: number) => {
    if (isBackendPlayback) {
      void playbackApi.setVolume(vol).catch(() => {});
    } else if (networkAudio) {
      networkAudio.volume = vol;
    }
  };

  // 停止 HTML5 Audio 元素（断开 src 并释放）
  const stopHtmlAudio = () => {
    if (networkAudio) {
      networkAudio.pause();
      networkAudio.removeAttribute('src');
      networkAudio.load();
      networkAudio = null;
    }
  };

  // 停止所有播放（双路径统一入口）
  const stopAllPlayback = () => {
    if (isBackendPlayback) {
      void playbackApi.pauseAudio().catch(() => {});
    }
    stopHtmlAudio();
  };

  // [YinDong 播放引擎移植] 双路径暂停/恢复/跳转
  const pausePlayback = async () => {
    if (isBackendPlayback) {
      await playbackApi.pauseAudio();
    } else if (networkAudio) {
      networkAudio.pause();
    }
  };

  const resumePlayback = async () => {
    if (isBackendPlayback) {
      await playbackApi.resumeAudio();
    } else if (networkAudio) {
      await networkAudio.play();
    }
  };

  const seekPlayback = async (time: number, playing: boolean, requestId: number) => {
    if (isBackendPlayback) {
      await playbackApi.seekAudio({ time, isPlaying: playing, requestId });
    } else if (networkAudio) {
      networkAudio.currentTime = time;
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
        setPlaybackVolume(targetVol);
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
        setPlaybackVolume(currentVol);
        if (progress < 1) {
          fadeFrameId = requestAnimationFrame(step);
        } else {
          fadeFrameId = null;
          fadeResolveFn = null;
          currentBackendVolume = targetVol;
          // 确保最终设置精确的目标音量
          setPlaybackVolume(targetVol);
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
        // [YinDong 播放引擎移植] 双路径进度同步：
        // WASAPI 独占走 Rust getPlaybackProgress；HTML5 Audio 直接读 audio.currentTime
        const rawTime = isBackendPlayback
          ? await playbackApi.getPlaybackProgress()
          : (networkAudio?.currentTime ?? 0);
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
        // 从音频引擎获取解码后的实际时长，更新 currentSong 和 libraryStore
        // [YinDong 播放引擎移植] HTML5 Audio 路径直接读 audio.duration
        const songForDuration = currentSong.value;
        if (songForDuration && (!songForDuration.duration || songForDuration.duration <= 0)) {
          try {
            const backendDuration = isBackendPlayback
              ? 0 // WASAPI 独占路径无 getPlaybackDuration 命令，依赖 song.duration
              : (networkAudio?.duration ?? 0);
            if (backendDuration > 0) {
              const newDuration = Math.floor(backendDuration);
              const updatedSong = { ...songForDuration, duration: newDuration };
              currentSong.value = updatedSong;
              playQueue.value = playQueue.value.map(item => (
                item.path === songForDuration.path ? { ...item, duration: newDuration } : item
              ));
              libraryStore.patchSongMeta(songForDuration.path, { duration: newDuration } as Partial<Song>);
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
      songSource = song.remote_source_id || 'plugin';
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
    stopAllPlayback();
    // [渐入渐出] 起播失败时恢复后端音量到用户设定值
    if (shouldFade) {
      currentBackendVolume = playbackStore.volume / 100;
      setPlaybackVolume(currentBackendVolume);
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
        const { findAlternativeLxSource } = await import('../services/lxSourceFallback');
        alternativeSong = await findAlternativeLxSource(song, switchCtx.failedSources);
      } catch (e: any) {
        console.warn(`[Audio] 自动换源查找异常: ${e?.message || e}`);
      }

      // [竞态检查] 搜索期间用户可能已切歌
      if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
        return;
      }

      if (alternativeSong) {
        const { getLxSourceDisplayName } = await import('../services/lxSourceFallback');
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
    const requestId = ++playRequestId;
    const previousSong = currentSong.value;

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

    addToHistory(song);

    // [预获取优化] 音质列表获取与 URL 解析并行执行，减少起播延迟
    // 音质列表独立于播放流程，可在后台并行获取
    currentAvailableQualities.value = null;
    const qSongPath = song.cue_source_path || song.path;
    const qualityListPromise = (async () => {
      try {
        if (qSongPath.startsWith('lx://')) {
          // LX 歌曲：从缓存的 _types 提取
          const parts = qSongPath.replace('lx://', '').split('/');
          const lxSource = parts[0];
          const songmid = parts.slice(1).join('/');
          if (lxSource && songmid) {
            const { getCachedLxSong } = await import('../services/lxSongCache');
            const persistedInfo = song.rawData?.source === lxSource ? song.rawData : null;
            const cachedInfo = getCachedLxSong(lxSource, songmid) ?? persistedInfo;
            if (cachedInfo?._types) {
              const lxQualities = Object.keys(cachedInfo._types)
                .filter(k => k in QUALITY_META) as QualityKey[];
              if (lxQualities.length > 0) {
                currentAvailableQualities.value = lxQualities
                  .sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank);
              }
            }
          }
        } else if (qSongPath.startsWith('plugin://')) {
          // plugin:// 歌曲：从插件实例的 supportedQualities 提取
          const pluginSearchResult = song.rawData;
          if (pluginSearchResult?.pluginId) {
            const { getStoredPlugins, pluginGetSupportedQualities } = await import('../services/pluginEngine');
            const plugins = getStoredPlugins();
            const pluginSource = plugins.find(p => p.id === pluginSearchResult.pluginId && p.enabled);
            if (pluginSource) {
              const supportedQ = await pluginGetSupportedQualities(pluginSource);
              if (supportedQ && supportedQ.length > 0) {
                currentAvailableQualities.value = supportedQ
                  .sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank);
              }
            }
          }
        }
      } catch { /* ignore: 音质列表获取失败不影响播放 */ }
    })();

    let audioFilePath = song.cue_source_path || song.path;
    // 插件返回的自定义请求头（防盗链 Cookie/Referer 等），随 URL 一起传递给播放器
    let pluginHeaders: Record<string, string> | null = null;
    const startOffsetMs = cueStartOffset + Math.round(resumeTime * 1000);

    // [音质列表] 在 URL 解析前等待音质列表获取完成，确保后续音质回退逻辑能正确过滤
    await qualityListPromise;

    // [落雪] lx:// 协议需要通过落雪插件引擎解析真实播放 URL
    // 完全对齐 YinDongMusic 的实现：getStoredPlugins → ensureLxPluginInstance → lxPluginGetMusicUrl
    if (audioFilePath.startsWith('lx://')) {
      const parts = audioFilePath.replace('lx://', '').split('/');
      const lxSource = parts[0];
      const songmid = parts.slice(1).join('/');
      if (lxSource && songmid) {
        try {
          const { getStoredPlugins } = await import('../services/pluginEngine');
          const { lxPluginGetMusicUrl, ensureLxPluginInstance } = await import('../services/lxPluginEngine');
          const { getCachedLxSong } = await import('../services/lxSongCache');
          // 从 localStorage 获取已启用的 LX 插件
          const lxPlugins = getStoredPlugins().filter(p => p.enabled && p.format === 'lx');
          // 优先找到支持该音源的插件，否则用第一个
          let matchedPlugin = lxPlugins.find(p => p.sources.includes(lxSource));
          if (!matchedPlugin && lxPlugins.length > 0) matchedPlugin = lxPlugins[0];
          if (matchedPlugin) {
            await ensureLxPluginInstance(matchedPlugin);
            // 从缓存获取完整的歌曲元信息（hash/strMediaMid/copyrightId 等）
            const persistedInfo = song.rawData?.source === lxSource ? song.rawData : null;
            const cachedInfo = getCachedLxSong(lxSource, songmid) ?? persistedInfo;
            // 读取音质：优先使用底部栏会话级临时覆盖，回退到设置页的在线播放音质
            const requestedQuality = playbackStore.sessionQualityOverride
              || settingsStore.settings.audio.onlineDefaultQuality || '320k';
            const fallbackBehavior = settingsStore.settings.audio.onlineQualityFallbackBehavior ?? 'lower';

            // [统一音质解析] 使用 resolveOnlinePlayQuality 构建有序尝试列表：
            // 首选音质 → 回退行为（lower/higher/pause）→ 最高可用兜底
            const lxTryQualities = resolveOnlinePlayQuality(
              requestedQuality,
              playbackStore.currentAvailableQualities,
              fallbackBehavior,
            );

            // 依次尝试音质列表，第一个返回有效 URL 的即采用
            for (const q of lxTryQualities) {
              const urlResult = await lxPluginGetMusicUrl(matchedPlugin, lxSource, {
                songId: songmid,
                name: song.name,
                singer: song.artist,
                albumName: song.album,
                source: lxSource,
                songmid,
                hash: cachedInfo?.hash,
                copyrightId: cachedInfo?.copyrightId,
                strMediaMid: cachedInfo?.strMediaMid,
                albumId: cachedInfo?.albumId,
                albumMid: cachedInfo?.albumMid,
                interval: cachedInfo?.interval,
                _types: cachedInfo?._types,
                types: cachedInfo?.types,
              } as any, q);
              const musicUrl = urlResult?.url;
              if (musicUrl && /^https?:/.test(musicUrl)) {
                audioFilePath = musicUrl;
                playbackStore.currentPlayingQuality = q;
                playbackStore.currentPlayingAudioUrl = musicUrl;
                break;
              }
            }
            if (audioFilePath.startsWith('lx://')) {
              console.warn(`[Audio] lxPluginGetMusicUrl returned empty/invalid URL for lx://${lxSource}/${songmid}, tried=${JSON.stringify(lxTryQualities)}`);
            }
          } else {
            console.warn(`[Audio] No LX plugin available for lx://${lxSource}/${songmid}`);
          }
        } catch (e: any) {
          console.warn(`[Audio] Failed to resolve lx:// URL via plugin: ${e?.message}`);
        }
      }
    }

    // [MusicFree 插件] plugin:// 协议需要通过插件引擎解析真实播放 URL
    // 用于"全部播放"场景：歌曲仅携带 rawData（PluginSearchResult），播放时才拉取直链
    if (audioFilePath.startsWith('plugin://')) {
      // 优先使用预获取的直链（remote_source_id），避免重复调用插件 API
      // 播放入口（如 handlePlayMfSong）会在播放前预获取 URL 并存到 remote_source_id
      const preUrl = song.remote_source_id;
      if (preUrl && /^https?:/.test(preUrl)) {
        // [缓存复用] Baka 等前置请求易失败的音源，若该 URL 已缓存完成则直接复用，不再请求插件
        // 避免每次播放都走 pluginGetMusicInfo（可能返回会失败的占位 URL）
        let usePreUrlDirectly = true;
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const cached = await invoke<boolean>('is_stream_cached', { url: preUrl });
          if (!cached && song.rawData?.pluginId) {
            // 未缓存：走插件解析获取新 URL（插件可能返回不同音质/防盗链直链）
            const { getStoredPlugins, pluginGetMusicInfo, pluginGetCover } = await import('../services/pluginEngine');
            const plugins = getStoredPlugins();
            const pluginSource = plugins.find(p => p.id === song.rawData!.pluginId && p.enabled);
            if (pluginSource) {
              const requestedQuality = playbackStore.sessionQualityOverride
                || settingsStore.settings.audio.onlineDefaultQuality || '320k';
              const fallbackBehavior = settingsStore.settings.audio.onlineQualityFallbackBehavior ?? 'lower';
              const musicInfo = await pluginGetMusicInfo(pluginSource, song.rawData, requestedQuality, fallbackBehavior, playbackStore.currentAvailableQualities);
              if (musicInfo?.url && /^https?:/.test(musicInfo.url)) {
                audioFilePath = musicInfo.url;
                usePreUrlDirectly = false;
                if (musicInfo.actualQuality) {
                  playbackStore.currentPlayingQuality = musicInfo.actualQuality;
                }
                playbackStore.currentPlayingAudioUrl = musicInfo.url;
                if (musicInfo.headers && Object.keys(musicInfo.headers).length > 0) {
                  pluginHeaders = musicInfo.headers;
                }
                if (!song.lyrics_raw?.trim() && musicInfo.lyricsRaw) {
                  song.lyrics_raw = musicInfo.lyricsRaw;
                }
                if (!song.cover_thumb_path) {
                  if (musicInfo.coverUrl) {
                    song.cover_thumb_path = musicInfo.coverUrl;
                  } else {
                    try {
                      const cover = await pluginGetCover(pluginSource, song.rawData);
                      if (cover) song.cover_thumb_path = cover;
                    } catch { /* ignore cover error */ }
                  }
                }
              }
            }
          }
        } catch (e: any) {
          console.warn('[Audio] 缓存检测/插件解析失败，回退到 preUrl:', e?.message);
        }
        if (usePreUrlDirectly) {
          audioFilePath = preUrl;
          // 记录实际播放直链，供下载时复用播放缓存
          playbackStore.currentPlayingAudioUrl = preUrl;
          if (song.remote_headers) {
            pluginHeaders = song.remote_headers;
          }
        }
      } else {
        // 回退到插件解析：通过 rawData 调用 pluginGetMusicInfo 获取直链
        const pluginSearchResult = song.rawData;
        if (pluginSearchResult?.pluginId) {
          try {
            const { getStoredPlugins, pluginGetMusicInfo, pluginGetCover } = await import('../services/pluginEngine');
            const plugins = getStoredPlugins();
            const pluginSource = plugins.find(p => p.id === pluginSearchResult.pluginId && p.enabled);
            if (pluginSource) {
              // 读取音质：优先使用底部栏会话级临时覆盖，回退到设置页的在线播放音质
              // pluginGetMusicInfo 内部会先尝试新键值（Toskysun 插件），再回退到旧三档（原版 MusicFree）
              const requestedQuality = playbackStore.sessionQualityOverride
                || settingsStore.settings.audio.onlineDefaultQuality || '320k';
              const fallbackBehavior = settingsStore.settings.audio.onlineQualityFallbackBehavior ?? 'lower';
              const musicInfo = await pluginGetMusicInfo(pluginSource, pluginSearchResult, requestedQuality, fallbackBehavior, playbackStore.currentAvailableQualities);
              if (musicInfo?.url && /^https?:/.test(musicInfo.url)) {
                audioFilePath = musicInfo.url;
                if (musicInfo.actualQuality) {
                  playbackStore.currentPlayingQuality = musicInfo.actualQuality;
                }
                playbackStore.currentPlayingAudioUrl = musicInfo.url;
                // 保存插件返回的防盗链 headers
                if (musicInfo.headers && Object.keys(musicInfo.headers).length > 0) {
                  pluginHeaders = musicInfo.headers;
                }

                // 更新歌词：仅使用 getMediaSource 返回的歌词（已由 buildLyricsRaw 构建为 lyricsRaw）
                // 不在此处同步调用 pluginGetLyric（避免阻塞播放），未获取到时由上方异步逻辑补获
                if (!song.lyrics_raw?.trim() && musicInfo.lyricsRaw) {
                  song.lyrics_raw = musicInfo.lyricsRaw;
                }

                // 更新封面（如果尚未有）
                if (!song.cover_thumb_path) {
                  if (musicInfo.coverUrl) {
                    song.cover_thumb_path = musicInfo.coverUrl;
                  } else {
                    try {
                      const cover = await pluginGetCover(pluginSource, pluginSearchResult);
                      if (cover) song.cover_thumb_path = cover;
                    } catch { /* ignore cover error */ }
                  }
                }
              } else {
                console.warn(`[Audio] pluginGetMusicInfo returned empty/invalid URL for plugin://${pluginSearchResult.pluginId}/${pluginSearchResult.id}`);
              }
            } else {
              console.warn(`[Audio] No enabled plugin found for pluginId=${pluginSearchResult.pluginId}`);
            }
          } catch (e: any) {
            console.warn(`[Audio] Failed to resolve plugin:// URL: ${e?.message}`);
          }
        }
      }
    }

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
          // [修复] 同步更新 library store 中的 extraSongPool/songPool 条目。
          // 当歌曲在 extraSongPool（在线收藏）中时，currentSong computed getter 会返回
          // extraSongPool 中的对象而非入参 song 或 fallback。若不更新池中对象，
          // loadLyrics 读到的 currentSong.lyrics_raw 仍为空，导致歌词加载超时。
          libraryStore.patchSongMeta(song.path, { lyrics_raw: lyricsRaw } as Partial<Song>);
          const songWithLyrics = { ...currentSong.value, lyrics_raw: lyricsRaw };
          playQueue.value = playQueue.value.map(item => (
            item.path === song.path ? { ...item, lyrics_raw: lyricsRaw } : item
          ));
          currentSong.value = songWithLyrics;
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
            const { getStoredPlugins, pluginGetLyric } = await import('../services/pluginEngine');
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
            const songWithLyrics = { ...currentSong.value, lyrics_raw: lyricData.lyricsRaw };
            playQueue.value = playQueue.value.map(item => (
              item.path === song.path ? { ...item, lyrics_raw: lyricData.lyricsRaw } : item
            ));
            currentSong.value = songWithLyrics;
            void loadLyrics(lyricData.lyricsRaw);
          } catch (error) {
            console.warn('[Lyrics] plugin:// 在线歌词获取失败:', error);
          }
        })();
      }
    }

    try {
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

      // [YinDong 播放引擎移植] 双路径播放：
      // - 默认（共享模式）：HTML5 <audio> + Web Audio 音效链（soundEffectEngine）
      // - WASAPI 独占模式：Rust rodio 后端 + set_audio_effects
      const useWasapiExclusive = settingsStore.settings.audio.usbExclusiveEnabled === true;
      isBackendPlayback = useWasapiExclusive;

      if (useWasapiExclusive) {
        // === WASAPI 独占路径（Rust 后端） ===
        const tryPlayViaRust = async (): Promise<boolean> => {
          try {
            await playbackApi.playAudio({
              path: isM4sLocal ? actualAudioPath : audioFilePath,
              title: getSmtcTitle(song),
              artist: song.artist || 'Unknown Artist',
              album: song.album || 'Unknown Album',
              cover: cachedCoverPath,
              duration: Math.floor(song.duration),
              outputMode: settingsStore.settings.audio.outputMode,
              startOffsetMs: startOffsetMs || undefined,
              songId: song.id ?? undefined,
              headers: pluginHeaders,
            });
          } catch (e: any) {
            console.warn('[Audio] WASAPI playAudio 调用失败:', e?.message || e);
            return false;
          }

          // [起播探测] play_audio 异步投递，通过 getBitstreamInfo 探测是否就绪
          const READY_TIMEOUT_MS = 20000;
          const PROBE_INTERVAL_MS = 200;
          const probeStart = Date.now();
          while (Date.now() - probeStart < READY_TIMEOUT_MS) {
            if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
              return true; // 已被新切歌请求接管
            }
            try {
              const info = await playbackApi.getBitstreamInfo();
              if (info.sampleRate > 0) {
                return true;
              }
            } catch { /* keep probing */ }
            await new Promise(resolve => setTimeout(resolve, PROBE_INTERVAL_MS));
          }
          console.warn('[Audio] WASAPI 独占起播探测失败（未就绪）');
          return false;
        };

        const rustOk = await tryPlayViaRust();
        if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

        // 用户在解析直链期间按了暂停：停掉刚起来的播放并保持暂停态
        if (cancelledPlayRequestId === requestId) {
          stopAllPlayback();
          if (shouldFadeOnSwitch) {
            currentBackendVolume = playbackStore.volume / 100;
            setPlaybackVolume(currentBackendVolume);
          }
          isPlaying.value = false;
          isSongLoaded.value = false;
          stopPlaybackRuntime();
          return;
        }

        if (rustOk) {
          if (shouldFadeOnSwitch) {
            currentBackendVolume = 0;
            setPlaybackVolume(0);
            finishRustPlaybackStart();
            void fadeVolumeTo(playbackStore.volume / 100, effectiveFadeDuration, 0);
          } else {
            currentBackendVolume = playbackStore.volume / 100;
            setPlaybackVolume(currentBackendVolume);
            finishRustPlaybackStart();
          }
        } else if (isNetworkAudio && !isM4sLocal) {
          // 在线起播失败：触发换源/失败处理
          await handleOnlinePlaybackFailure(song, options, requestId, shouldFadeOnSwitch);
          return;
        } else {
          // 本地文件 WASAPI 起播失败：回退到 HTML5 Audio
          isBackendPlayback = false;
        }
      }

      if (!isBackendPlayback) {
        // === HTML5 Audio 默认路径 ===
        stopHtmlAudio();
        const soundEffectStore = useSoundEffectStore();

        const audio = new Audio();
        audio.preload = 'auto';
        audio.crossOrigin = 'anonymous';

        // URL 解析：网络音频走代理（注入 CORS 头），本地文件走本地代理 URL
        const audioSrc = (isNetworkAudio && !isM4sLocal)
          ? await playbackApi.getProxiedAudioUrl(audioFilePath)
          : await playbackApi.getLocalAudioUrl(actualAudioPath);
        audio.src = audioSrc;
        audio.volume = playbackStore.volume / 100;

        // 连接到 Web Audio 音效处理链
        try {
          await soundEffectStore.connectAudio(audio);
        } catch (e: any) {
          console.warn('[Audio] 连接音效链失败:', e?.message || e);
        }

        // 等待 canplay 或 error（超时 20s）
        const canPlay = await new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => resolve(false), 20000);
          audio.addEventListener('canplay', () => {
            clearTimeout(timeout);
            resolve(true);
          }, { once: true });
          audio.addEventListener('error', () => {
            clearTimeout(timeout);
            resolve(false);
          }, { once: true });
        });

        if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
          stopHtmlAudio();
          return;
        }

        if (!canPlay) {
          stopHtmlAudio();
          if (isNetworkAudio && !isM4sLocal) {
            await handleOnlinePlaybackFailure(song, options, requestId, shouldFadeOnSwitch);
          } else {
            isPlaying.value = false;
            isSongLoaded.value = false;
            stopPlaybackRuntime();
          }
          return;
        }

        // 用户在解析直链期间按了暂停
        if (cancelledPlayRequestId === requestId) {
          stopHtmlAudio();
          isPlaying.value = false;
          isSongLoaded.value = false;
          stopPlaybackRuntime();
          loadLyrics();
          return;
        }

        // 起播
        try {
          if (startOffsetMs && startOffsetMs > 0) {
            audio.currentTime = startOffsetMs / 1000;
          }
          await audio.play();
        } catch (e: any) {
          console.warn('[Audio] HTML5 Audio play() 失败:', e?.message || e);
          stopHtmlAudio();
          isPlaying.value = false;
          isSongLoaded.value = false;
          stopPlaybackRuntime();
          return;
        }
        networkAudio = audio;

        // [在线歌曲时长修正] 从 audio.duration 获取实际时长
        if (audio.duration && audio.duration > 0 && (!song.duration || song.duration <= 0)) {
          const newDuration = Math.floor(audio.duration);
          const updatedSong = { ...song, duration: newDuration };
          currentSong.value = updatedSong;
          playQueue.value = playQueue.value.map(item => (
            item.path === song.path ? { ...item, duration: newDuration } : item
          ));
          libraryStore.patchSongMeta(song.path, { duration: newDuration } as Partial<Song>);
        }

        // 播放结束事件
        audio.addEventListener('ended', () => {
          if (requestId !== playRequestId) return;
          handleAutoNext();
        });

        // 渐入渐出 + 收尾
        if (shouldFadeOnSwitch) {
          currentBackendVolume = 0;
          audio.volume = 0;
          finishRustPlaybackStart();
          void fadeVolumeTo(playbackStore.volume / 100, effectiveFadeDuration, 0);
        } else {
          currentBackendVolume = playbackStore.volume / 100;
          audio.volume = currentBackendVolume;
          finishRustPlaybackStart();
        }
      }
    } catch {
      // [异常兜底] 仅处理状态清理，不执行起播失败行为
      // 起播失败行为已移至 rustOk===false 路径，仅在线引擎完全无法生效时执行
      if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

      // [渐入渐出] 异常时恢复后端音量到用户设定值
      if (shouldFadeOnSwitch) {
        currentBackendVolume = playbackStore.volume / 100;
        setPlaybackVolume(currentBackendVolume);
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
    await pausePlayback();
    stopPlaybackRuntime();

    // [渐入渐出] 淡出完成后延迟恢复音量：
    // pauseAudio 后 WASAPI 可能仍在播放已提交的缓冲区尾部，立即把音量从 0 拉回原值
    // 会让残余缓冲区以原音量突然发声，造成破音。等待 200ms 确保缓冲区播完后再恢复。
    if (fadeEnabled) {
      const restoreVol = playbackStore.volume / 100;
      setTimeout(() => {
        currentBackendVolume = restoreVol;
        setPlaybackVolume(restoreVol);
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

      await pausePlayback();
      if (myToken !== togglePlayToken) return;
      stopPlaybackRuntime();

      // [渐入渐出] 淡出完成后延迟恢复音量：
      // pauseAudio 后 WASAPI 可能仍在播放已提交的缓冲区尾部，立即把音量从 0 拉回原值
      // 会让残余缓冲区以原音量突然发声，造成破音。等待 200ms 确保缓冲区播完后再恢复。
      if (fadeEnabled) {
        const restoreVol = playbackStore.volume / 100;
        setTimeout(() => {
          if (myToken !== togglePlayToken) return;
          currentBackendVolume = restoreVol;
          setPlaybackVolume(restoreVol);
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
        setPlaybackVolume(0);
      }
      if (myToken !== togglePlayToken) return;
      await resumePlayback();
      sessionStartTime = Date.now();
      startPlaybackRuntime();
      void fadeVolumeTo(targetVol, fadeDuration, startVol);
    } else {
      await resumePlayback();
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
      await seekPlayback(targetTime + offsetSec, isPlaying.value, requestId);
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
    stopVolumeWatcher();
  };

  const stopPowerModeWatcher = watch(isMainWindowLowPower, () => {
    if (currentSong.value && isPlaying.value && !isSeeking) {
      startPlaybackRuntime();
    }
  });

  // [修复音量调节无反应] 统一音量应用入口：UI 滑块/滚轮/快捷键/静音/启动恢复
  // 只需设置 playbackStore.volume，此 watch 自动双路径分流：
  //   - WASAPI 后端：playbackApi.setVolume(vol)
  //   - HTML5 Audio：networkAudio.volume = vol
  // 原先 playerUiShell 直接调用 playbackApi.setVolume() 只对 Rust 后端生效，
  // HTML5 Audio 路径下 audio.volume 不更新，导致默认路径音量滑块完全无反应。
  const stopVolumeWatcher = watch(
    () => playbackStore.volume,
    (vol) => { setPlaybackVolume(vol / 100); },
  );

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
