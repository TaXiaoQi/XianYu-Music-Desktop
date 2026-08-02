<script setup lang="ts">
import { watch } from 'vue';

import { useCoverCache } from '../../composables/useCoverCache';

export interface RecentCollectionGridItem {
  id: string;
  title: string;
  subtitle: string;
  firstSongPath: string;
  playedAt: number;
}

const props = defineProps<{
  items: RecentCollectionGridItem[];
  emptyMessage: string;
}>();

defineEmits<{
  (event: 'open', id: string): void;
}>();

const { coverCache, loadingSet, preloadPriorityCovers } = useCoverCache();

watch(
  () => props.items.map(item => item.firstSongPath).filter(Boolean),
  paths => preloadPriorityCovers(paths),
  { immediate: true },
);

const formatPlayedAt = (timestamp: number) => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}).format(new Date(timestamp));
</script>

<template>
  <section class="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
    <div
      v-if="items.length > 0"
      class="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7"
    >
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="group min-w-0 rounded-xl p-2 text-left transition hover:bg-white/45 dark:hover:bg-white/5"
        @click="$emit('open', item.id)"
      >
        <div class="relative aspect-square overflow-hidden rounded-lg border border-black/5 bg-gradient-to-br from-gray-100 to-gray-200 shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-lg dark:border-white/10 dark:from-white/5 dark:to-white/10">
          <img
            v-if="coverCache.get(item.firstSongPath)"
            :src="coverCache.get(item.firstSongPath)"
            :alt="item.title"
            class="h-full w-full object-cover"
          />
          <div
            v-else
            class="flex h-full w-full items-center justify-center text-4xl font-semibold text-gray-300 dark:text-gray-600"
            :class="{ 'animate-pulse': loadingSet.has(item.firstSongPath) }"
          >
            {{ item.title.slice(0, 1).toUpperCase() || '♪' }}
          </div>
        </div>
        <h3 class="mt-3 truncate text-sm font-semibold text-gray-800 transition-colors group-hover:text-[#EC4141] dark:text-gray-200">
          {{ item.title }}
        </h3>
        <p class="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{{ item.subtitle }}</p>
        <p class="mt-1 truncate text-[11px] text-gray-400 dark:text-white/30">最近播放 {{ formatPlayedAt(item.playedAt) }}</p>
      </button>
    </div>

    <div v-else class="flex h-full min-h-64 items-center justify-center text-sm text-gray-400 dark:text-white/35">
      {{ emptyMessage }}
    </div>
  </section>
</template>
