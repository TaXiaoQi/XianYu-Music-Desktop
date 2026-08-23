<template>
  <div class="flex flex-col h-full">
    <!-- 头部：来源选择（横向滚动，单行显示） -->
    <div class="px-6 shrink-0 select-none">
      <div class="flex items-center justify-between gap-4 py-3">
        <div class="flex items-center min-w-0 flex-1">
          <span class="text-[clamp(0.75rem,0.9vw,0.875rem)] text-black/50 dark:text-white/50 mr-1 shrink-0">来源</span>
          <div
            ref="sourceScrollRef"
            class="flex items-center gap-1 overflow-x-auto no-h-scrollbar min-w-0 pr-3 cursor-grab select-none"
            :class="{ 'cursor-grabbing': isDragging, 'scroll-smooth': !isDragging }"
          >
            <button
              v-for="source in allSourceList"
              :key="source.id"
              type="button"
              :data-active="selectedSourceId === source.id ? 'true' : 'false'"
              class="px-3 py-1.5 rounded-md text-[clamp(0.8rem,1vw,0.9rem)] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
              :class="selectedSourceId === source.id
                ? 'text-[#EC4141] bg-red-50 dark:bg-red-500/10'
                : 'text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5'"
              @click="handleSelectSource(source)"
            >
              {{ source.name }}
            </button>
          </div>
        </div>
        <span class="text-[clamp(0.75rem,0.9vw,0.875rem)] text-black/50 dark:text-white/50 whitespace-nowrap shrink-0" :class="{ 'opacity-0': loading || checkingSources || topLists.length === 0 }">
          {{ topLists.length }} 个榜单
        </span>
      </div>
    </div>

    <!-- 榜单内容 -->
    <div class="flex-1 flex overflow-hidden relative">
      <section class="flex-1 flex overflow-hidden relative">
        <!-- 同时交叉淡入淡出（分支绝对定位）：不用 out-in —— 分支由异步数据切换，
             out-in 的延迟入场会在数据到达时与 keyed 虚拟行更新竞态导致 insertBefore 崩溃 -->
        <transition name="page-fade">
          <!-- 加载中 -->
          <div v-if="loading || checkingSources" key="loading" class="absolute inset-0 flex items-center justify-center">
            <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
              <svg class="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p class="text-sm">{{ checkingSources ? '正在检测可用音源…' : `正在从 ${selectedSourceName} 加载榜单…` }}</p>
            </div>
          </div>

          <!-- 无插件 -->
          <div v-else-if="allSourceList.length === 0" key="no-plugin" class="absolute inset-0 flex flex-col items-center justify-center text-black/30 dark:text-white/30">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
            </svg>
            <p class="text-base font-medium">暂无支持榜单的插件</p>
            <p class="text-sm mt-1">请先在「插件管理」中安装支持排行榜的音源插件</p>
          </div>

          <!-- 空榜单 -->
          <div v-else-if="topLists.length === 0" key="empty" class="absolute inset-0 flex flex-col items-center justify-center text-black/40 dark:text-white/40">
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
            class="absolute inset-0 overflow-y-auto custom-scrollbar p-4"
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
                  class="toplist-card rounded-xl p-3 cursor-pointer group hover:bg-black/5 dark:hover:bg-white/5 flex flex-col gap-2"
                  :class="{ 'toplist-card-enter': gridEnterAnimating }"
                  :style="gridEnterAnimating ? { animationDelay: `${ROW_ENTER_BASE_DELAY + row.index * ROW_ENTER_STAGGER}ms` } : undefined"
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import type { PluginPlaylistSearchResult, PluginSource } from '../types';
import { getStoredPlugins, pluginGetTopLists, pluginSupportsTopLists, pluginsVersion } from '../services/pluginEngine';
import { getDisplayCoverUrl, tryProxyImage } from '../utils/coverProxy';
import { useOnlineDetailStore, openOnlineDetail, type TopListsCache } from '../features/onlineDetail/store';
import { useDragScrollX } from '../composables/useDragScrollX';

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
const checkingSources = ref(false);
let refreshToken = 0;

