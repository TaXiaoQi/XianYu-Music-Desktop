<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';

import type { FolderNode, Song } from '../../types';
import { useI18n } from '../../features/i18n';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import {
  buildLocalPlaylistCollectionKey,
  type FavoriteCollectionEntry,
} from '../../features/collections/store';

const { isEnglish } = useI18n();
const { filterCondition } = usePlayerViewState();
const { playlists } = useLibraryCollections();

const DetailHeader = defineAsyncComponent(() => import('../headers/DetailHeader.vue'));
const FoldersHeader = defineAsyncComponent(() => import('../headers/FoldersHeader.vue'));
const LocalMusicHeader = defineAsyncComponent(() => import('../headers/LocalMusicHeader.vue'));

interface PlaylistDetail {
  name: string;
  date: string;
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
  /** 歌曲列表滚动容器（用于歌单详情头部滚动缩小封面效果） */
  scrollContainerRef?: HTMLElement | null;
}

const props = defineProps<Props>();

/** 本地歌单详情的"收藏整张"条目（仅歌单详情视图提供） */
const localPlaylistFavoriteEntry = computed<FavoriteCollectionEntry | null>(() => {
  if (props.localViewMode !== 'playlist') return null;
  const playlist = playlists.value.find(p => p.id === filterCondition.value);
  if (!playlist) return null;
  return {
    key: buildLocalPlaylistCollectionKey(playlist.id),
    type: 'playlist',
    title: playlist.name,
    subtitle: `${playlist.songPaths.length} 首歌曲`,
    coverUrl: playlist.cloudCoverUrl || playlist.songs?.find(s => s.cover_thumb_path)?.cover_thumb_path || '',
    favoritedAt: 0,
    localPlaylistId: playlist.id,
  };
});

const emit = defineEmits<{
  (event: 'update:isBatchMode', value: boolean): void;
  (event: 'update:isManagementMode', value: boolean): void;
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
  (event: 'selectAll'): void;
  (event: 'batchAddToFavorites'): void;
}>();

const isBatchModeModel = computed({
  get: () => props.isBatchMode,
  set: (value: boolean) => emit('update:isBatchMode', value),
});

const isManagementModeModel = computed({
  get: () => props.isManagementMode,
  set: (value: boolean) => emit('update:isManagementMode', value),
});
</script>

<template>
  <FoldersHeader
    v-if="localViewMode === 'folder'"
    v-model:isBatchMode="isBatchModeModel"
    :selectedCount="selectedCount"
    :currentFolderFilter="currentFolderFilter"
    @playAll="$emit('playAll')"
    @batchPlay="$emit('batchPlay')"
    @addToPlaylist="$emit('showAddToPlaylist')"
    @batchDelete="$emit('folderBatchDelete')"
    @batchMove="$emit('batchMove')"
    @addFolder="$emit('addFolder')"
    @refreshFolder="$emit('refreshFolder')"
    v-model:isManagementMode="isManagementModeModel"
  />

  <DetailHeader
    v-else-if="localViewMode === 'playlist'"
    v-model:isBatchMode="isBatchModeModel"
    :title="playlistDetail?.name || ''"
    :subtitle="playlistDetail?.date ? `${isEnglish ? 'Created on' : '创建于'} ${playlistDetail.date}` : ''"
    :songs="localSongList"
    :selectedCount="selectedCount"
    :totalSongCount="localSongPaths?.length ?? localSongList.length"
    :showRename="true"
    :showAddToPlaylist="true"
    :showHeaderAddToPlaylist="false"
    :scrollContainerRef="scrollContainerRef"
    :favoriteEntry="localPlaylistFavoriteEntry"
    @playAll="$emit('playAll')"
    @batchPlay="$emit('batchPlay')"
    @openAddToPlaylist="$emit('showAddToPlaylist')"
    @batchDelete="$emit('batchDelete')"
    @batchAddToFavorites="$emit('batchAddToFavorites')"
    @batchDownload="$emit('batchDownload')"
    @rename="$emit('renamePlaylist')"
    @selectAll="$emit('selectAll')"
  />

  <LocalMusicHeader
    v-else-if="!['statistics', 'artist', 'album'].includes(localViewMode)"
    v-model:isBatchMode="isBatchModeModel"
    :selectedCount="selectedCount"
    :totalSongCount="localSongList.length"
    @playAll="$emit('playAll')"
    @selectAll="$emit('selectAll')"
    @addToPlaylist="$emit('showAddToPlaylist')"
    @batchDelete="$emit('batchDelete')"
    @batchMove="$emit('batchMove')"
    @batchDownload="$emit('batchDownload')"
    @refreshAll="$emit('refreshAll')"
  />
</template>
