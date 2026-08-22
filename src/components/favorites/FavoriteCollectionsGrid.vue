<script setup lang="ts">
import { ref } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';

import type { FavoriteCollectionEntry } from '../../features/collections/store';
import { useCollectionsStore } from '../../features/collections/store';
import { getDisplayCoverUrl } from '../../utils/coverProxy';

defineProps<{
  items: FavoriteCollectionEntry[];
  emptyMessage: string;
}>();

defineEmits<{
  (event: 'open', entry: FavoriteCollectionEntry): void;
  (event: 'remove', entry: FavoriteCollectionEntry): void;
}>();

const collectionsStore = useCollectionsStore();

/** 本地歌单封面实时解析：歌单自定义封面/歌单内在线歌曲封面，随歌单更新保持新鲜 */
const getLocalPlaylistCover = (entry: FavoriteCollectionEntry): string => {
  if (!entry.localPlaylistId) return '';
  const playlist = collectionsStore.getPlaylistById(entry.localPlaylistId);
  if (!playlist) return '';
  if (playlist.coverPath) {
    return convertFileSrc(playlist.coverPath);
  }
  return playlist.songs?.find(song => song.cover_thumb_path)?.cover_thumb_path || '';
};

// 网格封面显示 URL：B站等防盗链封面直连 403，须经后端代理转 data:URL，代理完成回填刷新
const coverDisplayMap = ref(new Map<string, string>());
const getEntryCover = (entry: FavoriteCollectionEntry) => {
  const url = entry.coverUrl || getLocalPlaylistCover(entry);
  if (!url) return '';
  const cached = coverDisplayMap.value.get(url);
  if (cached) return cached;
  return getDisplayCoverUrl(url, (dataUrl) => {
    coverDisplayMap.value = new Map(coverDisplayMap.value).set(url, dataUrl);
  });
};

const formatFavoritedAt = (timestamp: number) => new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(timestamp));
</script>

<template>
  <section class="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
    <div
      v-if="items.length > 0"
      class="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7"
    >
      <div
        v-for="entry in items"
        :key="entry.key"
        class="group relative"
      >
        <button
          type="button"
          class="w-full min-w-0 rounded-xl p-2 text-left transition hover:bg-white/45 dark:hover:bg-white/5"
          @click="$emit('open', entry)"
        >
          <div class="relative aspect-square overflow-hidden rounded-lg border border-black/5 bg-gradient-to-br from-gray-100 to-gray-200 shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-lg dark:border-white/10 dark:from-white/5 dark:to-white/10">
            <img
              v-if="getEntryCover(entry)"
              :src="getEntryCover(entry)"
              :alt="entry.title"
              class="h-full w-full object-cover"
              loading="lazy"
            />
            <div
              v-else
              class="flex h-full w-full items-center justify-center text-4xl font-semibold text-gray-300 dark:text-gray-600"
            >
              {{ entry.title.slice(0, 1).toUpperCase() || '♪' }}
            </div>
          </div>
          <h3 class="mt-3 truncate text-sm font-semibold text-gray-800 transition-colors group-hover:text-[color:var(--favorite-color)] dark:text-gray-200">
            {{ entry.title }}
          </h3>
          <p class="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{{ entry.subtitle }}</p>
          <p class="mt-1 truncate text-[11px] text-gray-400 dark:text-white/30">收藏于 {{ formatFavoritedAt(entry.favoritedAt) }}</p>
        </button>

        <!-- 悬停显示的取消收藏按钮 -->
        <button
          type="button"
          class="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-sm transition hover:bg-[color:var(--favorite-color)] active:scale-90 group-hover:opacity-100"
          :title="entry.type === 'playlist' ? '取消收藏歌单' : '取消收藏专辑'"
          @click.stop="$emit('remove', entry)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path fill-rule="evenodd" d="M11.823 4.212a4.866 4.866 0 016.882 6.866l-6.882 6.883a.85.85 0 01-1.202 0L3.74 11.08a4.866 4.866 0 116.866-6.882l.607.606.609-.592z" clip-rule="evenodd" />
          </svg>
        </button>
      </div>
    </div>

    <div v-else class="flex h-full min-h-64 items-center justify-center text-sm text-gray-400 dark:text-white/35">
      {{ emptyMessage }}
    </div>
  </section>
</template>
