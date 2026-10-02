import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'; // 实现

import { useLibraryStore } from './store'; // 实现

import {
  isStaleLibraryPathRequestError, // 实现
  useLibraryAllSongPathCache, // 实现
} from '../../composables/useLibraryAllSongPathCache'; // 实现
import { useLibraryCollectionSongPathCache } from '../../composables/useLibraryCollectionSongPathCache'; // 实现
import { useLibraryDetailSongPathCache } from '../../composables/useLibraryDetailSongPathCache'; // 实现
import { useLibraryFolderSongPathCache } from '../../composables/useLibraryFolderSongPathCache'; // 实现
import type { AlbumDetailSortMode, FolderSortMode, LocalSortMode, PlaylistSortMode } from '../../services/storage/playerStorage'; // 实现
import type { HistoryItem, Playlist, Song } from '../../types'; // 实现
import { sortItemsByAlphabetIndex } from '../../utils/alphabetIndex'; // 实现
import {
  getSongArtistSearchText, // 实现
  getSongFileNameLabel, // 实现
  getSongTitleLabel, // 实现
  matchesAlbumKey, // 实现
  songHasArtist, // 实现
} from './playerLibraryViewShared'; // 实现
import { orderPathsByAlbumDetailMode, orderPathsBySortMode } from './viewSortOrdering';
import { createPlaylistDurationFixer, isStreamedPath } from './streamDurationProbe';

interface UseLibraryCurrentViewSongsOptions { // 实现
  canonicalSongPaths: Ref<string[]>; // 实现
  playlists: Ref<Playlist[]>; // 实现
  recentSongs: Ref<HistoryItem[]>; // 实现
  songLookup: ComputedRef<Map<string, Song>>; // 实现
  favoriteSongPaths: ComputedRef<string[]>; // 实现
  currentFolderSongPaths: ComputedRef<string[]>; // 实现
  currentViewMode: Ref<string>; // 实现
  searchQuery: Ref<string>; // 实现
  localMusicTab: Ref<'default' | 'artist' | 'album'>; // 实现
  currentArtistFilter: Ref<string>; // 实现
  currentAlbumFilter: Ref<string>; // 实现
  currentFolderFilter: Ref<string>; // 实现
  filterCondition: Ref<string>; // 实现
  favTab: Ref<'songs' | 'playlists' | 'albums'>;
  folderSortMode: Ref<FolderSortMode>; // 实现
  localSortMode: Ref<LocalSortMode>; // 实现
  albumDetailSortMode: Ref<AlbumDetailSortMode>; // 实现
  localCustomOrder: Ref<string[]>; // 实现
  playlistSortMode: Ref<PlaylistSortMode>; // 实现
}

// 异步加载竞态保护：只有最新一次请求有权写入结果。
function createSequenceTicket() {
  let stamp = 0;
  return {
    next: () => ++stamp,
    isCurrent: (token: number) => token === stamp,
  };
}

