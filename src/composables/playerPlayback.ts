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

const getSmtcTitle = (song: Song) => song.title?.trim() || song.name.replace(/\.[^/.]+$/, '');
const LOW_POWER_PROGRESS_UPDATE_MS = 1000;
// [修复防御] 本地音频后端进度 reanchor 漂移容忍度。
// 对齐 YinDongMusic 的逐字歌词播放方法：默认信任 rAF 自增（performance.now() 墙钟），
// 后端 samples_played 仅用于播放结束兜底检测与严重漂移纠正。
// 旧阈值 0.05s 过严：后端 samples_played（音频设备实际拉取采样，见 types.rs TimedSource::next）
// 天然滞后于 rAF 墙钟（音频缓冲、设备时钟漂移、歌曲开始解码器初始化），导致每秒 setInterval
// 都触发 reanchor 把 currentTime 突变拉回后端滞后值，AMLL 逐字进度回退
// → "前 3 个字来回循环" + 歌词行上下跳动。
const LOCAL_AUDIO_DRIFT_TOLERANCE_SECONDS = 1.5;

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

      progressFrameId = requestAnimationFrame(update);
    };

    // All audio (local + network) uses HTML5 Audio timeupdate event for progress sync.
    // No need for Tauri backend polling anymore.
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

      // [落雪] 异步获取歌词（包括逐字歌词 lxlyric），不阻塞播放
      if (!song.lyrics_raw) {
        void (async () => {
          let lyricResult: { lyric: string; tlyric?: string | null; rlyric?: string | null; lxlyric?: string | null } | null = null;
          // 0. 优先直接从音乐平台 API 获取歌词（包括逐字歌词 lxlyric）
          try {
            const { fetchLxLyric, getCachedLxSongInfo } = await import('../services/lxLyricFetcher');
            const cachedInfo = getCachedLxSongInfo(lxSource, songmid);
            const result = await fetchLxLyric(lxSource as 'kw' | 'kg' | 'tx' | 'wy', cachedInfo ?? {
              songmid, name: song.name, singer: song.artist,
              albumName: song.album, source: lxSource,
            });
            if (result && (result.lyric || result.lxlyric)) lyricResult = result;
          } catch { /* direct API fetch failed, try plugins */ }
          // 1. [回退] 通过 LX 插件获取歌词
          if (!lyricResult?.lyric && !lyricResult?.lxlyric) {
            try {
              const { lxPluginGetLyric, ensureLxPluginInstance } = await import('../services/lxPluginEngine');
              const { getStoredPlugins } = await import('../services/pluginEngine');
              const lxPlugins = getStoredPlugins().filter(p => p.enabled && p.format === 'lx');
              let matchedPlugin = lxPlugins.find(p => p.sources.includes(lxSource));
              if (!matchedPlugin && lxPlugins.length > 0) matchedPlugin = lxPlugins[0];
              if (matchedPlugin) {
                await ensureLxPluginInstance(matchedPlugin);
                const lrcResult = await lxPluginGetLyric(matchedPlugin, lxSource, {
                  songId: songmid, name: song.name, singer: song.artist,
                  albumName: song.album, source: lxSource, songmid,
                } as any);
                if (lrcResult?.lyric) {
                  lyricResult = lrcResult;
                }
              }
            } catch { /* LX plugin may not support lyric action */ }
          }
          if (lyricResult?.lyric || lyricResult?.lxlyric) {
            const { buildLyricsRaw } = await import('./lyrics/parser');
            const lyricsText = buildLyricsRaw(
              lyricResult.lyric,
              lyricResult.tlyric ?? null,
              lyricResult.rlyric ?? null,
              lyricResult.lxlyric ?? null,
            );
            song.lyrics_raw = lyricsText;
            const { loadLyrics } = await import('./lyrics/state');
            const { usePlaybackStore } = await import('../features/playback/store');
            const playbackStore = usePlaybackStore();
            if (playbackStore.currentSong?.path === song.path) {
              playbackStore.currentSong = { ...playbackStore.currentSong, lyrics_raw: lyricsText };
              void loadLyrics();
            }
          }
        })();
      }
    }

    try {
      const isNetworkAudio = audioFilePath.startsWith('http://') || audioFilePath.startsWith('https://');

      if (isNetworkAudio) {
        // [落雪] 网络音频走 HTML5 Audio 元素播放（与 YinDongMusic 一致）
        // 1. 停止后端播放
        try { await playbackApi.pauseAudio(); } catch {}
        // 2. 停止上一个网络音频
        if (networkAudio) {
          networkAudio.pause();
          if (networkAudioTimeUpdateHandler) networkAudio.removeEventListener('timeupdate', networkAudioTimeUpdateHandler);
          if (networkAudioEndedHandler) networkAudio.removeEventListener('ended', networkAudioEndedHandler);
          networkAudio.src = '';
          networkAudio = null;
        }

        const audio = new Audio();
        audio.preload = 'auto';
        // [修复 CORS] 不设置 crossOrigin，允许跨域音频播放
        audio.volume = playbackStore.volume / 100;
        audio.src = audioFilePath;
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
          audio.pause();
          return;
        }

        // 设置进度同步和播放结束处理器
        networkAudioTimeUpdateHandler = () => {
          if (!networkAudio || !isPlaying.value) return;
          const newTime = networkAudio.currentTime;
          if (Math.abs(newTime - currentTime.value) > 0.05) {
            reanchorPlaybackClock(newTime);
          }
        };
        networkAudioEndedHandler = () => {
          handleAutoNext();
        };
        audio.addEventListener('timeupdate', networkAudioTimeUpdateHandler);
        audio.addEventListener('ended', networkAudioEndedHandler);

        audio.play().catch(() => {});
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
