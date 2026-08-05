import { storeToRefs } from 'pinia';

import { useCollectionsStore } from '../collections/store';
import { useLibraryStore } from './store';
import type {
  AlbumDetailSortMode,
  FolderSortMode,
  LocalSortMode,
  PlaylistSortMode,
} from '../../services/storage/playerStorage';

export const createLibrarySortingActions = () => {
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const { playlistSortMode } = storeToRefs(collectionsStore);
  const {
    artistSortMode,
    albumSortMode,
    albumDetailSortMode,
    artistCustomOrder,
    albumCustomOrder,
    folderSortMode,
    folderCustomOrder,
    localSortMode,
    localCustomOrder,
  } = storeToRefs(libraryStore);

  const reorderWatchedFolders = (from: number, to: number) => {
    libraryStore.reorderWatchedFolders(from, to);
  };

  const reorderPlaylists = (from: number, to: number) => {
    collectionsStore.reorderPlaylists(from, to);
  };

  const updateArtistOrder = (newOrder: string[]) => {
    artistCustomOrder.value = newOrder;
    if (artistSortMode.value !== 'custom') {
      artistSortMode.value = 'custom';
    }
  };

  const updateAlbumOrder = (newOrder: string[]) => {
    albumCustomOrder.value = newOrder;
    if (albumSortMode.value !== 'custom') {
      albumSortMode.value = 'custom';
    }
  };

  const updateFolderOrder = (folderPath: string, newOrder: string[]) => {
    folderCustomOrder.value = {
      ...folderCustomOrder.value,
      [folderPath]: newOrder,
    };
    if (folderSortMode.value !== 'custom') {
      folderSortMode.value = 'custom';
    }
  };

  const updateLocalOrder = (newOrder: string[]) => {
    localCustomOrder.value = newOrder;
    if (localSortMode.value !== 'custom') {
      localSortMode.value = 'custom';
    }
  };

  const setFolderSortMode = (mode: FolderSortMode) => {
    folderSortMode.value = mode;
  };

  const setLocalSortMode = (mode: LocalSortMode) => {
    localSortMode.value = mode;
  };

  const setAlbumDetailSortMode = (mode: AlbumDetailSortMode) => {
    albumDetailSortMode.value = mode;
  };

  const setPlaylistSortMode = (mode: PlaylistSortMode) => {
    playlistSortMode.value = mode;
  };

  return {
    reorderWatchedFolders,
    reorderPlaylists,
    updateArtistOrder,
    updateAlbumOrder,
    updateFolderOrder,
    updateLocalOrder,
    setFolderSortMode,
    setLocalSortMode,
    setAlbumDetailSortMode,
    setPlaylistSortMode,
  };
};