const allSourceList = computed(() => sourceList.value);

const selectedSourceItem = computed(() =>
  allSourceList.value.find(s => s.id === selectedSourceId.value),
);

const selectedSourceName = computed(() => selectedSourceItem.value?.name ?? '未知音源');

/** 构建支持榜单接口的插件来源列表；silent 时（从缓存恢复后）不显示"检测音源"加载态 */
async function refreshSourceList(silent = false) {
  const token = ++refreshToken;
  if (!silent) checkingSources.value = true;
  try {
    const plugins = getStoredPlugins()
      .filter(p => p.enabled && p.format === 'musicfree')
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    // 并行检测各插件是否支持榜单，避免串行等待导致长时间停留在"无插件"空态
    const results = await Promise.all(plugins.map(async (p) => {
      try {
        return (await pluginSupportsTopLists(p)) ? p : null;
      } catch {
        // 插件加载失败视为不支持榜单，静默跳过
        return null;
      }
    }));

    if (token !== refreshToken) return;

    const items: SourceItem[] = results
      .filter((p): p is PluginSource => p !== null)
      .map(p => ({ id: p.id, name: p.name, source: p }));

    sourceList.value = items;

    const prevSelectedId = selectedSourceId.value;
    const stillExists = items.some(s => s.id === prevSelectedId);
    if (!stillExists && items.length > 0) {
      selectedSourceId.value = items[0].id;
    } else if (items.length === 0) {
      selectedSourceId.value = '';
    }
  } finally {
    if (token === refreshToken && !silent) {
      checkingSources.value = false;
    }
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
  stopGridEnterAnimation();
  resetGridScroll();
  try {
    const results = await pluginGetTopLists(source.source);
    if (version !== loadVersion) return;
    topLists.value = results;
    if (results.length > 0) playGridEnterAnimation();
  } catch {
    if (version !== loadVersion) return;
    topLists.value = [];
  } finally {
    if (version === loadVersion) {
      loading.value = false;
    }
  }
}

// ==================== 榜单逐行入场动画 ====================
/** 行入场节奏（ms）：基础延迟避开外层 page-fade 容器淡入（0.3s）对前几行的掩盖，
    行间隔放大到 140ms、单行 600ms，让逐行波浪清晰可辨 */
const ROW_ENTER_BASE_DELAY = 200;
const ROW_ENTER_STAGGER = 140;
const ROW_ENTER_DURATION = 600;
/** 入场动画进行中：卡片带动画类与行号 delay；结束后移除，滚动加载的新行不再重播 */
const gridEnterAnimating = ref(false);
let gridEnterTimer: ReturnType<typeof setTimeout> | undefined;

/** 数据加载完成后播放逐行入场：按首屏可见行数（含 overscan）估算总时长，超时自动收尾 */
function playGridEnterAnimation() {
  clearTimeout(gridEnterTimer);
  gridEnterAnimating.value = true;
  const rows = Math.ceil(gridViewportHeight.value / Math.max(1, gridRowHeight.value)) + 1 + GRID_OVERSCAN_ROWS;
  gridEnterTimer = setTimeout(() => {
    gridEnterAnimating.value = false;
  }, ROW_ENTER_BASE_DELAY + (rows - 1) * ROW_ENTER_STAGGER + ROW_ENTER_DURATION + 120);
}

/** 立即终止入场动画：用户滚动时调用，避免虚拟滚动新挂载的行带着长 delay 迟迟不出现 */
function stopGridEnterAnimation() {
  clearTimeout(gridEnterTimer);
  gridEnterAnimating.value = false;
}

const handleSelectSource = (source: SourceItem) => {
  selectedSourceId.value = source.id;
};

// ==================== 来源横向滚动 ====================
const sourceScrollRef = ref<HTMLElement | null>(null);
const { isDragging } = useDragScrollX(sourceScrollRef);

/** 选中的来源按钮滚入视野（横向 nearest），避免选中的项停在滚动可视区外 */
function scrollSelectedSourceIntoView() {
  const container = sourceScrollRef.value;
  if (!container) return;
  const active = container.querySelector<HTMLElement>('[data-active="true"]');
  active?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
}

watch(selectedSourceId, () => {
  nextTick(() => scrollSelectedSourceIntoView());
});

// 窗口尺寸变化（容器宽度随窗口自适应）后重新校准选中项可见性：
// 拖动窗口从最小尺寸恢复时，滚动偏移可能停在可视区外
const sourceResizeObserver = new ResizeObserver(() => {
  const container = sourceScrollRef.value;
  if (!container) return;
  const active = container.querySelector<HTMLElement>('[data-active="true"]');
  if (!active) return;
  const left = active.offsetLeft;
  const right = left + active.offsetWidth;
  const viewLeft = container.scrollLeft;
  const viewRight = viewLeft + container.clientWidth;
  if (left < viewLeft || right > viewRight) {
    scrollSelectedSourceIntoView();
  }
});
watch(sourceScrollRef, (el) => {
  sourceResizeObserver.disconnect();
  if (el) sourceResizeObserver.observe(el);
});

onBeforeUnmount(() => {
  sourceResizeObserver.disconnect();
});

/** 从缓存恢复期间置位：抑制 selectedSourceId 首次变化触发的重复加载（榜单数据已随缓存恢复） */
let restoringFromCache = false;

watch(selectedSourceId, () => {
  if (restoringFromCache) {
    restoringFromCache = false;
    return;
  }
  loadTopLists();
});

// ==================== 虚拟滚动网格 ====================
const resultsScrollRef = ref<HTMLElement | null>(null);
const gridScrollTop = ref(0);
const gridViewportHeight = ref(720);
const gridWidth = ref(960);
// 列数断点基于窗口宽度（与本地专辑页一致），保证最小窗口下封面大小一致
const windowWidth = ref(window.innerWidth);
const GRID_H_GAP = 24;
const GRID_V_GAP = 40;
const GRID_OVERSCAN_ROWS = 2;

const gridColumns = computed(() => {
  const width = windowWidth.value;
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
  index: number;
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
      index: rowIndex,
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
  // 入场动画期间用户主动滚动：立即终止，让滚动加载的新行直接呈现
  if (gridEnterAnimating.value) stopGridEnterAnimation();
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
  openOnlineDetail({
    type: 'playlist',
    title: item.title,
    subtitle: item.trackCount ? `${item.trackCount} 首` : (item.artist || ''),
    coverUrl: item.coverUrl,
    pluginSource: source.source,
    rawData: item.rawData,
    platformId: item.platformId || item.id,
    engineType: 'musicfree',
    origin: 'toplist',
  });
};

// ==================== 初始化 ====================
const handleWindowResize = () => {
  windowWidth.value = window.innerWidth;
};

/** 从在线详情返回：直接恢复缓存的来源/榜单/滚动，免重新检测与加载 */
function restoreFromCache(cached: TopListsCache) {
  restoringFromCache = true;
  sourceList.value = cached.sourceList;
  topLists.value = cached.topLists;
  gridScrollTop.value = cached.gridScrollTop;
  gridViewportHeight.value = cached.gridViewportHeight;
  gridWidth.value = cached.gridWidth;
  selectedSourceId.value = cached.selectedSourceId;
  nextTick(() => {
    restoringFromCache = false;
    const el = resultsScrollRef.value;
    if (el) el.scrollTop = cached.gridScrollTop;
  });
  // 后台静默刷新来源列表，检测详情停留期间插件变更（不打断已恢复的榜单）
  void refreshSourceList(true);
}

onMounted(() => {
  window.addEventListener('resize', handleWindowResize);
  const cached = onlineDetailStore.consumeTopListsCache();
  if (cached) {
    restoreFromCache(cached);
  } else {
    void refreshSourceList();
  }
});

// 插件变更（开关/排序/增删）时刷新来源列表
watch(pluginsVersion, () => {
  void refreshSourceList();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleWindowResize);
  loadVersion += 1;
  clearTimeout(gridEnterTimer);
  scrollResizeObserver?.disconnect();
  scrollResizeObserver = null;
  // 进入在线详情：缓存榜单状态（来源 + 榜单 + 滚动），返回时恢复；
  // 其他去向（真正离开榜单页）：销毁缓存
  if (router.currentRoute.value.path === '/online-detail') {
    syncGridScrollState();
    onlineDetailStore.setTopListsCache({
      sourceList: sourceList.value,
      selectedSourceId: selectedSourceId.value,
      topLists: topLists.value,
      gridScrollTop: gridScrollTop.value,
      gridViewportHeight: gridViewportHeight.value,
      gridWidth: gridWidth.value,
    });
  } else {
    onlineDetailStore.clearTopListsCache();
  }
});
</script>

<style scoped>
/* ==================== 榜单卡片逐行入场动画 ==================== */
/* 卡片基础过渡：hover 底色平滑、移开后跳跃偏移平滑滑回原位、入场动画类移除时 opacity 平滑回落 */
.toplist-card {
  transition: background-color 0.2s ease, opacity 0.2s ease, transform 0.25s cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* 悬停跳跃：高亮的同时向右跳一步——抛物线主跳（上行减速/下行加速=重力感）
   + 落地后两次衰减回弹（-16px → -6px → -2px），共 360ms。
   动画结束停在右侧 12px，与 :hover 静态 transform 一致（无跳变）；
   移开后由基础 transform 过渡滑回原位。
   入场动画期间不触发，避免两个 animation 互相顶掉导致入场重播 */
.toplist-card:hover:not(.toplist-card-enter) {
  transform: translateX(12px);
  animation: toplist-card-hop 0.36s;
}

@keyframes toplist-card-hop {
  /* 主跳：腾空到落点 */
  0%   { transform: translate(0, 0);         animation-timing-function: cubic-bezier(0.3, 0.7, 0.5, 1); }
  22%  { transform: translate(3px, -16px);   animation-timing-function: cubic-bezier(0.5, 0, 0.7, 0.3); }
  45%  { transform: translate(6px, 0);       animation-timing-function: cubic-bezier(0.3, 0.7, 0.5, 1); }
  /* 回弹一：高度约 1/3 */
  57%  { transform: translate(7.5px, -6px);  animation-timing-function: cubic-bezier(0.5, 0, 0.7, 0.3); }
  70%  { transform: translate(9px, 0);       animation-timing-function: cubic-bezier(0.3, 0.7, 0.5, 1); }
  /* 回弹二：再衰减 */
  79%  { transform: translate(10.5px, -2px); animation-timing-function: cubic-bezier(0.5, 0, 0.7, 0.3); }
  90%  { transform: translate(12px, 0); }
  100% { transform: translate(12px, 0); }
}

/* 逐行入场：按行号错峰上浮淡入；backwards 保证 delay 期间保持隐藏。
   只在数据加载完成时短暂挂载该类，虚拟滚动后续挂载的行不受影响 */
.toplist-card-enter {
  animation: toplist-card-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) backwards;
}

@keyframes toplist-card-in {
  from {
    opacity: 0;
    transform: translateY(30px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* 来源条隐藏原生横向滚动条：
   经典滚动条在内容溢出时会额外撑高 auto 高度容器（厚度固定、不随 clamp 字号缩放），
   pb+负 mb 只能部分抵消且两种状态间仍有高度跳变，导致与「来源」标签/数量错位。
   隐藏后容器高度恒等于按钮高度，任意窗口尺寸精确对齐；
   滚动能力由拖拽（useDragScrollX）、滚轮、选中项自动滚入视野保证。 */
.no-h-scrollbar {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.no-h-scrollbar::-webkit-scrollbar {
  display: none;
  height: 0;
}
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
</style>
