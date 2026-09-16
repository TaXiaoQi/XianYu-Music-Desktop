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
import { parseIntervalToSeconds } from '../../utils/remoteSong';
import { cacheLxSong, getCachedLxSong } from '../../services/domain/lxSongCache';
import { lxSearch, txBatchTrackInterval } from '../../services/domain/lxMusicSdk';
import type { LxSourceId } from '../../services/domain/lxMusicSdkTypes';
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

  // ── 在线歌曲时长补全工具 ──
  // isOnlineSongPath 已在上方定义，直接复用

  /** 从 song.rawData 或 lxSongCache 中提取时长（秒），无法提取时返回 0 */
  const extractDurationFromSong = (song: Song): number => {
    // 1. lx:// 歌曲：从 lxSongCache 中查 interval
    if (song.path?.startsWith('lx://')) {
      const sourceKey = song.path.slice('lx://'.length).split('/')[0];
      const songmid = song.path.slice('lx://'.length).split('/')[1] ?? '';
      if (sourceKey && songmid) {
        const cached = getCachedLxSong(sourceKey, songmid);
        if (cached?.interval) {
          return parseIntervalToSeconds(cached.interval);
        }
      }
      // 也从 rawData 中尝试 —— 覆盖多种字段名（含大写/KG 特有 Duration）
      const raw = song.rawData;
      if (raw) {
        const rawInterval = raw.interval ?? raw.Interval ?? raw.dt ?? raw.Dt ?? raw.timelength ?? raw.Timelength;
        if (rawInterval) {
          const s = parseIntervalToSeconds(String(rawInterval));
          if (s > 0) return s;
        }
        // KG/腾讯/网易等平台 rawData 里可能直接给 Duration 毫秒数
        const ms = raw.duration ?? raw.Duration ?? raw.durationMs ?? raw.duration_ms;
        if (typeof ms === 'number' && ms > 0) {
          return ms > 1000 ? Math.floor(ms / 1000) : ms;
        }
      }
    }

    // 2. plugin:// 歌曲：从 rawData 中提取
    if (song.path?.startsWith('plugin://')) {
      const raw = song.rawData;
      if (raw) {
        // 尝试多种字段名（含大写）
        const dt = raw.duration ?? raw.Duration ?? raw.dt ?? raw.interval ?? raw.intervalSeconds ?? raw.timelength;
        if (typeof dt === 'number' && dt > 0) {
          return dt > 1000 ? Math.floor(dt / 1000) : dt;
        }
        if (typeof dt === 'string') {
          const parsed = parseIntervalToSeconds(dt);
          if (parsed > 0) return parsed;
        }
      }
    }

    // 3. remote:// 歌曲：从 rawData 中提取
    if (song.path?.startsWith('remote://')) {
      const raw = song.rawData;
      if (raw) {
        const dt = raw.duration ?? raw.Duration ?? raw.dt ?? raw.interval;
        if (typeof dt === 'number' && dt > 0) {
          return dt > 1000 ? Math.floor(dt / 1000) : dt;
        }
      }
    }

    return 0;
  };

  /** 延迟获取 collectionsStore（避免循环依赖） */
  let _collectionsStore: any = null;
  const getCollectionsStore = async () => {
    if (_collectionsStore) return _collectionsStore;
    try {
      const mod = await import('../../features/collections/store');
      _collectionsStore = mod.useCollectionsStore();
      return _collectionsStore;
    } catch {
      return null;
    }
  };

  // ── 歌单视图：自动检测并补全在线歌曲时长为 0 的条目 ──
  // 打开歌单时扫描所有歌曲，对 duration===0 的在线歌曲（lx://、plugin://、remote://）做分层兜底：
  //   0) 同步从 lxSongCache / rawData 直接提取 interval/duration；
  //   1) TX 源 → txBatchTrackInterval 按 songid 批量 50 首一次，不走搜索接口不受风控（朋友写的！）；
  //   2) 其他源（KG/WY/MG/KW）→ 队列式 lxSearch 重查 interval，并发 3 个。
  let lastProbedPlaylistId = '';
  /** 正在 probe 中的 lx:// path（防重复） */
  const probingLxPaths = new Set<string>();
  /** 队列节流：一次最多并发 CONCURRENCY 个请求 */
  const PROBE_CONCURRENCY = 3;
  let activeProbes = 0;
  const probeQueue: Song[] = [];

  /** 统一更新三处：libraryStore / playlist.songs / favoriteSongMeta */
  const patchSongDurationAll = async (path: string, duration: number) => {
    libraryStore.patchSongMeta(path, { duration });
    const playlist = playlists.value.find(p => p.id === filterCondition.value);
    if (playlist?.songs) {
      playlist.songs = playlist.songs.map(s =>
        s.path === path ? { ...s, duration } : s,
      );
    }
    void getCollectionsStore().then(collectionsStore => {
      if (!collectionsStore) return;
      const meta = collectionsStore.favoriteSongMeta[path];
      if (meta && meta.duration === 0) {
        collectionsStore.setFavoriteSongMeta(path, { ...meta, duration });
      }
    });
  };

  /** 消费 probe 队列，并发槽空出时自动补上 */
  const drainProbeQueue = () => {
    while (activeProbes < PROBE_CONCURRENCY && probeQueue.length > 0) {
      const song = probeQueue.shift()!;
      void probeLxSongDuration(song).finally(() => {
        activeProbes--;
        drainProbeQueue();
      });
      activeProbes++;
    }
  };

  /** 异步：通过 lxSearch 获取一首歌的 interval 并更新；原源失败时自动换源 fallback */
  const probeLxSongDuration = async (song: Song) => {
    if (!song.path?.startsWith('lx://')) return;
    if (probingLxPaths.has(song.path)) return;
    probingLxPaths.add(song.path);

    try {
      const originalSource = song.path.slice('lx://'.length).split('/')[0] as LxSourceId;
      if (!originalSource || !['kg', 'tx', 'wy', 'mg', 'kw'].includes(originalSource)) return;

      // 换源 fallback 顺序：原源稳定则只查原源；原源不稳定（WY/MG）时按 KG → KW → TX 依次尝试
      const STABLE_SOURCES = ['kg', 'tx', 'kw'] as const;
      const sourceCandidates: LxSourceId[] =
        STABLE_SOURCES.includes(originalSource as any)
          ? [originalSource]
          : [...STABLE_SOURCES]; // WY/MG 跳过自己的源，直接换源

      const keyword = song.name || song.title || '';
      let matched: { interval: string; source: string; songmid?: string | number } | null = null;

      for (const trySource of sourceCandidates) {
        let list: Array<{ songmid: string | number; name: string; singer?: string; interval: string }> = [];
        // 限流(406/429)重试 2 次；404/403/405 等不可恢复错误直接放弃该源
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await lxSearch(trySource, keyword, 1, 10);
            list = r?.list ?? [];
            break;
          } catch (e: any) {
            const msg = String(e?.message ?? e ?? '');
            if (/404|403|405|not found|forbidden|method not allowed/i.test(msg)) {
              list = []; // 这个源彻底不行，换下一个源
              break;
            }
            if (/406|429|限流|频率|frequent|denied/i.test(msg) && attempt < 2) {
              await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
              continue;
            }
            list = [];
            break;
          }
        }
        if (!list.length) continue;

        // 优先按 songmid 精确匹配（只对原源），其次按歌名+歌手模糊匹配（换源场景只能模糊）
        if (trySource === originalSource) {
          const songmid = song.path.slice('lx://'.length).split('/')[1];
          const item = list.find(i => String(i.songmid) === String(songmid)) ?? null;
          if (item) matched = { ...item, source: trySource };
        }
        if (!matched) {
          const item = list.find(
            i => i.name === song.name && (i.singer || '').includes(song.artist || ''),
          ) ?? null;
          if (item) matched = { ...item, source: trySource };
        }
        if (matched) break; // 找到就停
      }

      if (!matched) return;

      const duration = parseIntervalToSeconds(matched.interval);
      if (duration <= 0) return;

      // 同步更新 songPool，同时把换源搜到的 interval 缓存进去便于后续复用
      cacheLxSong({ interval: matched.interval, songmid: matched.songmid || '', source: matched.source } as any);

      libraryStore.patchSongMeta(song.path, { duration });
      const playlist = playlists.value.find(p => p.id === filterCondition.value);
      if (playlist?.songs) {
        playlist.songs = playlist.songs.map(s =>
          s.path === song.path ? { ...s, duration } : s,
        );
      }
      void getCollectionsStore().then(collectionsStore => {
        if (!collectionsStore) return;
        const meta = collectionsStore.favoriteSongMeta[song.path];
        if (meta && meta.duration === 0) {
          collectionsStore.setFavoriteSongMeta(song.path, { ...meta, duration });
        }
      });
    } catch { /* 静默忽略 */ }
    finally { probingLxPaths.delete(song.path); }
  };

  watch(
    [currentViewMode, filterCondition] as const,
    ([mode, playlistId]) => {
      if (mode !== 'playlist' || !playlistId || playlistId === lastProbedPlaylistId) return;
      lastProbedPlaylistId = playlistId;

      const playlist = playlists.value.find(item => item.id === playlistId);
      if (!playlist) return;

      // 收集所有 duration=0 的在线歌曲
      const songsToFix: Song[] = [];
      for (const path of playlist.songPaths) {
        const song = songLookup.value.get(path) ?? playlist.songs?.find(s => s.path === path);
        if (song && song.duration === 0 && isOnlineSongPath(song.path)) {
          songsToFix.push(song);
        }
      }
      if (songsToFix.length === 0) return;

      // 0) 同步：从 lxSongCache / rawData 直接提取
      const patches: Array<[string, number]> = [];
      // 分类：TX 源走批量接口；其他 lx:// 源统一进队列（probeLxSongDuration 内部自动换源 fallback）
      const txSongs: Song[] = [];
      const queueableLxSongs: Song[] = [];

      for (const song of songsToFix) {
        const duration = extractDurationFromSong(song);
        if (duration > 0) {
          patches.push([song.path, duration]);
        } else if (song.path?.startsWith('lx://')) {
          const src = song.path.slice('lx://'.length).split('/')[0];
          if (src === 'tx') txSongs.push(song);
          else queueableLxSongs.push(song); // 所有非 TX 的 lx:// 都进队列，probeLxSongDuration 内部换源
        }
      }

      // 同步批量更新（来自缓存/rawData）
      for (const [path, duration] of patches) {
        void patchSongDurationAll(path, duration);
      }

      // 1) TX 源：用朋友写的 txBatchTrackInterval！按 songid 批量 50 首一次，不走搜索接口不受风控
      if (txSongs.length > 0) {
        const songIds = txSongs
          .map(s => s.rawData?.id ?? s.path.slice('lx://tx/'.length).split('/')[1])
          .filter(Boolean) as string[];
        void txBatchTrackInterval(songIds).then(durationMap => {
          if (!durationMap.size) return;
          for (const song of txSongs) {
            const songmid = song.path.slice('lx://tx/'.length).split('/')[1];
            const seconds = durationMap.get(String(songmid));
            if (seconds && seconds > 0) {
              void patchSongDurationAll(song.path, seconds);
            }
          }
        });
      }

      // 2) KG/KW：进入 lxSearch 队列（并发 3，限流退避）
      probeQueue.length = 0;
      probeQueue.push(...queueableLxSongs);
      drainProbeQueue();
    },
    { immediate: true },
  );

  return {
    currentViewSongPaths,
    currentViewSongCount,
    currentViewSongs,
    resolveSongByPath,
  };
}
