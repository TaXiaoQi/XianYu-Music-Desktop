<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Song } from '../../types';
import { useSettings } from '../../features/settings/useSettings';
import { launchFlyingCover } from '../../composables/useFlyingCover';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { getDisplayCoverUrl, tryProxyImage } from '../../utils/coverProxy';

const { settings } = useSettings();
const { currentSong, isPlaying } = usePlaybackController();
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

const coverDisplayMap = ref(new Map<string, string>());

const getCover = (item: Song): string => {
  const url = item.cover_thumb_path || '';
  if (!url || url.startsWith('data:')) return url;
  const cached = coverDisplayMap.value.get(url);
  if (cached !== undefined) return cached;
  const display = getDisplayCoverUrl(url, (dataUrl) => {
    coverDisplayMap.value = new Map(coverDisplayMap.value).set(url, dataUrl);
  });
  if (display !== url) {
    coverDisplayMap.value = new Map(coverDisplayMap.value).set(url, display);
  }
  return display;
};

const handleImgError = (e: Event) => {
  const img = e.target as HTMLImageElement;
  const src = img.src;
  if (!src || src.startsWith('data:')) return;
  (async () => {
    const dataUrl = await tryProxyImage(src);
    if (dataUrl) {
      coverDisplayMap.value = new Map(coverDisplayMap.value).set(src, dataUrl);
    }
  })();
};

const handlePlayClick = (song: Song) => {
  if (currentSong.value?.path === song.path && isPlaying.value) {
    return;
  }

  void launchFlyingCover(song.path, song.cover_thumb_path || '');
  emit('play', song);
};

// --- 渐进式渲染 ---
const ROW_HEIGHT = 61;
const RENDER_BUFFER_ROWS = 4;
const MIN_RENDER_BATCH_SIZE = 20;
const getInitialRenderLimit = () => Math.max(
  1,
  Math.ceil(window.innerHeight / ROW_HEIGHT) + RENDER_BUFFER_ROWS,
);
const getRenderBatchSize = () => Math.max(MIN_RENDER_BATCH_SIZE, getInitialRenderLimit());
const renderLimit = ref(getInitialRenderLimit());

const visibleSongs = computed(() => props.songs.slice(0, renderLimit.value));
const hasMore = computed(() => renderLimit.value < props.songs.length);

const sentinelRef = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

const onSentinelIntersect: IntersectionObserverCallback = (entries) => {
  if (entries[0]?.isIntersecting && hasMore.value) {
    renderLimit.value = Math.min(
      renderLimit.value + getRenderBatchSize(),
      props.songs.length
    );
  }
};

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

watch(() => props.songs, () => {
  renderLimit.value = Math.min(props.songs.length, getInitialRenderLimit());
}, { immediate: true });

watch(() => props.songs.length, () => {
  renderLimit.value = Math.min(props.songs.length, getInitialRenderLimit());
});

onBeforeUnmount(() => {
  observer?.disconnect();
});
</script>

<template>
  <div class="online-song-list-root">
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
                v-if="getCover(item)"
                :src="getCover(item)"
                class="w-full h-full object-cover"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
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
    <div ref="sentinelRef" class="h-1 w-full" aria-hidden="true"></div>
  </div>
</template>
