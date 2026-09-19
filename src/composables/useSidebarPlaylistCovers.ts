import { onUnmounted, ref, watch, type Ref } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import { sidebarPlaylistCoverCache } from '../caches/imageCaches';

import type { Playlist } from '../types';

interface UseSidebarPlaylistCoversOptions {
  playlists: Ref<Playlist[]>;
  loadCover: (songPath: string) => Promise<string | null | undefined>;
  primeCoverPath: (path: string | undefined, rawPath: string | undefined | null) => string;
}

export function useSidebarPlaylistCovers({
  playlists,
  loadCover,
  primeCoverPath,
}: UseSidebarPlaylistCoversOptions) {
  const playlistRealFirstSongMap = new Map<string, string>();
  const playlistCustomCoverMap = new Map<string, string | undefined>();
  const playlistCoverCacheVersion = ref(0);
  const pendingPlaylistCoverLoads = new Set<string>();
  let playlistCoverRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let playlistCoverRefreshIdleId: number | null = null;

  const tryPrimeFromPlaylistSongs = (playlistId: string, firstSongPath: string): string => {
    const playlist = playlists.value.find(item => item.id === playlistId);
    if (!playlist?.songs || playlist.songs.length === 0) {
      return '';
    }

    const firstSong = playlist.songs.find(s => s.path === firstSongPath);
    if (!firstSong?.cover_thumb_path) {
      return '';
    }

    return primeCoverPath(firstSong.path, firstSong.cover_thumb_path);
  };

  const isDirectUrl = (path: string) =>
    /^https?:\/\//i.test(path) || path.startsWith('asset:') || path.startsWith('data:');

  const updateCoverIfChanged = async (playlistId: string, firstSongPath: string) => {
    if (
      playlistRealFirstSongMap.get(playlistId) === firstSongPath &&
      sidebarPlaylistCoverCache.has(playlistId)
    ) {
      return false;
    }

    playlistRealFirstSongMap.set(playlistId, firstSongPath);

    const primedUrl = tryPrimeFromPlaylistSongs(playlistId, firstSongPath);
    if (primedUrl) {
      sidebarPlaylistCoverCache.set(playlistId, primedUrl);
      return true;
    }

    try {
      const assetUrl = await loadCover(firstSongPath);
      if (assetUrl) {
        sidebarPlaylistCoverCache.set(playlistId, assetUrl);
        return true;
      } else {
        return sidebarPlaylistCoverCache.delete(playlistId);
      }
    } catch {
      return sidebarPlaylistCoverCache.delete(playlistId);
    }
  };

  const applyCustomCover = (playlistId: string, coverPath: string | undefined): boolean => {
    const prev = playlistCustomCoverMap.get(playlistId);
    if (prev === coverPath && sidebarPlaylistCoverCache.has(playlistId)) {
      return false;
    }
    playlistCustomCoverMap.set(playlistId, coverPath);

    if (!coverPath) {
      sidebarPlaylistCoverCache.delete(playlistId);
      playlistRealFirstSongMap.delete(playlistId);
      return true;
    }

    const url = isDirectUrl(coverPath) ? coverPath : convertFileSrc(coverPath);
    sidebarPlaylistCoverCache.set(playlistId, url);
    return true;
  };

  const calculatePlaylistCovers = async () => {
    const changes = await Promise.all(
      playlists.value.map(async playlist => {
        if (playlist.coverPath) {
          return applyCustomCover(playlist.id, playlist.coverPath);
        }

        if (playlist.cloudCoverUrl && /^https?:\/\//i.test(playlist.cloudCoverUrl)) {
          const prev = playlistCustomCoverMap.get(playlist.id);
          if (prev === playlist.cloudCoverUrl && sidebarPlaylistCoverCache.has(playlist.id)) {
            return false;
          }
          playlistCustomCoverMap.set(playlist.id, playlist.cloudCoverUrl);
          sidebarPlaylistCoverCache.set(playlist.id, playlist.cloudCoverUrl);
          return true;
        }

        if (playlistCustomCoverMap.has(playlist.id)) {
          applyCustomCover(playlist.id, undefined);
        }

        if (playlist.songPaths.length > 0) {
          return updateCoverIfChanged(playlist.id, playlist.songPaths[0]);
        }

        const removedCover = sidebarPlaylistCoverCache.delete(playlist.id);
        const removedSongPath = playlistRealFirstSongMap.delete(playlist.id);
        return removedCover || removedSongPath;
      }),
    );

    if (changes.some(Boolean)) {
      playlistCoverCacheVersion.value += 1;
    }
  };

  const refreshPlaylistCover = async (playlistId: string, firstSongPath: string) => {
    if (!firstSongPath || pendingPlaylistCoverLoads.has(playlistId)) {
      return;
    }

    pendingPlaylistCoverLoads.add(playlistId);

    try {
      const changed = await updateCoverIfChanged(playlistId, firstSongPath);
      if (changed) {
        playlistCoverCacheVersion.value += 1;
      }
    } finally {
      pendingPlaylistCoverLoads.delete(playlistId);
    }
  };

  const getPlaylistCover = (playlistId: string) => {
    const cachedCover = sidebarPlaylistCoverCache.get(playlistId);
    if (cachedCover) {
      return cachedCover;
    }

    const playlist = playlists.value.find(item => item.id === playlistId);

    if (playlist?.coverPath) {
      const url = isDirectUrl(playlist.coverPath) ? playlist.coverPath : convertFileSrc(playlist.coverPath);
      sidebarPlaylistCoverCache.set(playlistId, url);
      playlistCustomCoverMap.set(playlistId, playlist.coverPath);
      playlistCoverCacheVersion.value += 1;
      return url;
    }

    if (playlist?.cloudCoverUrl && /^https?:\/\//i.test(playlist.cloudCoverUrl)) {
      sidebarPlaylistCoverCache.set(playlistId, playlist.cloudCoverUrl);
      playlistCoverCacheVersion.value += 1;
      return playlist.cloudCoverUrl;
    }

    const firstSongPath = playlist?.songPaths[0];
    if (firstSongPath) {
      const primedUrl = tryPrimeFromPlaylistSongs(playlistId, firstSongPath);
      if (primedUrl) {
        sidebarPlaylistCoverCache.set(playlistId, primedUrl);
        return primedUrl;
      }

      void refreshPlaylistCover(playlistId, firstSongPath);
    }

    return undefined;
  };

  const schedulePlaylistCoverRefresh = () => {
    if (playlistCoverRefreshTimer) {
      clearTimeout(playlistCoverRefreshTimer);
    }
    if (playlistCoverRefreshIdleId !== null && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(playlistCoverRefreshIdleId);
    }

    const runRefresh = () => {
      playlistCoverRefreshIdleId = null;
      playlistCoverRefreshTimer = null;
      void calculatePlaylistCovers();
    };

    if ('requestIdleCallback' in window) {
      playlistCoverRefreshIdleId = window.requestIdleCallback(runRefresh, { timeout: 500 });
      return;
    }

    playlistCoverRefreshTimer = setTimeout(runRefresh, 180);
  };

  watch(
    () =>
      playlists.value
        .map(playlist => `${playlist.id}:${playlist.coverPath ?? ''}:${playlist.cloudCoverUrl ?? ''}:${playlist.songPaths[0] ?? ''}:${playlist.songPaths.length}`)
        .join('|'),
    () => {
      schedulePlaylistCoverRefresh();
    },
    { immediate: true },
  );

  onUnmounted(() => {
    if (playlistCoverRefreshTimer) {
      clearTimeout(playlistCoverRefreshTimer);
    }
    if (playlistCoverRefreshIdleId !== null && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(playlistCoverRefreshIdleId);
    }
  });

  return {
    playlistCoverCache: sidebarPlaylistCoverCache,
    playlistCoverCacheVersion,
    getPlaylistCover,
  };
}
