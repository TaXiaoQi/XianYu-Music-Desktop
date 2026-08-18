<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Song } from '../../types';
import { useSettings } from '../../features/settings/useSettings';
import { launchFlyingCover } from '../../composables/useFlyingCover';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { getDisplayCoverUrl } from '../../utils/coverProxy';
import { pluginApi } from '../../services/tauri/pluginApi';

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

/** 封面显示 URL 缓存（原始 URL → 代理后的 data: URL） */
const coverDisplayMap = ref(new Map<string, string>());
const coverAttempted = new Set<string>();

/** 返回可直接用于 <img> 的封面 URL：需要代理的域名走后端代理，代理完成后自动刷新回 data: URL */
const getCover = (item: Song): string => {
  const url = item.cover_thumb_path || '';
  if (!url || url.startsWith('data:')) return url;
  const cached = coverDisplayMap.value.get(url);
  if (cached) return cached;
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
  // 原始 URL（非 data:）加载失败 → 走后端代理回退，避免网易云等防盗链封面白屏
  if (src && !src.startsWith('data:') && !coverAttempted.has(src)) {
    coverAttempted.add(src);
    (async () => {
      try {
        const dataUrl = await pluginApi.proxyImage(src);
        coverDisplayMap.value = new Map(coverDisplayMap.value).set(src, dataUrl);
      } catch { /* ignore */ }
    })();
  }
};

/** 点击/双击播放：触发飞入封面动画并立即 emit 播放 */
const handlePlayClick = (song: Song) => {
  if (currentSong.value?.path === song.path && isPlaying.value) {
    return;
  }

  void launchFlyingCover(song.path, song.cover_thumb_path || '');
  emit('play', song);
};

// --- 渐进式渲染 ---
// 在线搜索/专辑歌曲列表可能包含上百首歌曲，全量渲染会产生大量 DOM 节点。
// 使用初始渲染上限 + IntersectionObserver 哨兵检测，滚动到底部时自动加载更多。
// 首批数量按屏幕高度估算，只挂载一屏左右的 DOM，避免在线歌单过大时切换页面卡顿。
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

// 哨兵元素 ref
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

// songs 变化时重置渲染上限（切换专辑/歌手/tab 时）
// immediate: true 确保组件创建时立即设置正确的 renderLimit，避免首次渲染空白
watch(() => props.songs, () => {
  renderLimit.value = Math.min(props.songs.length, getInitialRenderLimit());
}, { immediate: true });

// 额外安全网：当 songs 数组长度变化但引用未变时（原地修改），也重置渲染上限
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
    <!-- 渐进式渲染哨兵：滚动到此处时自动加载下一批 -->
    <div ref="sentinelRef" class="h-1 w-full" aria-hidden="true"></div>
  </div>
</template>
