import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import { useLibraryStore } from './store';

import {
  isStaleLibraryPathRequestError,
  useLibraryAllSongPathCache,
} from '../../composables/useLibraryAllSongPathCache';
import { useLibraryCollectionSongPathCache } from '../../composables/useLibraryCollectionSongPathCache';
import { useLibraryDetailSongPathCache } from '../../composables/useLibraryDetailSongPathCache';
import { useLibraryFolderSongPathCache } from '../../composables/useLibraryFolderSongPathCache';
import type { AlbumDetailSortMode, FolderSortMode, LocalSortMode, PlaylistSortMode } from '../../services/storage/playerStorage';
import type { HistoryItem, Playlist, Song } from '../../types';
import { sortItemsByAlphabetIndex } from '../../utils/alphabetIndex';
import {
  compareSongPathsByTrackNumber,
  getSongArtistSearchText,
  getSongFileNameLabel,
  getSongTitleLabel,
  matchesAlbumKey,
  songHasArtist,
} from './playerLibraryViewShared';

interface UseLibraryCurrentViewSongsOptions {
  canonicalSongPaths: Ref<string[]>;
  playlists: Ref<Playlist[]>;
  recentSongs: Ref<HistoryItem[]>;
  songLookup: ComputedRef<Map<string, Song>>;
  favoriteSongPaths: ComputedRef<string[]>;
  currentFolderSongPaths: ComputedRef<string[]>;
  currentViewMode: Ref<string>;
  searchQuery: Ref<string>;
  localMusicTab: Ref<'default' | 'artist' | 'album'>;
  currentArtistFilter: Ref<string>;
  currentAlbumFilter: Ref<string>;
  currentFolderFilter: Ref<string>;
  filterCondition: Ref<string>;
  favTab: Ref<'songs' | 'playlists' | 'albums'>;
  folderSortMode: Ref<FolderSortMode>;
  localSortMode: Ref<LocalSortMode>;
  albumDetailSortMode: Ref<AlbumDetailSortMode>;
  localCustomOrder: Ref<string[]>;
  playlistSortMode: Ref<PlaylistSortMode>;
}

