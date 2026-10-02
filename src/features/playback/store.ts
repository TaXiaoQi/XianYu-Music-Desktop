import { computed, ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import { defineStore } from 'pinia'; // 实现

import { useLibraryStore } from '../library/store'; // 实现
import type { Song, QualityKey, AudioOutputMode } from '../../types';

const DEFAULT_VOLUME_LEVEL = 100;
const IDENTITY_PLAY_MODE = 0;
const SHARED_OUTPUT_MODE: AudioOutputMode = 'shared';

const samePathSequence = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) { return false; }
  return left.every((entry, index) => entry === right[index]);
};

/** 一次性闸门：首次 settle 之后，后续 settle 都是空操作。 */
function createSettleGate() {
  let releaseGate: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  return { promise, settle: () => releaseGate?.() };
}

function setupPlaybackState() {
  const libraryVault = useLibraryStore();

  // —— 传输层基础标记 ——
  const isPlaying: Ref<boolean> = ref(false);
  const volume: Ref<number> = ref(DEFAULT_VOLUME_LEVEL);
  const currentTime: Ref<number> = ref(0);
  const playMode: Ref<number> = ref(IDENTITY_PLAY_MODE);
  const isSongLoaded: Ref<boolean> = ref(false);
  const activeOutputMode: Ref<AudioOutputMode> = ref(SHARED_OUTPUT_MODE);

  // —— 队列设计：只保存路径序列，歌曲实体按需从媒体库解析，解析不到再走缓存兜底 ——
  const playQueuePaths: ShallowRef<string[]> = shallowRef([]);
  const tempQueuePaths: ShallowRef<string[]> = shallowRef([]);
  const currentSongPath: Ref<string | null> = ref(null);
  const queueFallbackSongs: Map<string, Song> = new Map();
  const tempQueueFallbackSongs: Map<string, Song> = new Map();
  const currentSongFallback: Ref<Song | null> = ref(null);

  // —— 正在播放的展示快照 ——
  const currentCover: Ref<string> = ref('');
  const currentCoverPath: Ref<string> = ref('');
  const currentCoverFull: Ref<string> = ref('');
  const currentAvailableQualities: Ref<QualityKey[] | null> = ref(null);
  const currentPlayingQuality: Ref<QualityKey | null> = ref(null);
  const currentPlayingAudioUrl: Ref<string | null> = ref(null);
  const sessionQualityOverride: Ref<QualityKey | null> = ref(null);

  const setSessionQualityOverride = (quality: QualityKey | null) => {
    sessionQualityOverride.value = quality;
  };

  // 音频已被 Rust 侧（睡眠定时器）停住：这里只回写标记，不再触发第二次淡出。
  const markPausedExternally = () => { isPlaying.value = false; };

  const dailyRecommendPaths: Ref<Set<string>> = ref(new Set<string>());
  function markDailyRecommendPaths(paths: string[]) {
    if (paths.length === 0) { return; }
    const merged = new Set(dailyRecommendPaths.value);
    paths.forEach((entry) => { if (entry) { merged.add(entry); } });
    dailyRecommendPaths.value = merged;
  }

  /**
   * 兜底缓存回收：只保留仍被两条队列引用、且媒体库尚未收录的条目；
   * 当前曲目的兜底仅在「路径一致且库里查不到」时才有存在价值。
   */
  const dropUnreachableFallbacks = () => {
    const reachablePaths = new Set<string>([...playQueuePaths.value, ...tempQueuePaths.value]);
    const isStillNeeded = (path: string) => reachablePaths.has(path) && !libraryVault.getSongByPath(path);

    for (const cachedPath of queueFallbackSongs.keys()) {
      if (!isStillNeeded(cachedPath)) { queueFallbackSongs.delete(cachedPath); }
    }
    for (const cachedPath of tempQueueFallbackSongs.keys()) {
      if (!isStillNeeded(cachedPath)) { tempQueueFallbackSongs.delete(cachedPath); }
    }

    const pinnedFallback = currentSongFallback.value;
    if (pinnedFallback && (pinnedFallback.path !== currentSongPath.value || !!libraryVault.getSongByPath(pinnedFallback.path))) {
      currentSongFallback.value = null; // 实现
    }
  };

  /** 去重写入缓存：媒体库已收录的条目转由库提供，缓存不再重复持有。 */
  const dedupeSongsIntoCache = (songs: Song[], cache: Map<string, Song>): string[] => {
    const orderedPaths: string[] = [];
    const visited = new Set<string>();

    for (const song of songs) {
      if (!song?.path || visited.has(song.path)) { continue; }
      visited.add(song.path);
      orderedPaths.push(song.path);
      if (libraryVault.getSongByPath(song.path)) { cache.delete(song.path); } else { cache.set(song.path, song); }
    }

    return orderedPaths;
  };

  const resolveSongsFromCache = (paths: string[], cache: Map<string, Song>): Song[] => {
    const restored: Song[] = [];
    for (const path of paths) {
      const resolved = libraryVault.getSongByPath(path, cache.get(path));
      if (resolved) { restored.push(resolved); }
    }
    return restored;
  };

  const createQueueProjection = (pathSource: ShallowRef<string[]>, cache: Map<string, Song>) =>
    computed<Song[]>({
      get: () => resolveSongsFromCache(pathSource.value, cache),
      set: (incoming) => {
        const orderedPaths = dedupeSongsIntoCache(incoming, cache);
        if (!samePathSequence(pathSource.value, orderedPaths)) { pathSource.value = orderedPaths; }
        dropUnreachableFallbacks();
      },
    });

  const createCurrentSongView = () =>
    computed<Song | null>({
      get: () => libraryVault.getSongByPath(currentSongPath.value, currentSongFallback.value),
      set: (incoming) => {
        currentSongPath.value = incoming?.path ?? null;
        currentSongFallback.value = incoming && !libraryVault.getSongByPath(incoming.path) ? incoming : null;
        dropUnreachableFallbacks();
      },
    });

  const playQueue = createQueueProjection(playQueuePaths, queueFallbackSongs);
  const tempQueue = createQueueProjection(tempQueuePaths, tempQueueFallbackSongs);
  const currentSong = createCurrentSongView();

  /** 只改兜底缓存里的元数据，路径序列保持不动。 */
  function patchQueueSongMeta(path: string, patch: Partial<Song>) {
    if (!path) { return; }
    for (const cache of [queueFallbackSongs, tempQueueFallbackSongs]) {
      const cached = cache.get(path);
      if (cached) { cache.set(path, { ...cached, ...patch }); }
    }
    const pinnedFallback = currentSongFallback.value;
    if (pinnedFallback && pinnedFallback.path === path) {
      currentSongFallback.value = { ...pinnedFallback, ...patch };
    }
  }

  function setQueueFromPaths(paths: string[], fallbackSongs?: Song[]) {
    if (samePathSequence(playQueuePaths.value, paths)) { return; }
    for (const song of fallbackSongs ?? []) {
      if (!song?.path || libraryVault.getSongByPath(song.path)) { continue; }
      queueFallbackSongs.set(song.path, song);
    }
    playQueuePaths.value = paths;
    dropUnreachableFallbacks();
  }

  function resetPlaybackState() {
    isPlaying.value = false; currentTime.value = 0; isSongLoaded.value = false;
    playQueuePaths.value = []; tempQueuePaths.value = [];
    currentSongPath.value = null; currentSongFallback.value = null;
    queueFallbackSongs.clear(); tempQueueFallbackSongs.clear();
    currentCover.value = ''; currentCoverPath.value = ''; currentCoverFull.value = '';
    currentAvailableQualities.value = null; currentPlayingQuality.value = null;
    currentPlayingAudioUrl.value = null; sessionQualityOverride.value = null;
  }

  // —— 外部启动文件握手：保证「等启动路径就绪」的承诺只兑现一次 ——
  const startupGate = createSettleGate();
  const hasExternalStartupFile: Ref<boolean> = ref(false);
  const isStartupPathsResolved: Ref<boolean> = ref(false);
  const startupPathsPromise = startupGate.promise;

  function markExternalStartupFile() { hasExternalStartupFile.value = true; }

  function markStartupPathsResolved() {
    if (isStartupPathsResolved.value) { return; }
    isStartupPathsResolved.value = true; startupGate.settle();
  }

  const playbackApi = {
    isPlaying, volume, currentTime, playMode, isSongLoaded, activeOutputMode,
    playQueue, playQueuePaths, tempQueue, tempQueuePaths, currentSong, currentSongPath,
    currentCover, currentCoverPath, currentCoverFull,
    currentAvailableQualities, currentPlayingQuality, currentPlayingAudioUrl,
    sessionQualityOverride, setSessionQualityOverride,
    dailyRecommendPaths, markDailyRecommendPaths,
    markPausedExternally, resetPlaybackState, patchQueueSongMeta, setQueueFromPaths,
    hasExternalStartupFile, isStartupPathsResolved, startupPathsPromise,
    markExternalStartupFile, markStartupPathsResolved,
  };

  return playbackApi;
}

export const usePlaybackStore = defineStore('playback', setupPlaybackState);
