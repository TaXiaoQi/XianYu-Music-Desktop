import { storeToRefs } from 'pinia';
import { watch } from 'vue';
import type { Song, QualityKey } from '../types';
import { QUALITY_META, ALL_QUALITY_KEYS, ALL_QUALITY_KEYS_DESC } from '../types';
import { playbackApi } from '../services/tauri/playbackApi';
import { usePlaybackStore } from '../features/playback/store';
import { useSettingsStore } from '../features/settings/store';
import { useUiStore } from '../shared/stores/ui';
import { useCoverCache } from './useCoverCache';
import { useRenderingPower } from './renderingPower';
import { fetchLxSongLyricsRaw } from '../services/lxLyricFetcher';

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
let periodicFlushTimerId: ReturnType<typeof setInterval> | null = null;
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
let isSeeking = false;
// duration 未知时用于检测播放结束：记录上次后端进度及停滞轮次
let lastRawProgress = -1;
let stalledProgressTicks = 0;
// [在线失败行为] 记录上一次因起播失败而重试过的歌曲路径，避免 'retry' 无限重试
let lastFailureRetriedPath: string | null = null;

// [落雪] HTML5 Audio 网络音频播放（与 YinDongMusic 一致）
let networkAudio: HTMLAudioElement | null = null;
let networkAudioTimeUpdateHandler: (() => void) | null = null;
let networkAudioEndedHandler: (() => void) | null = null;
let networkAudioErrorHandler: (() => void) | null = null;
/** IDM 兼容模式下为音频创建的 blob URL，需在切歌/停止时释放，避免内存泄漏 */
let networkAudioBlobUrl: string | null = null;

// --- 在线音频可视化（仅 IDM 兼容模式的本地 blob 可用；跨域直链受浏览器安全限制无法分析）---
let networkAudioContext: AudioContext | null = null;
let networkAnalyser: AnalyserNode | null = null;
let networkAnalyserSource: MediaElementAudioSourceNode | null = null;
let networkAnalyserBuffer: Uint8Array | null = null;
const NETWORK_VISUALIZER_BANDS = 48;

/**
 * 为网络音频建立 Web Audio 分析链路（仅在本地 blob 播放时调用，跨域直链无法分析）。
 *
 * 关键点：
 * - AudioContext 全局单例、只复用不 close。一旦对某个 <audio> 调用 createMediaElementSource，
 *   该元素的音频就被路由进这个 context，必须保持 context running 否则会没声音/卡住。
 * - 每首歌的 <audio> 是新实例，为它单独建 source（同一元素只能建一次，新元素没问题）。
 */
const setupNetworkAnalyser = async (audio: HTMLAudioElement) => {
  try {
    // 先断开上一首的 source（但不销毁 context）
    try { networkAnalyserSource?.disconnect(); } catch { /* ignore */ }
    networkAnalyserSource = null;

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    if (!networkAudioContext) {
      networkAudioContext = new AudioCtx();
    }
    // 自动播放策略可能让 context 处于 suspended。必须先等它恢复 running 再接入 source，
    // 否则音频被路由进一个非 running 的 context 会没声音/卡住——宁可放弃可视化也不能影响播放
    if (networkAudioContext.state === 'suspended') {
      try { await networkAudioContext.resume(); } catch { /* ignore */ }
    }
    if (networkAudioContext.state !== 'running') {
      return; // 无法恢复：不接入 source，保住正常播放
    }

    if (!networkAnalyser) {
      networkAnalyser = networkAudioContext.createAnalyser();
      networkAnalyser.fftSize = 256;
      networkAnalyser.smoothingTimeConstant = 0.75;
      networkAnalyser.connect(networkAudioContext.destination);
      networkAnalyserBuffer = new Uint8Array(networkAnalyser.frequencyBinCount);
    }

    // 链路：source → analyser → destination（保证仍能听到声音）
    networkAnalyserSource = networkAudioContext.createMediaElementSource(audio);
    networkAnalyserSource.connect(networkAnalyser);
  } catch (e: any) {
    console.warn('[Audio] 网络音频可视化分析链路创建失败:', e?.message || e);
    teardownNetworkAnalyser();
  }
};

