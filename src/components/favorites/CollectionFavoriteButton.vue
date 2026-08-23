<script setup lang="ts">
import { computed } from 'vue';

import type { FavoriteCollectionEntry } from '../../features/collections/store';
import { useCollectionsStore } from '../../features/collections/store';
import { useToast } from '../../composables/toast';

const props = defineProps<{
  /** 待收藏的歌单/专辑条目；为 null 时隐藏按钮 */
  entry: FavoriteCollectionEntry | null;
}>();

const collectionsStore = useCollectionsStore();
const { showToast } = useToast();

const isFavorited = computed(() =>
  props.entry ? collectionsStore.isCollectionFavorited(props.entry.key) : false,
);

const favoriteLabel = computed(() =>
  props.entry?.type === 'album' ? '收藏整张专辑' : '收藏整张歌单',
);

const handleToggle = () => {
  if (!props.entry) return;
  const favorited = collectionsStore.toggleFavoriteCollection(props.entry);
  showToast(favorited ? `已${favoriteLabel.value}` : '已取消收藏', favorited ? 'success' : 'info');
};
</script>

<template>
  <button
    v-if="entry"
    @click="handleToggle"
    :title="isFavorited ? '取消收藏' : favoriteLabel"
    class="bg-white/1 hover:bg-white/10 border border-white/1 px-5 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
    :class="isFavorited
      ? 'collection-favorite-btn--active text-[color:var(--favorite-color)]'
      : 'text-gray-900 dark:text-gray-100'"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="h-5 w-5 transition-all duration-300"
      :class="isFavorited ? 'scale-110' : ''"
      :fill="isFavorited ? 'currentColor' : 'none'"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
    </svg>
    {{ isFavorited ? '已收藏' : favoriteLabel }}
  </button>
</template>

<style scoped>
.collection-favorite-btn--active {
  border-color: color-mix(in srgb, var(--favorite-color) 40%, transparent);
}
</style>
