<template>
  <div class="flex flex-col h-full">
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
              @click="selectedSourceId = source.id"
            >
              {{ source.name }}
            </button>
          </div>
        </div>
        <span class="text-[clamp(0.75rem,0.9vw,0.875rem)] text-black/50 dark:text-white/50 whitespace-nowrap shrink-0" :class="{ 'opacity-0': loading || checkingSources || sheets.length === 0 }">
          {{ sheets.length }} 个歌单
        </span>
      </div>
    </div>

    <div class="flex-1 flex overflow-hidden relative">
      <section class="flex-1 flex overflow-hidden relative">
        <transition name="page-fade">
          <div v-if="loading || checkingSources" key="loading" class="absolute inset-0 flex items-center justify-center">
            <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
              <svg class="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p class="text-sm">{{ checkingSources ? '正在检测可用音源…' : `正在从 ${selectedSourceName} 加载推荐歌单…` }}</p>
            </div>
          </div>

          <div v-else-if="allSourceList.length === 0" key="no-plugin" class="absolute inset-0 flex flex-col items-center justify-center text-black/30 dark:text-white/30">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
            </svg>
            <p class="text-base font-medium">暂无支持推荐歌单的插件</p>
            <p class="text-sm mt-1">请先在「插件管理」中安装音源插件</p>
          </div>

          <div v-else-if="sheets.length === 0" key="empty" class="absolute inset-0 flex flex-col items-center justify-center text-black/40 dark:text-white/40">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <p class="text-base font-medium">该音源暂无推荐歌单</p>
            <p class="text-sm mt-1">试试切换其他音源</p>
          </div>

          <div v-else key="grid" class="absolute inset-0 overflow-y-auto custom-scrollbar p-4">
            <div class="grid gap-x-6 gap-y-5 w-full" :class="gridClass">
              <button
                v-for="(item, index) in sheets"
                :key="`sheet-${item.pluginId}-${item.id}-${index}`"
                type="button"
                class="sheet-card rounded-xl p-3 cursor-pointer group hover:bg-black/5 dark:hover:bg-white/5 flex flex-col gap-2"
                :style="{ animationDelay: `${ROW_ENTER_BASE_DELAY + Math.floor(index / gridColumns) * ROW_ENTER_STAGGER}ms` }"
                @click="handleSheetClick(item)"
              >
                <div class="bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] shrink-0 ring-1 ring-black/5 dark:ring-white/10 group-hover:ring-[#EC4141]/30 transition aspect-square rounded-lg">
                  <img
                    v-if="getCover(item)"
                    :src="getCover(item)"
                    class="w-full h-full object-cover"
                    alt=""
                    loading="lazy"
                    referrerpolicy="no-referrer"
                    @error="handleImgError($event, item)"
                  />
                  <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
                <p class="text-sm font-medium text-black dark:text-white truncate w-full">
                  {{ item.title }}
                </p>
                <p class="text-xs text-black/50 dark:text-white/50 truncate">
                  {{ getSubtitle(item) }}
                </p>
              </button>
            </div>
          </div>
        </transition>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { PluginPlaylistSearchResult, PluginSource } from '../types';
