<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import ModernModal from '../common/ModernModal.vue';
import PlaylistContextMenu from '../overlays/PlaylistContextMenu.vue';
import PlaylistModal from '../overlays/PlaylistModal.vue';
import { useCoverCache } from '../../composables/useCoverCache';
import { useHomeNavigation } from '../../composables/useHomeNavigation';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { usePlayerLibraryView } from '../../features/library/usePlayerLibraryView';
import { dragSession } from '../../composables/dragState';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useSettings } from '../../features/settings/useSettings';
import { useSidebarPlaylistContextMenu } from '../../composables/useSidebarPlaylistContextMenu';
import { useSidebarPlaylistCovers } from '../../composables/useSidebarPlaylistCovers';
import { useSidebarPlaylistDragDrop } from '../../composables/useSidebarPlaylistDragDrop';
import { useSidebarPlaylistSelection } from '../../composables/useSidebarPlaylistSelection';
import { useLibraryStore } from '../../features/library/store';
import { useToast } from '../../composables/toast';
import type { Song, SidebarItemKey } from '../../types';
import type { PlaylistImportResult } from '../../services/playlistImport';
import { matchSongsToLocalLibrary, type ImportedPlaylist } from '../../services/backupImport';
import type { PreparedPluginBackupImport } from '../../services/pluginBackupImport';
import { cacheLxSong } from '../../services/lxSongCache';
import SidebarBrand from './SidebarBrand.vue';
import SidebarNavigation from './SidebarNavigation.vue';
import SidebarPlaylists from './SidebarPlaylists.vue';

const { artistList, albumList } = usePlayerLibraryView();
const { playSong, addSongsToQueue, clearQueue } = usePlaybackController();
const { settings } = useSettings();

const {
  currentViewMode,
  filterCondition,
  currentFolderFilter,
  setSearch,
} = usePlayerViewState();

const {
  playlists,
  createPlaylist,
  deletePlaylist,
  reorderPlaylists,
  viewPlaylist,
  getSongsFromPlaylist,
} = useLibraryCollections();

const route = useRoute();
const router = useRouter();
const {
  openHomeAll,
  openHomeFolder,
  openHomePlaylist,
  openHomeStatistics,
  openArtists,
  openAlbums,
  openFavorites,
  openRecent,
  openPlugins,
  openAuth,
} = useHomeNavigation(router);
const { preloadCovers, loadCover, primeCoverPath } = useCoverCache();

const isPlaylistOpen = ref(true);
const showPlaylistModal = ref(false);
const playlistModalMode = ref<'create' | 'import' | 'all'>('all');

const handleHoverArtists = () => {
  if (artistList.value.length > 0) {
    preloadCovers(artistList.value.slice(0, 30).map(artist => artist.firstSongPath).filter(Boolean));
  }
};

const handleHoverAlbums = () => {
  if (albumList.value.length > 0) {
    preloadCovers(albumList.value.slice(0, 30).map(album => album.firstSongPath).filter(Boolean));
  }
};

const {
  selectedPlaylistIds,
  ensurePlaylistSelected,
  handlePlaylistClick,
  handleBackgroundClick,
} = useSidebarPlaylistSelection({
  playlists,
  currentViewMode,
  filterCondition,
  openHomePlaylist,
});

const clearPlaylistSelection = () => {
  selectedPlaylistIds.value.clear();
};

const {
  showContextMenu,
  contextMenuX,
  contextMenuY,
  targetPlaylist,
  showDeleteModal,
  deleteModalContent,
  handleDeletePlaylist,
  confirmDeletePlaylist,
  handlePlaylistContextMenu,
  handleMenuPlay,
  handleMenuAddToQueue,
  handleMenuDelete,
} = useSidebarPlaylistContextMenu({
  selectedPlaylistIds,
  ensurePlaylistSelected,
  viewPlaylist,
  getSongsFromPlaylist,
  addSongsToQueue,
  clearQueue,
  playSong,
  openHomePlaylist,
  deletePlaylist,
  clearSelection: clearPlaylistSelection,
});

const {
  dragOverId,
  dragPosition,
  handlePointerDown,
  handleItemPointerMove,
} = useSidebarPlaylistDragDrop({
  playlists,
  dragSession,
  reorderPlaylists,
});

const { playlistCoverCacheVersion, getPlaylistCover } = useSidebarPlaylistCovers({
  playlists,
  loadCover,
  primeCoverPath,
});

const handleCreatePlaylist = () => {
  playlistModalMode.value = 'create';
  showPlaylistModal.value = true;
};

const handleImportPlaylist = () => {
  playlistModalMode.value = 'import';
  showPlaylistModal.value = true;
};

const confirmCreatePlaylist = (name: string) => {
  if (name) {
    createPlaylist(name);
  }
};

