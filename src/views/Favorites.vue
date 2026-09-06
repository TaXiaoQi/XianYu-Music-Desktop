<template>
  <div class="flex flex-col h-full">
    <FavoritesHeader
      v-model:isBatchMode="isBatchMode"
      :selectedCount="selectedPaths.size"
      :totalSongCount="localSongList.length"
      @playAll="handlePlayAll"
      @batchPlay="handleBatchPlay"
      @addToPlaylist="openAddToPlaylistSelection"
      @batchDownload="handleBatchDownload"
      @batchDelete="requestBatchDelete"
      @clearAll="handleClearAll"
      @addAllToQueue="handleAddAllToQueue"
      @selectAll="handleSelectAll"
    />
    
    <div class="flex-1 flex overflow-hidden relative">
      <Transition name="fav-tab" mode="out-in">
        <!-- 单曲 tab：收藏歌曲列表 -->
        <section v-if="favTab === 'songs'" key="songs" class="flex-1 flex overflow-hidden">
          <SongTable
            ref="songTableRef"
            :songs="localSongList"
            :isBatchMode="isBatchMode"
            :selectedPaths="selectedPaths"
            memoryScopeKey="favorites-view"
            :download-completed-as-local="true"
            @play="handlePlaySong"
            @contextmenu="handleContextMenu"
            @update:selectedPaths="selectedPaths = $event"
            @drag-start="handleTableDragStart"
          />
        </section>

        <!-- 歌单 tab：收藏的整张歌单网格 -->
        <FavoriteCollectionsGrid
          v-else-if="favTab === 'playlists'"
          key="playlists"
          :items="favoritePlaylistEntries"
          empty-message="还没有收藏的歌单，去在线歌单详情页点击「收藏整张歌单」吧"
          @open="handleOpenCollection"
          @remove="handleRemoveCollection"
        />

        <!-- 专辑 tab：收藏的整张专辑网格 -->
        <FavoriteCollectionsGrid
          v-else
          key="albums"
          :items="favoriteAlbumEntries"
          empty-message="还没有收藏的专辑，去在线专辑详情页点击「收藏整张专辑」吧"
          @open="handleOpenCollection"
          @remove="handleRemoveCollection"
        />
      </Transition>
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
      title="移除歌曲"
      :content="confirmMessage"
      type="danger"
      confirm-text="移除"
      @confirm="executeConfirmAction"
      @cancel="showConfirm = false"
    />

    <SyncDeleteScopeModal
      v-model:visible="showDeleteScope"
      title="收藏已同步到云端"
      description="请选择删除范围"
      :can-delete-cloud="deleteScopeCanDeleteCloud"
      disabled-hint="选中收藏暂无云端副本，此选项不可用"
      @cancel="showDeleteScope = false"
      @scope="confirmDeleteScope"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import type { Song } from '../types';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useLibraryCollections } from '../features/collections/useLibraryCollections';
import {
  useCollectionsStore,
  type FavoriteCollectionEntry,
} from '../features/collections/store';
import { openOnlineDetail } from '../features/onlineDetail/store';
import { useNavigationStore } from '../shared/stores/navigation';
import { useHomeNavigation } from '../composables/useHomeNavigation';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { usePlayerLibraryView } from '../features/library/usePlayerLibraryView';
import { useSongContextActions } from '../composables/useSongContextActions';
import { launchFlyingCover } from '../composables/useFlyingCover';
import { useSettings } from '../features/settings/useSettings';
import { useToast } from '../composables/toast';
import { downloadToLocal } from '../composables/useDownloadToLocal';
import { isDownloadableOnlineSong } from '../services/domain/downloadService';

import { useSongDrag } from '../composables/useSongDrag';
import { getCiyuanxiId } from '../services/domain/playlistSync';
import { uploadFavorites } from '../services/domain/favoritesSync';
import {
  loadSyncedFavoritePaths,
  addCloudKeepPaths,
  addLocalOnlyPaths,
} from '../services/domain/favoritesSyncState';
import type { SyncDeleteScope } from '../components/overlays/SyncDeleteScopeModal.vue';

const FavoritesHeader = defineAsyncComponent(() => import('../components/headers/FavoritesHeader.vue'));
const SongTable = defineAsyncComponent(() => import('../components/song-list/SongTable.vue'));
const FavoriteCollectionsGrid = defineAsyncComponent(() => import('../components/favorites/FavoriteCollectionsGrid.vue'));
const DragGhost = defineAsyncComponent(() => import('../components/common/DragGhost.vue'));
const SongContextMenu = defineAsyncComponent(() => import('../components/overlays/SongContextMenu.vue'));
const ModernModal = defineAsyncComponent(() => import('../components/common/ModernModal.vue'));
const SyncDeleteScopeModal = defineAsyncComponent(() => import('../components/overlays/SyncDeleteScopeModal.vue'));

