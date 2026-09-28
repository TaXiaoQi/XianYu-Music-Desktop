<script setup lang="ts">
import { Heart } from 'lucide-vue-next';

import type { FavoriteCollectionEntry } from '../../../features/collections/store';
import { getDisplayCoverUrl } from '../../../utils/coverProxy';

interface Props {
  collections: FavoriteCollectionEntry[];
  expanded: boolean;
  /** 本地歌单封面解析器（由父级注入，含缓存版本联动） */
  resolvePlaylistCover: (playlistId: string) => string | undefined;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (event: 'update:expanded', value: boolean): void;
  (event: 'itemClick', entry: FavoriteCollectionEntry): void;
  (event: 'itemRemove', key: string): void;
}>();

const toggleExpanded = () => emit('update:expanded', !props.expanded);

// 封面优先级：本地歌单封面 > 条目自带远程封面 > 占位
const entryCover = (entry: FavoriteCollectionEntry): string => {
  if (entry.localPlaylistId) {
    const localCover = props.resolvePlaylistCover(entry.localPlaylistId);
    if (localCover) {
      return localCover;
    }
  }
  if (entry.coverUrl) {
    return getDisplayCoverUrl(entry.coverUrl, () => {});
  }
  return '';
};
</script>

<template>
  <div class="mt-5">
    <div class="group px-4 pr-3 py-2 flex items-center justify-between">
      <div
        class="flex items-center gap-1 cursor-pointer text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
        @click.stop="toggleExpanded"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          :class="['h-3 w-3 transition-transform duration-200', expanded ? 'rotate-90' : '']"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
        <span class="text-xs font-bold tracking-wide">收藏的歌单</span>
        <span class="text-xs text-gray-500 dark:text-gray-400 font-normal ml-0.5">{{ collections.length }}</span>
      </div>
    </div>

    <Transition name="playlist-list">
      <ul v-show="expanded" class="space-y-0.5 mt-1 overflow-hidden">
        <TransitionGroup name="playlist-item">
          <li
            v-for="entry in collections"
            :key="entry.key"
            class="px-3 py-2 mx-2 rounded-md cursor-pointer flex items-center transition-all duration-300 group relative select-none hover:bg-black/5 dark:hover:bg-white/5 text-gray-600 dark:text-gray-300 hover:translate-x-1 active:scale-[0.98]"
            @click.stop="emit('itemClick', entry)"
          >
            <div class="w-9 h-9 rounded bg-gray-200/50 border border-gray-100/50 shrink-0 overflow-hidden mr-3 flex items-center justify-center relative group-hover:scale-110 transition-transform duration-300">
              <img
                v-if="entryCover(entry)"
                :src="entryCover(entry)"
                class="w-full h-full object-cover"
                alt="Cover"
                loading="lazy"
                decoding="async"
              />
              <Heart v-else class="h-4 w-4 text-[#EC4141]" fill="currentColor" />
            </div>
            <div class="flex-1 min-w-0 flex flex-col justify-center">
              <span class="text-sm truncate leading-tight mb-0.5 flex items-center gap-1">
                <span class="truncate">{{ entry.title }}</span>
                <span class="text-[10px] text-[#EC4141] shrink-0 font-normal">♥</span>
              </span>
              <span class="text-[10px] text-gray-600 dark:text-gray-300 leading-tight truncate">{{ entry.subtitle }}</span>
            </div>
            <button
              class="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-gray-400 dark:text-white/60 hover:text-red-500 transition-all p-1"
              title="取消收藏歌单"
              @click.stop="emit('itemRemove', entry.key)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </li>
        </TransitionGroup>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
/* 条目进出场 */
.playlist-item-enter-active,
.playlist-item-leave-active { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
.playlist-item-enter-from,
.playlist-item-leave-to { opacity: 0; transform: translateX(-10px); }

/* 分组展开收起 */
.playlist-list-enter-active,
.playlist-list-leave-active { transition: all 0.3s ease-in-out; max-height: 500px; overflow: hidden; }
.playlist-list-enter-from,
.playlist-list-leave-to { max-height: 0; opacity: 0; }
</style>