const libraryStore = useLibraryStore();
const { showToast } = useToast();

/**
 * 将导入的搜索结果转换为 Song 对象
 * 使用 lx:// 协议作为 path（与 YinDongMusic 一致），由 playerPlayback 的 lx:// 处理器解析真实播放 URL
 * 同时将 rawData 缓存到 lxSongCache，确保切歌/队列播放时仍能获取完整元信息
 */
function importResultToSongs(result: PlaylistImportResult): Song[] {
  return result.songs.map((item) => {
    const artistNames = item.artist
      ? item.artist.split(/[、,/&]/).filter(Boolean).map((s) => s.trim())
      : ['未知歌手'];
    // 使用 lx://sourceKey/songId 协议，与 YinDongMusic 的 platformTrackToSong 一致
    const sourceKey = item.pluginId || 'wy';
    const path = `lx://${sourceKey}/${item.id}`;
    return {
      name: item.title,
      title: item.title,
      path,
      artist: item.artist || '未知歌手',
      artist_names: artistNames,
      effective_artist_names: artistNames,
      album: item.album || '未知专辑',
      album_artist: item.artist || '未知歌手',
      album_key: `${item.album || '未知专辑'}-${item.artist || '未知歌手'}`,
      is_various_artists_album: false,
      collapse_artist_credits: false,
      duration: Math.floor((item.duration || 0) / 1000),
      cover_thumb_path: item.coverUrl || '',
      source_type: 'remote' as const,
      remote_source_id: path,
      rawData: item.rawData ?? item,
    } as Song;
  });
}

const confirmImportPlaylist = (payload: { result: PlaylistImportResult; rename?: string }) => {
  const { result, rename } = payload;
  if (result.songs.length === 0) return;

  // 将搜索结果转换为 Song 对象
  const songs = importResultToSongs(result);
  const songPaths = songs.map((s) => s.path);

  // 缓存 LX 歌曲元信息，播放时 lxPluginGetMusicUrl 需要 hash/strMediaMid 等字段
  for (const song of songs) {
    const raw = song.rawData as any;
    if (raw && raw.source && raw.songmid) {
      cacheLxSong({
        name: raw.name || song.name,
        singer: raw.singer || song.artist,
        albumName: song.album || '',
        albumId: '',
        songmid: raw.songmid,
        source: raw.source,
        interval: raw.interval || '',
        img: song.cover_thumb_path || null,
        types: [],
        _types: {},
        hash: raw.hash,
        strMediaMid: raw.strMediaMid,
        songId: raw.songId,
        albumMid: raw.albumMid,
      });
    }
  }

  // 保存在线歌曲元信息到 libraryStore.songPool
  for (const song of songs) {
    libraryStore.setExtraSong(song);
  }

  // 创建歌单（使用用户指定的名称或原始歌单名称）
  // 第三个参数传入完整 Song 对象，缓存在 playlist.songs 中，
  // 确保重启后仍能显示歌曲（在线歌曲不在本地库中）
  const playlistName = rename || result.info.name || '导入的歌单';
  const playlistId = createPlaylist(playlistName, songPaths, songs);

  if (playlistId) {
    showToast(`已创建歌单「${playlistName}」，共 ${songPaths.length} 首歌曲`, 'success');
  } else {
    showToast('创建歌单失败', 'error');
  }
};

const confirmLocalFolderImport = (payload: { name: string; songs: Song[] }) => {
  const playlistName = payload.name.trim();
  if (!playlistName || payload.songs.length === 0) return;

  const songPaths = payload.songs.map((song) => song.path);
  for (const song of payload.songs) {
    libraryStore.setExtraSong(song);
  }

  const playlistId = createPlaylist(playlistName, songPaths, payload.songs);
  if (playlistId) {
    showToast(`已创建歌单「${playlistName}」，共 ${songPaths.length} 首歌曲`, 'success');
  } else {
    showToast('创建歌单失败', 'error');
  }
};