const router = useRouter();
const navigationStore = useNavigationStore();
const collectionsStore = useCollectionsStore();
const { openHomePlaylist } = useHomeNavigation(router);
const { favTab } = storeToRefs(navigationStore);
const { favoriteCollections } = storeToRefs(collectionsStore);

const { displaySongList, searchQuery } = usePlayerLibraryView();
const { playSong, addSongsToQueue } = usePlaybackController();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
const { settings } = useSettings();
const { showToast } = useToast();
const {
  favoritePaths,
  clearFavorites,
} = useLibraryCollections();

const localSongList = computed(() => displaySongList.value);

/** 搜索关键词过滤（歌单/专辑 tab 按标题与副标题匹配） */
const filterEntriesBySearch = (entries: FavoriteCollectionEntry[]): FavoriteCollectionEntry[] => {
  const keyword = searchQuery.value.trim().toLowerCase();
  if (!keyword) return entries;
  return entries.filter(entry =>
    entry.title.toLowerCase().includes(keyword)
    || entry.subtitle.toLowerCase().includes(keyword),
  );
};

/** 收藏的歌单条目（含本地歌单与在线歌单） */
const favoritePlaylistEntries = computed(() =>
  filterEntriesBySearch(favoriteCollections.value.filter(entry => entry.type === 'playlist')),
);

/** 收藏的专辑条目（在线专辑） */
const favoriteAlbumEntries = computed(() =>
  filterEntriesBySearch(favoriteCollections.value.filter(entry => entry.type === 'album')),
);

// ========== 状态管理 ==========
const isBatchMode = ref(false);
const selectedPaths = ref<Set<string>>(new Set());
const songTableRef = ref<any>(null);

// 离开单曲 tab 时退出批量模式并清空选择（歌单/专辑 tab 无批量操作）
watch(favTab, (tab) => {
  if (tab !== 'songs') {
    isBatchMode.value = false;
    selectedPaths.value.clear();
  }
});

// 初始化拖拽逻辑
const { handleTableDragStart } = useSongDrag(localSongList, isBatchMode, selectedPaths, songTableRef);

// 打开收藏的歌单/专辑详情：本地歌单走首页歌单详情，在线歌单/专辑恢复上下文快照进在线详情
const handleOpenCollection = (entry: FavoriteCollectionEntry) => {
  if (entry.localPlaylistId) {
    const playlist = collectionsStore.getPlaylistById(entry.localPlaylistId);
    if (!playlist) {
      collectionsStore.removeFavoriteCollection(entry.key);
      showToast('歌单已不存在，已移除该收藏', 'info');
      return;
    }
    void openHomePlaylist(entry.localPlaylistId);
    return;
  }

  if (entry.onlineContext) {
    openOnlineDetail({ ...entry.onlineContext });
  }
};

const handleRemoveCollection = (entry: FavoriteCollectionEntry) => {
  collectionsStore.removeFavoriteCollection(entry.key);
  showToast(entry.type === 'album' ? '已取消收藏专辑' : '已取消收藏歌单', 'info');
};

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



// ========== 业务逻辑处理 ==========

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

// 批量播放
const handleBatchPlay = () => {
  const selected = localSongList.value.filter(s => selectedPaths.value.has(s.path));
  if (selected.length > 0) {
    const firstSong = selected[0];
    void launchFlyingCover(firstSong.path, '');
    void playSong(firstSong);
  }
};

const runWithConcurrency = async (
  tasks: Array<() => Promise<boolean>>,
  limit: number,
): Promise<number> => {
  let nextIndex = 0;
  let successCount = 0;
  const workerCount = Math.min(limit, tasks.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < tasks.length) {
      const task = tasks[nextIndex++];
      if (await task()) {
        successCount++;
      }
    }
  }));

  return successCount;
};

const handleBatchDownload = async () => {
  const selected = localSongList.value.filter(s => selectedPaths.value.has(s.path));
  if (selected.length === 0) return;

  const downloadableSongs = selected.filter(isDownloadableOnlineSong);
  const skippedLocalCount = selected.length - downloadableSongs.length;

  if (skippedLocalCount > 0) {
    showToast(`已跳过 ${skippedLocalCount} 首本地歌曲`, 'info');
  }
  if (downloadableSongs.length === 0) {
    showToast('没有可下载的在线歌曲', 'info');
    return;
  }

  const concurrency = Math.min(5, Math.max(1, Math.round(settings.value.download.batchDownloadLimit ?? 2)));
  showToast(`开始批量下载 ${downloadableSongs.length} 首歌曲（同时 ${concurrency} 首）`, 'info');

  const tasks = downloadableSongs.map(song => async () => downloadToLocal(song));
  const successCount = await runWithConcurrency(tasks, concurrency);
  const failedCount = downloadableSongs.length - successCount;

  showToast(
    failedCount > 0
      ? `批量下载完成：成功 ${successCount} 首，失败 ${failedCount} 首`
      : `批量下载完成：成功 ${successCount} 首`,
    failedCount > 0 ? 'info' : 'success',
  );

  isBatchMode.value = false;
};

