import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';

import { useLibraryStore } from '../library/store';
import type { Song, QualityKey } from '../../types';

const areSamePaths = (left: string[], right: string[]) =>
  left.length === right.length && left.every((path, index) => path === right[index]);

export const usePlaybackStore = defineStore('playback', () => {
  const libraryStore = useLibraryStore();
  const isPlaying = ref(false);
  const volume = ref(100);
  const currentTime = ref(0);
  const playMode = ref(0);
  const isSongLoaded = ref(false);
  const playQueuePaths = shallowRef<string[]>([]);
  const tempQueuePaths = shallowRef<string[]>([]);
  const currentSongPath = ref<string | null>(null);
  const queueFallbackSongs = new Map<string, Song>();
  const tempQueueFallbackSongs = new Map<string, Song>();
  const currentSongFallback = ref<Song | null>(null);
  const currentCover = ref('');
  const currentCoverPath = ref('');
  const currentCoverFull = ref('');
  /** 当前播放歌曲支持的音质列表（null 表示未知，UI 回退到全部显示） */
  const currentAvailableQualities = ref<QualityKey[] | null>(null);
  /** 当前实际播放的音质（经回退逻辑解析后真正使用的音质，null 表示未知/本地歌曲） */
  const currentPlayingQuality = ref<QualityKey | null>(null);
  /**
   * 当前播放歌曲的实际音频直链 URL（经插件解析后的 http(s) 直链）。
   * 用于下载时复用播放缓存：若下载目标音质与播放音质一致且该 URL 已缓存完成，
   * 可直接复制缓存文件而非重新下载。null 表示未知/本地歌曲/未解析。
   * 仅运行时有效，切歌/重置时清空。
   */
  const currentPlayingAudioUrl = ref<string | null>(null);
  /**
   * 会话级临时音质覆盖（底部栏音质切换按钮写入）。
   * 仅影响播放链路取用的音质，不写入 settings，因此不会同步到设置页的「在线播放音质」。
   * 切歌时保留（尊重用户本次会话的选择），仅在 resetPlaybackState / 应用重启时清空。
   * 播放时优先级：sessionQualityOverride > settings.audio.onlineDefaultQuality。
   */
  const sessionQualityOverride = ref<QualityKey | null>(null);
  const setSessionQualityOverride = (q: QualityKey | null) => {
    sessionQualityOverride.value = q;
  };

  const pruneFallbackSongs = () => {
    const queuedPaths = new Set<string>([
      ...playQueuePaths.value,
      ...tempQueuePaths.value,
    ]);

    for (const [path] of queueFallbackSongs) {
      if (!queuedPaths.has(path) || libraryStore.getSongByPath(path)) {
        queueFallbackSongs.delete(path);
      }
    }

    for (const [path] of tempQueueFallbackSongs) {
      if (!queuedPaths.has(path) || libraryStore.getSongByPath(path)) {
        tempQueueFallbackSongs.delete(path);
      }
    }

    if (currentSongPath.value && libraryStore.getSongByPath(currentSongPath.value)) {
      currentSongFallback.value = null;
    }
    if (currentSongPath.value !== currentSongFallback.value?.path) {
      currentSongFallback.value = null;
    }
  };

  const normalizeSongs = (songs: Song[], fallbackMap: Map<string, Song>) => {
    const nextPaths: string[] = [];
    const seenPaths = new Set<string>();

    songs.forEach((song) => {
      if (!song?.path || seenPaths.has(song.path)) {
        return;
      }

      seenPaths.add(song.path);
      nextPaths.push(song.path);

      if (!libraryStore.getSongByPath(song.path)) {
        fallbackMap.set(song.path, song);
      } else {
        fallbackMap.delete(song.path);
      }
    });

    return nextPaths;
  };

  const materializeSongs = (paths: string[], fallbackMap: Map<string, Song>) =>
    paths
      .map(path => libraryStore.getSongByPath(path, fallbackMap.get(path)))
      .filter((song): song is Song => !!song);

  const playQueue = computed<Song[]>({
    get: () => materializeSongs(playQueuePaths.value, queueFallbackSongs),
    set: (songs) => {
      const nextPaths = normalizeSongs(songs, queueFallbackSongs);
      if (!areSamePaths(playQueuePaths.value, nextPaths)) {
        playQueuePaths.value = nextPaths;
      }
      pruneFallbackSongs();
    },
  });

  const tempQueue = computed<Song[]>({
    get: () => materializeSongs(tempQueuePaths.value, tempQueueFallbackSongs),
    set: (songs) => {
      const nextPaths = normalizeSongs(songs, tempQueueFallbackSongs);
      if (!areSamePaths(tempQueuePaths.value, nextPaths)) {
        tempQueuePaths.value = nextPaths;
      }
      pruneFallbackSongs();
    },
  });

  const currentSong = computed<Song | null>({
    get: () => libraryStore.getSongByPath(currentSongPath.value, currentSongFallback.value),
    set: (song) => {
      currentSongPath.value = song?.path ?? null;
      currentSongFallback.value = song && !libraryStore.getSongByPath(song.path) ? song : null;
      pruneFallbackSongs();
    },
  });

  /**
   * O(1) 更新队列中单首歌曲的元数据（如 duration、lyrics_raw）。
   * 直接修改 fallbackMap 中的条目，避免 playQueue.value.map(...) 遍历整个队列。
   * songPool 中的歌曲由调用方的 patchSongMeta 负责，本方法只处理 fallback 条目。
   */
  const patchQueueSongMeta = (path: string, patch: Partial<Song>) => {
    if (!path) return;
    const qf = queueFallbackSongs.get(path);
    if (qf) queueFallbackSongs.set(path, { ...qf, ...patch });
    const tf = tempQueueFallbackSongs.get(path);
    if (tf) tempQueueFallbackSongs.set(path, { ...tf, ...patch });
    if (currentSongFallback.value?.path === path) {
      currentSongFallback.value = { ...currentSongFallback.value, ...patch };
    }
  };

  /**
   * [性能优化] 直接用路径数组设置播放队列，绕过 playQueue computed setter 的 normalizeSongs。
   *
   * playQueue.value = songs 会调用 normalizeSongs 遍历所有歌曲对象（O(n) × getSongByPath + Set/Map 操作），
   * 对 600+ 歌曲的容器初次播放时产生可感知的卡顿。
   *
   * 本方法直接操作 playQueuePaths（shallowRef<string[]>），仅做路径比较和赋值：
   * 1. 路径未变 → 短路返回，不触发任何响应式更新（同一容器内切歌的核心优化）
   * 2. 路径变化 → 注册在线歌曲 fallback → 赋值 playQueuePaths → 清理过期 fallback
   *
   * @param paths          歌曲路径数组（已去重）
   * @param fallbackSongs  在线歌曲对象数组（用于 fallback 注册，本地歌曲可省略）
   */
  const setQueueFromPaths = (paths: string[], fallbackSongs?: Song[]) => {
    if (areSamePaths(playQueuePaths.value, paths)) return;

    // 注册不在 songPool 中的在线歌曲到 fallback map（本地歌曲在 songPool 中，跳过）
    if (fallbackSongs) {
      for (const song of fallbackSongs) {
        if (song?.path && !libraryStore.getSongByPath(song.path)) {
          queueFallbackSongs.set(song.path, song);
        }
      }
    }

    playQueuePaths.value = paths;
    pruneFallbackSongs();
  };

  const resetPlaybackState = () => {
    isPlaying.value = false;
    currentTime.value = 0;
    isSongLoaded.value = false;
    playQueuePaths.value = [];
    tempQueuePaths.value = [];
    currentSongPath.value = null;
    currentSongFallback.value = null;
    queueFallbackSongs.clear();
    tempQueueFallbackSongs.clear();
    currentCover.value = '';
    currentCoverPath.value = '';
    currentCoverFull.value = '';
    currentAvailableQualities.value = null;
    currentPlayingQuality.value = null;
    currentPlayingAudioUrl.value = null;
    sessionQualityOverride.value = null;
  };

  const hasExternalStartupFile = ref(false);
  const isStartupPathsResolved = ref(false);
  let startupResolver: (() => void) | null = null;
  const startupPathsPromise = new Promise<void>((resolve) => {
    startupResolver = resolve;
  });

  const markExternalStartupFile = () => {
    hasExternalStartupFile.value = true;
  };

  const markStartupPathsResolved = () => {
    if (isStartupPathsResolved.value) {
      return;
    }
    isStartupPathsResolved.value = true;
    if (startupResolver) {
      startupResolver();
      startupResolver = null;
    }
  };

  return {
    isPlaying,
    volume,
    currentTime,
    playMode,
    isSongLoaded,
    playQueue,
    playQueuePaths,
    tempQueue,
    tempQueuePaths,
    currentSong,
    currentSongPath,
    currentCover,
    currentCoverPath,
    currentCoverFull,
    currentAvailableQualities,
    currentPlayingQuality,
    currentPlayingAudioUrl,
    sessionQualityOverride,
    setSessionQualityOverride,
    resetPlaybackState,
    patchQueueSongMeta,
    setQueueFromPaths,
    hasExternalStartupFile,
    isStartupPathsResolved,
    startupPathsPromise,
    markExternalStartupFile,
    markStartupPathsResolved,
  };
});
