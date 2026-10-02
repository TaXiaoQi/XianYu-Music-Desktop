<script setup lang="ts"> // 实现
import { computed, defineAsyncComponent, ref } from 'vue';

import type { FolderNode, Song } from '../../types'; // 实现
import { useI18n } from '../../features/i18n'; // 实现
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

const { isEnglish } = useI18n(); // 实现
const { filterCondition } = usePlayerViewState();
const { playlists, applySourceSync } = useLibraryCollections();
const libraryStore = useLibraryStore();
const { showToast } = useToast();

const DetailHeader = defineAsyncComponent(() => import('../headers/DetailHeader.vue'));
const FoldersHeader = defineAsyncComponent(() => import('../headers/FoldersHeader.vue'));
const LocalMusicHeader = defineAsyncComponent(() => import('../headers/LocalMusicHeader.vue'));
const PlaylistSourceSyncModal = defineAsyncComponent(() => import('../overlays/PlaylistSourceSyncModal.vue'));

interface PlaylistDetail { // 实现
  name: string; // 实现
  date: string; // 实现
}

interface Props { // 实现
  localViewMode: string; // 实现
  isBatchMode: boolean; // 实现
  isManagementMode: boolean; // 实现
  activeRootPath: string; // 实现
  selectedCount: number; // 实现
  folderTree: FolderNode[]; // 实现
  currentFolderFilter: string; // 实现
  playlistDetail: PlaylistDetail | null; // 实现
  localSongList: Song[]; // 实现
  localSongPaths?: string[];
  scrollContainerRef?: HTMLElement | null;
}

const props = defineProps<Props>(); // 实现

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

const emit = defineEmits<{ // 实现
  (event: 'update:isBatchMode', value: boolean): void; // 实现
  (event: 'update:isManagementMode', value: boolean): void; // 实现
  (event: 'playAll'): void; // 实现
  (event: 'batchPlay'): void; // 实现
  (event: 'showAddToPlaylist'): void; // 实现
  (event: 'batchDelete'): void; // 实现
  (event: 'folderBatchDelete'): void; // 实现
  (event: 'batchMove'): void; // 实现
  (event: 'batchDownload'): void;
  (event: 'rootCreatePlaylist', path: string, name: string): void; // 实现
  (event: 'addFolder'): void; // 实现
  (event: 'refreshFolder'): void; // 实现
  (event: 'removeFolder', path: string, name?: string): void; // 实现
  (event: 'rootCreateFolder', path: string): void; // 实现
  (event: 'rootDeleteFolder', path: string): void; // 实现
  (event: 'activeRootChange', value: string): void; // 实现
  (event: 'renamePlaylist'): void; // 实现
  (event: 'refreshAll'): void; // 实现
  (event: 'selectAll'): void;
  (event: 'batchAddToFavorites'): void;
}>();

const isBatchModeModel = computed({ // 实现
  get: () => props.isBatchMode, // 实现
  set: (value: boolean) => emit('update:isBatchMode', value), // 实现
});

const isManagementModeModel = computed({ // 实现
  get: () => props.isManagementMode, // 实现
  set: (value: boolean) => emit('update:isManagementMode', value), // 实现
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
