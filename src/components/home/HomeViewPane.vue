<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import type { FolderNode, Song } from '../../types';

const HomeContentPanel = defineAsyncComponent(() => import('./HomeContentPanel.vue'));
const HomeHeaderPanel = defineAsyncComponent(() => import('./HomeHeaderPanel.vue'));

interface PlaylistDetail {
  name: string;
  date: string;
}

interface ArtistAlbumItem {
  key: string;
  name: string;
  count: number;
  artist: string;
  firstSongPath: string;
}

interface Props {
  localViewMode: string;
  isBatchMode: boolean;
  isManagementMode: boolean;
  activeRootPath: string;
  selectedCount: number;
  folderTree: FolderNode[];
  currentFolderFilter: string;
  playlistDetail: PlaylistDetail | null;
  localSongList: Song[];
  localSongPaths?: string[];
  resolveSongByPath?: (path: string) => Song | null;
  artistActiveTab: 'songs' | 'albums' | 'details';
  localFilterCondition: string;
  selectedAlbumSong: Song | null;
  artistAlbumList: ArtistAlbumItem[];
  coverCache: Map<string, string>;
  loadingSet: Set<string>;
  selectedPaths: Set<string>;
  setSongTableRef?: (instance: any | null) => void;
  /** 歌曲列表滚动容器（用于详情头部滚动缩小封面效果） */
  scrollContainerRef?: HTMLElement | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (event: 'update:isBatchMode', value: boolean): void;
  (event: 'update:isManagementMode', value: boolean): void;
  (event: 'update:artistActiveTab', value: 'songs' | 'albums' | 'details'): void;
  (event: 'update:selectedPaths', value: Set<string>): void;
  (event: 'playAll'): void;
  (event: 'batchPlay'): void;
  (event: 'showAddToPlaylist'): void;
  (event: 'batchDelete'): void;
  (event: 'folderBatchDelete'): void;
  (event: 'batchMove'): void;
  (event: 'batchDownload'): void;
  (event: 'rootCreatePlaylist', path: string, name: string): void;
  (event: 'addFolder'): void;
  (event: 'refreshFolder'): void;
  (event: 'removeFolder', path: string, name?: string): void;
  (event: 'rootCreateFolder', path: string): void;
  (event: 'rootDeleteFolder', path: string): void;
  (event: 'activeRootChange', value: string): void;
  (event: 'renamePlaylist'): void;
  (event: 'refreshAll'): void;
  (event: 'playSong', song: Song): void;
  (event: 'contextMenuSong', nativeEvent: MouseEvent, song: Song): void;
  (event: 'tableDragStart', ...args: any[]): void;
  (event: 'artistAlbumClick', albumKey: string): void;
  (event: 'selectAll'): void;
  (event: 'batchAddToFavorites'): void;
}>();

const handleContentContextMenu = (nativeEvent: MouseEvent, song: Song) => {
  emit('contextMenuSong', nativeEvent, song);
};

const handleTableDragStart = (...args: any[]) => {
  emit('tableDragStart', ...args);
};

const songTableMemoryScopeKey = computed(() =>
  (() => {
    switch (props.localViewMode) {
      case 'folder':
        return [
          'folder',
          props.currentFolderFilter || '',
          props.activeRootPath || '',
        ].join('::');
      case 'artist':
      case 'album':
      case 'playlist':
        return [
          props.localViewMode,
          props.localFilterCondition || '',
        ].join('::');
      case 'statistics':
        return 'statistics';
      default:
        return 'all';
    }
  })(),
);

// 主页内的详情容器（歌单/歌手/专辑/文件夹等）按 key 销毁重建。
// 歌单切换时旧 SongTable 会完整卸载，新歌单再重新挂载，避免旧页面状态和缓存残留。
const viewInstanceKey = computed(() =>
  [
    props.localViewMode,
    props.localFilterCondition || '',
    props.currentFolderFilter || '',
    props.activeRootPath || '',
    props.artistActiveTab || '',
  ].join('::'),
);
</script>