// 全选/取消全选
const handleSelectAll = () => {
  const allPaths = localSongList.value.map(s => s.path);
  if (allPaths.length > 0 && selectedPaths.value.size === allPaths.length) {
    selectedPaths.value = new Set();
  } else {
    selectedPaths.value = new Set(allPaths);
  }
};

// 批量删除（从收藏移除）
const executeBatchDelete = () => {
  const newPathSet = new Set(selectedPaths.value);
  favoritePaths.value = favoritePaths.value.filter(p => !newPathSet.has(p));
  selectedPaths.value.clear();
  showConfirm.value = false;
};

const requestBatchDelete = () => {
  if (selectedPaths.value.size === 0) return;
  const paths = Array.from(selectedPaths.value);
  // 已登录且存在云端副本：弹删除范围三选一
  if (getCiyuanxiId() && paths.some(p => loadSyncedFavoritePaths().includes(p))) {
    deleteScopePaths.value = paths;
    deleteScopeIsClearAll.value = false;
    showDeleteScope.value = true;
    return;
  }
  confirmMessage.value = `确定要从收藏中移除选中的 ${paths.length} 首歌曲吗？`;
  confirmAction.value = executeBatchDelete;
  showConfirm.value = true;
};

const executeConfirmAction = async () => {
  await confirmAction.value();
  showConfirm.value = false;
};

// ========== 收藏删除范围三选一（仅删本地 / 删除全部 / 仅保留本地） ==========
const showDeleteScope = ref(false);
const deleteScopePaths = ref<string[]>([]);
const deleteScopeIsClearAll = ref(false);
const deleteScopeCanDeleteCloud = computed(() =>
  deleteScopePaths.value.some(p => loadSyncedFavoritePaths().includes(p)),
);

/** 从云端删除指定收藏（merge 模式空集合 + delete_paths）；失败返回 false */
async function deleteCloudFavoritePaths(paths: string[]): Promise<boolean> {
  const ciyuanxiId = getCiyuanxiId();
  if (!ciyuanxiId || paths.length === 0) return false;
  try {
    await uploadFavorites(ciyuanxiId, [], { deletePaths: paths });
    return true;
  } catch {
    return false;
  }
}

/** 清空歌单/专辑收藏（本地数据，与云端无关） */
const removeFavoriteCollections = () => {
  favoriteCollections.value.forEach(entry => collectionsStore.removeFavoriteCollection(entry.key));
};

async function confirmDeleteScope(scope: SyncDeleteScope) {
  const paths = [...deleteScopePaths.value];
  const isClearAll = deleteScopeIsClearAll.value;
  showDeleteScope.value = false;
  deleteScopePaths.value = [];
  deleteScopeIsClearAll.value = false;
  if (paths.length === 0) return;
  const pathSet = new Set(paths);

  if (scope === 'cloud') {
    // 仅保留本地：本机收藏不动，立即删除云端副本并写墓碑防止上传复活
    const ok = await deleteCloudFavoritePaths(paths);
    if (!ok) {
      showToast('云端删除失败，请检查网络后重试', 'error');
      return;
    }
    addLocalOnlyPaths(paths);
    if (isClearAll) removeFavoriteCollections();
    showToast(`已从云端移除 ${paths.length} 首收藏，本机保留`, 'success');
    return;
  }

  // 仅删本地：云端保留，写墓碑排除 delete_paths 与下载回灌
  if (scope === 'local') {
    addCloudKeepPaths(paths);
  }
  favoritePaths.value = favoritePaths.value.filter(p => !pathSet.has(p));
  // 清空时连同歌单/专辑收藏与元信息一并清理（本地数据）
  if (isClearAll) clearFavorites();
  showToast(
    scope === 'local'
      ? `已从本机移除 ${paths.length} 首收藏（云端保留）`
      : `已移除 ${paths.length} 首收藏`,
    'success',
  );
}

// 清空收藏
const handleClearAll = () => {
  const paths = [...favoritePaths.value];
  // 已登录且存在云端副本：弹删除范围三选一
  if (paths.length > 0 && getCiyuanxiId() && paths.some(p => loadSyncedFavoritePaths().includes(p))) {
    deleteScopePaths.value = paths;
    deleteScopeIsClearAll.value = true;
    showDeleteScope.value = true;
    return;
  }
  confirmMessage.value = "确定要清空收藏列表吗？";
  confirmAction.value = clearFavorites;
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

<style scoped>
/* 单曲/歌单/专辑 tab 切换动画 */
.fav-tab-enter-active {
  transition: opacity 240ms cubic-bezier(0.25, 0.8, 0.25, 1), transform 240ms cubic-bezier(0.25, 0.8, 0.25, 1);
}
.fav-tab-leave-active {
  pointer-events: none;
  transition: opacity 160ms ease, transform 160ms ease;
}
.fav-tab-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.fav-tab-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
</style>
