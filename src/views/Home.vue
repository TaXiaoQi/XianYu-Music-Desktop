<template>
  <div class="flex h-full flex-col">
    <HomeViewPane v-bind="paneProps" v-on="paneListeners" />

    <DragGhost /> 

    <HomeDialogStack v-bind="dialogProps" />
  </div>
</template>

<script setup lang="ts"> // 实现
defineOptions({ name: 'Home' });

import { computed, defineAsyncComponent } from 'vue';
import type { Song } from '../types';
import { useHomePageModel } from '../composables/useHomePageModel'; // 实现
import { useI18n } from '../features/i18n'; // 实现
import { default as HomeViewPane } from '../components/home/HomeViewPane.vue';
import HomeDialogStack from '../components/home/dialogs/HomeDialogStack.vue';

const DragGhost = defineAsyncComponent(() => import('../components/common/DragGhost.vue'));

const { isEnglish } = useI18n();

const {
  localViewMode: activeMode,
  isBatchMode: batchFlag,
  isManagementMode: manageFlag,
  activeRootPath: rootPath,
  selectedPaths: pickedPaths,
  folderTree: folderHierarchy,
  currentFolderFilter: folderFilterToken,
  playlistDetail: playlistMeta,
  localSongList: visibleSongs,
  localSongPaths: visibleSongPaths,
  resolveSongByPath: resolvePathToSong,
  artistActiveTab: artistTab,
  localFilterCondition: filterToken,
  selectedAlbumSong: albumHeadSong,
  artistAlbumList: artistAlbums,
  coverCache: coverMap,
  loadingSet: pendingCovers,
  songTableRef: tableHandle,
  setSongTableRef: bindTableHandle,
  handlePlayAll: runPlayAll,
  handleBatchPlay: runBatchPlay,
  handleAddToPlaylistRequest: openAddToPlaylist,
  requestBatchDelete: promptBatchDelete,
  handleFolderBatchDelete: promptFolderBatchDelete,
  handleBatchMove: runBatchMove,
  handleBatchDownload: runBatchDownload,
  handleSelectAll: runSelectAll,
  handleBatchAddToFavorites: runBatchFavorite,
  handleRootCreatePlaylistRequest: promptRootPlaylistCreate,
  handleAddFolder: openAddFolderFlow,
  handleRefreshFolder: runRefreshFolder,
  handleRemoveFolderWithConfirm: promptFolderRemoval,
  handleRootCreateFolderRequest: promptRootFolderCreate,
  handleRootDeleteFolderRequest: promptRootFolderDelete,
  handleActiveRootChange: applyRootChange,
  handleRenamePlaylist: openRenameFlow,
  handleRefreshAll: runRefreshAll,
  playSong: startPlayback,
  handleContextMenu: openSongContextMenu,
  handleTableDragStart: beginSongDrag,
  handleArtistAlbumClick: openArtistAlbum,
  showMoveToFolderModal: moveModalShown,
  confirmBatchMove: applyBatchMove,
  showContextMenu: contextMenuShown,
  contextMenuX: menuPosX,
  contextMenuY: menuPosY,
  contextMenuTargetSong: menuSong,
  contextMenuResolvedPath: menuResolvedPath,
  contextMenuIsOnlineSearch: menuFromOnlineSearch,
  handleOnlineViewArtist: openOnlineArtist,
  handleOnlineViewAlbum: openOnlineAlbum,
  showConfirm: confirmShown,
  confirmTitle: confirmHeading,
  confirmMessage: confirmBody,
  confirmButtonText: confirmLabel,
  executeConfirmAction: applyConfirm,
  showSongPhysicalDeleteConfirm: songDeleteShown,
  songToPhysicalDelete: songPendingDiskDelete,
  handleSongPhysicalDelete: promptSongDiskDelete,
  executeSongPhysicalDelete: applySongDiskDelete,
  showFolderDeleteConfirm: folderDeleteShown,
  folderToDeletePath: folderPendingDelete,
  executeDeleteFolder: applyFolderDelete,
  showCreateFolderModal: createFolderShown,
  confirmCreateFolder: applyFolderCreate,
  showRenameModal: renameShown,
  renameInitialValue: renameSeedValue,
  renameInitialCoverPath: renameSeedCover,
  editingPlaylistId: renameTargetId,
  confirmRename: applyRename,
} = useHomePageModel(); // 实现

const tableScrollContainer = computed(() => tableHandle.value?.containerRef ?? null);

