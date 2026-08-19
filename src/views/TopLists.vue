<template>
  <div class="flex flex-col h-full">
    <!-- 头部：来源选择 -->
    <div class="px-6 shrink-0 select-none">
      <div class="flex items-center justify-between gap-4 py-3">
        <div class="flex items-center gap-1 flex-wrap">
          <span class="text-[clamp(0.75rem,0.9vw,0.875rem)] text-black/50 dark:text-white/50 mr-1">来源</span>
          <button
            v-for="source in allSourceList"
            :key="source.id"
            type="button"
            class="px-3 py-1.5 rounded-md text-[clamp(0.8rem,1vw,0.9rem)] font-medium transition-colors cursor-pointer whitespace-nowrap"
            :class="selectedSourceId === source.id
              ? 'text-[#EC4141] bg-red-50 dark:bg-red-500/10'
              : 'text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5'"
            @click="handleSelectSource(source)"
          >
            {{ source.name }}
          </button>
        </div>
        <span v-if="!loading && topLists.length > 0" class="text-[clamp(0.75rem,0.9vw,0.875rem)] text-black/50 dark:text-white/50 whitespace-nowrap">
          {{ topLists.length }} 个榜单
        </span>
      </div>
    </div>

    <!-- 榜单内容 -->
    <div class="flex-1 flex overflow-hidden relative">
      <section class="flex-1 flex overflow-hidden">
        <transition name="page-fade" mode="out-in">
          <!-- 加载中 -->
          <div v-if="loading" key="loading" class="flex-1 flex items-center justify-center">
            <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
              <svg class="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p class="text-sm">正在从 {{ selectedSourceName }} 加载榜单…</p>
            </div>
          </div>

          <!-- 无插件 -->
          <div v-else-if="allSourceList.length === 0" key="no-plugin" class="flex-1 flex flex-col items-center justify-center text-black/30 dark:text-white/30">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
            </svg>
            <p class="text-base font-medium">暂无支持榜单的插件</p>
            <p class="text-sm mt-1">请先在「插件管理」中安装支持排行榜的音源插件</p>
          </div>

          <!-- 空榜单 -->
          <div v-else-if="topLists.length === 0" key="empty" class="flex-1 flex flex-col items-center justify-center text-black/40 dark:text-white/40">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <p class="text-base font-medium">该音源暂无榜单</p>
            <p class="text-sm mt-1">试试切换其他音源</p>
          </div>

          <!-- 榜单网格：按行虚拟滚动 -->
          <div
            v-else
            key="grid"
            ref="resultsScrollRef"
            class="flex-1 overflow-y-auto custom-scrollbar p-4"
            @scroll="handleGridScroll"
          >
            <div class="relative w-full" :style="{ height: `${gridVirtualTotalHeight}px` }">
              <div
                v-for="row in virtualGridRows"
                :key="row.key"
                class="absolute left-0 grid w-full gap-x-6"
                :class="gridClass"
                :style="{ transform: `translateY(${row.start}px)` }"
              >
                <button
                  v-for="entry in row.items"
                  :key="entry.key"
                  type="button"
                  class="rounded-xl p-3 transition-colors cursor-pointer group hover:bg-black/5 dark:hover:bg-white/5 flex flex-col gap-2"
                  @click="handleTopListClick(entry)"
                >
                  <div
                    class="bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-2xl font-black shrink-0 ring-1 ring-black/5 dark:ring-white/10 group-hover:ring-[#EC4141]/30 transition aspect-square rounded-lg"
                  >
                    <img
                      v-if="getCover(entry)"
                      :src="getCover(entry)"
                      class="w-full h-full object-cover"
                      alt=""
                      loading="lazy"
                      referrerpolicy="no-referrer"
                      @error="handleImgError($event)"
                    />
                    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                  <p class="text-sm font-medium text-black dark:text-white truncate w-full">
                    {{ entry.item.title }}
                  </p>
                  <p class="text-xs text-black/50 dark:text-white/50 truncate">
                    {{ getSubtitle(entry) }}
                  </p>
                </button>
              </div>
            </div>
          </div>
        </transition>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import type { PluginPlaylistSearchResult, PluginSource } from '../types';
