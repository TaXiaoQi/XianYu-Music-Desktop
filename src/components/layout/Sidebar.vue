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

  // 保存在线歌曲元信息到 libraryStore.extraSongPool
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

const handleOpenAllView = () => {
  void openHomeAll();
};

const handleOpenHomeView = () => {
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
  sidebarSelectHandlers[key]?.();
};
</script>

<template>
  <aside class="w-48 bg-transparent flex flex-col border-r border-black/10 dark:border-white/10 h-full select-none overflow-hidden relative transition-colors duration-600">
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
        @pointerDown="handlePointerDown"
        @itemPointerMove="handleItemPointerMove"
        @playlistClick="handlePlaylistClick"
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
      @create="confirmCreatePlaylist"
      @import="confirmImportPlaylist"
    />
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
