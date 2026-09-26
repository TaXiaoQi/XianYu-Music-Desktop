<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';

import type { FolderNode, Song } from '../../types';
import { useI18n } from '../../features/i18n';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import { useLibraryStore } from '../../features/library/store';
import { useToast } from '../../composables/toast';
import { cacheLxSong } from '../../services/domain/lxSongCache';
import {
  diffPlaylistWithSource,
  hasPlaylistSource,
} from '../../services/domain/playlistSourceUpdate';
import {
  buildLocalPlaylistCollectionKey,
  type FavoriteCollectionEntry,
} from '../../features/collections/store';

const { isEnglish } = useI18n();
const { filterCondition } = usePlayerViewState();
const { playlists, applySourceSync } = useLibraryCollections();
const libraryStore = useLibraryStore();
const { showToast } = useToast();

const DetailHeader = defineAsyncComponent(() => import('../headers/DetailHeader.vue'));
const FoldersHeader = defineAsyncComponent(() => import('../headers/FoldersHeader.vue'));
const LocalMusicHeader = defineAsyncComponent(() => import('../headers/LocalMusicHeader.vue'));
const PlaylistSourceSyncModal = defineAsyncComponent(() => import('../overlays/PlaylistSourceSyncModal.vue'));

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
  scrollContainerRef?: HTMLElement | null;
}

const props = defineProps<Props>();

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

// ==================== 从源端更新导入的歌单 ====================

const sourcePlaylist = computed(() => {
  if (props.localViewMode !== 'playlist') return null;
  const playlist = playlists.value.find(p => p.id === filterCondition.value);
  return hasPlaylistSource(playlist) ? playlist : null;
});

const updatingSource = ref(false);
const showSourceSyncModal = ref(false);
const modalAddCount = ref(0);
const modalRemoveCount = ref(0);
let modalResolve: ((choice: 'add' | 'full' | null) => void) | null = null;

const requestSyncMode = (addCount: number, removeCount: number) =>
  new Promise<'add' | 'full' | null>((resolve) => {
    modalAddCount.value = addCount;
    modalRemoveCount.value = removeCount;
    modalResolve = resolve;
    showSourceSyncModal.value = true;
  });

const handleSourceSyncChoice = (choice: 'add' | 'full') => {
  showSourceSyncModal.value = false;
  modalResolve?.(choice);
  modalResolve = null;
};

const handleSourceSyncCancel = () => {
  showSourceSyncModal.value = false;
  modalResolve?.(null);
  modalResolve = null;
};

const cacheNewLxSong = (song: Song) => {
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
};

const handleUpdateFromSource = async () => {
  const playlist = sourcePlaylist.value;
  if (!playlist || updatingSource.value) return;
  updatingSource.value = true;
  try {
    const { sourceSongs, addCount, removeCount } = await diffPlaylistWithSource(playlist);
    if (sourceSongs.length === 0) {
      showToast('源端歌单为空或获取失败', 'error');
      return;
    }
    if (addCount === 0 && removeCount === 0) {
      showToast('已是最新，与源端一致', 'info');
      return;
    }

    let fullSync = false;
    if (removeCount > 0) {
      const choice = await requestSyncMode(addCount, removeCount);
      if (!choice) return;
      fullSync = choice === 'full';
    }

    const beforePaths = new Set(playlist.songPaths);
    const { added, removed } = applySourceSync(playlist.id, sourceSongs, fullSync);
    for (const song of sourceSongs) {
      if (!beforePaths.has(song.path)) {
        libraryStore.setExtraSong(song);
        cacheNewLxSong(song);
      }
    }

    if (added === 0 && removed === 0) {
      showToast('已是最新，与源端一致', 'info');
    } else {
      showToast(
        fullSync ? `已完全同步：新增 ${added} 首，移除 ${removed} 首` : `已新增 ${added} 首歌曲`,
        'success',
      );
    }
  } catch (e) {
    showToast(`更新失败：${e instanceof Error ? e.message : e}`, 'error');
  } finally {
    updatingSource.value = false;
  }
};
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
    :showSourceUpdate="!!sourcePlaylist"
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
    @updateFromSource="handleUpdateFromSource"
  />

  <LocalMusicHeader
    v-else-if="!['statistics', 'leaderboard', 'artist', 'album', 'dailyRecommend', 'topLists'].includes(localViewMode)"
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

  <PlaylistSourceSyncModal
    :visible="showSourceSyncModal"
    :addCount="modalAddCount"
    :removeCount="modalRemoveCount"
    @choice="handleSourceSyncChoice"
    @cancel="handleSourceSyncCancel"
  />
</template>
