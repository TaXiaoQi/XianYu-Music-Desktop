<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ArtistCatalogItem, AlbumCatalogItem, Playlist } from '../../types';
import type { CatalogGridEntry } from '../../composables/search/useSearchResults';
import type { SearchTypeKey } from '../../composables/search/useSearchQuery';
import { getDisplayCoverUrl, tryProxyImage } from '../../utils/coverProxy';
import { useLibraryStore } from '../../features/library/store';

const props = defineProps<{
  items: CatalogGridEntry[];
  activeSearchType: SearchTypeKey;
  refreshCatalogResults: () => void;
}>();

const emit = defineEmits<{
  (e: 'entry-click', entry: CatalogGridEntry): void;
  (e: 'scroll-top', top: number): void;
}>();

const libraryStore = useLibraryStore();

// ==================== 目录网格虚拟滚动 ====================
const resultsScrollRef = ref<HTMLElement | null>(null);

const catalogGridScrollTop = ref(0);
const catalogGridViewportHeight = ref(720);
const catalogGridWidth = ref(960);
const windowWidth = ref(window.innerWidth);
const CATALOG_GRID_H_GAP = 24;
const CATALOG_GRID_V_GAP = 40;
const CATALOG_GRID_OVERSCAN_ROWS = 2;

type VirtualCatalogGridRow = {
  key: string;
  start: number;
  items: CatalogGridEntry[];
};

const catalogGridColumns = computed(() => {
  const width = windowWidth.value;
  if (width >= 1536) return 7;
  if (width >= 1280) return 6;
  if (width >= 1024) return 5;
  if (width >= 768) return 4;
  if (width >= 640) return 3;
  return 2;
});

const catalogGridClass = computed(() => ({
  'grid-cols-2': catalogGridColumns.value === 2,
  'grid-cols-3': catalogGridColumns.value === 3,
  'grid-cols-4': catalogGridColumns.value === 4,
  'grid-cols-5': catalogGridColumns.value === 5,
  'grid-cols-6': catalogGridColumns.value === 6,
  'grid-cols-7': catalogGridColumns.value === 7,
}));

const catalogGridRowHeight = computed(() => {
  if (props.activeSearchType === 'artist') {
    return 156 + CATALOG_GRID_V_GAP;
  }

  const columns = Math.max(1, catalogGridColumns.value);
  const itemWidth = Math.max(120, (catalogGridWidth.value - CATALOG_GRID_H_GAP * (columns - 1)) / columns);
  return itemWidth + 78 + CATALOG_GRID_V_GAP;
});

const catalogGridRowCount = computed(() => Math.ceil(props.items.length / catalogGridColumns.value));
const catalogGridVirtualTotalHeight = computed(() => catalogGridRowCount.value * catalogGridRowHeight.value);

const virtualCatalogGridRows = computed<VirtualCatalogGridRow[]>(() => {
  const rowHeight = Math.max(1, catalogGridRowHeight.value);
  const startRow = Math.max(0, Math.floor(catalogGridScrollTop.value / rowHeight) - CATALOG_GRID_OVERSCAN_ROWS);
  const visibleRows = Math.ceil(catalogGridViewportHeight.value / rowHeight) + CATALOG_GRID_OVERSCAN_ROWS * 2;
  const endRow = Math.min(catalogGridRowCount.value, startRow + visibleRows);
  const rows: VirtualCatalogGridRow[] = [];

  for (let rowIndex = startRow; rowIndex < endRow; rowIndex += 1) {
    const startIndex = rowIndex * catalogGridColumns.value;
    rows.push({
      key: `catalog-row-${props.activeSearchType}-${rowIndex}`,
      start: rowIndex * rowHeight,
      items: props.items.slice(startIndex, startIndex + catalogGridColumns.value),
    });
  }

  return rows;
});

const handleWindowResize = () => {
  windowWidth.value = window.innerWidth;
};

// ==================== 入场逐行动画（对齐榜单/歌手/专辑页手法） ====================
const ROW_ENTER_BASE_DELAY = 200;
const ROW_ENTER_STAGGER = 140;
const ROW_ENTER_DURATION = 600;
const enterAnimating = ref(false);
let enterTimer: ReturnType<typeof setTimeout> | undefined;

function playRowEnterAnimation() {
  clearTimeout(enterTimer);
  enterAnimating.value = true;
  const rows = Math.ceil(catalogGridViewportHeight.value / Math.max(1, catalogGridRowHeight.value)) + CATALOG_GRID_OVERSCAN_ROWS * 2 + 1;
  enterTimer = setTimeout(() => {
    enterAnimating.value = false;
  }, ROW_ENTER_BASE_DELAY + Math.max(0, rows - 1) * ROW_ENTER_STAGGER + ROW_ENTER_DURATION + 120);
}