<template>
  <div class="flex flex-1 flex-col min-h-0 min-w-0">
    <Transition name="home-view-switch" mode="out-in">
      <div :key="viewInstanceKey" class="flex flex-1 flex-col min-h-0 min-w-0">
      <HomeHeaderPanel
        :localViewMode="localViewMode"
        :isBatchMode="isBatchMode"
        :isManagementMode="isManagementMode"
        :activeRootPath="activeRootPath"
        :selectedCount="selectedCount"
        :folderTree="folderTree"
        :currentFolderFilter="currentFolderFilter"
        :playlistDetail="playlistDetail"
        :localSongList="localSongList"
        :localSongPaths="localSongPaths"
        :scrollContainerRef="scrollContainerRef"
        @update:isBatchMode="$emit('update:isBatchMode', $event)"
        @update:isManagementMode="$emit('update:isManagementMode', $event)"
        @playAll="$emit('playAll')"
        @batchPlay="$emit('batchPlay')"
        @showAddToPlaylist="$emit('showAddToPlaylist')"
        @rootCreatePlaylist="(path, name) => $emit('rootCreatePlaylist', path, name)"
        @batchDelete="$emit('batchDelete')"
        @folderBatchDelete="$emit('folderBatchDelete')"
        @batchMove="$emit('batchMove')"
        @batchDownload="$emit('batchDownload')"
        @addFolder="$emit('addFolder')"
        @refreshFolder="$emit('refreshFolder')"
        @removeFolder="(path, name) => $emit('removeFolder', path, name)"
        @rootCreateFolder="(path) => $emit('rootCreateFolder', path)"
        @rootDeleteFolder="(path) => $emit('rootDeleteFolder', path)"
        @activeRootChange="$emit('activeRootChange', $event)"
        @renamePlaylist="$emit('renamePlaylist')"
        @refreshAll="$emit('refreshAll')"
        @selectAll="$emit('selectAll')"
        @batchAddToFavorites="$emit('batchAddToFavorites')"
      />

      <HomeContentPanel
        :localViewMode="localViewMode"
        :isBatchMode="isBatchMode"
        :isManagementMode="isManagementMode"
        :artistActiveTab="artistActiveTab"
        :localFilterCondition="localFilterCondition"
        :songTableMemoryScopeKey="songTableMemoryScopeKey"
        :localSongList="localSongList"
        :localSongPaths="localSongPaths"
        :resolveSongByPath="resolveSongByPath"
        :selectedCount="selectedCount"
        :selectedAlbumSong="selectedAlbumSong"
        :artistAlbumList="artistAlbumList"
        :coverCache="coverCache"
        :loadingSet="loadingSet"
        :selectedPaths="selectedPaths"
        :setSongTableRef="setSongTableRef"
        :scrollContainerRef="scrollContainerRef"
        @update:isBatchMode="$emit('update:isBatchMode', $event)"
        @update:artistActiveTab="$emit('update:artistActiveTab', $event)"
        @update:selectedPaths="$emit('update:selectedPaths', $event)"
        @playAll="$emit('playAll')"
        @batchPlay="$emit('batchPlay')"
        @showAddToPlaylist="$emit('showAddToPlaylist')"
        @batchDelete="$emit('batchDelete')"
        @batchMove="$emit('batchMove')"
        @playSong="$emit('playSong', $event)"
        @contextMenuSong="handleContentContextMenu"
        @tableDragStart="handleTableDragStart"
        @artistAlbumClick="$emit('artistAlbumClick', $event)"
      />
      </div>
    </Transition>
    </div>
</template>

<style scoped>
.home-view-switch-enter-active {
  transition:
    opacity 260ms ease,
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.home-view-switch-leave-active {
  transition:
    opacity 220ms ease,
    transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
}

.home-view-switch-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.home-view-switch-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
