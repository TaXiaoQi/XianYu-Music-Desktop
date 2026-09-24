<script setup lang="ts">
import { computed } from 'vue';
import type { FolderNode, Song } from '../../types';
import HomeContentPanel from './HomeContentPanel.vue';
import HomeHeaderPanel from './HomeHeaderPanel.vue';

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
      case 'dailyRecommend':
      case 'topLists':
        return 'discover';
      default:
        return 'all';
    }
  })(),
);

const viewInstanceKey = computed(() => {
  const mode = props.localViewMode;
  const discoverModes = ['statistics', 'dailyRecommend', 'topLists'];
  return [
    discoverModes.includes(mode) ? 'discover' : mode,
    props.localFilterCondition || '',
    props.currentFolderFilter || '',
    props.activeRootPath || '',
    props.artistActiveTab || '',
  ].join('::');
});
</script>

<template>
  <div class="flex flex-1 flex-col min-h-0 min-w-0">
      <div :key="viewInstanceKey" class="home-view-switch-host flex flex-1 flex-col min-h-0 min-w-0">
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
    </div>
</template>

<style scoped>
.home-view-switch-host {
  animation: home-view-switch-in 260ms ease;
}

@keyframes home-view-switch-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
