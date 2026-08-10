import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import type { Song } from '../types';

import { launchFlyingCover } from './useFlyingCover';
import { useCoverCache } from './useCoverCache';
import { useHomeArtistAlbums } from './useHomeArtistAlbums';
import { useHomeBatchActions } from './useHomeBatchActions';
import { useHomeFolderManagement } from './useHomeFolderManagement';
import { useHomeNavigation } from './useHomeNavigation';
import { useHomePlaylistRename } from './useHomePlaylistRename';
import { useScopedBatchSelection } from './useScopedBatchSelection';

import { useHomeViewState } from './useHomeViewState';
import { usePlayerViewState } from './usePlayerViewState';
import { useSongContextActions } from './useSongContextActions';
import { useSongDrag } from './useSongDrag';
import { useToast } from './toast';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useLibraryCollections } from '../features/collections/useLibraryCollections';
import { useLibraryRuntimeActions } from '../features/library/useLibraryRuntimeActions';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { useLibraryStore } from '../features/library/store';

export function useHomePageModel() {
  const route = useRoute();
  const router = useRouter();
  const { openHomeAlbum } = useHomeNavigation(router);
  const { showToast } = useToast();
  const { openAddToPlaylistDialog } = useAddToPlaylistDialog();

  const libraryStore = useLibraryStore();
  const {
    canonicalSongs,
    sourceSongs,
    albumSortMode,
    albumCustomOrder,
  } = storeToRefs(libraryStore);

  const {
    currentViewMode,
    activeRootPath,
    currentFolderFilter,
    filterCondition,
  } = usePlayerViewState();
  const {
    currentViewSongPaths,
    displaySongList,
    librarySongs,
    folderTree,
    resolveSongByPath,
    searchQuery,
  } = usePlayerLibraryView();
  const { playSong } = usePlaybackController();
  const {
    moveFilesToFolder,
    refreshAllFolders,
    deleteFromDisk,
    addLibraryFolder,
    getSongsInFolder,
    createFolder,
    deleteFolder,
    expandFolderPath,
    fetchFolderTree,
    removeLibraryFolderLinked,
    refreshFolder,
  } = useLibraryRuntimeActions();
  const {
    createPlaylist,
    favoritePaths,
    removeFromHistory,
    playlists,
    setPlaylistCover,
    toggleFavorite,
  } = useLibraryCollections();
  const { coverCache, loadingSet, preloadCovers } = useCoverCache();

  const isManagementMode = ref(false);
  const songTableRef = ref<any>(null);
  const setSongTableRef = (instance: any | null) => {
    songTableRef.value = instance;
  };

  const {
    localViewMode,
    localFilterCondition,
    artistActiveTab,
    viewTransitionKey,
  } = useHomeViewState({
    currentViewMode,
    filterCondition,
    isManagementMode,
  });

  const isPlaylistView = computed(() => currentViewMode.value === 'playlist');
  const localSongPaths = computed(() => currentViewSongPaths.value);
  // 歌单详情页走 SongTable 的 path + resolver 惰性模式，避免进入页面即 materialize 全量 Song[]。
  // 非歌单视图保持原有数组模式，避免影响本地/专辑/歌手等已有交互。
  const localSongList = computed(() => isPlaylistView.value ? [] : displaySongList.value);
  const getActionSongList = () => displaySongList.value;
  const selectedAlbumSong = computed(() => localSongList.value[0] || null);
  const batchSelectionScopeKey = computed(() =>
    [
      route.path,
      currentViewMode.value,
      filterCondition.value,
      currentFolderFilter.value,
    ].join('::'),
  );
  const {
    isBatchMode,
    selectedPaths,
  } = useScopedBatchSelection(batchSelectionScopeKey);

  const { handleTableDragStart } = useSongDrag(
    computed(() => displaySongList.value),
    isBatchMode,
    selectedPaths,
    songTableRef,
  );

  const {
    showContextMenu,
    contextMenuX,
    contextMenuY,
    contextMenuTargetSong,
    contextMenuResolvedPath,
    contextMenuIsOnlineSearch,
    showSongPhysicalDeleteConfirm,
    songToPhysicalDelete,
    handleContextMenu,
    handleSongPhysicalDelete,
    executeSongPhysicalDelete,
    handleOnlineViewArtist,
    handleOnlineViewAlbum,
  } = useSongContextActions({
    isBatchMode,
    deleteFromDisk,
  });

  const {
    showMoveToFolderModal,
    showConfirm,
    confirmTitle,
    confirmButtonText,
    confirmMessage,
    requestBatchDelete,
    handleFolderBatchDelete,
    executeConfirmAction,
    handleBatchMove,
    handleBatchDownload,
    confirmBatchMove,
    openConfirm,
  } = useHomeBatchActions({
    currentViewMode,
    selectedPaths,
    isBatchMode,
    isManagementMode,
    canonicalSongs,
    sourceSongs,
    favoritePaths,
    playlists,
    moveFilesToFolder,
    removeFromHistory,
    showToast,
    getRoutePath: () => route.path,
    resolveSongByPath,
  });

  const {
    showCreateFolderModal,
    showFolderDeleteConfirm,
    folderToDeletePath,
    handleActiveRootChange,
    confirmCreateFolder,
    executeDeleteFolder,
    handleAddFolder,
    handleRootCreateFolderRequest,
    handleRootDeleteFolderRequest,
    handleRefreshFolder,
    handleRemoveFolderWithConfirm,
  } = useHomeFolderManagement({
    isManagementMode,
    activeRootPath,
    currentFolderFilter,
    libraryHierarchy: folderTree,
    sourceSongs,
    refreshFolder,
    fetchFolderTree,
    createFolder,
    deleteFolder,
    expandFolderPath,
    addLibraryFolder,
    removeLibraryFolderLinked,
    showToast,
    openConfirm,
  });


  const {
    showRenameModal,
    renameInitialValue,
    renameInitialCoverPath,
    editingPlaylistId,
    handleRenamePlaylist,
    confirmRename,
  } = useHomePlaylistRename({
    currentViewMode,
    filterCondition,
    playlists,
    showToast,
    setPlaylistCover,
  });

  const playlistDetail = computed(() => {
    if (localViewMode.value !== 'playlist') {
      return null;
    }

    const playlist = playlists.value.find(item => item.id === localFilterCondition.value);
    if (!playlist) {
      return null;
    }

    return {
      name: playlist.name,
      date: (playlist as any).createdAt || '',
    };
  });

  const { artistAlbumList } = useHomeArtistAlbums({
    localFilterCondition,
    filterCondition,
    librarySongs,
    albumSortMode,
    albumCustomOrder,
    preloadCovers,
  });

  const handlePlayAll = () => {
    const songs = getActionSongList();
    if (songs.length > 0) {
      const firstSong = songs[0];
      void launchFlyingCover(firstSong.path, coverCache.get(firstSong.path) ?? '');
      void playSong(firstSong);
    }
  };

  const handlePlaySong = (song: Song) => {
    const shouldInsertAfterCurrent =
      searchQuery.value.trim().length > 0 &&
      ['all', 'artist', 'album', 'folder'].includes(currentViewMode.value);

    void playSong(song, shouldInsertAfterCurrent ? { insertAfterCurrent: true } : undefined);
  };

  const handleBatchPlay = () => {
    const selectedSongs = getActionSongList().filter(song => selectedPaths.value.has(song.path));
    if (selectedSongs.length > 0) {
      const firstSong = selectedSongs[0];
      void launchFlyingCover(firstSong.path, coverCache.get(firstSong.path) ?? '');
      void playSong(firstSong);
    }
  };

  const handleAddToPlaylistRequest = () => {
    const songPaths = isBatchMode.value
      ? Array.from(selectedPaths.value)
      : (contextMenuTargetSong.value ? [contextMenuTargetSong.value.path] : []);
    const songs = songPaths
      .map(path => resolveSongByPath(path))
      .filter((song): song is Song => Boolean(song));

    openAddToPlaylistDialog(songPaths, {
      songs,
      excludedPlaylistId: currentViewMode.value === 'playlist' ? filterCondition.value : null,
      onAdded: () => {
        if (isBatchMode.value) {
          isBatchMode.value = false;
        }
      },
    });
  };

  const handleSelectAll = () => {
    const allPaths = currentViewSongPaths.value;
    if (allPaths.length > 0 && selectedPaths.value.size === allPaths.length) {
      selectedPaths.value = new Set();
    } else {
      selectedPaths.value = new Set(allPaths);
    }
  };

  const handleBatchAddToFavorites = () => {
    const paths = Array.from(selectedPaths.value);
    if (paths.length === 0) return;

    const favoriteSet = new Set(favoritePaths.value);
    let addedCount = 0;

    for (const path of paths) {
      if (!favoriteSet.has(path)) {
        const song = resolveSongByPath(path);
        toggleFavorite(song ?? path);
        addedCount++;
      }
    }

    showToast(
      addedCount > 0
        ? `已添加 ${addedCount} 首歌曲到我喜欢`
        : '所选歌曲已在我喜欢中',
      'success',
    );
    isBatchMode.value = false;
  };

  const handleRefreshAll = async () => {
    try {
      const summary = await refreshAllFolders();
      if (summary && typeof summary === 'object' && 'removedCount' in summary) {
        const removedCount = Number(summary.removedCount) || 0;
        showToast(
          removedCount > 0
            ? `刷新成功，检测到少了 ${removedCount} 首歌曲`
            : '刷新成功',
          'success',
        );
        return;
      }

      showToast('刷新成功', 'success');
    } catch (error: any) {
      showToast(`刷新失败: ${error?.message || error}`, 'error');
    }
  };

  const handleRootCreatePlaylistRequest = (folderPath: string, folderName: string) => {
    const songs = getSongsInFolder(folderPath);
    if (songs.length === 0) {
      showToast('该文件夹下没有可用于创建歌单的歌曲', 'info');
      return;
    }

    createPlaylist(folderName, songs.map(song => song.path));
    showToast('已根据文件夹创建歌单', 'success');
  };

  const handleArtistAlbumClick = (albumKey: string) => {
    void openHomeAlbum(albumKey);
  };

  return {
    viewTransitionKey,
    localViewMode,
    isBatchMode,
    isManagementMode,
    activeRootPath,
    selectedPaths,
    folderTree,
    currentFolderFilter,
    playlistDetail,
    localSongList,
    localSongPaths,
    resolveSongByPath,
    artistActiveTab,
    localFilterCondition,
    selectedAlbumSong,
    artistAlbumList,
    coverCache,
    loadingSet,
    songTableRef,
    setSongTableRef,
    handlePlayAll,
    handleBatchPlay,
    handleAddToPlaylistRequest,
    handleSelectAll,
    handleBatchAddToFavorites,
    handleBatchDownload,
    requestBatchDelete,
    handleFolderBatchDelete,
    handleBatchMove,
    handleRootCreatePlaylistRequest,
    handleAddFolder,
    handleRefreshFolder,
    handleRemoveFolderWithConfirm,
    handleRootCreateFolderRequest,
    handleRootDeleteFolderRequest,
    handleActiveRootChange,
    handleRenamePlaylist,
    handleRefreshAll,
    playSong: handlePlaySong,
    handleContextMenu,
    handleTableDragStart,
    handleArtistAlbumClick,
    showMoveToFolderModal,
    confirmBatchMove,
    showContextMenu,
    contextMenuX,
    contextMenuY,
    contextMenuTargetSong,
    contextMenuResolvedPath,
    contextMenuIsOnlineSearch,
    handleOnlineViewArtist,
    handleOnlineViewAlbum,
    showConfirm,
    confirmTitle,
    confirmMessage,
    confirmButtonText,
    executeConfirmAction,
    showSongPhysicalDeleteConfirm,
    songToPhysicalDelete,
    handleSongPhysicalDelete,
    executeSongPhysicalDelete,
    showFolderDeleteConfirm,
    folderToDeletePath,
    executeDeleteFolder,
    showCreateFolderModal,
    confirmCreateFolder,
    showRenameModal,
    renameInitialValue,
    renameInitialCoverPath,
    editingPlaylistId,
    confirmRename,
  };
}