export function useLibraryCurrentViewSongs({
  canonicalSongPaths,
  playlists,
  recentSongs,
  songLookup,
  favoriteSongPaths,
  currentFolderSongPaths,
  currentViewMode,
  searchQuery,
  localMusicTab,
  currentArtistFilter,
  currentAlbumFilter,
  currentFolderFilter,
  filterCondition,
  favTab,
  folderSortMode,
  localSortMode,
  albumDetailSortMode,
  localCustomOrder,
  playlistSortMode,
}: UseLibraryCurrentViewSongsOptions) {
  const libraryStore = useLibraryStore();

  const allViewLoading = ref(false);
  const allViewUseCanonicalFallback = ref(false);
  const lastSuccessfulAllViewSongPaths = ref<string[]>([]);
  const currentQueryKey = ref('');

  const { loadAllViewSongPaths } = useLibraryAllSongPathCache();
  const { loadFavoriteSongPaths, loadRecentSongPaths } = useLibraryCollectionSongPathCache();
  const { loadArtistSongPaths, loadAlbumSongPaths } = useLibraryDetailSongPathCache();
  const {
    loadFolderViewSongPaths,
    libraryFolderSongPathCacheVersion,
  } = useLibraryFolderSongPathCache();
  const allViewSongPaths = ref<string[]>([]);
  const favoriteViewSongPaths = ref<string[]>([]);

  /** 判断是否为在线歌曲路径（不在本地音乐库/数据库中） */
  const isOnlineSongPath = (path: string) =>
    path.startsWith('lx://') || path.startsWith('remote://') || path.startsWith('plugin://');

  /**
   * 后端收藏视图按数据库反查，会丢掉在线歌曲。
   * 这里把仍能从 songLookup 反查到的在线收藏歌曲补回结果末尾，
   * 并在有搜索词时按标题/歌手做前端过滤。
   */
  const appendMissingOnlineFavorites = (
    backendPaths: string[],
    allFavoritePaths: string[],
    query: string,
  ) => {
    const existing = new Set(backendPaths);
    const keyword = query.trim().toLowerCase();

    const missingOnline = allFavoritePaths.filter((path) => {
      if (existing.has(path) || !isOnlineSongPath(path)) {
        return false;
      }

      const song = songLookup.value.get(path);
      if (!song) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      const title = getSongTitleLabel(song).toLowerCase();
      const artist = getSongArtistSearchText(song).toLowerCase();
      return title.includes(keyword) || artist.includes(keyword);
    });

    return missingOnline.length > 0 ? [...backendPaths, ...missingOnline] : backendPaths;
  };

  /**
   * 后端最近播放视图按数据库反查，会丢掉在线歌曲。
   * 这里把仍能从 songLookup 反查到的在线最近播放歌曲按 recentSongs 时间顺序补回结果，
   * 并在有搜索词时按标题/歌手做前端过滤。
   */
  const appendMissingOnlineRecents = (
    backendPaths: string[],
    recentItems: HistoryItem[],
    query: string,
  ) => {
    const existing = new Set(backendPaths);
    const keyword = query.trim().toLowerCase();

    const missingOnline = recentItems
      .map(item => item.path)
      .filter((path) => {
        if (existing.has(path) || !isOnlineSongPath(path)) {
          return false;
        }

        const song = songLookup.value.get(path);
        if (!song) {
          return false;
        }

        if (!keyword) {
          return true;
        }

        const title = getSongTitleLabel(song).toLowerCase();
        const artist = getSongArtistSearchText(song).toLowerCase();
        return title.includes(keyword) || artist.includes(keyword);
      });

    return missingOnline.length > 0 ? [...backendPaths, ...missingOnline] : backendPaths;
  };
  const recentViewSongPaths = ref<string[]>([]);
  const folderViewSongPaths = ref<string[]>([]);
  const localArtistFilterPaths = ref<string[]>([]);
  const localAlbumFilterPaths = ref<string[]>([]);
  const detailViewSongPaths = ref<string[]>([]);
  let allViewRequestId = 0;
  let favoriteViewRequestId = 0;
  let recentViewRequestId = 0;
  let folderViewRequestId = 0;
  let localArtistRequestId = 0;
  let localAlbumRequestId = 0;
  let detailViewRequestId = 0;

  const resolveRecentSongPaths = () =>
    recentSongs.value
      .map(item => item.path)
      .filter(path => songLookup.value.has(path));

  watch(
    [
      currentViewMode,
      searchQuery,
      localMusicTab,
      currentArtistFilter,
      currentAlbumFilter,
      localSortMode,
      canonicalSongPaths,
    ],
    async ([viewMode, query, musicTab, artistFilter, albumFilter, sortMode]) => {
      const requestId = ++allViewRequestId;

      if (viewMode !== 'all' || sortMode === 'custom') {
        allViewSongPaths.value = [];
        return;
      }

      const nextQueryKey = `${musicTab}\u0001${artistFilter}\u0001${albumFilter}\u0001${sortMode}\u0001${query}`;
      const isQueryKeyChanged = currentQueryKey.value !== nextQueryKey;
      currentQueryKey.value = nextQueryKey;

      // 如果过滤/查询条件变了，立即清空上一次结果，防旧数据筛选错乱
      if (isQueryKeyChanged) {
        allViewSongPaths.value = [];
        allViewUseCanonicalFallback.value = false;
        lastSuccessfulAllViewSongPaths.value = [];
      }

      allViewLoading.value = true;

      // 扫描导入版本风暴控制：若正处于扫描中且已有旧成功数据，为防 batch 频繁失效风暴，延迟加载并使用旧列表做过渡渲染
      const isScanning = !!libraryStore.libraryScanProgress && !libraryStore.libraryScanProgress.done;
      if (isScanning && lastSuccessfulAllViewSongPaths.value.length > 0) {
        allViewLoading.value = false;
        return;
      }

      const loadCurrentAllViewPaths = () => loadAllViewSongPaths({
        query,
        artistFilter: musicTab === 'artist' ? artistFilter : '',
        albumFilter: musicTab === 'album' ? albumFilter : '',
        sortMode,
      });

      try {
        const paths = await loadCurrentAllViewPaths();

        if (requestId !== allViewRequestId) {
          return;
        }

        allViewSongPaths.value = paths;
        allViewUseCanonicalFallback.value = false;
        lastSuccessfulAllViewSongPaths.value = paths; // 缓存成功列表
      } catch (error) {
        if (requestId !== allViewRequestId) {
          return;
        }
        if (isStaleLibraryPathRequestError(error)) {
          allViewUseCanonicalFallback.value = true;
          try {
            const paths = await loadCurrentAllViewPaths();
            if (requestId !== allViewRequestId) {
              return;
            }
            allViewSongPaths.value = paths;
            allViewUseCanonicalFallback.value = false;
            lastSuccessfulAllViewSongPaths.value = paths;
          } catch (retryError) {
            if (!isStaleLibraryPathRequestError(retryError)) {
              allViewSongPaths.value = [];
              allViewUseCanonicalFallback.value = false;
            }
          }
          return;
        }
        allViewUseCanonicalFallback.value = false;
        allViewSongPaths.value = [];
      } finally {
        if (requestId === allViewRequestId) {
          allViewLoading.value = false;
        }
      }
    },
    { immediate: true },
  );

  watch(
    [
      currentViewMode,
      favoriteSongPaths,
      searchQuery,
      favTab,
      localSortMode,
      canonicalSongPaths,
    ],
    async ([viewMode, paths, query, currentFavTab, sortMode]) => {
      const requestId = ++favoriteViewRequestId;

      // 收藏页"歌单/专辑"tab 展示整张收藏网格，歌曲列表仅在"单曲"tab 加载
      if (viewMode !== 'favorites' || currentFavTab !== 'songs' || sortMode === 'custom') {
        favoriteViewSongPaths.value = [];
        return;
      }

      if (paths.length === 0) {
        favoriteViewSongPaths.value = [];
        return;
      }

      try {
        const nextPaths = await loadFavoriteSongPaths({
          favoritePaths: paths,
          query,
          sortMode,
        });

        if (requestId !== favoriteViewRequestId) {
          return;
        }

        // 后端按数据库反查收藏歌曲，在线歌曲（lx://、remote://、plugin://）不在库中会被丢弃。
        // 这里把仍可从前端反查到的在线收藏歌曲补回列表末尾，避免它们在排序/搜索模式下消失。
        favoriteViewSongPaths.value = appendMissingOnlineFavorites(nextPaths, paths, query);
      } catch {
        if (requestId !== favoriteViewRequestId) {
          return;
        }

        favoriteViewSongPaths.value = [];
      }
    },
    { immediate: true },
  );

  watch(
    [
      currentViewMode,
      recentSongs,
      searchQuery,
      localSortMode,
      canonicalSongPaths,
    ],
    async ([viewMode, items, query, sortMode]) => {
      const requestId = ++recentViewRequestId;

      if (viewMode !== 'recent' || sortMode === 'custom') {
        recentViewSongPaths.value = [];
        return;
      }

      if (items.length === 0) {
        recentViewSongPaths.value = [];
        return;
      }

      try {
        const nextPaths = await loadRecentSongPaths({
          recentSongs: items,
          query,
          sortMode,
        });

        if (requestId !== recentViewRequestId) {
          return;
        }

        // 后端按数据库反查最近播放，在线歌曲（lx://、remote://、plugin://）不在库中会被丢弃。
        // 这里把仍可从前端反查到的在线最近播放歌曲补回列表末尾，避免它们在排序/搜索模式下消失。
        recentViewSongPaths.value = appendMissingOnlineRecents(nextPaths, items, query);
      } catch {
        if (requestId !== recentViewRequestId) {
          return;
        }

        recentViewSongPaths.value = [];
      }
    },
    { immediate: true },
  );

  watch(
    [
      currentViewMode,
      currentFolderFilter,
      searchQuery,
      folderSortMode,
      currentFolderSongPaths,
      libraryFolderSongPathCacheVersion,
      () => libraryStore.libraryDataVersion,
    ],
    async ([viewMode, folderFilter, query, sortMode]) => {
      const requestId = ++folderViewRequestId;

      if (viewMode !== 'folder' || !folderFilter || sortMode === 'custom') {
        folderViewSongPaths.value = [];
        return;
      }

      try {
        const nextPaths = await loadFolderViewSongPaths({
          folderPath: folderFilter,
          query,
          sortMode,
        });

        if (requestId !== folderViewRequestId) {
          return;
        }

        folderViewSongPaths.value = nextPaths;
      } catch (error) {
        if (requestId !== folderViewRequestId) {
          return;
        }

        folderViewSongPaths.value = [];
      }
    },
    { immediate: true },
  );

  watch(
    [
      currentViewMode,
      localMusicTab,
      currentArtistFilter,
      canonicalSongPaths,
    ],
    async ([viewMode, musicTab, artistFilter]) => {
      const requestId = ++localArtistRequestId;

      if (viewMode !== 'all' || musicTab !== 'artist' || !artistFilter) {
        localArtistFilterPaths.value = [];
        return;
      }

      try {
        const paths = await loadArtistSongPaths(artistFilter);
        if (requestId !== localArtistRequestId) {
          return;
        }

        localArtistFilterPaths.value = paths;
      } catch {
        if (requestId !== localArtistRequestId) {
          return;
        }

        localArtistFilterPaths.value = [];
      }
    },
    { immediate: true },
  );

  watch(
    [
      currentViewMode,
      localMusicTab,
      currentAlbumFilter,
      canonicalSongPaths,
    ],
    async ([viewMode, musicTab, albumFilter]) => {
      const requestId = ++localAlbumRequestId;

      if (viewMode !== 'all' || musicTab !== 'album' || !albumFilter) {
        localAlbumFilterPaths.value = [];
        return;
      }

      try {
        const paths = await loadAlbumSongPaths(albumFilter);
        if (requestId !== localAlbumRequestId) {
          return;
        }

        localAlbumFilterPaths.value = paths;
      } catch {
        if (requestId !== localAlbumRequestId) {
          return;
        }

        localAlbumFilterPaths.value = [];
      }
    },
    { immediate: true },
  );

  watch(
    [
      currentViewMode,
      filterCondition,
      canonicalSongPaths,
    ],
    async ([viewMode, filter]) => {
      const requestId = ++detailViewRequestId;

      if (!filter || (viewMode !== 'artist' && viewMode !== 'album')) {
        detailViewSongPaths.value = [];
        return;
      }

      try {
        const paths = viewMode === 'artist'
          ? await loadArtistSongPaths(filter)
          : await loadAlbumSongPaths(filter);

        if (requestId !== detailViewRequestId) {
          return;
        }

        detailViewSongPaths.value = paths;
      } catch {
        if (requestId !== detailViewRequestId) {
          return;
        }

        detailViewSongPaths.value = [];
      }
    },
    { immediate: true },
  );

  const materializeSongPaths = (paths: string[]) =>
    paths
      .map(path => songLookup.value.get(path))
      .filter((song): song is Song => !!song);

  const filterRenderableCanonicalPaths = (paths: string[]) => {
    const canonicalPathSet = new Set(canonicalSongPaths.value);
    return paths.filter(path => canonicalPathSet.has(path) && songLookup.value.has(path));
  };

  const resolveFavoriteFallbackPaths = () => {
    if (favTab.value !== 'songs') {
      return [];
    }

    return [...favoriteSongPaths.value];
  };

  const sortSongPathsByLocalMode = (paths: string[], mode: LocalSortMode) => {
    const sortedPaths = [...paths];

    if (mode === 'title') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.title || songLookup.value.get(left)?.name || '').localeCompare(
          songLookup.value.get(right)?.title || songLookup.value.get(right)?.name || '',
          'zh-CN',
        ),
      );
    } else if (mode === 'artist') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.artist || '').localeCompare(songLookup.value.get(right)?.artist || '', 'zh-CN'),
      );
    } else if (mode === 'added_at') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(right)?.added_at || 0) - (songLookup.value.get(left)?.added_at || 0),
      );
    } else if (mode === 'added_at_asc') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.added_at || 0) - (songLookup.value.get(right)?.added_at || 0),
      );
    } else if (mode === 'file_modified_at') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(right)?.file_modified_at || 0) - (songLookup.value.get(left)?.file_modified_at || 0),
      );
    } else if (mode === 'file_modified_at_asc') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.file_modified_at || 0) - (songLookup.value.get(right)?.file_modified_at || 0),
      );
    }

    return sortedPaths;
  };

  const sortSongPathsByAlbumDetailMode = (paths: string[], mode: AlbumDetailSortMode) => {
    if (mode !== 'track_number' && mode !== 'track_number_desc') {
      return sortSongPathsByLocalMode(paths, mode as LocalSortMode);
    }

    const sortedPaths = [...paths];
    sortedPaths.sort((left, right) => {
      const result = compareSongPathsByTrackNumber(left, right, songLookup.value);
      return mode === 'track_number_desc' ? -result : result;
    });

    return sortedPaths;
  };

  const sortSongPathsByPlaylistMode = (paths: string[], mode: PlaylistSortMode) => {
    const sortedPaths = [...paths];

    if (mode === 'title') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.title || songLookup.value.get(left)?.name || '').localeCompare(
          songLookup.value.get(right)?.title || songLookup.value.get(right)?.name || '',
          'zh-CN',
        ),
      );
    } else if (mode === 'name') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.name || '').localeCompare(songLookup.value.get(right)?.name || '', 'zh-CN'),
      );
    } else if (mode === 'artist') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.artist || '').localeCompare(songLookup.value.get(right)?.artist || '', 'zh-CN'),
      );
    } else if (mode === 'added_at') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(right)?.added_at || 0) - (songLookup.value.get(left)?.added_at || 0),
      );
    } else if (mode === 'added_at_asc') {
      sortedPaths.sort((left, right) =>
        (songLookup.value.get(left)?.added_at || 0) - (songLookup.value.get(right)?.added_at || 0),
      );
    }

    return sortedPaths;
  };

  // 改为 computed 缓存，避免每次 currentViewSongPaths 重算时重复执行 O(n) 查找和过滤
  const resolvedPlaylistSongPaths = computed(() => {
    if (currentViewMode.value !== 'playlist') return [];

    const playlist = playlists.value.find(item => item.id === filterCondition.value);
    if (!playlist) {
      return [];
    }

    // 优先使用 playlist.songs 缓存中的歌曲路径（在线歌曲可能尚未注入 songPool）
    if (playlist.songs && playlist.songs.length > 0) {
      const songPathSet = new Set(playlist.songs.map(s => s.path).filter(Boolean));
      // 合并 songPaths 和 songs 中的路径，确保所有歌曲都能被展示
      return playlist.songPaths.filter(path =>
        songLookup.value.has(path) || songPathSet.has(path)
      );
    }

    return playlist.songPaths.filter(path => songLookup.value.has(path));
  });

  const currentViewSongPaths = computed(() => {
    if (searchQuery.value.trim()) {
      const query = searchQuery.value.toLowerCase();

      if (currentViewMode.value === 'all' && localSortMode.value !== 'custom') {
        const renderablePaths = filterRenderableCanonicalPaths(allViewSongPaths.value);
        if (localSortMode.value === 'title') {
          return sortItemsByAlphabetIndex(
            renderablePaths,
            (path) => getSongTitleLabel(songLookup.value.get(path)!),
          );
        }
        return renderablePaths;
      }

      const matchesQuery = (path: string) => {
        const song = songLookup.value.get(path);
        if (!song) {
          return false;
        }
        return song.name.toLowerCase().includes(query)
          || getSongArtistSearchText(song).includes(query)
          || song.album.toLowerCase().includes(query);
      };

      if (currentViewMode.value === 'favorites') {
        if (localSortMode.value !== 'custom') {
          return favoriteViewSongPaths.value;
        }

        return resolveFavoriteFallbackPaths().filter(matchesQuery);
      }

      if (currentViewMode.value === 'recent') {
        if (localSortMode.value !== 'custom') {
          return recentViewSongPaths.value;
        }

        return resolveRecentSongPaths().filter(matchesQuery);
      }

      if (currentViewMode.value === 'all') {
        if (localSortMode.value !== 'custom') {
          return filterRenderableCanonicalPaths(allViewSongPaths.value);
        }

        return sortItemsByAlphabetIndex(
          canonicalSongPaths.value.filter(matchesQuery),
          (path) => getSongTitleLabel(songLookup.value.get(path)!),
        );
      }

      if (currentViewMode.value === 'folder') {
        if (folderSortMode.value !== 'custom') {
          if (folderSortMode.value === 'name') {
            return sortItemsByAlphabetIndex(
              folderViewSongPaths.value,
              (path) => getSongFileNameLabel(songLookup.value.get(path)!),
            );
          }
          if (folderSortMode.value === 'title') {
            return sortItemsByAlphabetIndex(
              folderViewSongPaths.value,
              (path) => getSongTitleLabel(songLookup.value.get(path)!),
            );
          }
          return folderViewSongPaths.value;
        }

        return sortItemsByAlphabetIndex(currentFolderSongPaths.value.filter(matchesQuery), (path) =>
          getSongTitleLabel(songLookup.value.get(path)!),
        );
      }

      if (currentViewMode.value === 'artist') {
        const filteredPaths = detailViewSongPaths.value.filter(matchesQuery);
        return localSortMode.value === 'custom'
          ? filteredPaths
          : sortSongPathsByLocalMode(filteredPaths, localSortMode.value);
      }

      if (currentViewMode.value === 'album') {
        return sortSongPathsByAlbumDetailMode(
          detailViewSongPaths.value.filter(matchesQuery),
          albumDetailSortMode.value,
        );
      }

      if (currentViewMode.value === 'playlist') {
        return sortSongPathsByPlaylistMode(
          resolvedPlaylistSongPaths.value.filter(matchesQuery),
          playlistSortMode.value,
        );
      }

      return canonicalSongPaths.value.filter(matchesQuery);
    }

    if (currentViewMode.value === 'all') {
      if (localSortMode.value !== 'custom') {
        let pathsToRender = allViewSongPaths.value;
        const isCurrentlyEmpty = allViewSongPaths.value.length === 0;

        if (isCurrentlyEmpty) {
          if (lastSuccessfulAllViewSongPaths.value.length > 0) {
            // 1. 优先展示上一次渲染成功的结果，实现毫秒级快速切回过渡
            pathsToRender = lastSuccessfulAllViewSongPaths.value;
          } else if (allViewLoading.value || allViewUseCanonicalFallback.value) {
            // 2. 首次导入空档期且正在加载中：以常驻内存 canonicalSongPaths 辅以本地简排做临时兜底，根除空白
            pathsToRender = sortSongPathsByLocalMode(canonicalSongPaths.value, localSortMode.value);
          }
        }

        const renderablePaths = filterRenderableCanonicalPaths(pathsToRender);

        if (localSortMode.value === 'title') {
          return sortItemsByAlphabetIndex(
            renderablePaths,
            (path) => getSongTitleLabel(songLookup.value.get(path)!),
          );
        }
        return renderablePaths;
      }

      let base = [...canonicalSongPaths.value];
      if (localMusicTab.value === 'artist' && currentArtistFilter.value) {
        base = [...localArtistFilterPaths.value];
      } else if (localMusicTab.value === 'album' && currentAlbumFilter.value) {
        base = [...localAlbumFilterPaths.value];
      }

      const orderMap = new Map(localCustomOrder.value.map((path, index) => [path, index]));
      base.sort((left, right) => {
        const leftIndex = orderMap.has(left) ? orderMap.get(left)! : Number.MAX_SAFE_INTEGER;
        const rightIndex = orderMap.has(right) ? orderMap.get(right)! : Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
      });

      return base;
    }

    if (currentViewMode.value === 'folder') {
      if (folderSortMode.value !== 'custom') {
        // 异步加载期间 folderViewSongPaths 可能为空，用 currentFolderSongPaths 做同步兜底
        const paths = folderViewSongPaths.value.length > 0
          ? folderViewSongPaths.value
          : currentFolderSongPaths.value;
        if (folderSortMode.value === 'name') {
          return sortItemsByAlphabetIndex(
            paths,
            (path) => getSongFileNameLabel(songLookup.value.get(path)!),
          );
        }
        if (folderSortMode.value === 'title') {
          return sortItemsByAlphabetIndex(
            paths,
            (path) => getSongTitleLabel(songLookup.value.get(path)!),
          );
        }
        return paths;
      }

      return currentFolderSongPaths.value;
    }

    if (currentViewMode.value === 'artist') {
      // 异步加载期间 detailViewSongPaths 可能为空，用 canonicalSongPaths 同步过滤做兜底
      const paths = detailViewSongPaths.value.length > 0
        ? detailViewSongPaths.value
        : canonicalSongPaths.value.filter(path => {
            const song = songLookup.value.get(path);
            return song && songHasArtist(song, filterCondition.value);
          });
      return localSortMode.value === 'custom'
        ? paths
        : sortSongPathsByLocalMode(paths, localSortMode.value);
    }

    if (currentViewMode.value === 'album') {
      // 异步加载期间 detailViewSongPaths 可能为空，用 canonicalSongPaths 同步过滤做兜底
      const paths = detailViewSongPaths.value.length > 0
        ? detailViewSongPaths.value
        : canonicalSongPaths.value.filter(path => {
            const song = songLookup.value.get(path);
            return song && matchesAlbumKey(song, filterCondition.value);
          });
      return sortSongPathsByAlbumDetailMode(paths, albumDetailSortMode.value);
    }

    if (currentViewMode.value === 'recent') {
      if (localSortMode.value !== 'custom') {
        // 异步加载期间 recentViewSongPaths 可能为空，用 resolveRecentSongPaths 做同步兜底，
        // 避免切换到最近播放页时出现白屏
        const paths = recentViewSongPaths.value;
        if (paths.length > 0) {
          return paths;
        }
        return resolveRecentSongPaths();
      }

      return sortSongPathsByLocalMode(resolveRecentSongPaths(), localSortMode.value);
    }

    if (currentViewMode.value === 'favorites') {
      if (localSortMode.value !== 'custom') {
        // 异步加载期间 favoriteViewSongPaths 可能为空，用 resolveFavoriteFallbackPaths 做同步兜底，
        // 避免切换到收藏页时出现白屏
        const paths = favoriteViewSongPaths.value;
        if (paths.length > 0) {
          return paths;
        }
        return resolveFavoriteFallbackPaths();
      }

      const paths = resolveFavoriteFallbackPaths();
      return sortSongPathsByLocalMode(paths, localSortMode.value);
    }

    if (currentViewMode.value === 'playlist') {
      return sortSongPathsByPlaylistMode(
        resolvedPlaylistSongPaths.value,
        playlistSortMode.value,
      );
    }

    return [];
  });

  const currentViewSongs = computed(() => {
    canonicalSongPaths.value;

    const paths = currentViewSongPaths.value;
    const songsFromLookup = materializeSongPaths(paths);

    // 歌单视图：如果 songLookup 找不到所有歌曲（在线歌曲重启后尚未注入 songPool），
    // 从 playlist.songs 缓存中补充缺失的歌曲
    if (currentViewMode.value === 'playlist' && songsFromLookup.length < paths.length) {
      const playlist = playlists.value.find(item => item.id === filterCondition.value);
      if (playlist?.songs && playlist.songs.length > 0) {
        const foundPaths = new Set(songsFromLookup.map(s => s.path));
        const songMap = new Map(playlist.songs.map(s => [s.path, s] as const));
        const missing = paths
          .filter(path => !foundPaths.has(path))
          .map(path => songMap.get(path))
          .filter((song): song is Song => !!song);
        return [...songsFromLookup, ...missing];
      }
    }

    return songsFromLookup;
  });

  const resolveSongByPath = (path: string) => {
    const song = songLookup.value.get(path);
    if (song) {
      return song;
    }

    // 歌单页惰性渲染：在线歌曲可能只存在于 playlist.songs 缓存中。
    // 这里按需解析单个 path，避免进入歌单详情时为了补全在线歌曲一次性构建完整 Song[]。
    if (currentViewMode.value !== 'playlist') {
      return null;
    }

    const playlist = playlists.value.find(item => item.id === filterCondition.value);
    return playlist?.songs?.find(item => item.path === path) ?? null;
  };

  const currentViewSongCount = computed(() => currentViewSongPaths.value.length);

  return {
    currentViewSongPaths,
    currentViewSongCount,
    currentViewSongs,
    resolveSongByPath,
  };
}