/** 断开当前歌曲的 source（保留复用 context/analyser 单例，避免反复创建销毁导致卡顿） */
const teardownNetworkAnalyser = () => {
  try { networkAnalyserSource?.disconnect(); } catch { /* ignore */ }
  networkAnalyserSource = null;
};

/**
 * 读取网络音频当前频谱，返回 0..1 的 48 个频段电平（与 Rust 后端可视化输出量级一致）。
 * 无分析链路或频谱全为 0（context 未运行/静音）时返回空数组，调用方应回退到 Rust 数据源。
 */
export const getNetworkVisualizerLevels = (): number[] => {
  if (!networkAnalyserSource || !networkAnalyser || !networkAnalyserBuffer) return [];
  if (networkAudioContext?.state !== 'running') return [];

  networkAnalyser.getByteFrequencyData(networkAnalyserBuffer);
  const bins = networkAnalyserBuffer;
  // 只取低到中频段（人耳音乐能量主要集中区），映射到 48 个频段
  const usableBins = Math.floor(bins.length * 0.8);
  const levels: number[] = new Array(NETWORK_VISUALIZER_BANDS);
  let total = 0;
  for (let i = 0; i < NETWORK_VISUALIZER_BANDS; i += 1) {
    const start = Math.floor((i / NETWORK_VISUALIZER_BANDS) * usableBins);
    const end = Math.max(start + 1, Math.floor(((i + 1) / NETWORK_VISUALIZER_BANDS) * usableBins));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += bins[j];
    const level = sum / (end - start) / 255;
    levels[i] = level;
    total += level;
  }
  // 全 0（context 静音/未真正出数）时返回空，让调用方回退，避免频谱条贴底卡住
  if (total <= 0) return [];
  return levels;
};

/**
 * 彻底停止并清理 HTML5 网络音频。
 *
 * 播放本地歌曲（走 Rust 后端）之前必须调用，否则上一首在线歌的 Audio 实例会残留继续播放，
 * 并且让 pause/seek 的通道判断误判到已失效的网络音频上（表现为"切歌失败/暂停错乱"）。
 */