const syncCatalogGridVirtualScrollState = () => {
  const el = resultsScrollRef.value;
  if (!el) return;
  catalogGridScrollTop.value = el.scrollTop;
  catalogGridViewportHeight.value = el.clientHeight || catalogGridViewportHeight.value;
  catalogGridWidth.value = Math.max(320, el.clientWidth - 32);
  emit('scroll-top', catalogGridScrollTop.value);
};

const resetCatalogGridVirtualScroll = () => {
  catalogGridScrollTop.value = 0;
  emit('scroll-top', 0);
  const el = resultsScrollRef.value;
  if (!el) return;
  el.scrollTop = 0;
  catalogGridViewportHeight.value = el.clientHeight || catalogGridViewportHeight.value;
  catalogGridWidth.value = Math.max(320, el.clientWidth - 32);
};

const resetScroll = () => {
  resetCatalogGridVirtualScroll();
};

// 供父级在恢复快照时同步行渲染位置（滚动本体由父级写入 el）
const setScrollTop = (top: number) => {
  catalogGridScrollTop.value = top;
  emit('scroll-top', top);
};

const handleCatalogGridScroll = () => {
  syncCatalogGridVirtualScrollState();
};

let scrollResizeObserver: ResizeObserver | null = null;
const setupScrollResizeObserver = () => {
  scrollResizeObserver?.disconnect();
  const el = resultsScrollRef.value;
  if (!el) return;
  scrollResizeObserver = new ResizeObserver(() => {
    syncCatalogGridVirtualScrollState();
  });
  scrollResizeObserver.observe(el);
};

onMounted(() => {
  window.addEventListener('resize', handleWindowResize);
  playRowEnterAnimation();
});

watch(resultsScrollRef, () => setupScrollResizeObserver());

onBeforeUnmount(() => {
  clearTimeout(enterTimer);
  window.removeEventListener('resize', handleWindowResize);
  scrollResizeObserver?.disconnect();
  scrollResizeObserver = null;
});

// ==================== 搜索卡片悬停跳跃防抖与方向锁定 ====================
const cardHopDirections = ref<Record<string, 'left' | 'right'>>({});
const cardHopLockTimestamps = new Map<string, number>();
const HOP_ANIMATION_LOCK_MS = 500;

function handleMouseEnterCard(e: MouseEvent, key: string) {
  if (cardHopDirections.value[key]) return;

  const now = Date.now();
  const lastTime = cardHopLockTimestamps.get(key) ?? 0;
  if (now - lastTime < HOP_ANIMATION_LOCK_MS) {
    return;
  }

  const target = e.currentTarget as HTMLElement;
  if (!target) return;

  const rect = target.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;

  cardHopLockTimestamps.set(key, now);
  cardHopDirections.value[key] = e.clientX >= centerX ? 'left' : 'right';
}

function handleMouseLeaveCard(key: string) {
  delete cardHopDirections.value[key];
}

// ==================== 网格条目展示与封面 ====================
const handleCatalogEntryClick = (entry: CatalogGridEntry) => {
  emit('entry-click', entry);
};

const getCatalogEntryCover = (entry: CatalogGridEntry) => {
  const refreshFn = () => {
    props.refreshCatalogResults();
  };

  if (entry.type === 'artist') {
    return entry.source === 'local'
      ? getLocalArtistCover(entry.item)
      : entry.item.avatarUrl ? getDisplayCoverUrl(entry.item.avatarUrl, refreshFn) : '';
  }

  if (entry.type === 'album') {
    return entry.source === 'local'
      ? getLocalAlbumCover(entry.item)
      : entry.item.coverUrl ? getDisplayCoverUrl(entry.item.coverUrl, refreshFn) : '';
  }

  return entry.source === 'local'
    ? getPlaylistCover(entry.item)
    : entry.item.coverUrl ? getDisplayCoverUrl(entry.item.coverUrl, refreshFn) : '';
};

const getCatalogEntryTitle = (entry: CatalogGridEntry) => {
  if (entry.type === 'playlist' && entry.source === 'plugin') {
    return entry.item.title;
  }

  return entry.item.name;
};

const getCatalogEntrySubtitle = (entry: CatalogGridEntry) => {
  if (entry.type === 'artist') {
    if (entry.source === 'local') return `${entry.item.count} 首`;
    return entry.item.songCount ? `${entry.item.songCount} 首` : '查看';
  }

  if (entry.type === 'album') {
    return entry.item.artist;
  }

  if (entry.source === 'local') {
    return `${entry.item.songPaths.length} 首`;
  }

  return entry.item.trackCount ? `${entry.item.trackCount} 首` : '查看';
};

