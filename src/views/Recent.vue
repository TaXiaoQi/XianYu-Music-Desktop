<template>
  <div class="flex flex-col h-full">
    <RecentHeader
      @playAll="handlePlayAll"
      @clearHistory="handleClearHistory"
      @addAllToQueue="handleAddAllToQueue"
    />

    <div class="flex-1 flex overflow-hidden relative">

      <section class="flex-1 flex overflow-hidden">
        <SongTable
          ref="songTableRef"
          :songs="localSongList"
          :isBatchMode="isBatchMode"
          :selectedPaths="selectedPaths"
          memoryScopeKey="recent-view"
          :download-completed-as-local="true"
          @play="handlePlaySong"
          @contextmenu="handleContextMenu"
          @drag-start="handleTableDragStart"
        />
      </section>
    </div>

    <!-- 弹窗组件 -->
    <DragGhost />

    <SongContextMenu
      v-if="showContextMenu"
      :visible="showContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :song="contextMenuTargetSong"
      :is-playlist-view="false"
      :is-online-search="contextMenuIsOnlineSearch"
      :resolved-file-path="contextMenuResolvedPath"
      @close="showContextMenu = false"
      @add-to-playlist="openAddToPlaylistSelection"
      @view-online-artist="handleOnlineViewArtist"
      @view-online-album="handleOnlineViewAlbum"
    />

    <ModernModal
      v-if="showConfirm"
      :visible="showConfirm"
      title="删除记录"
      :content="confirmMessage"
      type="danger"
      confirm-text="删除"
      @confirm="executeConfirmAction"
      @cancel="showConfirm = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import type { Song } from '../types';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useLibraryCollections } from '../features/collections/useLibraryCollections';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';
import { useSongContextActions } from '../composables/useSongContextActions';
import { launchFlyingCover } from '../composables/useFlyingCover';

import { useSongDrag } from '../composables/useSongDrag';

const RecentHeader = defineAsyncComponent(() => import('../components/headers/RecentHeader.vue'));
const SongTable = defineAsyncComponent(() => import('../components/song-list/SongTable.vue'));
const DragGhost = defineAsyncComponent(() => import('../components/common/DragGhost.vue'));
const SongContextMenu = defineAsyncComponent(() => import('../components/overlays/SongContextMenu.vue'));
const ModernModal = defineAsyncComponent(() => import('../components/common/ModernModal.vue'));

const {
  displaySongList,
  searchQuery,
} = usePlayerLibraryView();
const { playSong, addSongsToQueue } = usePlaybackController();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
const {
  clearHistory,
} = useLibraryCollections();

const localSongList = computed(() => displaySongList.value);

// ========== 状态管理 ==========
const isBatchMode = ref(false);
const selectedPaths = ref<Set<string>>(new Set());
const songTableRef = ref<any>(null);

// 初始化拖拽逻辑
const { handleTableDragStart } = useSongDrag(localSongList, isBatchMode, selectedPaths, songTableRef);

// 弹窗状态
const showConfirm = ref(false);
const confirmMessage = ref('');
const confirmAction = ref<() => void>(() => {});
const {
  showContextMenu,
  contextMenuX,
  contextMenuY,
  contextMenuTargetSong,
  contextMenuResolvedPath,
  contextMenuIsOnlineSearch,
  handleContextMenu,
  handleOnlineViewArtist,
  handleOnlineViewAlbum,
} = useSongContextActions({ isBatchMode });

// ========== 业务逻辑处理 ==========

// 播放全部
const handlePlayAll = () => {
  if (localSongList.value.length > 0) {
    const firstSong = localSongList.value[0];
    void launchFlyingCover(firstSong.path, '');
    void playSong(firstSong);
  }
};

const handlePlaySong = (song: Song) => {
  const shouldInsertAfterCurrent = searchQuery.value.trim().length > 0;
  void playSong(song, shouldInsertAfterCurrent ? { insertAfterCurrent: true } : undefined);
};

const handleAddAllToQueue = () => {
  addSongsToQueue(localSongList.value);
};

const executeConfirmAction = async () => {
  await confirmAction.value();
  showConfirm.value = false;
};

// 清空历史
const handleClearHistory = () => {
  confirmMessage.value = "确定要清空所有播放记录吗？";
  confirmAction.value = async () => {
    await clearHistory();
    showConfirm.value = false;
  };
  showConfirm.value = true;
};

const openAddToPlaylistSelection = () => {
  const songPaths = contextMenuTargetSong.value ? [contextMenuTargetSong.value.path] : [];
  openAddToPlaylistDialog(songPaths);
};

// 右键菜单由 useSongContextActions 提供（支持在线歌曲已下载/未下载的菜单区分）


// ========== 路由监听 ==========
</script>
