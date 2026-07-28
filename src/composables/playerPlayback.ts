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

// [落雪] HTML5 Audio 网络音频播放（与 YinDongMusic 一致）
let networkAudio: HTMLAudioElement | null = null;
let networkAudioTimeUpdateHandler: (() => void) | null = null;
let networkAudioEndedHandler: (() => void) | null = null;
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

    let audioFilePath = song.cue_source_path || song.path;
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
            const urlResult = await lxPluginGetMusicUrl(matchedPlugin, lxSource, {
              songId: songmid,
              name: song.name,
              singer: song.artist,
              albumName: song.album,
              source: lxSource,
              songmid,
              // 传入缓存的完整元信息，某些 LX 插件需要这些字段才能正确解析 URL
              hash: cachedInfo?.hash,
              copyrightId: cachedInfo?.copyrightId,
              strMediaMid: cachedInfo?.strMediaMid,
              albumId: cachedInfo?.albumId,
              albumMid: cachedInfo?.albumMid,
              interval: cachedInfo?.interval,
              _types: cachedInfo?._types,
              types: cachedInfo?.types,
            } as any, '320k');
            const musicUrl = urlResult?.url;
            if (musicUrl && /^https?:/.test(musicUrl)) {
              audioFilePath = musicUrl;
            } else {
              console.warn(`[Audio] lxPluginGetMusicUrl returned empty/invalid URL for lx://${lxSource}/${songmid}`);
            }
          } else {
            console.warn(`[Audio] No LX plugin available for lx://${lxSource}/${songmid}`);
          }
        } catch (e: any) {
          console.warn(`[Audio] Failed to resolve lx:// URL via plugin: ${e?.message}`);
        }
      }
    }

    try {
      const isNetworkAudio = audioFilePath.startsWith('http://') || audioFilePath.startsWith('https://');

      if (isNetworkAudio) {
        // [落雪] 网络音频走 HTML5 Audio 元素播放（与 YinDongMusic 一致）
        // 1. 停止后端播放
        try { await playbackApi.pauseAudio(); } catch {}
        // 2. 停止上一个网络音频
        stopNetworkAudio();

        // [IDM 兼容模式] 开启后先在 Worker 线程把整首音频拉成本地 blob 再播放，
        // 这样主线程不会直接请求音频直链，可避免被 IDM 等下载器劫持导致播放异常。
        let playbackSource = audioFilePath;
        if (settingsStore.settings.audio.idmCompatMode) {
          try {
            const { fetchViaWorker } = await import('../services/downloadService');
            const bytes = await fetchViaWorker(audioFilePath);
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
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('error', onError);
            resolve();
          };
          const onError = () => {
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('error', onError);
            reject(new Error(`Audio failed to load: ${audio.error?.code ?? 'unknown'}`));
          };
          audio.addEventListener('canplay', onCanPlay);
          audio.addEventListener('error', onError);
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
        audio.addEventListener('timeupdate', networkAudioTimeUpdateHandler);
        audio.addEventListener('ended', networkAudioEndedHandler);

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
      } else {
        // 本地音频走 Rust 后端播放
        // [修复] 先彻底停掉可能残留的网络音频，否则从在线歌切到本地歌时，
        // 上一首在线歌会继续播放，且 pause/seek 会误操作到它上面
        stopNetworkAudio();

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
      }
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

      if (networkAudio) {
        networkAudio.pause();
      } else {
        await playbackApi.pauseAudio();
      }
      isPlaying.value = false;
      stopPlaybackRuntime();
      return;
    }

    if (!isSongLoaded.value) {
      await playSong(currentSong.value, { startTime: currentTime.value });
    } else if (networkAudio) {
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
