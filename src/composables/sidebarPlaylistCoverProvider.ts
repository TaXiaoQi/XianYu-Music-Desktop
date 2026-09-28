import { onUnmounted, ref, watch, type Ref } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import { sidebarPlaylistCoverCache } from '../caches/imageCaches';

import type { Playlist } from '../types';

interface SidebarPlaylistCoverProviderOptions {
  playlists: Ref<Playlist[]>;
  loadCover: (songPath: string) => Promise<string | null | undefined>;
  primeCoverPath: (path: string | undefined, rawPath: string | undefined | null) => string;
}

/** http(s) / asset: / data: 之外的路径需要经 Tauri 转换为可加载地址 */
const looksLikeSelfContainedUrl = (path: string) =>
  /^https?:\/\//i.test(path) || path.startsWith('asset:') || path.startsWith('data:');

const looksLikeRemoteHttp = (path: string) => /^https?:\/\//i.test(path);

/**
 * 侧边栏歌单封面提供者：
 * 维护「自定义封面 > 云端封面 > 首曲缩略图」的解析优先级，
 * 并以缓存版本号驱动模板刷新。
 */
export function useSidebarPlaylistCovers({ playlists, loadCover, primeCoverPath }: SidebarPlaylistCoverProviderOptions) {
  /** 歌单当前生效的首曲路径（用于变更检测） */
  const activeFirstTrackByPlaylist = new Map<string, string>();
  /** 歌单当前生效的自定义封面源路径 */
  const activeCustomCoverByPlaylist = new Map<string, string | undefined>();

  const coverVersion = ref(0);
  const inflightCoverLoads = new Set<string>();

  let backgroundRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let backgroundRefreshIdleHandle: number | null = null;

  const bumpCoverVersion = () => {
    coverVersion.value += 1;
  };

  /** 用歌单内首曲的缩略图直接预热封面缓存 */
  const primeFromPlaylistTracks = (playlistId: string, firstSongPath: string): string => {
    const playlist = playlists.value.find((item) => item.id === playlistId);
    if (!playlist?.songs || playlist.songs.length === 0) {
      return '';
    }
    const firstSong = playlist.songs.find((song) => song.path === firstSongPath);
    if (!firstSong?.cover_thumb_path) {
      return '';
    }
    return primeCoverPath(firstSong.path, firstSong.cover_thumb_path);
  };

  /** 同步单个歌单的首曲封面；返回缓存是否发生变化 */
  const syncFirstTrackCover = async (playlistId: string, firstSongPath: string): Promise<boolean> => {
    if (activeFirstTrackByPlaylist.get(playlistId) === firstSongPath && sidebarPlaylistCoverCache.has(playlistId)) {
      return false;
    }
    activeFirstTrackByPlaylist.set(playlistId, firstSongPath);

    const primedUrl = primeFromPlaylistTracks(playlistId, firstSongPath);
    if (primedUrl) {
      sidebarPlaylistCoverCache.set(playlistId, primedUrl);
      return true;
    }

    try {
      const assetUrl = await loadCover(firstSongPath);
      if (assetUrl) {
        sidebarPlaylistCoverCache.set(playlistId, assetUrl);
        return true;
      }
      return sidebarPlaylistCoverCache.delete(playlistId);
    } catch {
      return sidebarPlaylistCoverCache.delete(playlistId);
    }
  };

  /** 采纳（或清除）歌单自定义封面 */
  const adoptCustomCover = (playlistId: string, coverPath: string | undefined): boolean => {
    const previous = activeCustomCoverByPlaylist.get(playlistId);
    if (previous === coverPath && sidebarPlaylistCoverCache.has(playlistId)) {
      return false;
    }
    activeCustomCoverByPlaylist.set(playlistId, coverPath);

    if (!coverPath) {
      sidebarPlaylistCoverCache.delete(playlistId);
      activeFirstTrackByPlaylist.delete(playlistId);
      return true;
    }

    sidebarPlaylistCoverCache.set(playlistId, looksLikeSelfContainedUrl(coverPath) ? coverPath : convertFileSrc(coverPath));
    return true;
  };

  /** 采纳歌单云端封面；返回缓存是否变化 */
  const adoptCloudCover = (playlistId: string, cloudCoverUrl: string): boolean => {
    const previous = activeCustomCoverByPlaylist.get(playlistId);
    if (previous === cloudCoverUrl && sidebarPlaylistCoverCache.has(playlistId)) {
      return false;
    }
    activeCustomCoverByPlaylist.set(playlistId, cloudCoverUrl);
    sidebarPlaylistCoverCache.set(playlistId, cloudCoverUrl);
    return true;
  };

  /** 全量重算所有歌单封面，任一变化则推进版本号 */
  const recomputeAllPlaylistCovers = async () => {
    const changes = await Promise.all(
      playlists.value.map(async (playlist) => {
        if (playlist.coverPath) {
          return adoptCustomCover(playlist.id, playlist.coverPath);
        }

        if (playlist.cloudCoverUrl && looksLikeRemoteHttp(playlist.cloudCoverUrl)) {
          return adoptCloudCover(playlist.id, playlist.cloudCoverUrl);
        }

        if (activeCustomCoverByPlaylist.has(playlist.id)) {
          adoptCustomCover(playlist.id, undefined);
        }

        if (playlist.songPaths.length > 0) {
          return syncFirstTrackCover(playlist.id, playlist.songPaths[0]);
        }

        const droppedCover = sidebarPlaylistCoverCache.delete(playlist.id);
        const droppedTrackMark = activeFirstTrackByPlaylist.delete(playlist.id);
        return droppedCover || droppedTrackMark;
      }),
    );

    if (changes.some(Boolean)) {
      bumpCoverVersion();
    }
  };

  /** 单歌单异步补载封面（带去重），成功后推进版本号 */
  const requestCoverLoad = async (playlistId: string, firstSongPath: string) => {
    if (!firstSongPath || inflightCoverLoads.has(playlistId)) {
      return;
    }
    inflightCoverLoads.add(playlistId);
    try {
      const changed = await syncFirstTrackCover(playlistId, firstSongPath);
      if (changed) {
        bumpCoverVersion();
      }
    } finally {
      inflightCoverLoads.delete(playlistId);
    }
  };

  /** 模板侧读取入口：未命中时尝试预热并触发异步补载 */
  const getPlaylistCover = (playlistId: string) => {
    const cached = sidebarPlaylistCoverCache.get(playlistId);
    if (cached) {
      return cached;
    }

    const playlist = playlists.value.find((item) => item.id === playlistId);

    if (playlist?.coverPath) {
      const url = looksLikeSelfContainedUrl(playlist.coverPath) ? playlist.coverPath : convertFileSrc(playlist.coverPath);
      sidebarPlaylistCoverCache.set(playlistId, url);
      activeCustomCoverByPlaylist.set(playlistId, playlist.coverPath);
      bumpCoverVersion();
      return url;
    }

    if (playlist?.cloudCoverUrl && looksLikeRemoteHttp(playlist.cloudCoverUrl)) {
      sidebarPlaylistCoverCache.set(playlistId, playlist.cloudCoverUrl);
      bumpCoverVersion();
      return playlist.cloudCoverUrl;
    }

    const firstSongPath = playlist?.songPaths[0];
    if (firstSongPath) {
      const primedUrl = primeFromPlaylistTracks(playlistId, firstSongPath);
      if (primedUrl) {
        sidebarPlaylistCoverCache.set(playlistId, primedUrl);
        return primedUrl;
      }
      void requestCoverLoad(playlistId, firstSongPath);
    }

    return undefined;
  };

  /** 空闲时段后台重算，避免阻塞交互 */
  const queueBackgroundRecompute = () => {
    if (backgroundRefreshTimer) {
      clearTimeout(backgroundRefreshTimer);
    }
    if (backgroundRefreshIdleHandle !== null && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(backgroundRefreshIdleHandle);
    }

    const runRecompute = () => {
      backgroundRefreshIdleHandle = null;
      backgroundRefreshTimer = null;
      void recomputeAllPlaylistCovers();
    };

    if ('requestIdleCallback' in window) {
      backgroundRefreshIdleHandle = window.requestIdleCallback(runRecompute, { timeout: 500 });
      return;
    }
    backgroundRefreshTimer = setTimeout(runRecompute, 180);
  };

  watch(
    () => playlists.value
      .map((playlist) => [
        playlist.id,
        playlist.coverPath ?? '',
        playlist.cloudCoverUrl ?? '',
        playlist.songPaths[0] ?? '',
        playlist.songPaths.length,
      ].join('#'))
      .join('~'),
    () => {
      queueBackgroundRecompute();
    },
    { immediate: true },
  );

  onUnmounted(() => {
    if (backgroundRefreshTimer) {
      clearTimeout(backgroundRefreshTimer);
    }
    if (backgroundRefreshIdleHandle !== null && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(backgroundRefreshIdleHandle);
    }
  });

  return {
    playlistCoverCache: sidebarPlaylistCoverCache,
    playlistCoverCacheVersion: coverVersion,
    getPlaylistCover,
  };
}
