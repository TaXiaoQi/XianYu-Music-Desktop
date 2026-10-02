<script setup lang="ts"> // 实现
import { computed, defineAsyncComponent, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router'; // 实现
import { storeToRefs } from 'pinia';

import { useI18n } from '../../features/i18n';
import { useCoverCache } from '../../composables/useCoverCache'; // 实现
import { useHomeNavigation } from '../../composables/useHomeNavigation'; // 实现
import { useLibraryCollections } from '../../features/collections/useLibraryCollections'; // 实现
import { usePlaybackController } from '../../features/playback/usePlaybackController'; // 实现
import { usePlayerLibraryView } from '../../features/library/usePlayerLibraryView'; // 实现
import { dragSession } from '../../composables/dragState'; // 实现
import { usePlayerViewState } from '../../composables/usePlayerViewState'; // 实现
import { usePlaylistSync } from '../../composables/usePlaylistSync';
import { useSettings } from '../../features/settings/useSettings'; // 实现
import { useSidebarPlaylistContextMenu } from '../../composables/useSidebarPlaylistContextMenu'; // 实现
import { useSidebarPlaylistCovers } from '../../composables/useSidebarPlaylistCovers'; // 实现
import { useSidebarImportConfirmers } from '../../composables/useSidebarImportConfirmers';
import { useSidebarPlaylistDragDrop } from '../../composables/useSidebarPlaylistDragDrop'; // 实现
import { useSidebarPlaylistSelection } from '../../composables/useSidebarPlaylistSelection'; // 实现
import { useSidebarWidthResizer } from '../../composables/useSidebarWidthResizer';
import { useToast } from '../../composables/toast'; // 轻提示
import type { SidebarItemKey } from '../../types';
import { useCollectionsStore, type FavoriteCollectionEntry } from '../../features/collections/store';
import { openOnlineDetail } from '../../features/onlineDetail/store';
import { useDesktopTheme } from '../../composables/useDesktopTheme';
import SidebarBrand from './SidebarBrand.vue'; // 实现
import SidebarNavigation from './SidebarNavigation.vue'; // 实现
import SidebarPlaylists from './SidebarPlaylists.vue'; // 实现

const { sticker } = useDesktopTheme();

const ModernModal = defineAsyncComponent(() => import('../common/ModernModal.vue'));
const PlaylistContextMenu = defineAsyncComponent(() => import('../overlays/PlaylistContextMenu.vue'));
const PlaylistModal = defineAsyncComponent(() => import('../overlays/PlaylistModal.vue'));
const SyncDeleteScopeModal = defineAsyncComponent(() => import('../overlays/SyncDeleteScopeModal.vue'));

// —— 基础依赖一次性接线 ——
const libraryView = usePlayerLibraryView();
const artistList = libraryView.artistList;
const albumList = libraryView.albumList;

const playback = usePlaybackController();
const playSong = playback.playSong;
const addSongsToQueue = playback.addSongsToQueue;
const clearQueue = playback.clearQueue;

const settingsStore = useSettings();
const settings = settingsStore.settings;
const playlistSync = usePlaylistSync();
const deleteCloudPlaylistLocal = playlistSync.deleteCloudPlaylistLocal;
const { showToast } = useToast();

const playerView = usePlayerViewState();
const { currentViewMode, filterCondition, currentFolderFilter, setSearch } = playerView;

const collectionsApi = useLibraryCollections();
const { playlists, createPlaylist, deletePlaylist, reorderPlaylists, getSongsFromPlaylist, setPlaylistSource } = collectionsApi;

const collectionsStore = useCollectionsStore();
const { favoriteCollections } = storeToRefs(collectionsStore);

// —— 收藏歌单条目：本地歌单优先，其次透传在线上下文 ——
const resolveLocalPlaylistIdOf = (entry: FavoriteCollectionEntry): string => {
  if (entry.localPlaylistId) { return entry.localPlaylistId; }
  return entry.key.startsWith('local:playlist:') ? entry.key.replace('local:playlist:', '') : '';
};

const handleFavoriteCollectionClick = (entry: FavoriteCollectionEntry) => {
  setSearch('');
  const localId = resolveLocalPlaylistIdOf(entry);
  if (localId === '') {
    if (entry.onlineContext) { openOnlineDetail({ ...entry.onlineContext }); }
    return;
  }

  const playlist = collectionsStore.getPlaylistById(localId);
  if (!playlist) {
    collectionsStore.removeFavoriteCollection(entry.key);
    showToast('原本地歌单已被删除', 'info');
    return;
  }
  void openHomePlaylist(playlist.id);
  handleSidebarPlaylistClick(undefined as any, playlist.id);
};

const handleRemoveFavoriteCollection = (key: string) => {
  collectionsStore.removeFavoriteCollection(key);
  showToast('已取消收藏歌单', 'success');
};

const navRouter = useRouter();
const currentRoute = useRoute();
const homeNav = useHomeNavigation(navRouter);
const { openHomeAll, openHomeFolder, openHomePlaylist, openHomeStatistics, openArtists, openAlbums, openFavorites, openRecent, openPlugins, openAuth } = homeNav;
const { preloadCovers, loadCover, primeCoverPath } = useCoverCache(); // 封面缓存

const playlistsGroupOpen = ref(true);
const playlistDialogVisible = ref(false);
const playlistDialogMode = ref<'create' | 'import' | 'all'>('all');

// —— 悬浮预载：歌手/专辑前 30 张封面 ——
const preloadLeadingCovers = (entries: { firstSongPath: string }[]) => {
  if (entries.length === 0) { return; }
  preloadCovers(entries.slice(0, 30).map(item => item.firstSongPath).filter(Boolean));
};

const handleHoverArtists = () => preloadLeadingCovers(artistList.value);
const handleHoverAlbums = () => preloadLeadingCovers(albumList.value);

const selectionApi = useSidebarPlaylistSelection({
  playlists, currentViewMode, filterCondition, openHomePlaylist,
});
const activePlaylistSelection = selectionApi.selectedPlaylistIds;
const requirePlaylistSelected = selectionApi.ensurePlaylistSelected;
const onPlaylistClicked = selectionApi.handlePlaylistClick;
const onNavBackgroundClick = selectionApi.handleBackgroundClick;

const clearPlaylistSelection = () => activePlaylistSelection.value.clear();

const contextMenuApi = useSidebarPlaylistContextMenu({
  selectedPlaylistIds: activePlaylistSelection,
  ensurePlaylistSelected: requirePlaylistSelected,
  getSongsFromPlaylist, addSongsToQueue, clearQueue, playSong,
  openHomePlaylist, deletePlaylist,
  isCloudOrigin: (id) => Boolean(
    playlists.value?.some?.((item) => item.id === id && (item.cloudId != null || item.isCloud === true)),
  ),
  hasCloudId: (id) => Boolean(
    playlists.value?.some?.((item) => item.id === id && item.cloudId != null),
  ),
  deleteCloudPlaylist: async (id) => deleteCloudPlaylistLocal(id),
  clearSelection: clearPlaylistSelection, // 实现
});
const contextMenuShown = contextMenuApi.showContextMenu;
const contextMenuPosX = contextMenuApi.contextMenuX;
const contextMenuPosY = contextMenuApi.contextMenuY;
const contextMenuTarget = contextMenuApi.targetPlaylist;
const deleteDialogVisible = contextMenuApi.showDeleteModal;
const deleteDialogText = contextMenuApi.deleteModalContent;
const scopeDialogVisible = contextMenuApi.showDeleteScopeModal;
const cloudRemovable = contextMenuApi.canDeleteCloud;
const applyDeleteScope = contextMenuApi.confirmDeleteScope;
const requestPlaylistDelete = contextMenuApi.handleDeletePlaylist;
const applyPlaylistDelete = contextMenuApi.confirmDeletePlaylist;
const openPlaylistContextMenu = contextMenuApi.handlePlaylistContextMenu;
const runMenuPlay = contextMenuApi.handleMenuPlay;
const runMenuEnqueue = contextMenuApi.handleMenuAddToQueue;
const runMenuDelete = contextMenuApi.handleMenuDelete;

const dragDropApi = useSidebarPlaylistDragDrop({
  playlists, dragSession, reorderPlaylists,
});
const dragHoverId = dragDropApi.dragOverId;
const dragEdge = dragDropApi.dragPosition;
const beginPlaylistPointer = dragDropApi.handlePointerDown;
const trackPlaylistPointer = dragDropApi.handleItemPointerMove;

const coversApi = useSidebarPlaylistCovers({ playlists, loadCover, primeCoverPath });
const coverCacheVersion = coversApi.playlistCoverCacheVersion;
const resolvePlaylistCover = coversApi.getPlaylistCover;

const importActions = useSidebarImportConfirmers({ createPlaylist, setPlaylistSource });
const confirmImportPlaylist = importActions.confirmImportPlaylist;
const confirmLocalFolderImport = importActions.confirmLocalFolderImport;
const confirmBackupImport = importActions.confirmBackupImport;
const confirmOnlineBackupImport = importActions.confirmOnlineBackupImport;

const openPlaylistDialogIn = (mode: 'create' | 'import') => {
  playlistDialogMode.value = mode;
  playlistDialogVisible.value = true;
};

const handleCreatePlaylist = () => openPlaylistDialogIn('create');
const handleImportPlaylist = () => openPlaylistDialogIn('import');

const confirmCreatePlaylist = (playlistName: string) => {
  if (playlistName !== '') { createPlaylist(playlistName); }
};

// —— 导航分发：按侧栏键位路由到对应视图 ——
const viewOpeners: Record<SidebarItemKey, () => void> = {
  localMusic: () => { void openHomeAll(); },
  artists: () => { void openArtists(); },
  albums: () => { void openAlbums(); },
  favorites: () => { void openFavorites(); },
  recent: () => { void openRecent(); },
  folders: () => { void openHomeFolder(currentFolderFilter.value || undefined); },
  plugins: () => { void openPlugins(); },
  account: () => { void openAuth(); },
};

const handleOpenHomeView = () => { // 实现
  setSearch(''); // 实现
  return openHomeStatistics();
};

const handleSidebarSelect = (key: SidebarItemKey) => {
  setSearch(''); // 实现
  viewOpeners[key]?.();
};

const handleSidebarPlaylistClick = (event: MouseEvent, id: string) => { // 实现
  setSearch(''); // 实现
  onPlaylistClicked(event, id);
};

// —— 一级侧边栏宽度拖拽（含持久化与双击复位） ——
const { isEnglish } = useI18n();
const widthResizer = useSidebarWidthResizer({ isEnglishUi: isEnglish });
const sidebarWidth = widthResizer.sidebarWidth;
const isResizingSidebar = widthResizer.resizing;
const startSidebarResize = widthResizer.beginResize;
const resetSidebarWidth = widthResizer.resetToPreferredWidth;

const asideWidthStyle = computed(() => ({ width: `${sidebarWidth.value}px` }));
</script>

<template>
  <aside
    class="bg-transparent flex flex-col border-r border-black/10 dark:border-white/10 h-full select-none overflow-hidden relative transition-colors duration-600 shrink-0"
    :class="{ 'select-none': isResizingSidebar }" :style="asideWidthStyle"
  >
    <SidebarBrand/>

    <nav class="flex-1 overflow-y-auto custom-scrollbar px-2 pb-4" @click="onNavBackgroundClick">
      <SidebarNavigation 
        :sidebar="settings.sidebar" :currentViewMode="currentViewMode" :currentPath="currentRoute.path"
        :isDragActive="dragSession.active" @openHome="handleOpenHomeView" @select="handleSidebarSelect"
        @hoverArtists="handleHoverArtists" @hoverAlbums="handleHoverAlbums"
      />

      <SidebarPlaylists 
        v-model:isOpen="playlistsGroupOpen"
        :playlists="playlists" :favoriteCollections="favoriteCollections" :selectedPlaylistIds="activePlaylistSelection"
        :playlistCoverCacheVersion="coverCacheVersion" :getPlaylistCover="resolvePlaylistCover"
        :dragState="dragSession" :dragOverId="dragHoverId" :dragPosition="dragEdge"
        @createPlaylist="handleCreatePlaylist" @importPlaylist="handleImportPlaylist"
        @pointerDown="beginPlaylistPointer" @itemPointerMove="trackPlaylistPointer"
        @playlistClick="handleSidebarPlaylistClick" @playlistContextMenu="openPlaylistContextMenu"
        @deletePlaylist="requestPlaylistDelete" @favoriteCollectionClick="handleFavoriteCollectionClick"
        @removeFavoriteCollection="handleRemoveFavoriteCollection"
      />
    </nav>

    <PlaylistContextMenu 
      v-if="contextMenuShown" :visible="contextMenuShown"
      :x="contextMenuPosX" :y="contextMenuPosY"
      :playlist-name="contextMenuTarget?.name || ''" :selected-count="activePlaylistSelection.size"
      @close="contextMenuShown = false" @cancel="contextMenuShown = false"
      @play="runMenuPlay" @add-to-queue="runMenuEnqueue" @delete="runMenuDelete"
    />

    <ModernModal 
      v-if="deleteDialogVisible" v-model:visible="deleteDialogVisible"
      title="删除播放列表" :content="deleteDialogText" type="danger" confirm-text="删除"
      @confirm="applyPlaylistDelete"
    />

    <SyncDeleteScopeModal
      v-model:visible="scopeDialogVisible"
      title="该歌单已同步到云端" description="请选择删除范围" :can-delete-cloud="cloudRemovable"
      @cancel="scopeDialogVisible = false" @scope="applyDeleteScope"
    />

    <PlaylistModal 
      v-if="playlistDialogVisible" v-model:visible="playlistDialogVisible"
      :playlists="playlists" :mode="playlistDialogMode"
      @create="confirmCreatePlaylist" @import="confirmImportPlaylist" @import-local="confirmLocalFolderImport"
      @import-backup="confirmBackupImport" @import-backup-online="confirmOnlineBackupImport"
    />

    <img
      v-if="sticker('sidebar.bottom')"
      :src="sticker('sidebar.bottom')"
      alt=""
      class="pointer-events-none absolute bottom-3 left-1/2 z-10 max-h-16 max-w-[80%] -translate-x-1/2 object-contain opacity-80"
    />

    <div
      class="group absolute -right-1 top-0 bottom-0 z-20 w-2 cursor-col-resize touch-none flex items-center justify-center"
      title="按住拖拽调整侧边栏宽度，双击恢复默认"
      @pointerdown="startSidebarResize" @dblclick="resetSidebarWidth"
    >
      <div
        class="h-full w-0.5 transition-colors duration-200"
        :class="isResizingSidebar ? 'bg-[#EC4141]' : 'group-hover:bg-[#EC4141]/60 bg-transparent'"
      />
    </div>
  </aside>
</template>

<style scoped> /* 样式 */
/* 侧栏纵向滚动条：细线 + 半透明滑块 */
.custom-scrollbar::-webkit-scrollbar { width: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.1); border-radius: 10px; }
.dark .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); }
</style>