const handlePluginImgError = (e: Event) => {
  const img = e.target as HTMLImageElement;
  const src = img.src;
  if (!src || src.startsWith('data:')) return;
  (async () => {
    const dataUrl = await tryProxyImage(src);
    if (dataUrl) {
      img.src = dataUrl;
      img.style.removeProperty('display');
      props.refreshCatalogResults();
    }
  })();
  img.style.display = 'none';
};

const getLocalArtistCover = (artist: ArtistCatalogItem): string => {
  if (!artist.avatarPath) return '';
  if (artist.avatarPath.startsWith('http') || artist.avatarPath.startsWith('asset:') || artist.avatarPath.startsWith('data:')) {
    return artist.avatarPath;
  }
  try {
    return convertFileSrc(artist.avatarPath);
  } catch {
    return '';
  }
};

const getLocalAlbumCover = (album: AlbumCatalogItem): string => {
  if (!album.firstSongPath) return '';
  const song = libraryStore.getSongByPath(album.firstSongPath);
  if (song?.cover_thumb_path) {
    if (song.cover_thumb_path.startsWith('http') || song.cover_thumb_path.startsWith('asset:') || song.cover_thumb_path.startsWith('data:')) {
      return song.cover_thumb_path;
    }
    try {
      return convertFileSrc(song.cover_thumb_path);
    } catch {
      return '';
    }
  }
  return '';
};

const getPlaylistCover = (playlist: Playlist): string => {
  if (playlist.coverPath) {
    if (playlist.coverPath.startsWith('http') || playlist.coverPath.startsWith('asset:') || playlist.coverPath.startsWith('data:')) {
      return playlist.coverPath;
    }
    try {
      return convertFileSrc(playlist.coverPath);
    } catch {
      return '';
    }
  }
  if (playlist.songPaths.length > 0) {
    const song = libraryStore.getSongByPath(playlist.songPaths[0]);
    if (song?.cover_thumb_path) {
      if (song.cover_thumb_path.startsWith('http') || song.cover_thumb_path.startsWith('asset:') || song.cover_thumb_path.startsWith('data:')) {
        return song.cover_thumb_path;
      }
      try {
        return convertFileSrc(song.cover_thumb_path);
      } catch {
        return '';
      }
    }
  }
  return '';
};

defineExpose({
  resetScroll,
  setScrollTop,
  scrollEl: resultsScrollRef,
});
</script>

<template>
  <div
    ref="resultsScrollRef"
    class="absolute inset-0 overflow-y-auto custom-scrollbar p-4"
    @scroll="handleCatalogGridScroll"
  >
    <div class="relative w-full" :style="{ height: `${catalogGridVirtualTotalHeight}px` }">
      <div
        v-for="(row, rowIndex) in virtualCatalogGridRows"
        :key="row.key"
        class="absolute left-0 grid w-full gap-x-6"
        :class="catalogGridClass"
        :style="{ transform: `translateY(${row.start}px)` }"
      >
        <button
          v-for="entry in row.items"
          :key="entry.key"
          type="button"
          class="search-card rounded-xl p-3 transition-colors cursor-pointer group hover:bg-black/5 dark:hover:bg-white/5"
          :class="[
            entry.type === 'artist' ? 'flex flex-col items-center gap-2' : 'flex flex-col gap-2',
            cardHopDirections[entry.key] === 'left' ? 'hop-left' : cardHopDirections[entry.key] === 'right' ? 'hop-right' : '',
            { 'search-card-enter': enterAnimating }
          ]"
          :style="enterAnimating ? { animationDelay: `${ROW_ENTER_BASE_DELAY + rowIndex * ROW_ENTER_STAGGER}ms` } : undefined"
          @mouseenter="handleMouseEnterCard($event, entry.key)"
          @mouseleave="handleMouseLeaveCard(entry.key)"
          @click="handleCatalogEntryClick(entry)"
        >
          <div
            v-if="entry.type === 'artist'"
            class="w-20 h-20 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-2xl font-black shrink-0 ring-1 ring-black/5 dark:ring-white/10 group-hover:ring-[#EC4141]/30 transition"
          >
            <img
              v-if="getCatalogEntryCover(entry)"
              :src="getCatalogEntryCover(entry)"
              class="w-full h-full object-cover"
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="handlePluginImgError($event)"
            />
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 19l7 3v-11l-7-3-7 3v11l7-3zM12 19V8M5 12l7-3 7 3" />
            </svg>
          </div>
          <div v-else-if="entry.type === 'album'" class="relative w-full aspect-square shrink-0">
            <div class="absolute inset-x-2 top-0 bottom-1/2 bg-[#1c1c1c] rounded-t-full shadow-inner origin-bottom translate-y-[-10%] group-hover:translate-y-[-24%] transition-transform duration-500 ease-out z-0 flex items-center justify-center overflow-hidden border border-[#333]">
              <div class="absolute inset-0 rounded-t-full border border-white/5 scale-90"></div>
              <div class="absolute inset-0 rounded-t-full border border-white/5 scale-75"></div>
              <div class="absolute inset-0 rounded-t-full border border-white/5 scale-50"></div>
            </div>
            <div class="absolute inset-0 z-10 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-100 dark:border-white/10 p-1 flex items-center justify-center overflow-hidden group-hover:shadow-xl transition-shadow duration-300">
              <img
                v-if="getCatalogEntryCover(entry)"
                :src="getCatalogEntryCover(entry)"
                class="w-full h-full rounded-sm object-cover"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="handlePluginImgError($event)"
              />
              <div
                v-else
                class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-white/5 dark:to-white/10 rounded-sm flex items-center justify-center text-4xl font-bold text-gray-300 dark:text-gray-600 shadow-inner"
              >
                {{ getCatalogEntryTitle(entry) ? getCatalogEntryTitle(entry).charAt(0).toUpperCase() : 'A' }}
              </div>
            </div>
          </div>
          <div
            v-else
            class="bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-2xl font-black shrink-0 ring-1 ring-black/5 dark:ring-white/10 group-hover:ring-[#EC4141]/30 transition aspect-square rounded-lg"
          >
            <img
              v-if="getCatalogEntryCover(entry)"
              :src="getCatalogEntryCover(entry)"
              class="w-full h-full object-cover"
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="handlePluginImgError($event)"
            />
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
          <p
            class="text-sm font-medium text-black dark:text-white truncate w-full"
            :class="entry.type === 'artist' ? 'text-center' : ''"
          >
            {{ getCatalogEntryTitle(entry) }}
          </p>
          <p
            class="text-xs text-black/50 dark:text-white/50 truncate"
            :class="entry.type === 'artist' ? 'text-center' : ''"
          >
            {{ getCatalogEntrySubtitle(entry) }}
          </p>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 5px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
}