export function useLibraryCurrentViewSongs(viewOptions: UseLibraryCurrentViewSongsOptions) {
  const {
    canonicalSongPaths: canonicalSeq,
    playlists: playlistSource,
    recentSongs: recentHistory,
    songLookup: songsById,
    favoriteSongPaths: favoritePathSource,
    currentFolderSongPaths: activeFolderPaths,
    currentViewMode: viewMode,
    searchQuery: searchInput,
    localMusicTab: viewTab,
    currentArtistFilter: artistFilter,
    currentAlbumFilter: albumFilter,
    currentFolderFilter: folderFilter,
    filterCondition: detailFilter,
    favTab,
    folderSortMode: folderOrder,
    localSortMode: localOrder,
    albumDetailSortMode: albumDetailOrder,
    localCustomOrder: customOrder,
    playlistSortMode: playlistOrder,
  } = viewOptions;

  const catalogStore = useLibraryStore();

  const remoteAllPaths = ref<string[]>([]);
  const remoteAllPathsLoading = ref(false);
  const remoteAllFallbackToCanonical = ref(false);
  const lastDeliveredAllPaths = ref<string[]>([]);
  const allViewFingerprint = ref('');
  const remoteFavoritePaths = ref<string[]>([]);
  const remoteRecentPaths = ref<string[]>([]);
  const remoteFolderPaths = ref<string[]>([]);
  const artistScopedPaths = ref<string[]>([]);
  const albumScopedPaths = ref<string[]>([]);
  const detailScopedPaths = ref<string[]>([]);

  const allViewTicket = createSequenceTicket();
  const favoriteViewTicket = createSequenceTicket();
  const recentViewTicket = createSequenceTicket();
  const folderViewTicket = createSequenceTicket();
  const artistScopeTicket = createSequenceTicket();
  const albumScopeTicket = createSequenceTicket();
  const detailScopeTicket = createSequenceTicket();

  const { loadAllViewSongPaths: fetchAllViewPaths } = useLibraryAllSongPathCache();
  const {
    loadFavoriteSongPaths: fetchFavoritePaths,
    loadRecentSongPaths: fetchRecentPaths,
  } = useLibraryCollectionSongPathCache();
  const {
    loadArtistSongPaths: fetchArtistPaths,
    loadAlbumSongPaths: fetchAlbumPaths,
  } = useLibraryDetailSongPathCache();
  const {
    loadFolderViewSongPaths: fetchFolderPaths,
    libraryFolderSongPathCacheVersion: folderCacheVersion,
  } = useLibraryFolderSongPathCache();

  const titleLabelOf = (path: string) => getSongTitleLabel(songsById.value.get(path)!);
  const fileNameLabelOf = (path: string) => getSongFileNameLabel(songsById.value.get(path)!);
  const withAlphabetTitleOrder = (paths: string[]) => sortItemsByAlphabetIndex(paths, titleLabelOf);

  // 剔除已不在 canonical 集合或曲目索引中的陈旧路径。
  const restrictToCanonical = (paths: string[]) => {
    const allowed = new Set(canonicalSeq.value);
    return paths.filter(path => allowed.has(path) && songsById.value.has(path));
  };

  const buildTextMatcher = (needle: string) => (path: string) => {
    const song = songsById.value.get(path);
    if (!song) {
      return false;
    }
    return song.name.toLowerCase().includes(needle)
      || getSongArtistSearchText(song).includes(needle)
      || song.album.toLowerCase().includes(needle);
  };

  const listKnownRecentPaths = () =>
    recentHistory.value
      .map(item => item.path)
      .filter(path => songsById.value.has(path));

  const collectFavoriteFallbackPaths = () =>
    favTab.value === 'songs' ? [...favoritePathSource.value] : [];

  // 后端检索结果之外补上仍可展示的在线曲目，避免在线收藏/最近播放丢失。
  const extendWithStreamedPaths = (basePaths: string[], candidatePaths: string[], query: string) => {
    const alreadyListed = new Set(basePaths);
    const needle = query.trim().toLowerCase();

    const extras = candidatePaths.filter((path) => {
      if (alreadyListed.has(path) || !isStreamedPath(path)) {
        return false;
      }

      const song = songsById.value.get(path);
      if (!song) {
        return false;
      }

      if (!needle) {
        return true;
      }

      return getSongTitleLabel(song).toLowerCase().includes(needle)
        || getSongArtistSearchText(song).toLowerCase().includes(needle);
    });

    return extras.length > 0 ? [...basePaths, ...extras] : basePaths;
  };

  watch(
    [
      viewMode,
      searchInput,
      viewTab,
      artistFilter,
      albumFilter,
      localOrder,
      canonicalSeq,
    ],
    async ([mode, query, tab, artistKey, albumKey, sortMode]) => {
      const ticket = allViewTicket.next();

      if (mode !== 'all' || sortMode === 'custom') {
        remoteAllPaths.value = [];
        return;
      }

      const fingerprint = [tab, artistKey, albumKey, sortMode, query].join('\u0001');
      if (allViewFingerprint.value !== fingerprint) {
        allViewFingerprint.value = fingerprint;
        remoteAllPaths.value = [];
        remoteAllFallbackToCanonical.value = false;
        lastDeliveredAllPaths.value = [];
      }

      remoteAllPathsLoading.value = true;

      const scanBusy = !!catalogStore.libraryScanProgress && !catalogStore.libraryScanProgress.done;
      if (scanBusy && lastDeliveredAllPaths.value.length > 0) {
        remoteAllPathsLoading.value = false;
        return;
      }

      const fetchPaths = () => fetchAllViewPaths({
        query,
        artistFilter: tab === 'artist' ? artistKey : '',
        albumFilter: tab === 'album' ? albumKey : '',
        sortMode,
      });

      const commit = (paths: string[]) => {
        remoteAllPaths.value = paths;
        remoteAllFallbackToCanonical.value = false;
        lastDeliveredAllPaths.value = paths;
      };

      try {
        const paths = await fetchPaths();
        if (allViewTicket.isCurrent(ticket)) {
          commit(paths);
        }
      } catch (error) {
        if (!allViewTicket.isCurrent(ticket)) {
          return;
        }

        if (!isStaleLibraryPathRequestError(error)) {
          remoteAllPaths.value = [];
          remoteAllFallbackToCanonical.value = false;
          return;
        }

        // 缓存失效：重试一次；重试再失败时仅在非失效错误下清空。
        remoteAllFallbackToCanonical.value = true;
        try {
          const retried = await fetchPaths();
          if (allViewTicket.isCurrent(ticket)) {
            commit(retried);
          }
        } catch (retryError) {
          if (!isStaleLibraryPathRequestError(retryError)) {
            remoteAllPaths.value = [];
            remoteAllFallbackToCanonical.value = false;
          }
        }
        return;
      } finally {
        if (allViewTicket.isCurrent(ticket)) {
          remoteAllPathsLoading.value = false;
        }
      }
    },
    { immediate: true }, // 实现
  );

  watch(
    [
      viewMode,
      favoritePathSource,
      searchInput,
      favTab,
      localOrder,
      canonicalSeq,
    ],
    async ([mode, paths, query, tab, sortMode]) => {
      const ticket = favoriteViewTicket.next();

      if (mode !== 'favorites' || tab !== 'songs' || sortMode === 'custom' || paths.length === 0) {
        remoteFavoritePaths.value = [];
        return;
      }

      try {
        const ordered = await fetchFavoritePaths({
          favoritePaths: paths, // 实现
          query,
          sortMode,
        });

        if (favoriteViewTicket.isCurrent(ticket)) {
          remoteFavoritePaths.value = extendWithStreamedPaths(ordered, paths, query);
        }
      } catch {
        if (favoriteViewTicket.isCurrent(ticket)) {
          remoteFavoritePaths.value = [];
        }
      }
    },
    { immediate: true }, // 实现
  );

  watch(
    [
      viewMode,
      recentHistory,
      searchInput,
      localOrder,
      canonicalSeq,
    ],
    async ([mode, items, query, sortMode]) => {
      const ticket = recentViewTicket.next();

      if (mode !== 'recent' || sortMode === 'custom' || items.length === 0) {
        remoteRecentPaths.value = [];
        return;
      }

      try {
        const ordered = await fetchRecentPaths({
          recentSongs: items, // 实现
          query,
          sortMode,
        });

        if (recentViewTicket.isCurrent(ticket)) {
          remoteRecentPaths.value = extendWithStreamedPaths(ordered, items.map(item => item.path), query);
        }
      } catch {
        if (recentViewTicket.isCurrent(ticket)) {
          remoteRecentPaths.value = [];
        }
      }
    },
    { immediate: true }, // 实现
  );

  watch(
    [
      viewMode,
      folderFilter,
      searchInput,
      folderOrder,
      activeFolderPaths,
      folderCacheVersion,
      () => catalogStore.libraryDataVersion,
    ],
    async ([mode, folderKey, query, sortMode]) => {
      const ticket = folderViewTicket.next();

      if (mode !== 'folder' || !folderKey || sortMode === 'custom') {
        remoteFolderPaths.value = [];
        return;
      }

      try {
        const ordered = await fetchFolderPaths({
          folderPath: folderKey,
          query,
          sortMode,
        });

        if (folderViewTicket.isCurrent(ticket)) {
          remoteFolderPaths.value = ordered;
        }
      } catch {
        if (folderViewTicket.isCurrent(ticket)) {
          remoteFolderPaths.value = [];
        }
      }
    },
    { immediate: true }, // 实现
  );

  watch(
    [viewMode, viewTab, artistFilter, canonicalSeq],
    async ([mode, tab, artistKey]) => {
      const ticket = artistScopeTicket.next();

      if (mode !== 'all' || tab !== 'artist' || !artistKey) {
        artistScopedPaths.value = [];
        return;
      }

      try {
        const paths = await fetchArtistPaths(artistKey);
        if (artistScopeTicket.isCurrent(ticket)) {
          artistScopedPaths.value = paths;
        }
      } catch {
        if (artistScopeTicket.isCurrent(ticket)) {
          artistScopedPaths.value = [];
        }
      }
    },
    { immediate: true }, // 实现
  );

  watch(
    [viewMode, viewTab, albumFilter, canonicalSeq],
    async ([mode, tab, albumKey]) => {
      const ticket = albumScopeTicket.next();

      if (mode !== 'all' || tab !== 'album' || !albumKey) {
        albumScopedPaths.value = [];
        return;
      }

      try {
        const paths = await fetchAlbumPaths(albumKey);
        if (albumScopeTicket.isCurrent(ticket)) {
          albumScopedPaths.value = paths;
        }
      } catch {
        if (albumScopeTicket.isCurrent(ticket)) {
          albumScopedPaths.value = [];
        }
      }
    },
    { immediate: true }, // 实现
  );

  watch(
    [viewMode, detailFilter, canonicalSeq],
    async ([mode, filter]) => {
      const ticket = detailScopeTicket.next();

      if (!filter || (mode !== 'artist' && mode !== 'album')) {
        detailScopedPaths.value = [];
        return;
      }

      try {
        const paths = mode === 'artist'
          ? await fetchArtistPaths(filter)
          : await fetchAlbumPaths(filter);

        if (detailScopeTicket.isCurrent(ticket)) {
          detailScopedPaths.value = paths;
        }
      } catch {
        if (detailScopeTicket.isCurrent(ticket)) {
          detailScopedPaths.value = [];
        }
      }
    },
    { immediate: true }, // 实现
  );

  const activePlaylistPaths = computed(() => {
    if (viewMode.value !== 'playlist') {
      return [];
    }

    const playlist = playlistSource.value.find(item => item.id === detailFilter.value);
    if (!playlist) { // 实现
      return [];
    }

    if (playlist.songs && playlist.songs.length > 0) { // 含歌曲时
      const declaredPaths = new Set(playlist.songs.map(s => s.path).filter(Boolean));
      return playlist.songPaths.filter(path => songsById.value.has(path) || declaredPaths.has(path));
    } // 判断结束
    return playlist.songPaths.filter(path => songsById.value.has(path));
  });

  const resolvePlainAllPaths = () => {
    let candidates = remoteAllPaths.value;

    if (candidates.length === 0) {
      if (lastDeliveredAllPaths.value.length > 0) {
        // 上一次加载成功的列表优先回显，避免切页闪空。
        candidates = lastDeliveredAllPaths.value;
      } else if (remoteAllPathsLoading.value || remoteAllFallbackToCanonical.value) {
        // 首次导入空档期：用内存中的 canonical 序列加本地简排兜底。
        candidates = orderPathsBySortMode(canonicalSeq.value, localOrder.value, songsById.value);
      }
    }

    const scoped = restrictToCanonical(candidates);
    return localOrder.value === 'title' ? withAlphabetTitleOrder(scoped) : scoped;
  };

  const applyCustomOrder = (paths: string[]) => {
    const rank = new Map(customOrder.value.map((path, index) => [path, index] as const));
    return [...paths].sort((left, right) =>
      (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER));
  };

  const resolveCustomAllPaths = () => {
    let base = [...canonicalSeq.value];
    if (viewTab.value === 'artist' && artistFilter.value) {
      base = [...artistScopedPaths.value];
    } else if (viewTab.value === 'album' && albumFilter.value) {
      base = [...albumScopedPaths.value];
    }

    return applyCustomOrder(base);
  };

  const resolvePlainFolderPaths = () => {
    if (folderOrder.value === 'custom') {
      return activeFolderPaths.value;
    }

    const pool = remoteFolderPaths.value.length > 0 ? remoteFolderPaths.value : activeFolderPaths.value;
    if (folderOrder.value === 'name') {
      return sortItemsByAlphabetIndex(pool, fileNameLabelOf);
    }
    if (folderOrder.value === 'title') {
      return withAlphabetTitleOrder(pool);
    }
    return pool;
  };

  const resolvePlainArtistPaths = () => {
    const pool = detailScopedPaths.value.length > 0
      ? detailScopedPaths.value
      : canonicalSeq.value.filter((path) => {
          const song = songsById.value.get(path);
          return !!song && songHasArtist(song, detailFilter.value);
        });

    return localOrder.value === 'custom'
      ? pool
      : orderPathsBySortMode(pool, localOrder.value, songsById.value);
  };

  const resolvePlainAlbumPaths = () => {
    const pool = detailScopedPaths.value.length > 0
      ? detailScopedPaths.value
      : canonicalSeq.value.filter((path) => {
          const song = songsById.value.get(path);
          return !!song && matchesAlbumKey(song, detailFilter.value);
        });

    return orderPathsByAlbumDetailMode(pool, albumDetailOrder.value, songsById.value);
  };

  const resolvePlainViewPaths = () => {
    switch (viewMode.value) {
      case 'all':
        return localOrder.value !== 'custom' ? resolvePlainAllPaths() : resolveCustomAllPaths();
      case 'folder':
        return resolvePlainFolderPaths();
      case 'artist':
        return resolvePlainArtistPaths();
      case 'album':
        return resolvePlainAlbumPaths();
      case 'recent':
        return localOrder.value !== 'custom'
          ? (remoteRecentPaths.value.length > 0 ? remoteRecentPaths.value : listKnownRecentPaths())
          : orderPathsBySortMode(listKnownRecentPaths(), localOrder.value, songsById.value);
      case 'favorites':
        return localOrder.value !== 'custom'
          ? (remoteFavoritePaths.value.length > 0 ? remoteFavoritePaths.value : collectFavoriteFallbackPaths())
          : orderPathsBySortMode(collectFavoriteFallbackPaths(), localOrder.value, songsById.value);
      case 'playlist':
        return orderPathsBySortMode(activePlaylistPaths.value, playlistOrder.value, songsById.value);
      default:
        return [];
    }
  };

  const resolveQueriedViewPaths = () => {
    const needle = searchInput.value.toLowerCase();

    if (viewMode.value === 'all' && localOrder.value !== 'custom') {
      const scoped = restrictToCanonical(remoteAllPaths.value);
      return localOrder.value === 'title' ? withAlphabetTitleOrder(scoped) : scoped;
    }

    const matchesQuery = buildTextMatcher(needle);

    switch (viewMode.value) {
      case 'favorites':
        return localOrder.value !== 'custom'
          ? remoteFavoritePaths.value
          : collectFavoriteFallbackPaths().filter(matchesQuery);
      case 'recent':
        return localOrder.value !== 'custom'
          ? remoteRecentPaths.value
          : listKnownRecentPaths().filter(matchesQuery);
      case 'all':
        return localOrder.value !== 'custom'
          ? restrictToCanonical(remoteAllPaths.value)
          : withAlphabetTitleOrder(canonicalSeq.value.filter(matchesQuery));
      case 'folder':
        if (folderOrder.value === 'custom') {
          return withAlphabetTitleOrder(activeFolderPaths.value.filter(matchesQuery));
        }
        if (folderOrder.value === 'name') {
          return sortItemsByAlphabetIndex(remoteFolderPaths.value, fileNameLabelOf);
        }
        if (folderOrder.value === 'title') {
          return withAlphabetTitleOrder(remoteFolderPaths.value);
        }
        return remoteFolderPaths.value;
      case 'artist': {
        const hits = detailScopedPaths.value.filter(matchesQuery);
        return localOrder.value === 'custom'
          ? hits
          : orderPathsBySortMode(hits, localOrder.value, songsById.value);
      }
      case 'album':
        return orderPathsByAlbumDetailMode(
          detailScopedPaths.value.filter(matchesQuery),
          albumDetailOrder.value,
          songsById.value,
        );
      case 'playlist':
        return orderPathsBySortMode(
          activePlaylistPaths.value.filter(matchesQuery),
          playlistOrder.value,
          songsById.value,
        );
      default:
        return canonicalSeq.value.filter(matchesQuery);
    }
  };

  const currentViewSongPaths = computed(() =>
    searchInput.value.trim() ? resolveQueriedViewPaths() : resolvePlainViewPaths(),
  );

  const currentViewSongs = computed(() => { // 实现
    canonicalSeq.value;
    const paths = currentViewSongPaths.value; // 取当前视图路径
    const resolved = paths
      .map(path => songsById.value.get(path))
      .filter((song): song is Song => !!song);
    // 播放集里可能存在尚未进入曲目索引的条目，从播放集自带数据补齐。
    if (viewMode.value === 'playlist' && resolved.length < paths.length) {
      const playlist = playlistSource.value.find(item => item.id === detailFilter.value);
      if (playlist?.songs && playlist.songs.length > 0) { // 歌单有歌时
        const resolvedPaths = new Set(resolved.map(s => s.path));
        const songsByPath = new Map(playlist.songs.map(s => [s.path, s] as const));
        const leftovers = paths
          .filter(path => !resolvedPaths.has(path))
          .map(path => songsByPath.get(path))
          .filter((song): song is Song => !!song); // 过滤无效项
        return [...resolved, ...leftovers];
      } // 过滤结束
    } // 条件结束
    return resolved;
  });

  const resolveSongByPath = (path: string) => {
    const known = songsById.value.get(path);
    if (known) {
      return known;
    }

    if (viewMode.value !== 'playlist') {
      return null;
    }

    const playlist = playlistSource.value.find(item => item.id === detailFilter.value);
    return playlist?.songs?.find(item => item.path === path) ?? null;
  };

  const currentViewSongCount = computed(() => currentViewSongPaths.value.length);

  let collectionsStoreRef: any = null;
  const loadCollectionsStore = async () => {
    if (collectionsStoreRef) return collectionsStoreRef;
    try {
      const mod = await import('../../features/collections/store');
      collectionsStoreRef = mod.useCollectionsStore();
      return collectionsStoreRef;
    } catch {
      return null;
    }
  };

  // 将探测到的时长同步到曲目索引、当前播放集与收藏元数据。
  const spreadDuration = (path: string, seconds: number) => {
    catalogStore.patchSongMeta(path, { duration: seconds });
    const playlist = playlistSource.value.find(item => item.id === detailFilter.value);
    if (playlist?.songs) {
      playlist.songs = playlist.songs.map(s =>
        s.path === path ? { ...s, duration: seconds } : s,
      );
    }
    void loadCollectionsStore().then((collectionsStore) => {
      if (!collectionsStore) return;
      const meta = collectionsStore.favoriteSongMeta[path];
      if (meta && meta.duration === 0) {
        collectionsStore.setFavoriteSongMeta(path, { ...meta, duration: seconds });
      }
    });
  };

  const durationFixer = createPlaylistDurationFixer({
    findSong: path => songsById.value.get(path),
    resolvePlaylist: id => playlistSource.value.find(item => item.id === id),
    applyDuration: spreadDuration,
  });

  watch(
    [viewMode, detailFilter] as const,
    ([mode, playlistId]) => {
      if (mode !== 'playlist') return;
      durationFixer.sync(playlistId);
    },
    { immediate: true },
  );

  return {
    currentViewSongPaths, // 实现
    currentViewSongCount, // 实现
    currentViewSongs, // 实现
    resolveSongByPath,
  };
}
