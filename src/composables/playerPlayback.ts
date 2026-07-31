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
// [渐入渐出] 淡入淡出动画帧 ID，用于取消正在进行的音量渐变
let fadeFrameId: number | null = null;
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
// [在线失败行为] 记录上一次因起播失败而等待过的歌曲路径，避免 'wait' 无限等待
let lastFailureWaitedPath: string | null = null;

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
  };

  // [渐入渐出] 将实际输出音量从当前值渐变到目标值（不影响 playbackStore.volume 显示值）
  const fadeVolumeTo = (targetVolume: number, durationMs: number): Promise<void> => {
    return new Promise((resolve) => {
      cancelFade();
      const startVolume = playbackStore.volume / 100;
      const targetVol = Math.max(0, Math.min(1, targetVolume));
      if (Math.abs(startVolume - targetVol) < 0.005 || durationMs <= 0) {
        void playbackApi.setVolume(targetVol).catch(() => {});
        resolve();
        return;
      }
      const startTime = performance.now();
      const step = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        // 使用 easeOutQuad 缓动函数，让渐变更自然
        const eased = 1 - (1 - progress) * (1 - progress);
        const currentVol = startVolume + (targetVol - startVolume) * eased;
        void playbackApi.setVolume(currentVol).catch(() => {});
        if (progress < 1) {
          fadeFrameId = requestAnimationFrame(step);
        } else {
          fadeFrameId = null;
          // 确保最终设置精确的目标音量
          void playbackApi.setVolume(targetVol).catch(() => {});
          resolve();
        }
      };
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
    // [渐入渐出] 切歌时取消正在进行的淡入淡出动画
    cancelFade();

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

    // [音质跟踪] 切歌时重置实际播放音质，URL 解析成功后重新设置
    playbackStore.currentPlayingQuality = null;
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
            const cachedInfo = getCachedLxSong(lxSource, songmid);
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
          void loadLyrics();
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
            void loadLyrics();
          } catch (error) {
            console.warn('[Lyrics] plugin:// 在线歌词获取失败:', error);
          }
        })();
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
        lastFailureWaitedPath = null; // 起播成功，清除等待标记
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

        const rustOk = await tryPlayOnlineViaRust();
        if (requestId !== playRequestId || currentSong.value?.path !== song.path) return;

        // 用户在解析直链期间按了暂停：停掉刚起来的播放并保持暂停态，不要继续出声
        if (cancelledPlayRequestId === requestId) {
          try { await playbackApi.stopAudio(); } catch {}
          isPlaying.value = false;
          isSongLoaded.value = false;
          stopPlaybackRuntime();
          return;
        }

        if (rustOk) {
          // 确保后端已接管，音量同步到后端
          try { await playbackApi.setVolume(playbackStore.volume / 100); } catch {}
          finishRustPlaybackStart();
        } else {
          // [在线播放重构] Rust 失败时直接报告错误并停止
          try { await playbackApi.stopAudio(); } catch {}
          isPlaying.value = false;
          isSongLoaded.value = false;
          stopPlaybackRuntime();
          console.error('[Audio] 在线音频播放失败（Rust 后端起播失败）');
          return;
        }
      } else {
        // 本地音频走 Rust 后端播放
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
        lastFailureWaitedPath = null;
        setTimeout(() => {
          if (currentSong.value?.path === song.path) handleAutoNext();
        }, 400);
      } else if (failureBehavior === 'wait') {
        // [等待响应] 等待流式缓存下载完成后重新播放（每首歌只等待一次，避免死循环）
        // 适用于 Baka 等前置请求易失败的音源：解码失败时缓存可能仍在后台下载
        const waitUrl = audioFilePath;
        if (/^https?:/.test(waitUrl) && lastFailureWaitedPath !== song.path) {
          lastFailureWaitedPath = song.path;
          console.log('[Audio] 起播失败，等待缓存完成后重试:', waitUrl);
          void (async () => {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const ok = await invoke<boolean>('wait_stream_complete', { url: waitUrl, timeoutSecs: 60 });
              if (ok && currentSong.value?.path === song.path && requestId === playRequestId) {
                void playSong(song, { startTime: currentTime.value, preserveQueue: true });
              } else {
                console.warn('[Audio] 缓存等待失败或已切歌，放弃重试');
              }
            } catch (e: any) {
              console.warn('[Audio] 等待缓存异常:', e?.message);
            }
          })();
        } else {
          lastFailureWaitedPath = null;
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

    // [渐入渐出] 淡出：渐变音量到0后再暂停
    const fadeEnabled = settingsStore.settings.audio.fadeInOutEnabled;
    const fadeDuration = settingsStore.settings.audio.fadeInOutDurationMs;
    if (fadeEnabled && isPlaying.value && isSongLoaded.value) {
      await fadeVolumeTo(0, fadeDuration);
    }

    isPlaying.value = false;
    await playbackApi.pauseAudio();
    stopPlaybackRuntime();

    // [渐入渐出] 淡出完成后恢复音量设置（不影响 UI 显示值，仅恢复后端音量）
    if (fadeEnabled) {
      void playbackApi.setVolume(playbackStore.volume / 100).catch(() => {});
    }
  };

  const togglePlay = async () => {
    if (!currentSong.value) return;

    const fadeEnabled = settingsStore.settings.audio.fadeInOutEnabled;
    const fadeDuration = settingsStore.settings.audio.fadeInOutDurationMs;

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

      // [渐入渐出] 淡出：渐变音量到0后再暂停
      if (fadeEnabled && isSongLoaded.value) {
        await fadeVolumeTo(0, fadeDuration);
      }

      await playbackApi.pauseAudio();
      isPlaying.value = false;
      stopPlaybackRuntime();

      // [渐入渐出] 淡出完成后恢复后端音量设置（不影响 UI 显示值）
      if (fadeEnabled) {
        void playbackApi.setVolume(playbackStore.volume / 100).catch(() => {});
      }
      return;
    }

    // 用户重新点了播放，撤销之前的取消标记
    cancelFade(); // 取消可能正在进行的淡出
    cancelledPlayRequestId = -1;

    if (!isSongLoaded.value) {
      // playSong 内部会自行设置 isPlaying / 启动播放时钟，这里直接返回避免重复
      await playSong(currentSong.value, { startTime: currentTime.value });
      return;
    }

    await playbackApi.resumeAudio();
    sessionStartTime = Date.now();

    isPlaying.value = true;
    startPlaybackRuntime();

    // [渐入渐出] 淡入：从0渐变到目标音量
    if (fadeEnabled) {
      void fadeVolumeTo(playbackStore.volume / 100, fadeDuration);
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