/* ==================== 搜索网格卡片悬停跳跃动画 ==================== */
.search-card {
  transition: background-color 0.2s ease, opacity 0.2s ease, transform 0.25s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.search-card.hop-right:hover:not(.search-card-enter) {
  transform: translateX(12px);
  animation: search-card-hop-right 0.36s;
}

.search-card.hop-left:hover:not(.search-card-enter) {
  transform: translateX(-12px);
  animation: search-card-hop-left 0.36s;
}

/* 入场逐行动画：卡片自下而上错峰浮入（与榜单页同一套曲线与步长）。 */
.search-card-enter { animation: search-card-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) backwards; }

@keyframes search-card-in {
  from { opacity: 0; transform: translateY(30px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes search-card-hop-right {
  0%   { transform: translate(0, 0);         animation-timing-function: cubic-bezier(0.3, 0.7, 0.5, 1); }
  22%  { transform: translate(3px, -16px);   animation-timing-function: cubic-bezier(0.5, 0, 0.7, 0.3); }
  45%  { transform: translate(6px, 0);       animation-timing-function: cubic-bezier(0.3, 0.7, 0.5, 1); }
  57%  { transform: translate(7.5px, -6px);  animation-timing-function: cubic-bezier(0.5, 0, 0.7, 0.3); }
  70%  { transform: translate(9px, 0);       animation-timing-function: cubic-bezier(0.3, 0.7, 0.5, 1); }
  79%  { transform: translate(10.5px, -2px); animation-timing-function: cubic-bezier(0.5, 0, 0.7, 0.3); }
  90%  { transform: translate(12px, 0); }
  100% { transform: translate(12px, 0); }
}

@keyframes search-card-hop-left {
  0%   { transform: translate(0, 0);          animation-timing-function: cubic-bezier(0.3, 0.7, 0.5, 1); }
  22%  { transform: translate(-3px, -16px);   animation-timing-function: cubic-bezier(0.5, 0, 0.7, 0.3); }
  45%  { transform: translate(-6px, 0);       animation-timing-function: cubic-bezier(0.3, 0.7, 0.5, 1); }
  57%  { transform: translate(-7.5px, -6px);  animation-timing-function: cubic-bezier(0.5, 0, 0.7, 0.3); }
  70%  { transform: translate(-9px, 0);       animation-timing-function: cubic-bezier(0.3, 0.7, 0.5, 1); }
  79%  { transform: translate(-10.5px, -2px); animation-timing-function: cubic-bezier(0.5, 0, 0.7, 0.3); }
  90%  { transform: translate(-12px, 0); }
  100% { transform: translate(-12px, 0); }
}
</style>
