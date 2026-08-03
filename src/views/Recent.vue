<template>
  <div class="flex flex-col h-full">
    <RecentHeader
      v-model:isBatchMode="isBatchMode"
      :selectedCount="selectedPaths.size"
      @playAll="handlePlayAll"
      @batchPlay="handleBatchPlay"
      @addToPlaylist="openAddToPlaylistSelection"
      @batchDelete="requestBatchDelete"
      @clearHistory="handleClearHistory"
      @addAllToQueue="handleAddAllToQueue"
    />
    
    <div class="flex-1 flex overflow-hidden relative">
      
      <section class="flex-1 flex overflow-hidden">
        <SongTable
          v-if="recentTab === 'songs'"
          ref="songTableRef"
          :songs="localSongList"
          :isBatchMode="isBatchMode"
          :selectedPaths="selectedPaths"
          memoryScopeKey="recent-view"
          @play="handlePlaySong"
          @contextmenu="handleContextMenu"
          @update:selectedPaths="selectedPaths = $event"
          @drag-start="handleTableDragStart"
        />
        <RecentCollectionGrid
          v-else
          :items="recentCollectionItems"
          :emptyMessage="recentTab === 'albums' ? '暂无最近播放的专辑' : '暂无最近播放的歌单'"
          @open="handleOpenRecentCollection"
        />
      </section>
    </div>
    
    <!-- 弹窗组件 -->
    <DragGhost />
    
    <SongContextMenu 
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
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Song } from '../types';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useLibraryCollections } from '../features/collections/useLibraryCollections';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';
import { usePlayerViewState } from '../composables/usePlayerViewState';
import { useHomeNavigation } from '../composables/useHomeNavigation';
import { useSongContextActions } from '../composables/useSongContextActions';

// 组件导入
import RecentHeader from '../components/headers/RecentHeader.vue';
import SongTable from '../components/song-list/SongTable.vue';
import DragGhost from '../components/common/DragGhost.vue';
import SongContextMenu from '../components/overlays/SongContextMenu.vue';
import ModernModal from '../components/common/ModernModal.vue';
import RecentCollectionGrid, {
  type RecentCollectionGridItem,
} from '../components/recent/RecentCollectionGrid.vue';
import { useSongDrag } from '../composables/useSongDrag';

const {
  displaySongList,
  recentAlbumList,
  recentPlaylistList,
  searchQuery,
} = usePlayerLibraryView();
const { recentTab } = usePlayerViewState();
const router = useRouter();
const { openHomeAlbum, openHomePlaylist } = useHomeNavigation(router);
const { playSong, addSongsToQueue } = usePlaybackController();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
const {
  removeFromHistory,
  clearHistory,
} = useLibraryCollections();

const localSongList = computed(() => displaySongList.value);
const recentCollectionItems = computed<RecentCollectionGridItem[]>(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();

  if (recentTab.value === 'albums') {
    return recentAlbumList.value
      .filter(album => !query || `${album.name} ${album.artist}`.toLocaleLowerCase().includes(query))
      .map(album => ({
        id: album.key,
        title: album.name,
        subtitle: album.artist,
        firstSongPath: album.firstSongPath,
        playedAt: album.playedAt,
      }));
  }

  if (recentTab.value === 'playlists') {
    return recentPlaylistList.value
      .filter(playlist => !query || playlist.name.toLocaleLowerCase().includes(query))
      .map(playlist => ({
        id: playlist.id,
        title: playlist.name,
        subtitle: `${playlist.count} 首歌曲`,
        firstSongPath: playlist.firstSongPath,
        playedAt: playlist.playedAt,
      }));
  }

  return [];
});

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

// 监听批量模式变化，清空选择
watch(isBatchMode, (val) => { if (!val) selectedPaths.value.clear(); });
watch(recentTab, () => {
  isBatchMode.value = false;
  selectedPaths.value.clear();
});

// ========== 业务逻辑处理 ==========

// 播放全部
const handlePlayAll = () => {
  if (localSongList.value.length > 0) {
    void playSong(localSongList.value[0]);
  }
};

const handlePlaySong = (song: Song) => {
  const shouldInsertAfterCurrent = searchQuery.value.trim().length > 0;
  void playSong(song, shouldInsertAfterCurrent ? { insertAfterCurrent: true } : undefined);
};

const handleAddAllToQueue = () => {
  addSongsToQueue(localSongList.value);
};

const handleOpenRecentCollection = (id: string) => {
  if (recentTab.value === 'albums') {
    void openHomeAlbum(id);
    return;
  }
  void openHomePlaylist(id);
};

// 批量播放
const handleBatchPlay = () => {
  const selected = localSongList.value.filter(s => selectedPaths.value.has(s.path));
  if (selected.length > 0) {
    void playSong(selected[0]);
  }
};

// 批量删除（从最近播放移除）
const executeBatchDelete = async () => {
  const newPathSet = new Set(selectedPaths.value);
  await removeFromHistory(Array.from(newPathSet));
  selectedPaths.value.clear();
  showConfirm.value = false;
};

const requestBatchDelete = () => {
  if (selectedPaths.value.size === 0) return;
  confirmMessage.value = `确定要删除选中的 ${selectedPaths.value.size} 条播放记录吗？`;
  confirmAction.value = executeBatchDelete;
  showConfirm.value = true;
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
  const songPaths = isBatchMode.value
    ? Array.from(selectedPaths.value)
    : (contextMenuTargetSong.value ? [contextMenuTargetSong.value.path] : []);
  openAddToPlaylistDialog(songPaths);
};

// 右键菜单由 useSongContextActions 提供（支持在线歌曲已下载/未下载的菜单区分）


// ========== 路由监听 ==========
</script>