import { getStoredPlugins, pluginGetTopLists, pluginSupportsTopLists, pluginsVersion } from '../services/pluginEngine';
import { getDisplayCoverUrl, tryProxyImage } from '../utils/coverProxy';
import { useOnlineDetailStore } from '../features/onlineDetail/store';

const router = useRouter();
const onlineDetailStore = useOnlineDetailStore();

// ==================== 来源列表 ====================
type SourceItem = {
  id: string;
  name: string;
  source: PluginSource;
};

const sourceList = ref<SourceItem[]>([]);
const selectedSourceId = ref<string>('');
const loading = ref(false);

const allSourceList = computed(() => sourceList.value);

const selectedSourceItem = computed(() =>
  allSourceList.value.find(s => s.id === selectedSourceId.value),
);

const selectedSourceName = computed(() => selectedSourceItem.value?.name ?? '未知音源');

/** 构建支持榜单接口的插件来源列表 */
async function refreshSourceList() {
  const plugins = getStoredPlugins()
    .filter(p => p.enabled && p.format === 'musicfree')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const items: SourceItem[] = [];
  for (const p of plugins) {
    try {
      if (await pluginSupportsTopLists(p)) {
        items.push({ id: p.id, name: p.name, source: p });
      }
    } catch {
      // 插件加载失败视为不支持榜单，静默跳过
    }
  }
  sourceList.value = items;

  const prevSelectedId = selectedSourceId.value;
  const stillExists = items.some(s => s.id === prevSelectedId);
  if (!stillExists && items.length > 0) {
    selectedSourceId.value = items[0].id;
  } else if (items.length === 0) {
    selectedSourceId.value = '';
  }
}

// ==================== 榜单数据 ====================
const topLists = ref<PluginPlaylistSearchResult[]>([]);
let loadVersion = 0;

async function loadTopLists() {
  const source = selectedSourceItem.value;
  if (!source) {
    topLists.value = [];
    return;
  }

  const version = ++loadVersion;
  loading.value = true;
  resetGridScroll();
  try {
    const results = await pluginGetTopLists(source.source);
    if (version !== loadVersion) return;
    topLists.value = results;
  } catch {
    if (version !== loadVersion) return;
    topLists.value = [];
  } finally {
    if (version === loadVersion) {
      loading.value = false;
    }
  }
}

const handleSelectSource = (source: SourceItem) => {
  selectedSourceId.value = source.id;
};

watch(selectedSourceId, () => {
  loadTopLists();
});

// ==================== 虚拟滚动网格 ====================
const resultsScrollRef = ref<HTMLElement | null>(null);
const gridScrollTop = ref(0);
const gridViewportHeight = ref(720);
const gridWidth = ref(960);
const GRID_H_GAP = 24;
const GRID_V_GAP = 40;
const GRID_OVERSCAN_ROWS = 2;

const gridColumns = computed(() => {
  const width = gridWidth.value;
  if (width >= 1536) return 7;
  if (width >= 1280) return 6;
  if (width >= 1024) return 5;
  if (width >= 768) return 4;
  if (width >= 640) return 3;
  return 2;
});

const gridClass = computed(() => ({
  'grid-cols-2': gridColumns.value === 2,
  'grid-cols-3': gridColumns.value === 3,
  'grid-cols-4': gridColumns.value === 4,
  'grid-cols-5': gridColumns.value === 5,
  'grid-cols-6': gridColumns.value === 6,
  'grid-cols-7': gridColumns.value === 7,
}));

const gridRowHeight = computed(() => {
  const columns = Math.max(1, gridColumns.value);
  const itemWidth = Math.max(120, (gridWidth.value - GRID_H_GAP * (columns - 1)) / columns);
  return itemWidth + 78 + GRID_V_GAP;
});

const gridRowCount = computed(() => Math.ceil(topLists.value.length / gridColumns.value));
const gridVirtualTotalHeight = computed(() => gridRowCount.value * gridRowHeight.value);

type GridEntry = {
  key: string;
  item: PluginPlaylistSearchResult;
};

type VirtualGridRow = {
  key: string;
  start: number;
  items: GridEntry[];
};

const gridEntries = computed<GridEntry[]>(() =>
  topLists.value.map((item, index) => ({
    key: `toplist-${item.pluginId}-${item.id}-${index}`,
    item,
  })),
);

