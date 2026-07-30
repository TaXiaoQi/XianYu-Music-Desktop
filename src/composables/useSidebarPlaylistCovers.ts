import { onUnmounted, ref, watch, type Ref } from 'vue';
import { sidebarPlaylistCoverCache } from '../caches/imageCaches';

import type { Playlist } from '../types';

interface UseSidebarPlaylistCoversOptions {
  playlists: Ref<Playlist[]>;
  loadCover: (songPath: string) => Promise<string | null | undefined>;
  /** 将歌曲的 cover_thumb_path（可能是网络 URL）注入封面缓存并返回可用的 URL */
  primeCoverPath: (path: string | undefined, rawPath: string | undefined | null) => string;
}

export function useSidebarPlaylistCovers({
  playlists,
  loadCover,
  primeCoverPath,
}: UseSidebarPlaylistCoversOptions) {
  const playlistRealFirstSongMap = new Map<string, string>();
  const playlistCoverCacheVersion = ref(0);
  const pendingPlaylistCoverLoads = new Set<string>();
  let playlistCoverRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let playlistCoverRefreshIdleId: number | null = null;

  /**
   * 从 playlist.songs 缓存中获取第一首歌的封面 URL。
   * 在线歌曲的封面是网络 URL，直接通过 primeCoverPath 注入缓存，
   * 无需调用后端 invoke。
   */
  const tryPrimeFromPlaylistSongs = (playlistId: string, firstSongPath: string): string => {
    const playlist = playlists.value.find(item => item.id === playlistId);
    if (!playlist?.songs || playlist.songs.length === 0) {
      return '';
    }

    const firstSong = playlist.songs.find(s => s.path === firstSongPath) ?? playlist.songs[0];
    if (!firstSong?.cover_thumb_path) {
      return '';
    }

    return primeCoverPath(firstSong.path, firstSong.cover_thumb_path);
  };

  const updateCoverIfChanged = async (playlistId: string, firstSongPath: string) => {
    if (
      playlistRealFirstSongMap.get(playlistId) === firstSongPath &&
      sidebarPlaylistCoverCache.has(playlistId)
    ) {
      return false;
    }

    playlistRealFirstSongMap.set(playlistId, firstSongPath);

    // 优先从 playlist.songs 缓存中获取封面（在线歌曲封面是网络 URL）
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

    // 在线歌曲封面可能已在 primeCoverPath 中缓存但尚未写入 sidebarPlaylistCoverCache
    const playlist = playlists.value.find(item => item.id === playlistId);
    const firstSongPath = playlist?.songPaths[0];
    if (firstSongPath) {
      // 先尝试从 songs 缓存中快速获取
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
