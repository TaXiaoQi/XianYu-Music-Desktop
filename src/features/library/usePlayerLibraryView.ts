import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import { useCollectionsStore } from '../collections/store';
import { useLibraryStore } from './store';
import { useNavigationStore } from '../../shared/stores/navigation';
import { useLibraryCatalogSelectors } from './useLibraryCatalogSelectors';
import { useLibraryCollectionSelectors } from './useLibraryCollectionSelectors';
import { useLibraryCurrentViewSongs } from './useLibraryCurrentViewSongs';
import { useLibraryFolderSelectors } from './useLibraryFolderSelectors';
export type { AlbumListItem, ArtistListItem } from './playerLibraryViewShared';

export function usePlayerLibraryView() {
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const navigationStore = useNavigationStore();

  const {
    activeRootPath,
    currentAlbumFilter,
    currentArtistFilter,
    currentFolderFilter,
    currentViewMode,
    favDetailFilter,
    favTab,
    filterCondition,
    localMusicTab,
    searchQuery,
  } = storeToRefs(navigationStore);
  const {
    libraryHierarchy,
    libraryFolders,
    artistCatalog,
    albumCatalog,
    canonicalSongs,
    canonicalSongPaths,
    songLookup,
    sourceSongs,
    sourceSongPaths,
    watchedFolders,
    artistSortMode,
    albumSortMode,
    artistCustomOrder,
    albumCustomOrder,
    folderSortMode,
    folderCustomOrder,
    localSortMode,
    albumDetailSortMode,
    localCustomOrder,
  } = storeToRefs(libraryStore);
  const { favoritePaths, playlists, recentSongs, playlistSortMode } = storeToRefs(collectionsStore);

  const isLocalMusic = computed(() =>
    currentViewMode.value === 'all' ||
    currentViewMode.value === 'artist' ||
    currentViewMode.value === 'album',
  );

  const isFolderMode = computed(() => currentViewMode.value === 'folder');

  const catalogSelectors = useLibraryCatalogSelectors({
    artistCatalog,
    albumCatalog,
    searchQuery,
    artistSortMode,
    albumSortMode,
    artistCustomOrder,
    albumCustomOrder,
  });

  const folderSelectors = useLibraryFolderSelectors({
    watchedFolders,
    sourceSongPaths,
    songLookup,
    currentFolderFilter,
    folderSortMode,
    folderCustomOrder,
  });

  const collectionSelectors = useLibraryCollectionSelectors({
    canonicalSongPaths,
    favoritePaths,
    playlists,
    recentSongs,
    songLookup,
  });

  const { currentViewSongs } = useLibraryCurrentViewSongs({
    canonicalSongPaths,
    playlists,
    recentSongs,
    songLookup,
    favoriteSongPaths: collectionSelectors.favoriteSongPaths,
    currentFolderSongPaths: folderSelectors.currentFolderSongPaths,
    currentViewMode,
    searchQuery,
    localMusicTab,
    currentArtistFilter,
    currentAlbumFilter,
    currentFolderFilter,
    filterCondition,
    favTab,
    favDetailFilter,
    folderSortMode,
    localSortMode,
    albumDetailSortMode,
    localCustomOrder,
    playlistSortMode,
  });

  return {
    activeRootPath,
    albumList: catalogSelectors.albumList,
    artistList: catalogSelectors.artistList,
    canonicalSongs,
    currentFolderSongs: folderSelectors.currentFolderSongs,
    currentViewSongs,
    favAlbumList: collectionSelectors.favAlbumList,
    favArtistList: collectionSelectors.favArtistList,
    favoriteSongList: collectionSelectors.favoriteSongList,
    filteredAlbumList: catalogSelectors.filteredAlbumList,
    filteredArtistList: catalogSelectors.filteredArtistList,
    folderList: folderSelectors.folderList,
    isFolderMode,
    isLocalMusic,
    libraryFolders,
    libraryHierarchy,
    recentAlbumList: collectionSelectors.recentAlbumList,
    recentPlaylistList: collectionSelectors.recentPlaylistList,
    searchQuery,
    sourceSongs,
    // Compatibility aliases for existing callers.
    displaySongList: currentViewSongs,
    folderTree: libraryHierarchy,
    librarySongs: canonicalSongs,
    songList: sourceSongs,
  };
}