const virtualGridRows = computed<VirtualGridRow[]>(() => {
  const rowHeight = Math.max(1, gridRowHeight.value);
  const startRow = Math.max(0, Math.floor(gridScrollTop.value / rowHeight) - GRID_OVERSCAN_ROWS);
  const visibleRows = Math.ceil(gridViewportHeight.value / rowHeight) + GRID_OVERSCAN_ROWS * 2;
  const endRow = Math.min(gridRowCount.value, startRow + visibleRows);
  const rows: VirtualGridRow[] = [];

  for (let rowIndex = startRow; rowIndex < endRow; rowIndex += 1) {
    const startIndex = rowIndex * gridColumns.value;
    rows.push({
      key: `toplist-row-${rowIndex}`,
      start: rowIndex * rowHeight,
      items: gridEntries.value.slice(startIndex, startIndex + gridColumns.value),
    });
  }

  return rows;
});

const syncGridScrollState = () => {
  const el = resultsScrollRef.value;
  if (!el) return;
  gridScrollTop.value = el.scrollTop;
  gridViewportHeight.value = el.clientHeight || gridViewportHeight.value;
  gridWidth.value = Math.max(320, el.clientWidth - 32);
};

const resetGridScroll = () => {
  gridScrollTop.value = 0;
  const el = resultsScrollRef.value;
  if (!el) return;
  el.scrollTop = 0;
  gridViewportHeight.value = el.clientHeight || gridViewportHeight.value;
  gridWidth.value = Math.max(320, el.clientWidth - 32);
};

const handleGridScroll = () => {
  syncGridScrollState();
};

let scrollResizeObserver: ResizeObserver | null = null;
const setupScrollResizeObserver = () => {
  scrollResizeObserver?.disconnect();
  const el = resultsScrollRef.value;
  if (!el) return;
  scrollResizeObserver = new ResizeObserver(() => {
    syncGridScrollState();
  });
  scrollResizeObserver.observe(el);
};

watch(resultsScrollRef, () => setupScrollResizeObserver());

// ==================== 封面与展示 ====================
const getCover = (entry: GridEntry) => {
  const url = entry.item.coverUrl;
  if (!url) return '';
  return getDisplayCoverUrl(url, () => {
    topLists.value = [...topLists.value];
  });
};

const handleImgError = (e: Event) => {
  const img = e.target as HTMLImageElement;
  const src = img.src;
  if (!src || src.startsWith('data:')) return;
  (async () => {
    const dataUrl = await tryProxyImage(src);
    if (dataUrl) {
      img.src = dataUrl;
      img.style.removeProperty('display');
      topLists.value = [...topLists.value];
    }
  })();
  img.style.display = 'none';
};

const getSubtitle = (entry: GridEntry) => {
  const { playCount, trackCount, artist } = entry.item;
  if (playCount != null && playCount > 0) {
    return playCount >= 10000 ? `${(playCount / 10000).toFixed(1)}万播放` : `${playCount} 播放`;
  }
  if (trackCount != null && trackCount > 0) {
    return `${trackCount} 首`;
  }
  return artist || '查看';
};

// ==================== 点击跳转详情 ====================
const handleTopListClick = (entry: GridEntry) => {
  const source = selectedSourceItem.value;
  if (!source) return;
  const item = entry.item;
  onlineDetailStore.setContext({
    type: 'playlist',
    title: item.title,
    subtitle: item.trackCount ? `${item.trackCount} 首` : (item.artist || ''),
    coverUrl: item.coverUrl,
    pluginSource: source.source,
    rawData: item.rawData,
    sourceSearchType: 'playlist',
    engineType: 'musicfree',
  });
  void router.push({ path: '/online-detail', query: { type: 'playlist' } });
};

// ==================== 初始化 ====================
onMounted(() => {
  void refreshSourceList();
});

// 插件变更（开关/排序/增删）时刷新来源列表
watch(pluginsVersion, () => {
  void refreshSourceList();
});

onBeforeUnmount(() => {
  loadVersion += 1;
  scrollResizeObserver?.disconnect();
  scrollResizeObserver = null;
});
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
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
</style>