const confirmBackupImport = (playlists: ImportedPlaylist[]) => {
  if (playlists.length === 0) return;

  // 椒盐音乐 / M3U 导出的路径来自导出设备，在当前机器上不存在。
  // 用文件名、标题+歌手在本地库中匹配，将 path 替换为本地路径。
  const { playlists: matchedPlaylists, matchedCount, unmatchedCount } =
    matchSongsToLocalLibrary(playlists, libraryStore.canonicalSongs);

  // 本地库路径集合：匹配成功的歌曲已在本地库中，无需写入 songPool
  const localPathSet = new Set(
    libraryStore.canonicalSongs.map(s => s.path.toLowerCase()),
  );

  let createdCount = 0;
  let totalSongs = 0;
  const allExtraSongs: Song[] = [];

  for (const pl of matchedPlaylists) {
    const playlistName = pl.name.trim();
    if (!playlistName || pl.songs.length === 0) continue;

    const songPaths = pl.songs.map((song) => song.path);
    // 仅未匹配的歌曲需要写入 songPool（匹配成功的已在本地库中）
    for (const song of pl.songs) {
      if (!localPathSet.has(song.path.toLowerCase())) {
        allExtraSongs.push(song);
      }
    }

    const playlistId = createPlaylist(playlistName, songPaths, pl.songs);
    if (playlistId) {
      createdCount++;
      totalSongs += songPaths.length;
    }
  }

  if (allExtraSongs.length > 0) {
    libraryStore.setExtraSongs(allExtraSongs);
  }

  if (createdCount > 0) {
    const msg = unmatchedCount > 0
      ? `已创建 ${createdCount} 个歌单，匹配 ${matchedCount} 首，${unmatchedCount} 首未匹配本地文件`
      : `已创建 ${createdCount} 个歌单，共 ${totalSongs} 首歌曲`;
    showToast(msg, 'success');
  } else {
    showToast('创建歌单失败', 'error');
  }
};

const confirmOnlineBackupImport = (prepared: PreparedPluginBackupImport) => {
  if (prepared.playlists.length === 0) {
    showToast('没有可导入的歌单', 'info');
    return;
  }

  let createdCount = 0;

  // 批量收集所有需要写入 songPool 的歌曲，避免逐首调用 setExtraSong
  // 触发 N 次 songCatalogVersion 自增和 songLookup 重算
  const allExtraSongs: Song[] = [];

  for (const playlist of prepared.playlists) {
    if (playlist.songs.length === 0) continue;
    const songPaths = playlist.songs.map(song => song.path);
    allExtraSongs.push(...playlist.songs);
    const playlistId = createPlaylist(playlist.name, songPaths, playlist.songs);
    if (playlistId) createdCount++;
  }

  if (allExtraSongs.length > 0) {
    libraryStore.setExtraSongs(allExtraSongs);
  }

  if (createdCount > 0) {
    const msg = prepared.failures.length > 0
      ? `已创建 ${createdCount} 个歌单，导入 ${prepared.importedSongCount} 首，${prepared.failures.length} 首未导入`
      : `已创建 ${createdCount} 个歌单，共 ${prepared.importedSongCount} 首歌曲`;
    showToast(msg, 'success');
  } else {
    showToast('创建歌单失败', 'error');
  }
};

const handleOpenAllView = () => {
  void openHomeAll();
};

const handleOpenHomeView = () => {
  setSearch('');
  void openHomeStatistics();
};

const handleOpenArtistsView = () => {
  void openArtists();
};

const handleOpenAlbumsView = () => {
  void openAlbums();
};

const handleOpenFavoritesView = () => {
  void openFavorites();
};

const handleOpenRecentView = () => {
  void openRecent();
};

const handleOpenFolderView = () => {
  void openHomeFolder(currentFolderFilter.value || undefined);
};

const handleOpenPluginsView = () => {
  void openPlugins();
};

const handleOpenAccountView = () => {
  void openAuth();
};

/** 侧边栏项点击分发：侧边栏顺序可自定义，故统一用 key 派发到对应 handler */
const sidebarSelectHandlers: Record<SidebarItemKey, () => void> = {
  localMusic: handleOpenAllView,
  artists: handleOpenArtistsView,
  albums: handleOpenAlbumsView,
  favorites: handleOpenFavoritesView,
  recent: handleOpenRecentView,
  folders: handleOpenFolderView,
  plugins: handleOpenPluginsView,
  account: handleOpenAccountView,
};

const handleSidebarSelect = (key: SidebarItemKey) => {
  setSearch('');
  sidebarSelectHandlers[key]?.();
};

const handleSidebarPlaylistClick = (event: MouseEvent, id: string) => {
  setSearch('');
  handlePlaylistClick(event, id);
};

// --- 一级侧边栏拖拽调整宽度逻辑 ---
import { onBeforeUnmount } from 'vue';

const STORAGE_KEY_MAIN_SIDEBAR_WIDTH = 'main_sidebar_width';
const DEFAULT_SIDEBAR_WIDTH = 192;
const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 360;

const loadInitialSidebarWidth = (): number => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_MAIN_SIDEBAR_WIDTH);
    if (saved) {
      const parsed = Number.parseInt(saved, 10);
      if (!Number.isNaN(parsed)) {
        return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed));
      }
    }
  } catch {}
  return DEFAULT_SIDEBAR_WIDTH;
};

const sidebarWidth = ref(loadInitialSidebarWidth());
const isResizingSidebar = ref(false);
let dragStartX = 0;
let dragStartWidth = 0;

