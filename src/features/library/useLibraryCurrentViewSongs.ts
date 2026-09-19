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

  const isOnlineSongPath = (path: string) =>
    path.startsWith('lx://') || path.startsWith('remote://') || path.startsWith('plugin://');

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

      if (isQueryKeyChanged) {
        allViewSongPaths.value = [];
        allViewUseCanonicalFallback.value = false;
        lastSuccessfulAllViewSongPaths.value = [];
      }

      allViewLoading.value = true;

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
        lastSuccessfulAllViewSongPaths.value = paths;
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

  const resolvedPlaylistSongPaths = computed(() => {
    if (currentViewMode.value !== 'playlist') return [];

    const playlist = playlists.value.find(item => item.id === filterCondition.value);
    if (!playlist) {
      return [];
    }

    if (playlist.songs && playlist.songs.length > 0) {
      const songPathSet = new Set(playlist.songs.map(s => s.path).filter(Boolean));
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
            pathsToRender = lastSuccessfulAllViewSongPaths.value;
          } else if (allViewLoading.value || allViewUseCanonicalFallback.value) {
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

    if (currentViewMode.value !== 'playlist') {
      return null;
    }

    const playlist = playlists.value.find(item => item.id === filterCondition.value);
    return playlist?.songs?.find(item => item.path === path) ?? null;
  };

  const currentViewSongCount = computed(() => currentViewSongPaths.value.length);


  const extractDurationFromSong = (song: Song): number => {
    if (song.path?.startsWith('lx://')) {
      const sourceKey = song.path.slice('lx://'.length).split('/')[0];
      const songmid = song.path.slice('lx://'.length).split('/')[1] ?? '';
      if (sourceKey && songmid) {
        const cached = getCachedLxSong(sourceKey, songmid);
        if (cached?.interval) {
          return parseIntervalToSeconds(cached.interval);
        }
      }
      const raw = song.rawData;
      if (raw) {
        const rawInterval = raw.interval ?? raw.Interval ?? raw.dt ?? raw.Dt ?? raw.timelength ?? raw.Timelength;
        if (rawInterval) {
          const s = parseIntervalToSeconds(String(rawInterval));
          if (s > 0) return s;
        }
        const ms = raw.duration ?? raw.Duration ?? raw.durationMs ?? raw.duration_ms;
        if (typeof ms === 'number' && ms > 0) {
          return ms > 1000 ? Math.floor(ms / 1000) : ms;
        }
      }
    }

    if (song.path?.startsWith('plugin://')) {
      const raw = song.rawData;
      if (raw) {
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

  let lastProbedPlaylistId = '';
  const probingLxPaths = new Set<string>();
  const PROBE_CONCURRENCY = 3;
  let activeProbes = 0;
  const probeQueue: Song[] = [];

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

  const probeLxSongDuration = async (song: Song) => {
    if (!song.path?.startsWith('lx://')) return;
    if (probingLxPaths.has(song.path)) return;
    probingLxPaths.add(song.path);

    try {
      const originalSource = song.path.slice('lx://'.length).split('/')[0] as LxSourceId;
      if (!originalSource || !['kg', 'tx', 'wy', 'mg', 'kw'].includes(originalSource)) return;

      const STABLE_SOURCES = ['kg', 'tx', 'kw'] as const;
      const sourceCandidates: LxSourceId[] =
        STABLE_SOURCES.includes(originalSource as any)
          ? [originalSource]
          : [...STABLE_SOURCES];

      const keyword = song.name || song.title || '';
      let matched: { interval: string; source: string; songmid?: string | number } | null = null;

      for (const trySource of sourceCandidates) {
        let list: Array<{ songmid: string | number; name: string; singer?: string; interval: string }> = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await lxSearch(trySource, keyword, 1, 10);
            list = r?.list ?? [];
            break;
          } catch (e: any) {
            const msg = String(e?.message ?? e ?? '');
            if (/404|403|405|not found|forbidden|method not allowed/i.test(msg)) {
              list = [];
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
        if (matched) break;
      }

      if (!matched) return;

      const duration = parseIntervalToSeconds(matched.interval);
      if (duration <= 0) return;

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

      const songsToFix: Song[] = [];
      for (const path of playlist.songPaths) {
        const song = songLookup.value.get(path) ?? playlist.songs?.find(s => s.path === path);
        if (song && song.duration === 0 && isOnlineSongPath(song.path)) {
          songsToFix.push(song);
        }
      }
      if (songsToFix.length === 0) return;

      const patches: Array<[string, number]> = [];
      const txSongs: Song[] = [];
      const queueableLxSongs: Song[] = [];

      for (const song of songsToFix) {
        const duration = extractDurationFromSong(song);
        if (duration > 0) {
          patches.push([song.path, duration]);
        } else if (song.path?.startsWith('lx://')) {
          const src = song.path.slice('lx://'.length).split('/')[0];
          if (src === 'tx') txSongs.push(song);
          else queueableLxSongs.push(song);
        }
      }

      for (const [path, duration] of patches) {
        void patchSongDurationAll(path, duration);
      }

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