const paneProps = computed(() => ({
  localViewMode: activeMode.value,
  isBatchMode: batchFlag.value,
  isManagementMode: manageFlag.value,
  activeRootPath: rootPath.value || '',
  selectedCount: pickedPaths.value.size,
  folderTree: folderHierarchy.value,
  currentFolderFilter: folderFilterToken.value,
  playlistDetail: playlistMeta.value,
  localSongList: visibleSongs.value,
  localSongPaths: visibleSongPaths.value,
  resolveSongByPath: resolvePathToSong,
  artistActiveTab: artistTab.value,
  localFilterCondition: filterToken.value,
  selectedAlbumSong: albumHeadSong.value,
  artistAlbumList: artistAlbums.value,
  coverCache: coverMap,
  loadingSet: pendingCovers,
  selectedPaths: pickedPaths.value,
  setSongTableRef: bindTableHandle,
  scrollContainerRef: tableScrollContainer.value,
}));

const paneListeners = {
  'update:isBatchMode': (value: boolean) => { batchFlag.value = value; },
  'update:isManagementMode': (value: boolean) => { manageFlag.value = value; },
  'update:artistActiveTab': (value: 'songs' | 'albums' | 'details') => { artistTab.value = value; },
  'update:selectedPaths': (value: Set<string>) => { pickedPaths.value = value; },
  playAll: () => runPlayAll(),
  batchPlay: () => runBatchPlay(),
  showAddToPlaylist: () => openAddToPlaylist(),
  batchDelete: () => promptBatchDelete(),
  folderBatchDelete: () => promptFolderBatchDelete(),
  batchMove: () => runBatchMove(),
  batchDownload: () => runBatchDownload(),
  selectAll: () => runSelectAll(),
  batchAddToFavorites: () => runBatchFavorite(),
  rootCreatePlaylist: (path: string, name: string) => promptRootPlaylistCreate(path, name),
  addFolder: () => openAddFolderFlow(),
  refreshFolder: () => runRefreshFolder(),
  removeFolder: (path: string, name?: string) => promptFolderRemoval(path, name),
  rootCreateFolder: (path: string) => promptRootFolderCreate(path),
  rootDeleteFolder: (path: string) => promptRootFolderDelete(path),
  activeRootChange: (value: string) => applyRootChange(value),
  renamePlaylist: () => openRenameFlow(),
  refreshAll: () => runRefreshAll(),
  playSong: (song: Song) => startPlayback(song),
  contextMenuSong: (nativeEvent: MouseEvent, song: Song) => openSongContextMenu(nativeEvent, song),
  tableDragStart: beginSongDrag,
  artistAlbumClick: (albumKey: string) => openArtistAlbum(albumKey),
};

const closeMoveModal = () => { moveModalShown.value = false; };
const closeSongMenu = () => { contextMenuShown.value = false; };
const cancelConfirm = () => { confirmShown.value = false; };
const syncSongDeleteVisible = (next: boolean) => { songDeleteShown.value = next; };
const syncFolderDeleteVisible = (next: boolean) => { folderDeleteShown.value = next; };
const cancelCreateFolder = () => { createFolderShown.value = false; };
const cancelRename = () => { renameShown.value = false; };

const dialogProps = computed(() => ({
  isEnglish: isEnglish.value,

  moveModalVisible: moveModalShown.value,
  moveCandidateCount: pickedPaths.value.size,
  closeMoveModal,
  applyMoveSelection: applyBatchMove,

  songMenuVisible: contextMenuShown.value,
  songMenuX: menuPosX.value,
  songMenuY: menuPosY.value,
  songMenuTarget: menuSong.value,
  songMenuPlaylistView: activeMode.value === 'playlist',
  songMenuFolderView: activeMode.value === 'folder',
  songMenuManageMode: manageFlag.value,
  songMenuOnlineSearch: menuFromOnlineSearch.value,
  songMenuResolvedPath: menuResolvedPath.value,
  closeSongMenu,
  menuAddToPlaylist: openAddToPlaylist,
  menuDeleteOnDisk: promptSongDiskDelete,
  menuViewOnlineArtist: openOnlineArtist,
  menuViewOnlineAlbum: openOnlineAlbum,

  confirmVisible: confirmShown.value,
  confirmHeading: confirmHeading.value,
  confirmBody: confirmBody.value,
  confirmLabel: confirmLabel.value,
  runConfirm: applyConfirm,
  cancelConfirm,

  songDeleteVisible: songDeleteShown.value,
  songDeleteTarget: songPendingDiskDelete.value,
  syncSongDeleteVisible,
  runSongDiskDelete: applySongDiskDelete,

  folderDeleteVisible: folderDeleteShown.value,
  folderDeletePath: folderPendingDelete.value,
  syncFolderDeleteVisible,
  runFolderDelete: applyFolderDelete,

  createFolderVisible: createFolderShown.value,
  cancelCreateFolder,
  runCreateFolder: applyFolderCreate,

  renameVisible: renameShown.value,
  renameTargetId: renameTargetId.value,
  renameSeedName: renameSeedValue.value,
  renameSeedCover: renameSeedCover.value,
  cancelRename,
  runRename: applyRename,
}));
</script>
