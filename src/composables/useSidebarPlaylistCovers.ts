import { onUnmounted, ref, watch, type Ref } from 'vue';
import { sidebarPlaylistCoverCache } from '../caches/imageCaches';

import type { Playlist } from '../types';

interface UseSidebarPlaylistCoversOptions {
  playlists: Ref<Playlist[]>;
  loadCover: (songPath: string) => Promise<string | null | undefined>;
}

export function useSidebarPlaylistCovers({
  playlists,
  loadCover,
}: UseSidebarPlaylistCoversOptions) {
  const playlistRealFirstSongMap = new Map<string, string>();
  const playlistCoverCacheVersion = ref(0);
  const pendingPlaylistCoverLoads = new Set<string>();
  let playlistCoverRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let playlistCoverRefreshIdleId: number | null = null;

  const updateCoverIfChanged = async (playlistId: string, firstSongPath: string) => {
    if (
      playlistRealFirstSongMap.get(playlistId) === firstSongPath &&
      sidebarPlaylistCoverCache.has(playlistId)
    ) {
      return false;
    }

    playlistRealFirstSongMap.set(playlistId, firstSongPath);
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

  const calculatePlaylistCovers = async () => {
    const changes = await Promise.all(
      playlists.value.map(async playlist => {
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
    const firstSongPath = playlist?.songPaths[0];
    if (firstSongPath) {
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
      playlistCoverRefreshIdleId = null;
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
        .map(playlist => `${playlist.id}:${playlist.songPaths[0] ?? ''}:${playlist.songPaths.length}`)
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
