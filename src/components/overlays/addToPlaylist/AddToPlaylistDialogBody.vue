<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import ModernInputModal from '../../common/ModernInputModal.vue';
import { useCoverCache } from '../../../composables/useCoverCache';
import { useLibraryCollections } from '../../../features/collections/useLibraryCollections';
import { useLibraryStore } from '../../../features/library/store';
import type { Playlist } from '../../../types';

const props = defineProps<{
  visible: boolean;
  excludedPlaylistId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'add', playlistId: string): void;
}>();

const { playlists, createPlaylist } = useLibraryCollections();
const libraryStore = useLibraryStore();
const { loadCover } = useCoverCache();

/** 在列表里展示的歌单（可按来源歌单 id 排除自身）。 */
const listablePlaylists = computed(() =>
  playlists.value.filter(playlist => playlist.id !== props.excludedPlaylistId),
);

/* —— 首歌封面懒加载缓存 —— */

const coverUrlTable = ref<Map<string, string>>(new Map());
let evictionTimer: number | null = null;
const COVER_CACHE_TTL_MS = 15000;

const clearCoverTable = () => {
  coverUrlTable.value.clear();
};

const cancelEvictionTimer = () => {
  if (evictionTimer !== null) {
    window.clearTimeout(evictionTimer);
    evictionTimer = null;
  }
};

// 弹窗关闭后延迟清空封面缓存，避免频繁开关时反复加载。
const scheduleEviction = () => {
  cancelEvictionTimer();
  evictionTimer = window.setTimeout(() => {
    clearCoverTable();
    evictionTimer = null;
  }, COVER_CACHE_TTL_MS);
};

/** 本地绝对路径转可访问 URL；http/asset:/data: 前缀的原样返回。 */
const toUsableUrl = (rawPath: string): string => {
  if (rawPath.startsWith('http') || rawPath.startsWith('asset:') || rawPath.startsWith('data:')) {
    return rawPath;
  }
  try {
    return convertFileSrc(rawPath);
  } catch {
    return '';
  }
};

/** 歌单封面解析：本地封面 → 云端封面 → 首首歌的缩略图。 */
const resolvePlaylistCover = (playlist: Playlist): string => {
  if (playlist.coverPath) {
    return toUsableUrl(playlist.coverPath);
  }
  if (playlist.cloudCoverUrl && /^https?:\/\//i.test(playlist.cloudCoverUrl)) {
    return playlist.cloudCoverUrl;
  }
  if (playlist.songPaths.length > 0) {
    const firstSong = libraryStore.songLookup.get(playlist.songPaths[0]);
    const thumbPath = firstSong?.cover_thumb_path;
    if (thumbPath) {
      return toUsableUrl(thumbPath);
    }
  }
  return '';
};

/** 通过封面缓存服务异步加载首首歌的封面。 */
const fetchFirstSongCover = async (playlistId: string, songPath: string) => {
  if (!songPath || coverUrlTable.value.has(playlistId)) return;
  try {
    const coverUrl = await loadCover(songPath);
    if (coverUrl && props.visible) {
      coverUrlTable.value.set(playlistId, coverUrl);
    }
  } catch { /* 封面加载失败不阻塞弹窗 */ }
};

watch(() => props.visible, (isShown) => {
  if (isShown) {
    cancelEvictionTimer();
    listablePlaylists.value.forEach((playlist) => {
      if (resolvePlaylistCover(playlist) !== '') return;
      if (playlist.songPaths.length > 0) {
        void fetchFirstSongCover(playlist.id, playlist.songPaths[0]);
      }
    });
    return;
  }

  scheduleEviction();
});

onUnmounted(() => {
  cancelEvictionTimer();
  clearCoverTable();
});

/* —— 新建歌单 —— */

const isNamingNewPlaylist = ref(false);

const openNamingModal = () => {
  isNamingNewPlaylist.value = true;
};

const handleConfirmCreate = (name: string) => {
  if (!name) return;
  const playlistId = createPlaylist(name);
  if (playlistId) {
    emit('add', playlistId);
  }
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-pop">
      <div v-if="visible" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm" @click.self="emit('close')">
        <div class="modal-content bg-white/80 dark:bg-gray-900/90 rounded-xl shadow-2xl w-80 overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
            <h3 class="font-bold text-gray-800 text-sm">收藏到歌单</h3>
            <button @click="emit('close')" class="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div class="max-h-80 overflow-y-auto custom-scrollbar p-2">
            <div @click="openNamingModal" class="flex items-center p-2 rounded-lg hover:bg-gray-50 cursor-pointer mb-1 group">
              <div class="w-10 h-10 bg-gray-100 rounded flex items-center justify-center mr-3 group-hover:bg-gray-200 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
              </div>
              <span class="text-sm text-gray-600">创建新歌单</span>
            </div>
            <div
              v-for="pl in listablePlaylists"
              :key="pl.id"
              @click="emit('add', pl.id)"
              class="flex items-center p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
            >
              <div class="w-10 h-10 bg-gray-100 rounded flex items-center justify-center mr-3 overflow-hidden border border-gray-100">
                <img
                  v-if="resolvePlaylistCover(pl) || coverUrlTable.get(pl.id)"
                  :src="resolvePlaylistCover(pl) || coverUrlTable.get(pl.id)"
                  class="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                >
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm text-gray-800 truncate">{{ pl.name }}</div>
                <div class="text-xs text-gray-400">{{ pl.songPaths.length }}首</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <ModernInputModal
      v-model:visible="isNamingNewPlaylist"
      title="创建并添加到歌单"
      placeholder="请输入歌单名称"
      confirm-text="创建"
      @confirm="handleConfirmCreate"
    />
  </Teleport>
</template>
