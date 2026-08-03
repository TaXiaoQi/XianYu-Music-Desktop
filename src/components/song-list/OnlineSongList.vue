<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Song } from '../../types';
import { useSettings } from '../../features/settings/useSettings';
import { launchFlyingCover } from '../../composables/useFlyingCover';

const { settings } = useSettings();
const songClickAction = computed(() => settings.value.songClickAction || 'double');

const props = defineProps<{
  songs: Song[];
}>();

const emit = defineEmits<{
  (e: 'play', song: Song): void;
  (e: 'contextmenu', event: MouseEvent, song: Song): void;
}>();

const formatDuration = (seconds: number): string => {
  if (!seconds || seconds <= 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const handleImgError = (e: Event) => {
  (e.target as HTMLImageElement).style.display = 'none';
};

/** 点击/双击播放：触发飞入封面动画并立即 emit 播放 */
const handlePlayClick = (song: Song) => {
  launchFlyingCover(song.path, song.cover_thumb_path || '');
  emit('play', song);
};

// --- 渐进式渲染 ---
// 在线搜索/专辑歌曲列表可能包含上百首歌曲，全量渲染会产生大量 DOM 节点。
// 使用初始渲染上限 + IntersectionObserver 哨兵检测，滚动到底部时自动加载更多，
// 将初始 DOM 节点从 N 降至 min(N, 50)，滚动时按 50 条递增。
const INITIAL_RENDER_LIMIT = 50;
const RENDER_BATCH_SIZE = 50;
const renderLimit = ref(INITIAL_RENDER_LIMIT);

const visibleSongs = computed(() => props.songs.slice(0, renderLimit.value));
const hasMore = computed(() => renderLimit.value < props.songs.length);

// 哨兵元素 ref
const sentinelRef = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

const onSentinelIntersect: IntersectionObserverCallback = (entries) => {
  if (entries[0]?.isIntersecting && hasMore.value) {
    renderLimit.value = Math.min(
      renderLimit.value + RENDER_BATCH_SIZE,
      props.songs.length
    );
  }
};

// 监听哨兵元素，使用 IntersectionObserver 检测滚动到底部
watch(sentinelRef, (el, _oldEl, onCleanup) => {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (!el) return;

  observer = new IntersectionObserver(onSentinelIntersect, {
    root: null, // 使用最近的可滚动祖先
    rootMargin: '200px', // 提前 200px 触发加载
    threshold: 0,
  });
  observer.observe(el);

  onCleanup(() => {
    observer?.disconnect();
    observer = null;
  });
});

// songs 变化时重置渲染上限（切换专辑/歌手时）
watch(() => props.songs, () => {
  renderLimit.value = INITIAL_RENDER_LIMIT;
});

onBeforeUnmount(() => {
  observer?.disconnect();
});
</script>

<template>
  <table class="w-full text-left">
    <tbody>
      <tr
        v-for="(item, index) in visibleSongs"
        :key="`${item.path}-${index}`"
        class="group border-b border-black/5 dark:border-white/5 cursor-default select-none transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        @click="songClickAction === 'single' && handlePlayClick(item)"
        @dblclick="songClickAction !== 'single' && handlePlayClick(item)"
        @contextmenu="emit('contextmenu', $event, item)"
      >
        <td class="py-2 px-4 text-center text-xs text-black/40 dark:text-white/40">
          {{ index + 1 }}
        </td>
        <td class="py-2 px-2">
          <div class="w-11 h-11 rounded-lg bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-lg font-black shrink-0" :data-cover-path="item.path">
            <img
              v-if="item.cover_thumb_path"
              :src="item.cover_thumb_path"
              class="w-full h-full object-cover"
              alt=""
              loading="lazy"
              @error="handleImgError"
            />
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
        </td>
        <td class="py-2 px-2 text-sm text-black dark:text-white font-medium truncate max-w-[200px]">
          {{ item.title || item.name }}
        </td>
        <td class="py-2 px-2 text-sm text-black/60 dark:text-white/60 truncate max-w-[150px]">
          {{ item.artist }}
        </td>
        <td class="py-2 px-2 text-sm text-black/40 dark:text-white/40 truncate max-w-[150px]">
          {{ item.album }}
        </td>
        <td class="py-2 px-4 text-xs text-black/40 dark:text-white/40 text-right whitespace-nowrap">
          {{ formatDuration(item.duration) }}
        </td>
      </tr>
    </tbody>
  </table>
  <!-- 渐进式渲染哨兵：滚动到此处时自动加载下一批 -->
  <div ref="sentinelRef" class="h-1 w-full" aria-hidden="true"></div>
</template>
