<script setup lang="ts">
import { computed } from 'vue';
import type { FolderNode, Song } from '../../types';
// 首页关键路径必须静态加载（禁用 defineAsyncComponent）：
// 正式构建下每个懒加载 chunk 都要经 tauri.localhost 协议真实加载，若 SongTable
// 在 page-fade/home-view-switch 的 out-in 过渡进行中"迟到挂载"，会与取消/重挂
// 中的路由树共享对 SongTable 虚拟列表 :key="song.path" 行节点的 patch 管理，
// 卸载时读到已脱离的 el.parentNode 为 null 而崩溃（dev 下 Vite 内存加载几乎
// 瞬时，整条链在同一过渡内同步完成，故从未复现——这正是"正式崩、dev 不崩"）。
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
      case 'dailyRecommend':
      case 'topLists':
        // 发现区三种 TAB 共用同一容器（KeepAlive 缓存各自滚动记忆，无需参与 key）
        return 'discover';
      default:
        return 'all';
    }
  })(),
);

// 主页内的详情容器（歌单/歌手/专辑/文件夹等）按 key 销毁重建。
// 歌单切换时旧 SongTable 会完整卸载，新歌单再重新挂载，避免旧页面状态和缓存残留。
// 发现区三种 TAB（统计/每日推荐/音源榜单）是同一容器内切换，统一用固定 key：
// 避免切 TAB 时整个面板（含 TAB 栏与 KeepAlive 缓存）被销毁重建导致"整页刷新"。
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
    <!-- 视图切换（viewInstanceKey 变化）按 key 销毁重建整棵内容（含 SongTable 虚拟列表），
         但不能再包 <transition mode="out-in">：out-in 会持有旧的虚拟列表 Fragment，
         其 enter/leave 临时重排期间若异步加载/扫描继续把行 patch 成 el=null，
         patchKeyedChildren 卸载时读 parentNode 为 null 而崩溃（正式构建时序触发，dev 不触发）。
         保留 key 重挂（达到"销毁重建、不残留旧状态"的意图），过渡交给纯 CSS 入场动画：
         CSS 动画只改合成属性，不参与 Vue 的 DOM 重排，天然不会把 el 置 null。 -->
      <div :key="viewInstanceKey" class="home-view-switch-host flex flex-1 flex-col min-h-0 min-w-0">
      <HomeHeaderPanel
        class="relative z-20"
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