import { getStoredPlugins, pluginGetRecommendSheets, pluginSupportsRecommendSheets, pluginsVersion, lxToplistSourcesOf } from '../services/domain/pluginEngine';
import { LX_SOURCE_NAMES, type LxSourceId } from '../services/domain/lxMusicSdk';
import { getDisplayCoverUrl, tryProxyImage } from '../utils/coverProxy';
import { openOnlineDetail } from '../features/onlineDetail/store';
import { useDragScrollX } from '../composables/useDragScrollX';
// ==================== 来源列表 ====================
type SourceItem = {
  id: string;
  name: string;
  source: PluginSource;
  lxKey?: string;
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

async function refreshSourceList() {
  const token = ++refreshToken;
  checkingSources.value = true;
  try {
    // MF/anime 插件按 getRecommendSheetTags 方法判定；lx 插件由
    // lx_recommend_sheets 兜底模块判定（sources 与 wy/kg/kw/tx 有交集）
    const plugins = getStoredPlugins()
      .filter(p => p.enabled && (p.format === 'musicfree' || p.format === 'anime' || p.format === 'lx'))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const results = await Promise.all(plugins.map(async (p) => {
      try {
        return (await pluginSupportsRecommendSheets(p)) ? p : null;
      } catch {
        return null;
      }
    }));

    if (token !== refreshToken) return;

    const items: SourceItem[] = results
      .filter((p): p is PluginSource => p !== null)
      .flatMap((p): SourceItem[] => {
        if (p.format !== 'lx') {
          return [{ id: p.id, name: p.name, source: p }];
        }
        // lx 按内部平台拆分展示（与榜单页同款）；单平台保留插件名
        const keys = lxToplistSourcesOf(p);
        if (keys.length <= 1) {
          return [{ id: p.id, name: p.name, source: p, lxKey: keys[0] }];
        }
        return keys.map((k) => ({
          id: `${p.id}__${k}`,
          name: LX_SOURCE_NAMES[k as LxSourceId] ?? k,
          source: p,
          lxKey: k,
        }));
      });

    sourceList.value = items;

    const prevSelectedId = selectedSourceId.value;
    const stillExists = items.some(s => s.id === prevSelectedId);
    if (!stillExists && items.length > 0) {
      selectedSourceId.value = items[0].id;
    } else if (items.length === 0) {
      selectedSourceId.value = '';
    }
  } finally {
    if (token === refreshToken) {
      checkingSources.value = false;
    }
  }
}

// ==================== 推荐歌单数据 ====================
const sheets = ref<PluginPlaylistSearchResult[]>([]);
let loadVersion = 0;

async function loadSheets() {
  const source = selectedSourceItem.value;
  if (!source) {
    sheets.value = [];
    return;
  }

  const version = ++loadVersion;
  loading.value = true;
  try {
    const results = await pluginGetRecommendSheets(source.source, source.lxKey);
    if (version !== loadVersion) return;
    sheets.value = results;
  } catch {
    if (version !== loadVersion) return;
    sheets.value = [];
  } finally {
    if (version === loadVersion) {
      loading.value = false;
    }
  }
}

watch(selectedSourceId, () => {
  loadSheets();
});

// ==================== 来源横向滚动 ====================
const sourceScrollRef = ref<HTMLElement | null>(null);
const { isDragging } = useDragScrollX(sourceScrollRef);

function scrollSelectedSourceIntoView() {
  const container = sourceScrollRef.value;
  if (!container) return;
  const active = container.querySelector<HTMLElement>('[data-active="true"]');
  active?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
}

watch(selectedSourceId, () => {
  scrollSelectedSourceIntoView();
});

// ==================== 歌单网格（首屏数据量小，不做虚拟滚动） ====================
const ROW_ENTER_BASE_DELAY = 200;
const ROW_ENTER_STAGGER = 140;
const windowWidth = ref(window.innerWidth);

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

// ==================== 封面与展示 ====================
const getCover = (item: PluginPlaylistSearchResult) => {
  const url = item.coverUrl;
  if (!url) return '';
  return getDisplayCoverUrl(url, () => {
    sheets.value = [...sheets.value];
  });
};

const handleImgError = (e: Event, item: PluginPlaylistSearchResult) => {
  const img = e.target as HTMLImageElement;
  const src = img.src;
  if (!src || src.startsWith('data:')) return;
  (async () => {
    const dataUrl = await tryProxyImage(src);
    if (dataUrl) {
      img.src = dataUrl;
      img.style.removeProperty('display');
      sheets.value = [...sheets.value];
    }
  })();
  img.style.display = 'none';
  void item;
};

const getSubtitle = (item: PluginPlaylistSearchResult) => {
  const { playCount, trackCount, artist } = item;
  if (playCount != null && playCount > 0) {
    return playCount >= 10000 ? `${(playCount / 10000).toFixed(1)}万播放` : `${playCount} 播放`;
  }
  if (trackCount != null && trackCount > 0) {
    return `${trackCount} 首`;
  }
  return artist || '查看';
};

// ==================== 点击跳转详情 ====================
const handleSheetClick = (item: PluginPlaylistSearchResult) => {
  const source = selectedSourceItem.value;
  if (!source) return;
  const isLx = source.source.format === 'lx';
  // chip 即平台：条目缺 source（如下发 JS 模块形状差异）时回退 chip 的 lxKey
  const lxSource = isLx ? String(item.rawData?._lxSource || item.rawData?.source || source.lxKey || '') : '';
  if (isLx && !lxSource) return;
  openOnlineDetail({
    type: 'playlist',
    title: item.title,
    subtitle: item.trackCount ? `${item.trackCount} 首` : (item.artist || ''),
    coverUrl: item.coverUrl,
    pluginSource: source.source,
    // lx 歌单补 _lxSource，OnlineDetailView 据此进 lx 引擎分支
    rawData: isLx ? { ...item.rawData, _lxSource: lxSource } : item.rawData,
    platformId: item.platformId || item.id,
    ...(isLx
      ? { engineType: 'lx' as const, lxSourceId: lxSource }
      : { engineType: 'musicfree' as const }),
  });
};

// ==================== 初始化 ====================
const handleWindowResize = () => {
  windowWidth.value = window.innerWidth;
};

onMounted(() => {
  window.addEventListener('resize', handleWindowResize);
  void refreshSourceList();
});

watch(pluginsVersion, () => {
  void refreshSourceList();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleWindowResize);
  loadVersion += 1;
});
</script>

<style scoped>
/* ==================== 歌单卡片逐行入场动画 ==================== */
.sheet-card {
  animation: sheet-card-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) backwards;
}

@keyframes sheet-card-in {
  from {
    opacity: 0;
    transform: translateY(30px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

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