const startSidebarResize = (e: PointerEvent) => {
  e.preventDefault();
  isResizingSidebar.value = true;
  dragStartX = e.clientX;
  dragStartWidth = sidebarWidth.value;

  window.addEventListener('pointermove', handleSidebarResizeMove);
  window.addEventListener('pointerup', stopSidebarResize);
  window.addEventListener('pointercancel', stopSidebarResize);
};

const handleSidebarResizeMove = (e: PointerEvent) => {
  if (!isResizingSidebar.value) return;
  const deltaX = e.clientX - dragStartX;
  const nextWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, dragStartWidth + deltaX));
  sidebarWidth.value = nextWidth;
};

const stopSidebarResize = () => {
  if (!isResizingSidebar.value) return;
  isResizingSidebar.value = false;
  window.removeEventListener('pointermove', handleSidebarResizeMove);
  window.removeEventListener('pointerup', stopSidebarResize);
  window.removeEventListener('pointercancel', stopSidebarResize);
  try {
    localStorage.setItem(STORAGE_KEY_MAIN_SIDEBAR_WIDTH, sidebarWidth.value.toString());
  } catch {}
};

const resetSidebarWidth = () => {
  sidebarWidth.value = DEFAULT_SIDEBAR_WIDTH;
  try {
    localStorage.setItem(STORAGE_KEY_MAIN_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH.toString());
  } catch {}
};

onBeforeUnmount(() => {
  stopSidebarResize();
});
</script>

<template>
  <aside
    class="bg-transparent flex flex-col border-r border-black/10 dark:border-white/10 h-full select-none overflow-hidden relative transition-colors duration-600 shrink-0"
    :class="{ 'select-none': isResizingSidebar }"
    :style="{ width: `${sidebarWidth}px` }"
  >
    <SidebarBrand />

    <nav class="flex-1 overflow-y-auto custom-scrollbar px-2 pb-4" @click="handleBackgroundClick">
      <SidebarNavigation
        :sidebar="settings.sidebar"
        :currentViewMode="currentViewMode"
        :currentPath="route.path"
        :isDragActive="dragSession.active"
        @openHome="handleOpenHomeView"
        @select="handleSidebarSelect"
        @hoverArtists="handleHoverArtists"
        @hoverAlbums="handleHoverAlbums"
      />

      <SidebarPlaylists
        v-model:isOpen="isPlaylistOpen"
        :playlists="playlists"
        :selectedPlaylistIds="selectedPlaylistIds"
        :playlistCoverCacheVersion="playlistCoverCacheVersion"
        :getPlaylistCover="getPlaylistCover"
        :dragState="dragSession"
        :dragOverId="dragOverId"
        :dragPosition="dragPosition"
        @createPlaylist="handleCreatePlaylist"
        @importPlaylist="handleImportPlaylist"
        @pointerDown="handlePointerDown"
        @itemPointerMove="handleItemPointerMove"
        @playlistClick="handleSidebarPlaylistClick"
        @playlistContextMenu="handlePlaylistContextMenu"
        @deletePlaylist="handleDeletePlaylist"
      />
    </nav>

    <PlaylistContextMenu
      :visible="showContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :playlist-name="targetPlaylist?.name || ''"
      :selected-count="selectedPlaylistIds.size"
      @close="showContextMenu = false"
      @cancel="showContextMenu = false"
      @play="handleMenuPlay"
      @add-to-queue="handleMenuAddToQueue"
      @delete="handleMenuDelete"
    />

    <ModernModal
      v-model:visible="showDeleteModal"
      title="删除播放列表"
      :content="deleteModalContent"
      type="danger"
      confirm-text="删除"
      @confirm="confirmDeletePlaylist"
    />

    <PlaylistModal
      v-model:visible="showPlaylistModal"
      :playlists="playlists"
      :mode="playlistModalMode"
      @create="confirmCreatePlaylist"
      @import="confirmImportPlaylist"
      @import-local="confirmLocalFolderImport"
      @import-backup="confirmBackupImport"
      @import-backup-online="confirmOnlineBackupImport"
    />

    <!-- 一级侧边栏宽度可拖拽手柄 -->
    <div
      class="group absolute -right-1 top-0 bottom-0 z-20 w-2 cursor-col-resize touch-none flex items-center justify-center"
      title="按住拖拽调整侧边栏宽度，双击恢复默认"
      @pointerdown="startSidebarResize"
      @dblclick="resetSidebarWidth"
    >
      <div
        class="h-full w-0.5 transition-colors duration-200"
        :class="isResizingSidebar ? 'bg-[#EC4141]' : 'group-hover:bg-[#EC4141]/60 bg-transparent'"
      ></div>
    </div>
  </aside>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
}

.create-menu-enter-active,
.create-menu-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.create-menu-enter-from,
.create-menu-leave-to {
  opacity: 0;
  transform: translateX(-100%) translateY(-4px);
}
</style>
