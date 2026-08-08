import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';

import { libraryApi } from '../../services/tauri/libraryApi';
import type {
  HistoryItem,
  Playlist,
  RecentAlbumCatalogItem,
  RecentPlaylistCatalogItem,
  Song,
} from '../../types';
import {
  type AlbumListItem,
  type ArtistListItem,
} from './playerLibraryViewShared';

interface UseLibraryCollectionSelectorsOptions {
  favoritePaths: Ref<string[]>;
  playlists: Ref<Playlist[]>;
  recentSongs: Ref<HistoryItem[]>;
  songLookup: ComputedRef<Map<string, Song>>;
}

export function useLibraryCollectionSelectors({
  favoritePaths,
  playlists,
  recentSongs,
  songLookup,
}: UseLibraryCollectionSelectorsOptions) {
  const favArtistList = ref<ArtistListItem[]>([]);
  const favAlbumList = ref<AlbumListItem[]>([]);
  const recentAlbumList = ref<RecentAlbumCatalogItem[]>([]);
  const recentPlaylistList = ref<RecentPlaylistCatalogItem[]>([]);
  let favoriteArtistRequestId = 0;
  let favoriteAlbumRequestId = 0;
  let recentAlbumRequestId = 0;
  let recentPlaylistRequestId = 0;

  // [性能优化] recentSongs 变化时触发的 IPC 调用需要序列化所有最近播放项（及所有歌单），
  // 歌单和歌曲数量越多开销越大。每次播放都会触发，导致播放启动时主页卡顿。
  // 防抖 1.5 秒，连续切歌时只发一次请求，避免阻塞播放启动和飞封面动画。
  const RECENT_CATALOG_DEBOUNCE_MS = 1500;
  let recentAlbumDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let recentPlaylistDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const favoriteSongPaths = computed(() => {
    return favoritePaths.value.filter(path => songLookup.value.has(path));
  });

  const favoriteSongList = computed(() =>
    favoriteSongPaths.value
      .map(path => songLookup.value.get(path))
      .filter((song): song is Song => !!song),
  );

  watch(
    favoriteSongPaths,
    async (paths) => {
      const requestId = ++favoriteArtistRequestId;

      if (paths.length === 0) {
        favArtistList.value = [];
        return;
      }

      try {
        const result = await libraryApi.getFavoriteArtistCatalog(paths);

        if (requestId !== favoriteArtistRequestId) {
          return;
        }

        favArtistList.value = result;
      } catch {
        if (requestId !== favoriteArtistRequestId) {
          return;
        }

        favArtistList.value = [];
      }
    },
    { immediate: true },
  );

  watch(
    favoriteSongPaths,
    async (paths) => {
      const requestId = ++favoriteAlbumRequestId;

      if (paths.length === 0) {
        favAlbumList.value = [];
        return;
      }

      try {
        const result = await libraryApi.getFavoriteAlbumCatalog(paths);

        if (requestId !== favoriteAlbumRequestId) {
          return;
        }

        favAlbumList.value = result;
      } catch {
        if (requestId !== favoriteAlbumRequestId) {
          return;
        }

        favAlbumList.value = [];
      }
    },
    { immediate: true },
  );

  watch(
    recentSongs,
    (items) => {
      if (items.length === 0) {
        if (recentAlbumDebounceTimer) {
          clearTimeout(recentAlbumDebounceTimer);
          recentAlbumDebounceTimer = null;
        }
        recentAlbumList.value = [];
        return;
      }

      if (recentAlbumDebounceTimer) {
        clearTimeout(recentAlbumDebounceTimer);
      }

      recentAlbumDebounceTimer = setTimeout(async () => {
        recentAlbumDebounceTimer = null;
        const requestId = ++recentAlbumRequestId;

        try {
          const result = await libraryApi.getRecentAlbumCatalog(
            items.map(item => ({
              songPath: item.path,
              playedAt: item.playedAt,
            })),
          );

          if (requestId !== recentAlbumRequestId) {
            return;
          }

          recentAlbumList.value = result;
        } catch {
          if (requestId !== recentAlbumRequestId) {
            return;
          }

          recentAlbumList.value = [];
        }
      }, RECENT_CATALOG_DEBOUNCE_MS);
    },
    { immediate: true },
  );

  watch(
    [playlists, recentSongs],
    ([playlistItems, recentItems]) => {
      if (playlistItems.length === 0 || recentItems.length === 0) {
        if (recentPlaylistDebounceTimer) {
          clearTimeout(recentPlaylistDebounceTimer);
          recentPlaylistDebounceTimer = null;
        }
        recentPlaylistList.value = [];
        return;
      }

      if (recentPlaylistDebounceTimer) {
        clearTimeout(recentPlaylistDebounceTimer);
      }

      // [性能优化] 此 IPC 调用需要序列化所有歌单 + 所有最近播放项作为 payload，
      // 歌单数量和歌曲数量越多，序列化开销越大。防抖后连续切歌只发一次请求。
      recentPlaylistDebounceTimer = setTimeout(async () => {
        recentPlaylistDebounceTimer = null;
        const requestId = ++recentPlaylistRequestId;

        try {
          const result = await libraryApi.getRecentPlaylistCatalog(
            playlistItems,
            recentItems.map(item => ({
              songPath: item.path,
              playedAt: item.playedAt,
            })),
          );

          if (requestId !== recentPlaylistRequestId) {
            return;
          }

          recentPlaylistList.value = result;
        } catch {
          if (requestId !== recentPlaylistRequestId) {
            return;
          }

          recentPlaylistList.value = [];
        }
      }, RECENT_CATALOG_DEBOUNCE_MS);
    },
    { immediate: true },
  );

  return {
    favoriteSongPaths,
    favoriteSongList,
    favArtistList,
    favAlbumList,
    recentAlbumList,
    recentPlaylistList,
  };
}
