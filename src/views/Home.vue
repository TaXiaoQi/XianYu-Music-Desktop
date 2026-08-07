<template>
  <div class="flex flex-col h-full">
    <HomeViewPane
      :localViewMode="localViewMode"
      :isBatchMode="isBatchMode"
      :isManagementMode="isManagementMode"
      :activeRootPath="activeRootPath || ''"
      :selectedCount="selectedPaths.size"
      :folderTree="folderTree"
      :currentFolderFilter="currentFolderFilter"
      :playlistDetail="playlistDetail"
      :localSongList="localSongList"
      :localSongPaths="localSongPaths"
      :resolveSongByPath="resolveSongByPath"
      :artistActiveTab="artistActiveTab"
      :localFilterCondition="localFilterCondition"
      :selectedAlbumSong="selectedAlbumSong"
      :artistAlbumList="artistAlbumList"
      :coverCache="coverCache"
      :loadingSet="loadingSet"
      :selectedPaths="selectedPaths"
      :setSongTableRef="setSongTableRef"
      @update:isBatchMode="isBatchMode = $event"
      @update:isManagementMode="isManagementMode = $event"
      @update:artistActiveTab="artistActiveTab = $event"
      @update:selectedPaths="selectedPaths = $event"
      @playAll="handlePlayAll"
      @batchPlay="handleBatchPlay"
      @showAddToPlaylist="handleAddToPlaylistRequest"
      @batchDelete="requestBatchDelete"
      @folderBatchDelete="handleFolderBatchDelete"
      @batchMove="handleBatchMove"
      @selectAll="handleSelectAll"
      @batchAddToFavorites="handleBatchAddToFavorites"
      @rootCreatePlaylist="handleRootCreatePlaylistRequest"
      @addFolder="handleAddFolder"
      @refreshFolder="handleRefreshFolder"
      @removeFolder="handleRemoveFolderWithConfirm"
      @rootCreateFolder="handleRootCreateFolderRequest"
      @rootDeleteFolder="handleRootDeleteFolderRequest"
      @activeRootChange="handleActiveRootChange"
      @renamePlaylist="handleRenamePlaylist"
      @refreshAll="handleRefreshAll"
      @playSong="playSong"
      @contextMenuSong="handleContextMenu"
      @tableDragStart="handleTableDragStart"
      @artistAlbumClick="handleArtistAlbumClick"
    />

    <DragGhost />

    <MoveToFolderModal
      v-if="showMoveToFolderModal"
      :visible="showMoveToFolderModal"
      :selectedCount="selectedPaths.size"
      @close="showMoveToFolderModal = false"
      @confirm="confirmBatchMove"
    />

    <SongContextMenu
      v-if="showContextMenu"
      :visible="showContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :song="contextMenuTargetSong"
      :is-playlist-view="localViewMode === 'playlist'"
      :is-folder-view="localViewMode === 'folder'"
      :isManagementMode="isManagementMode"
      :is-online-search="contextMenuIsOnlineSearch"
      :resolved-file-path="contextMenuResolvedPath"
      @close="showContextMenu = false"
      @add-to-playlist="handleAddToPlaylistRequest"
      @delete-disk="handleSongPhysicalDelete"
      @view-online-artist="handleOnlineViewArtist"
      @view-online-album="handleOnlineViewAlbum"
    />

    <ModernModal
      v-if="showConfirm"
      :visible="showConfirm"
      :title="confirmTitle"
      :content="confirmMessage"
      type="danger"
      :confirm-text="confirmButtonText"
      @confirm="executeConfirmAction"
      @cancel="showConfirm = false"
    />

    <ModernModal
      v-if="showSongPhysicalDeleteConfirm"
      v-model:visible="showSongPhysicalDeleteConfirm"
      title="永久删除文件"
      :content="`确定要从磁盘中永久删除歌曲 '${songToPhysicalDelete?.title}' 吗？此操作不可逆！`"
      type="danger"
      confirm-text="永久删除"
      @confirm="executeSongPhysicalDelete"
    />

    <ModernModal
      v-if="showFolderDeleteConfirm"
      v-model:visible="showFolderDeleteConfirm"
      title="删除文件夹"
      :content="`确定要删除文件夹 '${folderToDeletePath}' 吗？这也将移除其中的本地文件。`"
      type="danger"
      confirm-text="删除文件夹"
      @confirm="executeDeleteFolder"
    />

    <ModernInputModal
      v-if="showCreateFolderModal"
      :visible="showCreateFolderModal"
      title="新建文件夹"
      placeholder="请输入文件夹名称"
      confirm-text="创建"
      @cancel="showCreateFolderModal = false"
      @confirm="confirmCreateFolder"
    />

    <PlaylistEditInfoModal
      v-if="showRenameModal"
      :visible="showRenameModal"
      :playlist-id="editingPlaylistId"
      :initial-name="renameInitialValue"
      :initial-cover-path="renameInitialCoverPath"
      @cancel="showRenameModal = false"
      @confirm="confirmRename"
    />
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'Home' });

import { defineAsyncComponent } from 'vue';
import { useHomePageModel } from '../composables/useHomePageModel';

const DragGhost = defineAsyncComponent(() => import('../components/common/DragGhost.vue'));
const HomeViewPane = defineAsyncComponent(() => import('../components/home/HomeViewPane.vue'));
const ModernInputModal = defineAsyncComponent(() => import('../components/common/ModernInputModal.vue'));
const ModernModal = defineAsyncComponent(() => import('../components/common/ModernModal.vue'));
const MoveToFolderModal = defineAsyncComponent(() => import('../components/overlays/MoveToFolderModal.vue'));
const PlaylistEditInfoModal = defineAsyncComponent(() => import('../components/overlays/PlaylistEditInfoModal.vue'));
const SongContextMenu = defineAsyncComponent(() => import('../components/overlays/SongContextMenu.vue'));

const {
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
  setSongTableRef,
  handlePlayAll,
  handleBatchPlay,
  handleAddToPlaylistRequest,
  requestBatchDelete,
  handleFolderBatchDelete,
  handleBatchMove,
  handleSelectAll,
  handleBatchAddToFavorites,
  handleRootCreatePlaylistRequest,
  handleAddFolder,
  handleRefreshFolder,
  handleRemoveFolderWithConfirm,
  handleRootCreateFolderRequest,
  handleRootDeleteFolderRequest,
  handleActiveRootChange,
  handleRenamePlaylist,
  handleRefreshAll,
  playSong,
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
} = useHomePageModel();
</script>

<style scoped>
</style>