const stopNetworkAudio = () => {
  teardownNetworkAnalyser();
  if (!networkAudio) return;

  try {
    networkAudio.pause();
  } catch {
    // ignore
  }

  if (networkAudioTimeUpdateHandler) {
    networkAudio.removeEventListener('timeupdate', networkAudioTimeUpdateHandler);
    networkAudioTimeUpdateHandler = null;
  }
  if (networkAudioEndedHandler) {
    networkAudio.removeEventListener('ended', networkAudioEndedHandler);
    networkAudioEndedHandler = null;
  }
  if (networkAudioErrorHandler) {
    networkAudio.removeEventListener('error', networkAudioErrorHandler);
    networkAudioErrorHandler = null;
  }

  networkAudio.src = '';
  networkAudio = null;

  if (networkAudioBlobUrl) {
    URL.revokeObjectURL(networkAudioBlobUrl);
    networkAudioBlobUrl = null;
  }
};

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
    volume,
    currentAvailableQualities,
  } = storeToRefs(playbackStore);
  const { showPlayerDetail } = storeToRefs(uiStore);

  // 在线播放走 HTML5 audio，音量条只改了 Rust 后端音量，需同步到网络音频
  watch(volume, (value) => {
    if (networkAudio) {
      networkAudio.volume = Math.min(1, Math.max(0, value / 100));
    }
  });

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
    if (periodicFlushTimerId !== null) {
      clearInterval(periodicFlushTimerId);
      periodicFlushTimerId = null;
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

    // [定时刷新] 每 30 秒将当前播放会话刷写到统计数据库，确保「总听歌时长」准实时更新。
    // flushPlaySession 会重置 accumulatedTime 和 sessionStartTime，
    // 所以刷新后需立即重启会话计时器，保证后续时长继续累积。
    periodicFlushTimerId = setInterval(() => {
      if (isPlaying.value && currentSong.value) {
        flushPlaySession();
        sessionStartTime = Date.now();
      }
    }, 30_000);

    syncIntervalId = setInterval(async () => {
      if (!isPlaying.value || isSeeking) return;

      // [在线播放] 网络音频走 HTML5 audio，进度以 audio 自身为准。
      // 不能用 Rust 后端的 getPlaybackProgress 校准——此时后端并未在播放，
      // 会返回过时/为 0 的值，反复把进度拉回，导致进度条闪烁。
      if (networkAudio) {
        const audioTime = networkAudio.currentTime;
        if (Number.isFinite(audioTime) && Math.abs(audioTime - currentTime.value) > 0.25) {
          reanchorPlaybackClock(audioTime);
        }
        return;
      }

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
          // 在线歌（HTTP 流）拖动进度条或中途缓冲时，后端进度可能停滞数秒才恢复。
          // 若沿用 2 轮阈值会被误判为播放结束而自动切下一首——切歌时若 Rust 起播探测
          // 失败又会回退 H5 用 WebView 请求直链，进而弹出 IDM。故对在线歌放宽阈值。
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

    // 新的播放请求：清掉上一次可能残留的取消标记
    cancelledPlayRequestId = -1;

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

    // 队列建立后再启动异步歌词请求，确保成功结果能同步更新队列 fallback。
    if (song.path.startsWith('lx://') && !song.lyrics_raw?.trim()) {
      void fetchLxSongLyricsRaw(song)
        .then((lyricsRaw) => {
          if (
            !lyricsRaw
            || requestId !== playRequestId
            || currentSong.value?.path !== song.path
          ) {
            return;
          }

          // 在线歌曲由 fallback 对象承载；先更新源对象，确保队列与当前歌曲共享引用时都能获得歌词。
          song.lyrics_raw = lyricsRaw;
          const songWithLyrics = { ...currentSong.value, lyrics_raw: lyricsRaw };
          playQueue.value = playQueue.value.map(item => (
            item.path === song.path ? { ...item, lyrics_raw: lyricsRaw } : item
          ));
          currentSong.value = songWithLyrics;
          void loadLyrics();
        })
        .catch(error => console.warn('[Lyrics] LX 在线歌词获取失败:', error));
    }

    // [MusicFree 插件] plugin:// 协议歌曲异步获取歌词（不阻塞播放）
    // 播放入口（handlePlayMfSong 等）可能已通过 pluginGetMusicInfo 获取了歌词并设置到 lyrics_raw，
    // 此处仅在歌词为空时通过 pluginGetLyric 补获（支持逐字歌词）。
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
            const songWithLyrics = { ...currentSong.value, lyrics_raw: lyricData.lyricsRaw };
            playQueue.value = playQueue.value.map(item => (
              item.path === song.path ? { ...item, lyrics_raw: lyricData.lyricsRaw } : item
            ));
            currentSong.value = songWithLyrics;
            void loadLyrics();
          } catch (error) {
            console.warn('[Lyrics] plugin:// 在线歌词获取失败:', error);
          }
        })();
      }
    }

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

    // 提前获取当前歌曲支持的音质列表（与 URL 解析独立，确保预获取 URL 的歌曲也能正确渲染音质选项）
    currentAvailableQualities.value = null;
    const songPath = song.cue_source_path || song.path;
    try {
      if (songPath.startsWith('lx://')) {
        // LX 歌曲：从缓存的 _types 提取
        const parts = songPath.replace('lx://', '').split('/');
        const lxSource = parts[0];
        const songmid = parts.slice(1).join('/');
        if (lxSource && songmid) {
          const { getCachedLxSong } = await import('../services/lxSongCache');
          const cachedInfo = getCachedLxSong(lxSource, songmid);
          if (cachedInfo?._types) {
            const lxQualities = Object.keys(cachedInfo._types)
              .filter(k => k in QUALITY_META) as QualityKey[];
            if (lxQualities.length > 0) {
              currentAvailableQualities.value = lxQualities
                .sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank);
            }
          }
        }
      } else if (songPath.startsWith('plugin://')) {
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

    let audioFilePath = song.cue_source_path || song.path;
    // 插件返回的自定义请求头（防盗链 Cookie/Referer 等），随 URL 一起传递给播放器
    let pluginHeaders: Record<string, string> | null = null;
    const startOffsetMs = cueStartOffset + Math.round(resumeTime * 1000);

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
            const cachedInfo = getCachedLxSong(lxSource, songmid);
            // 读取用户在设置中选择的默认音质（统一 12 档）
            const requestedQuality = settingsStore.settings.audio.onlineDefaultQuality || '320k';
            const fallbackBehavior = settingsStore.settings.audio.onlineQualityFallbackBehavior ?? 'lower';

            // 根据音质回退行为构建尝试列表
            const lxTryQualities: QualityKey[] = (() => {
              if (fallbackBehavior === 'pause') return [requestedQuality];
              if (fallbackBehavior === 'higher') {
                const idx = ALL_QUALITY_KEYS.indexOf(requestedQuality);
                if (idx === -1) return [requestedQuality];
                return ALL_QUALITY_KEYS.slice(idx); // 从请求音质向上升级
              }
              // lower：从请求音质向下降级
              const idx = ALL_QUALITY_KEYS_DESC.indexOf(requestedQuality);
              if (idx === -1) return [requestedQuality];
              return ALL_QUALITY_KEYS_DESC.slice(idx);
            })();

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
        audioFilePath = preUrl;
        // 加载预获取时保存的防盗链 headers
        if (song.remote_headers) {
          pluginHeaders = song.remote_headers;
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
              // 读取用户在设置中选择的统一音质，直接传给插件
              // pluginGetMusicInfo 内部会先尝试新键值（Toskysun 插件），再回退到旧三档（原版 MusicFree）
              const requestedQuality = settingsStore.settings.audio.onlineDefaultQuality || '320k';
              const fallbackBehavior = settingsStore.settings.audio.onlineQualityFallbackBehavior ?? 'lower';
              const musicInfo = await pluginGetMusicInfo(pluginSource, pluginSearchResult, requestedQuality, fallbackBehavior);
              if (musicInfo?.url && /^https?:/.test(musicInfo.url)) {
                audioFilePath = musicInfo.url;
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

    try {
      const isNetworkAudio = audioFilePath.startsWith('http://') || audioFilePath.startsWith('https://');

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
        lastFailureRetriedPath = null; // 起播成功，清除重试标记
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

      // [在线 H5 回退] 原 HTML5 Audio 播放逻辑，作为在线走 Rust 失败时的兜底。
      // 返回是否成功起播（被切歌作废时返回 true 表示无需继续）。
      const playOnlineViaHtml5 = async (): Promise<void> => {
        // [避免 IDM 劫持] H5 回退路径一律先在 Worker 线程把整首音频拉成本地 blob 再播放。
        // 主线程直接请求音频直链会被 IDM 等下载器拦截（弹出下载框、播放失败），而 Worker
        // 线程的请求通常能逃过拦截。原先仅在用户开启「IDM 兼容模式」时才这么做，导致未开启
        // 该设置的用户一旦走到 H5 回退就会弹出 IDM；这里改为回退时总是优先 blob，
        // 拉取失败再退回直链保证可用性。
        // 注意：Rust 主路径不经过此函数，因此「IDM 相关处理仅作用于 H5 回退」的边界不变。
        let playbackSource = audioFilePath;
        {
          try {
            const { fetchViaWorker } = await import('../services/downloadService');
            const bytes = await fetchViaWorker(audioFilePath, undefined, pluginHeaders);
            if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

            const blob = new Blob([bytes as BlobPart], { type: 'audio/mpeg' });
            playbackSource = URL.createObjectURL(blob);
            networkAudioBlobUrl = playbackSource;
          } catch (e: any) {
            // 拉取失败则回退到直链播放，保证可用性
            console.warn('[Audio] IDM 兼容模式拉取失败，回退直链播放:', e?.message || e);
            playbackSource = audioFilePath;
          }
        }

        const audio = new Audio();
        audio.preload = 'auto';
        // [修复 CORS] 不设置 crossOrigin，允许跨域音频播放
        audio.volume = playbackStore.volume / 100;
        audio.src = playbackSource;
        networkAudio = audio;

        // 等待 canplay
        await new Promise<void>((resolve, reject) => {
          const onCanPlay = () => {
            console.log('[Audio] canplay fired, duration=', audio.duration);
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('error', onError);
            audio.removeEventListener('stalled', onStalled);
            resolve();
          };
          const onError = () => {
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('error', onError);
            audio.removeEventListener('stalled', onStalled);
            const mediaError = audio.error;
            const detail = mediaError
              ? `code=${mediaError.code} ${mediaError.message || ''}`
              : 'unknown';
            console.error(`[Audio] HTML5 Audio load failed: ${detail}`, 'src=', playbackSource?.substring(0, 120));
            reject(new Error(`Audio failed to load: ${detail}`));
          };
          const onStalled = () => {
            console.warn('[Audio] stalled - loading might be blocked (CORS/Referer/403):', playbackSource?.substring(0, 120));
          };
          audio.addEventListener('canplay', onCanPlay);
          audio.addEventListener('error', onError);
          audio.addEventListener('stalled', onStalled);
          audio.load();
        });

        if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
          // [修复] 本次播放已被新的切歌请求作废：除了暂停，还要清理掉指针，
          // 否则这个废弃实例会残留并影响后续 pause/seek 的通道判断
          audio.pause();
          audio.src = '';
          if (networkAudio === audio) {
            networkAudio = null;
          }
          if (networkAudioBlobUrl === playbackSource) {
            URL.revokeObjectURL(networkAudioBlobUrl);
            networkAudioBlobUrl = null;
          }
          return;
        }

        // 设置进度同步和播放结束处理器
        networkAudioTimeUpdateHandler = () => {
          if (!networkAudio || !isPlaying.value) return;
          const newTime = networkAudio.currentTime;
          // 阈值放宽：让 rAF 平滑时钟主导，仅在明显漂移时才校正，
          // 避免每次 timeupdate（~4Hz）都 reanchor 导致进度条来回抖动
          if (Math.abs(newTime - currentTime.value) > 0.5) {
            reanchorPlaybackClock(newTime);
          }
        };
        networkAudioEndedHandler = () => {
          handleAutoNext();
        };
        // [在线中途被打断行为] 播放开始后音频出错（网络中断/解码异常）时默认暂停等待，停在当前位置
        networkAudioErrorHandler = () => {
          if (!networkAudio || currentSong.value?.path !== song.path) return;
          isPlaying.value = false;
          stopPlaybackRuntime();
        };
        audio.addEventListener('timeupdate', networkAudioTimeUpdateHandler);
        audio.addEventListener('ended', networkAudioEndedHandler);
        audio.addEventListener('error', networkAudioErrorHandler);

        // 用户在加载音频期间按了暂停：保留已就绪的 audio 元素（后续点播放可直接续播），
        // 但不要出声，并停在暂停态
        if (cancelledPlayRequestId === requestId) {
          isSongLoaded.value = true;
          isPlaying.value = false;
          stopPlaybackRuntime();
          loadLyrics();
          return;
        }

        audio.play().catch(() => {});

        // [在线可视化] 仅在 IDM 兼容模式的本地 blob（同源）下建立 Web Audio 分析链路。
        // 跨域直链受浏览器安全限制（tainted）无法取频谱；放到 play() 之后建立，
        // 且分析链路创建失败/无法恢复 context 时不影响正常播放（内部已做保护）
        if (networkAudioBlobUrl && networkAudioBlobUrl === playbackSource) {
          void setupNetworkAnalyser(audio);
        }

        isSongLoaded.value = true;
        sessionStartTime = Date.now();
        loadLyrics();
        startPlaybackRuntime();

        // [修复] duration 未知时从 Audio 元素回退填充
        if (currentSong.value && (!currentSong.value.duration || currentSong.value.duration <= 0)) {
          const audioDuration = audio.duration;
          if (audioDuration && audioDuration > 0 && isFinite(audioDuration)) {
            currentSong.value = { ...currentSong.value, duration: Math.floor(audioDuration) };
          }
        }

        // 更新 SMTC 元数据
        void playbackApi.updatePlaybackMetadata({
          title: getSmtcTitle(song),
          artist: song.artist || 'Unknown Artist',
          album: song.album || 'Unknown Album',
          cover: cachedCoverPath,
          duration: Math.floor(song.duration),
          isPlaying: true,
        }).catch(() => {});

        // 封面加载回调
        void currentThumbnailLoad
          .then(async ([cover, coverPath]) => {
            if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;
            const normalizedCover = cover || '';
            const normalizedCoverPath = coverPath || '';
            currentCover.value = normalizedCover;
            if (!currentCoverFull.value) currentCoverFull.value = normalizedCover;
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

      // [在线走 Rust] 用后端 rodio + HTTP Range 流播放在线直链。
      // 成功返回 true；抛错（403 防盗链 / 不支持 Range / 解码失败）返回 false 由调用方回退 H5。
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
          console.warn('[Audio] 在线直链 playAudio 调用失败，回退 HTML5:', e?.message || e);
          return false;
        }

        // [起播探测] play_audio 是异步投递命令：调用立即返回，真正的取流/解码/播放在后台线程进行。
        // 若远程取流失败（防盗链 403 / 不支持 Range / 解码失败），后端不会抛错，需前端探测。
        //
        // 判定就绪的主信号：getPlaybackReady()（sample_rate>0，即 Decoder::new 成功）。
        // - 对支持 Range 的流：解码器读到文件头即就绪，通常很快。
        // - 对不支持 Range 的直链：后端会整曲下载到内存后才解码，可能耗时数秒到十几秒，
        //   因此给较长超时；只要期间 ready 变 true 就算成功，不误判为失败。
        // 就绪后再要求进度真实推进一点，排除"就绪但立刻卡死"的极端情况。
        const READY_TIMEOUT_MS = 20000;
        const PROBE_INTERVAL_MS = 200;
        const ADVANCE_THRESHOLD = 0.3;
        const probeStart = Date.now();
        let ready = false;
        let firstProgress: number | null = null;
        while (Date.now() - probeStart < READY_TIMEOUT_MS) {
          if (requestId !== playRequestId || currentSong.value?.path !== song.path) {
            return true; // 已被新切歌请求接管，无需回退
          }
          try {
            // 硬失败（403 / 不支持 Range / 解码失败）：后端已置位，立即回退，不必死等超时
            if (await playbackApi.getPlaybackStartFailed()) {
              console.warn('[Audio] 在线直链走 Rust 起播失败（后端报错），立即回退 HTML5');
              return false;
            }
            if (!ready) {
              ready = await playbackApi.getPlaybackReady();
            }
            if (ready) {
              const progress = await playbackApi.getPlaybackProgress();
              if (progress > 0) {
                if (firstProgress === null) firstProgress = progress;
                if (progress - firstProgress >= ADVANCE_THRESHOLD) return true;
              }
            }
          } catch { /* ignore, keep probing */ }
          await new Promise(resolve => setTimeout(resolve, PROBE_INTERVAL_MS));
        }

        console.warn('[Audio] 在线直链走 Rust 起播探测失败（未就绪或进度未推进），回退 HTML5');
        return false;
      };

      if (isNetworkAudio && !isM4sLocal) {
        // [在线播放] 先停掉可能残留的网络音频，再优先走 Rust 后端播放（可视化/均衡器/响度均衡生效，
        // 且请求由 Rust 进程发起，规避 IDM 劫持）；Rust 失败时回退到 HTML5 播放。
        stopNetworkAudio();

        // [兼容模式逃生开关] 用户开启后跳过 Rust，直接走 HTML5 + Worker blob 播放。
        // 供 Rust 内核在某些音源/环境下播放异常时使用（代价：无频谱/均衡器，起播略慢）。
        const forceHtml5 = settingsStore.settings.audio.idmCompatMode;
        const rustOk = forceHtml5 ? false : await tryPlayOnlineViaRust();
        if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

        // 用户在解析直链期间按了暂停：停掉刚起来的播放并保持暂停态，不要继续出声
        if (cancelledPlayRequestId === requestId) {
          try { await playbackApi.stopAudio(); } catch {}
          stopNetworkAudio();
          isPlaying.value = false;
          isSongLoaded.value = false;
          stopPlaybackRuntime();
          return;
        }

        if (rustOk) {
          // 确保后端已接管，音量同步到后端（H5 分支靠 audio.volume，Rust 分支靠 setVolume）
          try { await playbackApi.setVolume(playbackStore.volume / 100); } catch {}
          finishRustPlaybackStart();
        } else {
          // 回退（或用户强制 H5）：彻底停掉后端可能半启动的播放
          // （stop 会 sink.stop + 清空 sink + 重置进度，而 pause 只暂停不清理，
          // 可能与随后的 H5 播放抢占音频设备或双重出声），再走 HTML5
          try { await playbackApi.stopAudio(); } catch {}
          await playOnlineViaHtml5();
        }
      } else {
        // 本地音频走 Rust 后端播放
        // [修复] 先彻底停掉可能残留的网络音频，否则从在线歌切到本地歌时，
        // 上一首在线歌会继续播放，且 pause/seek 会误操作到它上面
        stopNetworkAudio();

        await playbackApi.playAudio({
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
        });
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
      }
    } catch {
      if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

      isPlaying.value = false;
      isSongLoaded.value = false;
      sessionStartTime = null;
      stopPlaybackRuntime();

      // [在线播放起播失败行为] 仅对在线歌曲生效；本地歌曲维持原有「停止」表现
      const isOnlineSong = song.path.startsWith('lx://')
        || song.path.startsWith('plugin://')
        || song.path.startsWith('http://')
        || song.path.startsWith('https://')
        || song.path.startsWith('remote://');
      if (!isOnlineSong) return;

      const failureBehavior = settingsStore.settings.audio.onlineFailureBehavior ?? 'skip';
      if (failureBehavior === 'skip') {
        lastFailureRetriedPath = null;
        setTimeout(() => {
          if (currentSong.value?.path === song.path) handleAutoNext();
        }, 400);
      } else if (failureBehavior === 'retry') {
        // 每首歌只自动重试一次，重试仍失败则停止，避免死循环
        if (lastFailureRetriedPath !== song.path) {
          lastFailureRetriedPath = song.path;
          setTimeout(() => {
            if (currentSong.value?.path === song.path) {
              void playSong(song, { startTime: currentTime.value, preserveQueue: true });
            }
          }, 800);
        } else {
          lastFailureRetriedPath = null;
        }
      }
      // 'stop'：保持停止，不做额外处理
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

    isPlaying.value = false;
    if (networkAudio) {
      networkAudio.pause();
    } else {
      await playbackApi.pauseAudio();
    }
    stopPlaybackRuntime();
  };

  const togglePlay = async () => {
    if (!currentSong.value) return;

    if (isPlaying.value) {
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

      if (networkAudio) {
        networkAudio.pause();
      } else {
        await playbackApi.pauseAudio();
      }
      isPlaying.value = false;
      stopPlaybackRuntime();
      return;
    }

    // 用户重新点了播放，撤销之前的取消标记
    cancelledPlayRequestId = -1;

    if (!isSongLoaded.value) {
      // playSong 内部会自行设置 isPlaying / 启动播放时钟，这里直接返回避免重复
      await playSong(currentSong.value, { startTime: currentTime.value });
      return;
    }

    if (networkAudio) {
      await networkAudio.play().catch(() => {});
      sessionStartTime = Date.now();
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

    if (networkAudio) {
      // [落雪] 网络音频直接操作 HTML5 Audio 元素
      networkAudio.currentTime = targetTime;
      isSeeking = false;
      if (isPlaying.value) {
        startPlaybackRuntime();
      }
      return;
    }

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
    // 防止销毁后残留的网络音频继续播放
    stopNetworkAudio();
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
