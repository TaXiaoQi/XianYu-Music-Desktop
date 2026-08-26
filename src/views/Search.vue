<template>
  <div class="flex flex-col h-full">
    <!-- 搜索结果头部 -->
    <div class="px-6 shrink-0 select-none">
    <!-- 第一层：内容类型切换（音乐/歌手/专辑/歌单） -->
      <div class="flex items-center gap-1 border-b border-black/5 dark:border-white/5">
        <button
          v-for="tab in searchTabs"
          :key="tab.type"
          type="button"
          class="relative px-5 py-3 text-[clamp(0.875rem,1.1vw,1rem)] font-medium tracking-wide transition-colors cursor-pointer"
          :class="activeSearchType === tab.type
            ? 'text-[#EC4141]'
            : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          @click="handleSearchTypeChange(tab.type)"
        >
          {{ tab.label }}
          <span
            class="absolute left-1/2 -translate-x-1/2 -bottom-px h-[2px] w-8 bg-[#EC4141] rounded-full origin-center transition-all duration-300 ease-out"
            :class="activeSearchType === tab.type ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'"
          ></span>
        </button>
      </div>

      <!-- 第二层：来源横向选择 + 搜索关键词提示 -->
      <div class="flex items-center justify-between gap-4 py-3">
        <!-- 来源横向滚动选择（单行显示，支持拖动） -->
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

        <!-- 搜索关键词 + 结果数 -->
        <div class="flex items-center gap-2 min-w-0 shrink-0">
          <span v-if="searchQuery.trim()" class="text-[clamp(0.75rem,0.9vw,0.875rem)] text-black/50 dark:text-white/50 truncate max-w-[16rem]">
            "{{ searchQuery }}" · {{ resultCount }} 个结果
          </span>
        </div>
      </div>
    </div>

    <!-- 搜索结果列表 -->
    <div class="flex-1 flex overflow-hidden relative">
      <section class="flex-1 flex overflow-hidden relative">
        <!-- 同时交叉淡入淡出（分支绝对定位）：不用 out-in —— 分支由异步数据切换，
             out-in 的延迟入场会在数据到达时与 keyed 虚拟行更新竞态导致 insertBefore 崩溃 -->
        <transition name="page-fade">
        <!-- 音乐 tab：在线搜索结果，使用 SongTable 作为容器（来源列显示底栏同款下载 UI） -->
        <div v-if="activeSearchType === 'track' && !searching && hasQuery && !hasNoResults" key="track" class="absolute inset-0 flex overflow-hidden">
          <SongTable
            :songs="onlineTrackSongs"
            :is-batch-mode="false"
            :selected-paths="new Set()"
            memory-scope-key="search-track-list"
            @play="handlePlaySong"
            @contextmenu="handleTrackContextMenu"
            @load-more="loadMore"
          />
        </div>

        <!-- 歌手/专辑/歌单：加载中 -->
        <div v-else-if="searching" key="searching" class="absolute inset-0 flex items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
            <svg class="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p class="text-sm">正在从 {{ selectedSourceName }} 搜索…</p>
          </div>
        </div>

        <!-- 歌手/专辑/歌单：空状态 -->
        <div v-else-if="!hasQuery" key="no-query" class="absolute inset-0 flex flex-col items-center justify-center text-black/30 dark:text-white/30">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p class="text-base font-medium">在上方搜索框输入关键词</p>
          <p class="text-sm mt-1">结果来自 {{ selectedSourceName }}</p>
        </div>

        <!-- 歌手/专辑/歌单：无结果 -->
        <div v-else-if="hasNoResults" key="no-results" class="absolute inset-0 flex flex-col items-center justify-center text-black/40 dark:text-white/40">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="text-base font-medium">没有找到与"{{ searchQuery }}"相关的内容</p>
          <p class="text-sm mt-1">试试更换音源或调整关键词</p>
        </div>

        <!-- 歌手/专辑/歌单搜索结果：按行虚拟滚动，避免大量卡片常驻 DOM -->
        <div
          v-else-if="activeSearchType === 'artist' || activeSearchType === 'album' || activeSearchType === 'playlist'"
          :key="activeSearchType"
          ref="resultsScrollRef"
          class="absolute inset-0 overflow-y-auto custom-scrollbar p-4"
          @scroll="handleCatalogGridScroll"
        >
          <div class="relative w-full" :style="{ height: `${catalogGridVirtualTotalHeight}px` }">
            <div
              v-for="row in virtualCatalogGridRows"
              :key="row.key"
              class="absolute left-0 grid w-full gap-x-6"
              :class="catalogGridClass"
              :style="{ transform: `translateY(${row.start}px)` }"
            >
              <button
                v-for="entry in row.items"
                :key="entry.key"
                type="button"
                class="rounded-xl p-3 transition-colors cursor-pointer group hover:bg-black/5 dark:hover:bg-white/5"
                :class="entry.type === 'artist' ? 'flex flex-col items-center gap-2' : 'flex flex-col gap-2'"
                @click="handleCatalogEntryClick(entry)"
              >
                <!-- 歌手：保持圆形头像 -->
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
                <!-- 专辑：对齐专辑列表页封面（黑胶唱片 + 白框 + object-cover 缩放） -->
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
                <!-- 歌单：保持原样式 -->
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
        </transition>
      </section>
    </div>

    <DragGhost />

    <SongContextMenu
      v-if="showContextMenu"
      :visible="showContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :song="contextMenuTargetSong"
      :is-playlist-view="false"
      :is-online-search="true"
      @close="showContextMenu = false"
      @add-to-playlist="openAddToPlaylistSelection"
      @view-online-artist="handleOnlineViewArtist"
      @view-online-album="handleOnlineViewAlbum"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import { convertFileSrc } from '@tauri-apps/api/core';
import { libraryApi } from '../services/tauri/libraryApi';
import type { Song, ArtistCatalogItem, AlbumCatalogItem, Playlist } from '../types';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { useUiStore } from '../shared/stores/ui';
import { useNavigationStore } from '../shared/stores/navigation';
import { useLibraryStore } from '../features/library/store';
import { useLibraryBrowse } from '../features/library/useLibraryBrowse';
import { usePlaybackStore } from '../features/playback/store';
import { useCollectionsStore } from '../features/collections/store';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useToast } from '../composables/toast';
import {
  lxSearch,
  lxCatalogSearch,
  lxGetPic,
  LX_SOURCE_NAMES,
  type LxArtistSearchResult,
  type LxAlbumSearchResult,
  type LxPlaylistSearchResult,
  type LxSearchResultItem,
  type LxSourceId,
} from '../services/domain/lxMusicSdk';
import { getDisplayCoverUrl, tryProxyImage } from '../utils/coverProxy';
import { parseIntervalToSeconds } from '../utils/remoteSong';
import { extractDurationMs } from '../services/domain/pluginResultMappers';
import { useDragScrollX } from '../composables/useDragScrollX';
import {
  getStoredPlugins,
  pluginsVersion,
  pluginSearch,
  pluginGetCover,
  pluginArtistSearch,
  pluginAlbumSearch,
  pluginPlaylistSearch,
  pluginSupportsSearchType,
} from '../services/domain/pluginEngine';
import { ensureLxPluginInstance, lxPluginGetPic } from '../services/domain/lxPluginEngine';
import type { PluginArtistResult, PluginAlbumResult } from '../services/domain/pluginEngine';
import type { PluginSource, PluginSearchResult, PluginPlaylistSearchResult } from '../types';
import { useOnlineDetailStore, openOnlineDetail, type SearchResultsSnapshot } from '../features/onlineDetail/store';
import { fetchWyTrackMetaByIds } from '../services/domain/playlistImport';
import { qqFillSongDurations } from '../services/domain/qqHostSearchFallback';
import { reportSearch, reportInputStats } from '../services/domain/usageStats';

import DragGhost from '../components/common/DragGhost.vue';
const SongContextMenu = defineAsyncComponent(() => import('../components/overlays/SongContextMenu.vue'));
const SongTable = defineAsyncComponent(() => import('../components/song-list/SongTable.vue'));

const router = useRouter();
const { playSong } = usePlaybackController();
const uiStore = useUiStore();
const navigationStore = useNavigationStore();
const libraryStore = useLibraryStore();
const collectionsStore = useCollectionsStore();
const playbackStore = usePlaybackStore();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();
const { showToast } = useToast();
const { searchQuery } = storeToRefs(navigationStore);
const { artistList, albumList } = useLibraryBrowse();
const { playlists } = storeToRefs(collectionsStore);

// ==================== 内容类型切换 ====================
type SearchTypeKey = 'track' | 'artist' | 'album' | 'playlist';
const activeSearchType = ref<SearchTypeKey>('track');
const searchTabs: { type: SearchTypeKey; label: string }[] = [
  { type: 'track', label: '音乐' },
  { type: 'artist', label: '歌手' },
  { type: 'album', label: '专辑' },
  { type: 'playlist', label: '歌单' },
];

/** 从在线详情返回恢复会话期间置位：抑制 selectedSourceId/activeSearchType 变化触发的重复搜索（结果已随快照恢复） */
let restoringSession = false;

const handleSearchTypeChange = (type: SearchTypeKey) => {
  activeSearchType.value = type;
};

// ==================== 来源列表（从插件加载，无插件则索引本地）====================
type SourceItem = {
  id: string;
  name: string;
  type: 'musicfree' | 'lx' | 'local';
  source?: PluginSource;
  lxSourceId?: LxSourceId;
};

const pluginSourceList = ref<SourceItem[]>([]);

/** LX 支持的源 ID 集合 */
const VALID_LX_SOURCES: ReadonlySet<string> = new Set(['kw', 'kg', 'tx', 'wy', 'mg']);

function refreshPluginSourceList() {
  // 按用户自定义的 sortOrder 排序，与插件管理页显示顺序保持一致
  // sortOrder 相同时以原始数组顺序作为 tiebreaker 保证稳定（见 project_memory 约定）
  const raw = getStoredPlugins();
  const plugins = raw
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => p.enabled)
    .sort((a, b) => {
      const sa = a.p.sortOrder ?? 0;
      const sb = b.p.sortOrder ?? 0;
      if (sa !== sb) return sa - sb;
      return a.idx - b.idx;
    })
    .map(({ p }) => p);
  const items: SourceItem[] = [];
  for (const p of plugins) {
    if (p.format === 'musicfree') {
      // MusicFree 插件：单个平台 = 单个来源条目
      items.push({ id: p.id, name: p.name, type: 'musicfree', source: p });
    } else if (p.format === 'lx' && p.sources.length > 0) {
      // LX 插件：解析出所有受支持的音源平台
      const lxSources = p.sources.filter(s => VALID_LX_SOURCES.has(s)) as LxSourceId[];
      if (lxSources.length === 0) continue;

      if (lxSources.length === 1) {
        // 单平台：直接以插件名显示
        items.push({ id: p.id, name: p.name, type: 'lx', source: p, lxSourceId: lxSources[0] });
      } else {
        // 多平台：每个平台拆分为独立来源条目，以平台名显示
        for (const sourceId of lxSources) {
          items.push({
            id: `${p.id}__${sourceId}`,
            name: LX_SOURCE_NAMES[sourceId],
            type: 'lx',
            source: p,
            lxSourceId: sourceId,
          });
        }
      }
    }
  }
  pluginSourceList.value = items;
}

// 统一来源列表 = 插件音源；无插件时显示"本地"
const allSourceList = computed<SourceItem[]>(() => {
  if (pluginSourceList.value.length === 0) {
    return [{ id: 'local', name: '本地', type: 'local' }];
  }
  return pluginSourceList.value;
});

// 当前选中的来源 ID
const selectedSourceId = ref<string>('');

const selectedSourceItem = computed(() =>
  allSourceList.value.find(s => s.id === selectedSourceId.value),
);

const selectedSourceName = computed(() =>
  selectedSourceItem.value?.name ?? '未知音源',
);

const isLocalSource = computed(() => selectedSourceItem.value?.type === 'local');

// ==================== 搜索状态 ====================
const searching = ref(false);
const loadingMore = ref(false);
const hasMore = ref(false);
const currentPage = ref(1);
const lxSearchResults = shallowRef<LxSearchResultItem[]>([]);
const pluginSearchResults = shallowRef<PluginSearchResult[]>([]);
const localSearchResults = shallowRef<Song[]>([]);
const localArtistResults = shallowRef<ArtistCatalogItem[]>([]);
const localAlbumResults = shallowRef<AlbumCatalogItem[]>([]);
const localPlaylistResults = shallowRef<Playlist[]>([]);
// 插件来源的歌手/专辑/歌单搜索结果
const pluginArtistResults = shallowRef<PluginArtistResult[]>([]);
const pluginAlbumResults = shallowRef<PluginAlbumResult[]>([]);
const pluginPlaylistResults = shallowRef<PluginPlaylistSearchResult[]>([]);
const resultsScrollRef = ref<HTMLElement | null>(null);

const catalogGridScrollTop = ref(0);
const catalogGridViewportHeight = ref(720);
const catalogGridWidth = ref(960);
// 列数断点基于窗口宽度（与本地专辑页一致），保证最小窗口下封面大小一致
const windowWidth = ref(window.innerWidth);
const CATALOG_GRID_H_GAP = 24;
const CATALOG_GRID_V_GAP = 40;
const CATALOG_GRID_OVERSCAN_ROWS = 2;

type CatalogGridEntry =
  | {
      type: 'artist';
      source: 'local';
      key: string;
      item: ArtistCatalogItem;
    }
  | {
      type: 'artist';
      source: 'plugin';
      key: string;
      item: PluginArtistResult;
    }
  | {
      type: 'album';
      source: 'local';
      key: string;
      item: AlbumCatalogItem;
    }
  | {
      type: 'album';
      source: 'plugin';
      key: string;
      item: PluginAlbumResult;
    }
  | {
      type: 'playlist';
      source: 'local';
      key: string;
      item: Playlist;
    }
  | {
      type: 'playlist';
      source: 'plugin';
      key: string;
      item: PluginPlaylistSearchResult;
    };

type VirtualCatalogGridRow = {
  key: string;
  start: number;
  items: CatalogGridEntry[];
};

const catalogGridItems = computed<CatalogGridEntry[]>(() => {
  if (activeSearchType.value === 'artist') {
    return [
      ...localArtistResults.value.map((item): CatalogGridEntry => ({
        type: 'artist',
        source: 'local',
        key: `artist-local-${item.id}`,
        item,
      })),
      ...pluginArtistResults.value.map((item): CatalogGridEntry => ({
        type: 'artist',
        source: 'plugin',
        key: `artist-plugin-${item.id}`,
        item,
      })),
    ];
  }

  if (activeSearchType.value === 'album') {
    return [
      ...localAlbumResults.value.map((item): CatalogGridEntry => ({
        type: 'album',
        source: 'local',
        key: `album-local-${item.key}`,
        item,
      })),
      ...pluginAlbumResults.value.map((item): CatalogGridEntry => ({
        type: 'album',
        source: 'plugin',
        key: `album-plugin-${item.id}`,
        item,
      })),
    ];
  }

  if (activeSearchType.value === 'playlist') {
    return [
      ...localPlaylistResults.value.map((item): CatalogGridEntry => ({
        type: 'playlist',
        source: 'local',
        key: `playlist-local-${item.id}`,
        item,
      })),
      ...pluginPlaylistResults.value.map((item): CatalogGridEntry => ({
        type: 'playlist',
        source: 'plugin',
        key: `playlist-plugin-${item.id}`,
        item,
      })),
    ];
  }

  return [];
});

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
  if (activeSearchType.value === 'artist') {
    return 156 + CATALOG_GRID_V_GAP;
  }

  const columns = Math.max(1, catalogGridColumns.value);
  const itemWidth = Math.max(120, (catalogGridWidth.value - CATALOG_GRID_H_GAP * (columns - 1)) / columns);
  return itemWidth + 78 + CATALOG_GRID_V_GAP;
});

const catalogGridRowCount = computed(() => Math.ceil(catalogGridItems.value.length / catalogGridColumns.value));
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
      key: `catalog-row-${activeSearchType.value}-${rowIndex}`,
      start: rowIndex * rowHeight,
      items: catalogGridItems.value.slice(startIndex, startIndex + catalogGridColumns.value),
    });
  }

  return rows;
});

const handleWindowResize = () => {
  windowWidth.value = window.innerWidth;
};

const syncCatalogGridVirtualScrollState = () => {
  const el = resultsScrollRef.value;
  if (!el) return;
  catalogGridScrollTop.value = el.scrollTop;
  catalogGridViewportHeight.value = el.clientHeight || catalogGridViewportHeight.value;
  catalogGridWidth.value = Math.max(320, el.clientWidth - 32);
};

const resetCatalogGridVirtualScroll = () => {
  catalogGridScrollTop.value = 0;
  const el = resultsScrollRef.value;
  if (!el) return;
  el.scrollTop = 0;
  catalogGridViewportHeight.value = el.clientHeight || catalogGridViewportHeight.value;
  catalogGridWidth.value = Math.max(320, el.clientWidth - 32);
};

// ResizeObserver：窗口/容器尺寸变化时同步虚拟滚动状态，避免网格列数和行高过期
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

// 封面加载任务版本号，用于在新搜索时取消旧任务
let coverLoadVersion = 0;
let coverLoadUiTimer: ReturnType<typeof setInterval> | null = null;

const clearCoverLoadUiTimer = () => {
  if (coverLoadUiTimer) {
    clearInterval(coverLoadUiTimer);
    coverLoadUiTimer = null;
  }
};

// 目录封面后台补获的视图刷新：lx 歌手/专辑（kw/wy）封面由 lxCatalogSearch 内部的
// fill* 系列后台补获（接口串行/小并发返回），但 pluginArtistResults/pluginAlbumResults
// 是 shallowRef，返回时可能仍有条目缺图。轮询比对快照，变化才替换数组触发重渲染；
// 全部补齐或超时后自动停止。
let catalogCoverRefreshVersion = 0;
let catalogCoverRefreshTimer: ReturnType<typeof setInterval> | null = null;

const stopCatalogCoverRefresh = () => {
  catalogCoverRefreshVersion += 1;
  if (catalogCoverRefreshTimer) {
    clearInterval(catalogCoverRefreshTimer);
    catalogCoverRefreshTimer = null;
  }
};

const watchCatalogCoverBackfill = <T,>(
  getItems: () => T[],
  pickUrl: (item: T) => string,
  commit: (items: T[]) => void,
) => {
  const version = ++catalogCoverRefreshVersion;
  if (catalogCoverRefreshTimer) clearInterval(catalogCoverRefreshTimer);
  let prev = '';
  catalogCoverRefreshTimer = setInterval(() => {
    if (version !== catalogCoverRefreshVersion) {
      clearInterval(catalogCoverRefreshTimer!);
      catalogCoverRefreshTimer = null;
      return;
    }
    const items = getItems();
    const settled = items.length === 0 || items.every(i => pickUrl(i));
    const snapshot = items.map(i => pickUrl(i) || '').join('|');
    if (snapshot !== prev) {
      prev = snapshot;
      commit([...items]);
    }
    if (settled) {
      clearInterval(catalogCoverRefreshTimer!);
      catalogCoverRefreshTimer = null;
    }
  }, 600);
  setTimeout(() => {
    if (version === catalogCoverRefreshVersion && catalogCoverRefreshTimer) {
      clearInterval(catalogCoverRefreshTimer);
      catalogCoverRefreshTimer = null;
    }
  }, 15000);
};

// 右键菜单
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuTargetSong = ref<Song | null>(null);

// 是否有搜索关键词
const hasQuery = computed(() => searchQuery.value.trim().length > 0);

// 当前类型的结果数量
const resultCount = computed(() => {
  if (activeSearchType.value === 'track') {
    if (isLocalSource.value) return localSearchResults.value.length;
    if (selectedSourceItem.value?.type === 'lx') return lxSearchResults.value.length;
    return pluginSearchResults.value.length;
  }
  if (isLocalSource.value) {
    if (activeSearchType.value === 'artist') return localArtistResults.value.length;
    if (activeSearchType.value === 'album') return localAlbumResults.value.length;
    if (activeSearchType.value === 'playlist') return localPlaylistResults.value.length;
  }
  // 插件来源
  if (activeSearchType.value === 'artist') return pluginArtistResults.value.length;
  if (activeSearchType.value === 'album') return pluginAlbumResults.value.length;
  if (activeSearchType.value === 'playlist') return pluginPlaylistResults.value.length;
  return 0;
});

// 当前类型是否无结果
const hasNoResults = computed(() => {
  if (activeSearchType.value === 'track') {
    return lxSearchResults.value.length === 0 && pluginSearchResults.value.length === 0 && localSearchResults.value.length === 0;
  }
  if (isLocalSource.value) {
    if (activeSearchType.value === 'artist') return localArtistResults.value.length === 0;
    if (activeSearchType.value === 'album') return localAlbumResults.value.length === 0;
    if (activeSearchType.value === 'playlist') return localPlaylistResults.value.length === 0;
  }
  // 插件来源
  if (activeSearchType.value === 'artist') return pluginArtistResults.value.length === 0;
  if (activeSearchType.value === 'album') return pluginAlbumResults.value.length === 0;
  if (activeSearchType.value === 'playlist') return pluginPlaylistResults.value.length === 0;
  return true;
});

// ==================== 在线歌曲结果转换（SongTable 容器） ====================

/** 将 PluginSearchResult 转换为 Song 用于展示和播放 */
function mfResultToSong(item: PluginSearchResult): Song {
  const artistNames = item.artist ? item.artist.split(/[、,/&]/).filter(Boolean).map(s => s.trim()) : ['未知歌手'];

  // 专辑名：优先用 item.album；为空时尝试从 rawData 提取
  let album = item.album || '';
  if (!album && item.rawData) {
    const raw = item.rawData;
    album = raw.al?.name || raw.album?.name || raw.albumName || '';
  }
  album = album || '未知专辑';

  // 时长：优先用 item.duration（已由 extractDurationMs 提取为毫秒）；
  // 为空时回退到 rawData 重新走统一的时长提取逻辑
  let durationMs = item.duration || 0;
  if ((!durationMs || durationMs <= 0) && item.rawData) {
    durationMs = extractDurationMs(item.rawData);
  }

  return {
    name: item.title,
    title: item.title,
    path: `plugin://${item.platform}/${item.id}`,
    artist: item.artist || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album,
    album_artist: item.artist || '未知歌手',
    album_key: `${album}-${item.artist || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: Math.floor((durationMs || 0) / 1000),
    cover_thumb_path: item.coverUrl || '',
    source_type: 'plugin',
    remote_source_id: `plugin://${item.platform}/${item.id}`,
    rawData: item,
  } as any;
}

/** 将 LxSearchResultItem 转换为 Song 用于展示和播放 */
function lxResultToSong(item: LxSearchResultItem): Song {
  const artistNames = item.singer ? item.singer.split('、').filter(Boolean) : ['未知歌手'];
  const songDuration = parseIntervalToSeconds(item.interval);
  const album = item.albumName || '未知专辑';
  return {
    name: item.name,
    title: item.name,
    path: `lx://${item.source}/${item.songmid}`,
    artist: item.singer || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album,
    album_artist: item.singer || '未知歌手',
    album_key: `${album}-${item.singer || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: songDuration,
    cover_thumb_path: item.img || '',
    source_type: 'remote',
    remote_source_id: `lx://${item.source}/${item.songmid}`,
    _hash: item.hash,
    _types: item._types,
    _copyrightId: item.copyrightId,
    _songmid: item.songmid,
    _source: item.source,
    _songId: item.songId,
    _strMediaMid: item.strMediaMid,
    _albumMid: item.albumMid,
    _albumId: item.albumId,
    rawData: item,
  } as any;
}

/** 音乐 tab 展示的歌曲：在线搜索结果（SongTable 容器），本地源直接使用本地 Song */
const onlineTrackSongs = computed<Song[]>(() => {
  if (isLocalSource.value) return localSearchResults.value;
  if (selectedSourceItem.value?.type === 'lx') {
    return lxSearchResults.value.map((item: LxSearchResultItem) => lxResultToSong(item));
  }
  return pluginSearchResults.value.map((item: PluginSearchResult) => mfResultToSong(item));
});

// ==================== 搜索逻辑 ====================
let searchAbortController: AbortController | null = null;

const withTimeoutFallback = async <T,>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>(resolve => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const performSearch = async () => {
  const query = searchQuery.value.trim();
  if (!query) {
    lxSearchResults.value = [];
    pluginSearchResults.value = [];
    localSearchResults.value = [];
    localArtistResults.value = [];
    localAlbumResults.value = [];
    localPlaylistResults.value = [];
    pluginArtistResults.value = [];
    pluginAlbumResults.value = [];
    pluginPlaylistResults.value = [];
    hasMore.value = false;
    return;
  }

  // 取消上一次搜索
  if (searchAbortController) {
    searchAbortController.abort();
  }
  searchAbortController = new AbortController();
  const activeController = searchAbortController;
  stopCatalogCoverRefresh();

  // 重置分页
  currentPage.value = 1;
  hasMore.value = false;
  searching.value = true;
  resetCatalogGridVirtualScroll();
  try {
    const source = selectedSourceItem.value;
    if (!source) return;

    if (source.type === 'local') {
      // 本地搜索：根据搜索类型分别索引
      pluginSearchResults.value = [];
      lxSearchResults.value = [];
      pluginArtistResults.value = [];
      pluginAlbumResults.value = [];
      pluginPlaylistResults.value = [];
      // 清空所有类型结果，仅填充当前类型
      localSearchResults.value = [];
      localArtistResults.value = [];
      localAlbumResults.value = [];
      localPlaylistResults.value = [];
      const lowerQuery = query.toLowerCase();

      if (activeSearchType.value === 'track') {
        // 音乐：通过 Rust 后端搜索本地音乐库（避免前端全量 canonicalSongs 内存过滤）
        const results = await libraryApi.searchLibrarySongs(query, 200);
        if (!activeController.signal.aborted) {
          localSearchResults.value = results;
        }
      } else if (activeSearchType.value === 'artist') {
        // 作者：从本地歌手索引过滤
        localArtistResults.value = artistList.value.filter(artist =>
          (artist.name || '').toLowerCase().includes(lowerQuery),
        ).slice(0, 200);
      } else if (activeSearchType.value === 'album') {
        // 专辑：从本地专辑索引过滤
        localAlbumResults.value = albumList.value.filter(album =>
          (album.name || '').toLowerCase().includes(lowerQuery) ||
          (album.artist || '').toLowerCase().includes(lowerQuery),
        ).slice(0, 200);
      } else if (activeSearchType.value === 'playlist') {
        // 歌单：从本地歌单过滤
        localPlaylistResults.value = playlists.value.filter(playlist =>
          (playlist.name || '').toLowerCase().includes(lowerQuery),
        ).slice(0, 200);
      }
      hasMore.value = false;
    } else if (source.type === 'lx' && source.lxSourceId) {
      // 落雪 LX 插件搜索
      pluginSearchResults.value = [];
      pluginArtistResults.value = [];
      pluginAlbumResults.value = [];
      pluginPlaylistResults.value = [];
      localSearchResults.value = [];
      const pluginId = source.source?.id || source.id;

      if (activeSearchType.value === 'track') {
        const result = await lxSearch(source.lxSourceId, query, 1);
        if (activeController.signal.aborted) return;
        lxSearchResults.value = result.list;
        hasMore.value = result.list.length >= result.limit;
        triggerCoverLoading();
      } else if (activeSearchType.value === 'artist') {
        lxSearchResults.value = [];
        const results = await lxCatalogSearch(source.lxSourceId, query, 'artist', 1) as LxArtistSearchResult[];
        if (activeController.signal.aborted) return;
        // 就地补充平台字段（不 spread 复制）：fillWyArtistAvatars 等后台 worker
        // 持续写入的是这批原始对象，watchCatalogCoverBackfill 才能把迟到头像刷进视图
        for (const item of results) {
          (item as any).platform = source.lxSourceId!;
          (item as any).platformId = item.id;
          (item as any).pluginId = pluginId;
        }
        pluginArtistResults.value = results as unknown as PluginArtistResult[];
        watchCatalogCoverBackfill(
          () => pluginArtistResults.value,
          i => i.avatarUrl,
          next => { pluginArtistResults.value = next; },
        );
        hasMore.value = false;
      } else if (activeSearchType.value === 'album') {
        lxSearchResults.value = [];
        const results = await lxCatalogSearch(source.lxSourceId, query, 'album', 1) as LxAlbumSearchResult[];
        if (activeController.signal.aborted) return;
        // 就地补充平台字段（不 spread 复制）：fill*AlbumCovers 的后台 worker
        // 持续写入的是这批原始对象，watchAlbumCoverBackfill 才能把迟到封面刷进视图
        for (const item of results) {
          (item as any).platform = source.lxSourceId!;
          (item as any).platformId = item.id;
          (item as any).pluginId = pluginId;
        }
        pluginAlbumResults.value = results as unknown as PluginAlbumResult[];
        watchCatalogCoverBackfill(
          () => pluginAlbumResults.value,
          i => i.coverUrl,
          next => { pluginAlbumResults.value = next; },
        );
        hasMore.value = false;
      } else {
        lxSearchResults.value = [];
        const results = await lxCatalogSearch(source.lxSourceId, query, 'playlist', 1) as LxPlaylistSearchResult[];
        if (activeController.signal.aborted) return;
        pluginPlaylistResults.value = results.map(item => ({
          ...item,
          platform: source.lxSourceId!,
          platformId: item.id,
          pluginId,
        }));
        hasMore.value = false;
      }
    } else if (source.type === 'musicfree' && source.source) {
      // MusicFree 插件搜索
      lxSearchResults.value = [];
      localSearchResults.value = [];
      localArtistResults.value = [];
      localAlbumResults.value = [];
      localPlaylistResults.value = [];

      if (activeSearchType.value === 'track') {
        // 音乐搜索
        pluginArtistResults.value = [];
        pluginAlbumResults.value = [];
        pluginPlaylistResults.value = [];
        const results = await pluginSearch(source.source, query, 1, 30);
        if (activeController.signal.aborted) return;
        pluginSearchResults.value = results;
        hasMore.value = results.length >= 30;
        triggerMfCoverLoading(source.source);
        void backfillWyTrackMeta(source.source, results);
        void backfillQqTrackMeta(source.source, results);
      } else if (activeSearchType.value === 'artist') {
        // 歌手搜索
        pluginSearchResults.value = [];
        if (pluginSupportsSearchType(source.source, 'artist')) {
          const results = await pluginArtistSearch(source.source, query, 1);
          if (activeController.signal.aborted) return;
          pluginArtistResults.value = results;
        } else {
          pluginArtistResults.value = [];
        }
        hasMore.value = false;
      } else if (activeSearchType.value === 'album') {
        // 专辑搜索
        pluginSearchResults.value = [];
        if (pluginSupportsSearchType(source.source, 'album')) {
          const results = await pluginAlbumSearch(source.source, query, 1);
          if (activeController.signal.aborted) return;
          pluginAlbumResults.value = results;
        } else {
          pluginAlbumResults.value = [];
        }
        hasMore.value = false;
      } else if (activeSearchType.value === 'playlist') {
        // 歌单搜索
        pluginSearchResults.value = [];
        if (pluginSupportsSearchType(source.source, 'sheet')) {
          const results = await pluginPlaylistSearch(source.source, query, 1);
          if (activeController.signal.aborted) return;
          pluginPlaylistResults.value = results;
        } else {
          pluginPlaylistResults.value = [];
        }
        hasMore.value = false;
      }
    }
  } catch (err) {
    if (!activeController.signal.aborted) {
      console.warn('[Search] failed:', err);
      lxSearchResults.value = [];
      pluginSearchResults.value = [];
      localSearchResults.value = [];
      localArtistResults.value = [];
      localAlbumResults.value = [];
      localPlaylistResults.value = [];
      pluginArtistResults.value = [];
      pluginAlbumResults.value = [];
      pluginPlaylistResults.value = [];
    }
  } finally {
    if (!activeController.signal.aborted) {
      searching.value = false;
      // 上报搜索行为到后台统计（fire-and-forget，失败静默）
      // 仅在确实存在音源时上报，避免无源退化场景下上报过时结果数
      if (selectedSourceItem.value) {
        reportSearch(query, selectedSourceName.value, resultCount.value);
      }
    }
  }
};

/** 加载下一页（SongTable 滚动接近底部时触发） */
const loadMore = async () => {
  if (loadingMore.value || !hasMore.value || searching.value) return;
  const query = searchQuery.value.trim();
  if (!query) return;

  // 本地搜索不分页
  if (isLocalSource.value) {
    hasMore.value = false;
    return;
  }

  loadingMore.value = true;
  const nextPage = currentPage.value + 1;
  try {
    const source = selectedSourceItem.value;
    if (!source) return;

    if (source.type === 'lx' && source.lxSourceId) {
      // 落雪 LX 插件分页
      const result = await lxSearch(source.lxSourceId, query, nextPage);
      if (result.list.length > 0) {
        currentPage.value = nextPage;
        lxSearchResults.value = [...lxSearchResults.value, ...result.list];
        hasMore.value = result.list.length >= result.limit;
        triggerCoverLoading();
      } else {
        hasMore.value = false;
      }
    } else if (source.type === 'musicfree' && source.source) {
      // MusicFree 插件分页
      const results = await pluginSearch(source.source, query, nextPage, 30);
      if (results.length > 0) {
        currentPage.value = nextPage;
        pluginSearchResults.value = [...pluginSearchResults.value, ...results];
        hasMore.value = results.length >= 30;
        triggerMfCoverLoading(source.source);
        void backfillWyTrackMeta(source.source, results);
        void backfillQqTrackMeta(source.source, results);
      } else {
        hasMore.value = false;
      }
    }
  } catch (err) {
    console.warn('[Search] loadMore failed:', err);
    hasMore.value = false;
  } finally {
    loadingMore.value = false;
  }
};

/** 滚动事件：接近底部时自动加载更多 */
const handleCatalogGridScroll = () => {
  syncCatalogGridVirtualScrollState();
};

/** 触发封面加载（滑动窗口并发版） */
function triggerCoverLoading() {
  const version = ++coverLoadVersion;
  clearCoverLoadUiTimer();
  // 只处理还没有封面（img 为 null）的项目，已失败的（''）不再重试
  const items = lxSearchResults.value.filter(item => item.img === null);
  if (items.length === 0) return;

  // 滑动窗口并发：始终保持 N 个请求在飞行中，一个完成立刻取下一个
  const CONCURRENCY = 8;
  let nextIdx = 0;
  let hasUpdate = false;

  const worker = async () => {
    while (nextIdx < items.length) {
      if (version !== coverLoadVersion) return; // 新搜索来了，停止旧任务
      const item = items[nextIdx++];
      try {
        // 每个请求最多等 8 秒，超时直接跳过
        const currentSource = selectedSourceItem.value;
        const pluginPicPromise = currentSource?.type === 'lx' && currentSource.source && currentSource.lxSourceId
          ? (async () => {
            await ensureLxPluginInstance(currentSource.source!);
            return lxPluginGetPic(currentSource.source!, currentSource.lxSourceId!, item);
          })()
          : Promise.resolve(null);
        const picUrl = await withTimeoutFallback(
          pluginPicPromise.then(url => url || lxGetPic(item)),
          8000,
          null,
        );
        if (version !== coverLoadVersion) return;
        if (picUrl) {
          item.img = picUrl;
          hasUpdate = true;
        } else {
          item.img = ''; // 标记为已尝试，避免重复请求
        }
      } catch {
        item.img = '';
      }
    }
  };

  // 启动 N 个 worker 并发消费队列
  const workers = Array.from({ length: CONCURRENCY }, () => worker());

  // 定时把已更新的封面刷到视图（500ms 一次，减少不必要的渲染）
  const uiTimer = setInterval(() => {
    if (version !== coverLoadVersion) {
      clearInterval(uiTimer);
      if (coverLoadUiTimer === uiTimer) {
        coverLoadUiTimer = null;
      }
      return;
    }
    if (hasUpdate) {
      hasUpdate = false;
      lxSearchResults.value = [...lxSearchResults.value];
    }
  }, 500);
  coverLoadUiTimer = uiTimer;

  // 全部完成后做最后一次刷新并清理定时器
  Promise.all(workers).then(() => {
    clearInterval(uiTimer);
    if (coverLoadUiTimer === uiTimer) {
      coverLoadUiTimer = null;
    }
    if (version === coverLoadVersion && hasUpdate) {
      lxSearchResults.value = [...lxSearchResults.value];
    }
  });
}

/**
 * 已尝试过补获封面的 MusicFree 结果项。
 *
 * MusicFree 的 coverUrl 是 string（空串既表示"没有"也表示"取过但失败"），
 * 无法像 LX 的 img 那样用 null/'' 区分"未尝试"和"已失败"。用 WeakSet 记录
 * 对象身份：新搜索会重建结果对象，天然重新尝试；loadMore 追加时旧项已在集合
 * 内，不会重复请求。
 */
const mfCoverAttempted = new WeakSet<PluginSearchResult>();

/** 判断当前音源是否为网易云（用于决定是否走官方 weapi 批量补全元信息） */
const isNeteaseSource = (pluginSource: PluginSource): boolean => {
  if (pluginSource.sources?.some(s => s === 'wy' || /网易云|netease/i.test(s))) return true;
  return /网易云|netease/i.test(pluginSource.name || '');
};

/**
 * 网易云音源：用官方 weapi 的 song/detail 批量补全封面与时长。
 *
 * 部分第三方网易云 MusicFree 插件（如时迁酱 v7）的 search 结果既没有可用的
 * artwork（weapi/search 响应里 album 只有 picId，没有 picUrl），也完全不返回
 * duration/dt 字段，导致列表里封面和时长都缺失。这里直接按歌曲 ID 批量补全，
 * 不依赖插件是否实现 getMusicInfo。
 */
async function backfillWyTrackMeta(pluginSource: PluginSource, items: PluginSearchResult[]) {
  if (!isNeteaseSource(pluginSource)) return;

  const version = coverLoadVersion;
  // 只补缺封面或缺时长、且 ID 是网易云纯数字 ID 的条目
  const pending = items.filter(item => (
    (!item.coverUrl || !item.duration) && /^\d+$/.test(String(item.id))
  ));
  if (pending.length === 0) return;

  const patches = await fetchWyTrackMetaByIds(pending.map(item => String(item.id)));
  if (patches.size === 0) return;
  // 补全期间用户可能已切换来源/重新搜索，丢弃过期结果
  if (version !== coverLoadVersion) return;

  let changed = false;
  for (const item of pending) {
    const patch = patches.get(String(item.id));
    if (!patch) continue;
    if (!item.coverUrl && patch.coverUrl) {
      item.coverUrl = patch.coverUrl;
      changed = true;
    }
    if (!item.duration && patch.durationMs > 0) {
      item.duration = patch.durationMs;
      changed = true;
    }
  }

  if (changed) {
    pluginSearchResults.value = [...pluginSearchResults.value];
  }
}

/**
 * QQ 音乐音源：按 songid 批量补全时长。
 *
 * QQ 插件 formatMusicItem 不输出时长、getMusicInfo 早退分支不回填，
 * 搜索结果整页无时长。宿主用 UniformRuleCtrl 一次批量查询补齐。
 */
async function backfillQqTrackMeta(pluginSource: PluginSource, items: PluginSearchResult[]) {
  const pending = items.filter(item => !item.duration && item.rawData?.id);
  if (pending.length === 0) return;

  const version = coverLoadVersion;
  await qqFillSongDurations(pluginSource, undefined, pending);
  if (version !== coverLoadVersion) return;
  if (pending.some(item => item.duration)) {
    pluginSearchResults.value = [...pluginSearchResults.value];
  }
}

/**
 * 触发 MusicFree 搜索结果的封面补获（滑动窗口并发版）。
 *
 * 部分平台的搜索接口不返回封面 URL（如网易云 weapi/search/get 的 album 只有
 * picId 没有 picUrl），需要调用插件的 getMusicInfo 逐条补获。与 LX 的
 * triggerCoverLoading 共用 coverLoadVersion / coverLoadUiTimer：两条路径互斥
 * （同一来源只会是 lx 或 musicfree 之一），共用可让切换来源时自动取消对方的
 * 在途任务，卸载时的既有清理也一并覆盖。
 */
function triggerMfCoverLoading(pluginSource: PluginSource) {
  const version = ++coverLoadVersion;
  clearCoverLoadUiTimer();
  // 处理缺封面或缺时长的项，入队即标记，避免并发重入时重复请求
  const items = pluginSearchResults.value.filter((item) => {
    if ((item.coverUrl && item.duration) || mfCoverAttempted.has(item)) return false;
    mfCoverAttempted.add(item);
    return true;
  });
  if (items.length === 0) return;

  // 滑动窗口并发：始终保持 N 个请求在飞行中，一个完成立刻取下一个
  const CONCURRENCY = 8;
  let nextIdx = 0;
  let hasUpdate = false;

  const worker = async () => {
    while (nextIdx < items.length) {
      if (version !== coverLoadVersion) return; // 新搜索/切换来源，停止旧任务
      const item = items[nextIdx++];
      try {
        // 每个请求最多等 8 秒，超时直接跳过
        // pluginGetCover 内部调用 getMusicInfo，会同时补全封面和时长
        const coverUrl = await withTimeoutFallback(
          pluginGetCover(pluginSource, item),
          8000,
          null,
        );
        if (version !== coverLoadVersion) return;
        if (coverUrl && coverUrl !== item.coverUrl) {
          item.coverUrl = coverUrl.startsWith('http://') ? coverUrl.replace('http://', 'https://') : coverUrl;
          hasUpdate = true;
        }
        // 时长已由 pluginGetCover 副作用补全到 item.duration
        if (item.duration) hasUpdate = true;
      } catch { /* 已在 WeakSet 中标记，不再重试 */ }
    }
  };

  // 启动 N 个 worker 并发消费队列
  const workers = Array.from({ length: CONCURRENCY }, () => worker());

  // 定时把已更新的封面刷到视图（500ms 一次，减少不必要的渲染）
  const uiTimer = setInterval(() => {
    if (version !== coverLoadVersion) {
      clearInterval(uiTimer);
      if (coverLoadUiTimer === uiTimer) {
        coverLoadUiTimer = null;
      }
      return;
    }
    if (hasUpdate) {
      hasUpdate = false;
      pluginSearchResults.value = [...pluginSearchResults.value];
    }
  }, 500);
  coverLoadUiTimer = uiTimer;

  // 全部完成后做最后一次刷新并清理定时器
  Promise.all(workers).then(() => {
    clearInterval(uiTimer);
    if (coverLoadUiTimer === uiTimer) {
      coverLoadUiTimer = null;
    }
    if (version === coverLoadVersion && hasUpdate) {
      pluginSearchResults.value = [...pluginSearchResults.value];
    }
  });
}

// 切换来源
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

// 窗口尺寸变化后重新校准选中项可见性：容器宽度随窗口自适应，
// 拖动窗口从最小尺寸恢复时滚动偏移可能停在可视区外
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

// 监听关键词变化（防抖）
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastQueryLength = 0;
watch(searchQuery, (newVal) => {
  // 上报输入字符数（仅统计新增字符，防抖批量上报）
  const newLen = (newVal || '').length;
  if (newLen > lastQueryLength) {
    reportInputStats(newLen - lastQueryLength);
  }
  lastQueryLength = newLen;

  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    performSearch();
  }, 400);
});

// 监听来源变化，立即重新搜索
watch(selectedSourceId, () => {
  if (restoringSession) return;
  performSearch();
});

// 监听搜索类型变化，重新搜索
watch(activeSearchType, () => {
  if (restoringSession) return;
  performSearch();
});

// 监听插件状态版本号：插件变更（排序/开关/更新/增删）时第一时间刷新搜索源列表
watch(pluginsVersion, () => {
  const prevSelectedId = selectedSourceId.value;
  refreshPluginSourceList();
  // 若当前选中的源已不存在（被禁用/删除），回退到第一个可用源
  const stillExists = allSourceList.value.some(s => s.id === prevSelectedId);
  if (!stillExists && allSourceList.value.length > 0) {
    selectedSourceId.value = allSourceList.value[0].id;
  }
});

// ==================== MusicFree 插件歌曲播放 ====================

const openAddToPlaylistSelection = () => {
  const song = contextMenuTargetSong.value;
  if (!song) return;

  // 缓存在线歌曲元信息到 songPool，确保歌单中能正确显示
  libraryStore.setExtraSong(song);

  // 触发原生收藏到歌单弹窗，同时传入完整 Song 对象用于持久化
  openAddToPlaylistDialog([song.path], { songs: [song] });
};

// ==================== 在线搜索右键：歌手/专辑导航 ====================

const handleOnlineViewArtist = async (song: Song) => {
  const artistName = song.effective_artist_names?.[0] || song.artist_names?.[0] || song.artist || '';
  if (!artistName || artistName === '未知歌手') {
    showToast('当前歌曲缺少歌手信息', 'info');
    return;
  }

  const pluginSource = selectedSourceItem.value?.source;
  if (!pluginSource) {
    showToast('当前音源不支持查看歌手', 'info');
    return;
  }

  // MusicFree 插件：搜索歌手后跳转到歌手详情页
  if (selectedSourceItem.value?.type === 'musicfree') {
    try {
      const results = await pluginArtistSearch(pluginSource, artistName, 1);
      if (results.length === 0) {
        showToast('未找到该歌手', 'info');
        return;
      }
      const artist = results[0];
      pushDetail({
        type: 'artist',
        title: artist.name,
        subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
        coverUrl: artist.avatarUrl,
        pluginSource,
        rawData: artist.rawData,
        platformId: artist.platformId || artist.id,
        engineType: 'musicfree',
      });
    } catch (e: any) {
      showToast(`查看歌手失败: ${e?.message || e}`, 'error');
    }
    return;
  }

  // LX 落雪源暂不支持歌手详情页
  showToast('当前音源暂不支持查看歌手', 'info');
};

const handleOnlineViewAlbum = async (song: Song) => {
  const albumName = song.album || '';
  if (!albumName || albumName === '未知专辑') {
    showToast('当前歌曲缺少专辑信息', 'info');
    return;
  }

  const pluginSource = selectedSourceItem.value?.source;
  if (!pluginSource) {
    showToast('当前音源不支持查看专辑', 'info');
    return;
  }

  // MusicFree 插件：搜索专辑后跳转到专辑详情页
  if (selectedSourceItem.value?.type === 'musicfree') {
    try {
      const results = await pluginAlbumSearch(pluginSource, albumName, 1);
      if (results.length === 0) {
        showToast('未找到该专辑', 'info');
        return;
      }
      const album = results[0];
      pushDetail({
        type: 'album',
        title: album.name,
        subtitle: album.artist,
        coverUrl: album.coverUrl,
        pluginSource,
        rawData: album.rawData,
        platformId: album.platformId || album.id,
        engineType: 'musicfree',
      });
    } catch (e: any) {
      showToast(`查看专辑失败: ${e?.message || e}`, 'error');
    }
    return;
  }

  // LX 落雪源暂不支持专辑详情页
  showToast('当前音源暂不支持查看专辑', 'info');
};

/** 播放在线搜索结果中的歌曲（本地/在线均由 playSong 解析协议） */
const handlePlaySong = (song: Song) => {
  void playSong(song, { insertAfterCurrent: true });
};

/** 在线搜索结果右键菜单（Song 对象直接作为菜单目标） */
const handleTrackContextMenu = (e: MouseEvent, song: Song) => {
  e.preventDefault();
  contextMenuTargetSong.value = song;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

const getCatalogEntryCover = (entry: CatalogGridEntry) => {
  const refreshFn = () => {
    if (activeSearchType.value === 'artist') pluginArtistResults.value = [...pluginArtistResults.value];
    else if (activeSearchType.value === 'album') pluginAlbumResults.value = [...pluginAlbumResults.value];
    else pluginPlaylistResults.value = [...pluginPlaylistResults.value];
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

const handleCatalogEntryClick = (entry: CatalogGridEntry) => {
  if (entry.type === 'artist') {
    if (entry.source === 'local') handleArtistClick(entry.item);
    else handlePluginArtistClick(entry.item);
    return;
  }

  if (entry.type === 'album') {
    if (entry.source === 'local') handleAlbumClick(entry.item);
    else handlePluginAlbumClick(entry.item);
    return;
  }

  if (entry.source === 'local') handlePlaylistClick(entry.item);
  else handlePluginPlaylistClick(entry.item);
};

// ==================== 本地歌手/专辑/歌单导航 ====================

const handleArtistClick = (artist: ArtistCatalogItem) => {
  void router.push({ path: '/', query: { view: 'artist', filter: artist.name } });
};

const handleAlbumClick = (album: AlbumCatalogItem) => {
  void router.push({ path: '/', query: { view: 'album', filter: album.key } });
};

const handlePlaylistClick = (playlist: Playlist) => {
  void router.push({ path: '/', query: { view: 'playlist', filter: playlist.id } });
};

// ==================== 插件歌手/专辑/歌单导航 ====================

const onlineDetailStore = useOnlineDetailStore();

/** 打开在线详情容器（帧栈导航统一入口）：进入详情流时本页（一级）由 onBeforeUnmount 快照缓存 */
function pushDetail(context: Parameters<typeof openOnlineDetail>[0]) {
  openOnlineDetail(context);
}

/** 根据 pluginId 查找对应的 PluginSource */
function findPluginSource(pluginId: string): PluginSource | undefined {
  const item = pluginSourceList.value.find(s => s.id === pluginId && s.type === 'musicfree');
  return item?.source;
}

const handlePluginArtistClick = (artist: PluginArtistResult) => {
  if (selectedSourceItem.value?.type === 'lx') {
    const lxSourceId = selectedSourceItem.value.lxSourceId!;
    pushDetail({
      type: 'artist',
      title: artist.name,
      subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
      description: artist.description || '',
      coverUrl: artist.avatarUrl,
      pluginSource: selectedSourceItem.value.source!,
      rawData: artist.rawData,
      platformId: artist.platformId || artist.id,
      engineType: 'lx',
      lxSourceId,
    });
    return;
  }
  const pluginSource = findPluginSource(artist.pluginId);
  if (!pluginSource) {
    void router.push({ path: '/search', query: { q: artist.name } });
    return;
  }
  pushDetail({
    type: 'artist',
    title: artist.name,
    subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
    description: artist.description || '',
    coverUrl: artist.avatarUrl,
    pluginSource,
    rawData: artist.rawData,
    platformId: artist.platformId || artist.id,
    engineType: 'musicfree',
  });
};

const handlePluginAlbumClick = (album: PluginAlbumResult) => {
  if (selectedSourceItem.value?.type === 'lx') {
    const lxSourceId = selectedSourceItem.value.lxSourceId!;
    pushDetail({
      type: 'album',
      title: album.name,
      subtitle: album.artist,
      coverUrl: album.coverUrl,
      pluginSource: selectedSourceItem.value.source!,
      rawData: album.rawData,
      platformId: album.platformId || album.id,
      engineType: 'lx',
      lxSourceId,
    });
    return;
  }
  const pluginSource = findPluginSource(album.pluginId);
  if (!pluginSource) {
    void router.push({ path: '/search', query: { q: album.name } });
    return;
  }
  pushDetail({
    type: 'album',
    title: album.name,
    subtitle: album.artist,
    coverUrl: album.coverUrl,
    pluginSource,
    rawData: album.rawData,
    platformId: album.platformId || album.id,
    engineType: 'musicfree',
  });
};

const handlePluginPlaylistClick = (playlist: PluginPlaylistSearchResult) => {
  if (selectedSourceItem.value?.type === 'lx') {
    const lxSourceId = selectedSourceItem.value.lxSourceId!;
    pushDetail({
      type: 'playlist',
      title: playlist.title,
      subtitle: playlist.trackCount ? `${playlist.trackCount} 首` : (playlist.artist || ''),
      coverUrl: playlist.coverUrl,
      pluginSource: selectedSourceItem.value.source!,
      rawData: playlist.rawData,
      platformId: playlist.platformId || playlist.id,
      engineType: 'lx',
      lxSourceId,
    });
    return;
  }
  const pluginSource = findPluginSource(playlist.pluginId);
  if (!pluginSource) {
    void router.push({ path: '/search', query: { q: playlist.title } });
    return;
  }
  pushDetail({
    type: 'playlist',
    title: playlist.title,
    subtitle: playlist.trackCount ? `${playlist.trackCount} 首` : (playlist.artist || ''),
    coverUrl: playlist.coverUrl,
    pluginSource,
    rawData: playlist.rawData,
    platformId: playlist.platformId || playlist.id,
    engineType: 'musicfree',
  });
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
      if (activeSearchType.value === 'artist') pluginArtistResults.value = [...pluginArtistResults.value];
      else if (activeSearchType.value === 'album') pluginAlbumResults.value = [...pluginAlbumResults.value];
      else pluginPlaylistResults.value = [...pluginPlaylistResults.value];
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
  // 通过 songPool O(1) 查找封面，避免遍历 canonicalSongs 数组
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
  // 尝试用歌单内第一首歌的封面
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

// ==================== 搜索结果快照（进详情 → 返回时免重搜） ====================

/** 快照当前搜索状态（各 tab 结果 + 分页 + 当前 tab 滚动），供从在线详情返回时直接还原，避免重复请求触发风控 */
function captureResultsSnapshot(): SearchResultsSnapshot {
  return {
    hasMore: hasMore.value,
    currentPage: currentPage.value,
    lists: {
      lxSearchResults: [...lxSearchResults.value],
      pluginSearchResults: [...pluginSearchResults.value],
      localSearchResults: [...localSearchResults.value],
      localArtistResults: [...localArtistResults.value],
      localAlbumResults: [...localAlbumResults.value],
      localPlaylistResults: [...localPlaylistResults.value],
      pluginArtistResults: [...pluginArtistResults.value],
      pluginAlbumResults: [...pluginAlbumResults.value],
      pluginPlaylistResults: [...pluginPlaylistResults.value],
    },
    scrollTop: catalogGridScrollTop.value,
  };
}

/** 还原搜索状态快照（由 onMounted 恢复会话时调用，仅当关键词未变时） */
function restoreResultsSnapshot(snapshot: SearchResultsSnapshot) {
  hasMore.value = snapshot.hasMore;
  currentPage.value = snapshot.currentPage;
  lxSearchResults.value = snapshot.lists.lxSearchResults as LxSearchResultItem[];
  pluginSearchResults.value = snapshot.lists.pluginSearchResults as PluginSearchResult[];
  localSearchResults.value = snapshot.lists.localSearchResults as Song[];
  localArtistResults.value = snapshot.lists.localArtistResults as ArtistCatalogItem[];
  localAlbumResults.value = snapshot.lists.localAlbumResults as AlbumCatalogItem[];
  localPlaylistResults.value = snapshot.lists.localPlaylistResults as Playlist[];
  pluginArtistResults.value = snapshot.lists.pluginArtistResults as PluginArtistResult[];
  pluginAlbumResults.value = snapshot.lists.pluginAlbumResults as PluginAlbumResult[];
  pluginPlaylistResults.value = snapshot.lists.pluginPlaylistResults as PluginPlaylistSearchResult[];
  searching.value = false;
  loadingMore.value = false;
  // 恢复虚拟网格滚动位置（artist/album/playlist tab；track tab 由 SongTable 滚动记忆恢复）
  if (typeof snapshot.scrollTop === 'number' && snapshot.scrollTop > 0) {
    catalogGridScrollTop.value = snapshot.scrollTop;
    nextTick(() => {
      requestAnimationFrame(() => {
        const el = resultsScrollRef.value;
        if (el) el.scrollTop = snapshot.scrollTop!;
      });
    });
  }
}

// 初始化
onMounted(() => {
  uiStore.showPlayerDetail = false;
  window.addEventListener('resize', handleWindowResize);
  refreshPluginSourceList();
  // 从在线详情返回：恢复离开前的搜索 tab、插件源与结果快照（免重搜防风控）；
  // 全新进入（含插件已不存在）则初始化为第一个可用源
  const cache = onlineDetailStore.consumeSearchPageCache();
  const restoredSourceId = cache?.selectedSourceId ?? '';
  // 仅当恢复的插件源仍存在时才还原其结果快照；源已失效则重新搜索新源
  const sourceRestored = !!(restoredSourceId && allSourceList.value.some(s => s.id === restoredSourceId));
  restoringSession = true;
  if (sourceRestored) {
    selectedSourceId.value = restoredSourceId;
  } else if (allSourceList.value.length > 0) {
    selectedSourceId.value = allSourceList.value[0].id;
  }
  if (cache?.activeSearchType) {
    activeSearchType.value = cache.activeSearchType;
  }
  setupScrollResizeObserver();
  if (!hasQuery.value) {
    void nextTick(() => { restoringSession = false; });
    return;
  }
  if (cache?.snapshot && sourceRestored) {
    restoreResultsSnapshot(cache.snapshot);
  } else {
    performSearch();
  }
  void nextTick(() => { restoringSession = false; });
});

// resultsScrollRef 在 track/catalog 视图切换时重新挂载，需重新绑定 ResizeObserver
watch(resultsScrollRef, () => setupScrollResizeObserver());

// 一级页面缓存：进入在线详情流时快照搜索状态（tab + 源 + 各 tab 结果 + 滚动），
// 返回时免重搜（防风控）；切换插件/顶部 tab 由 watcher 重新加载；离开到其他一级页面时销毁。
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleWindowResize);
  searchAbortController?.abort();
  searchAbortController = null;
  scrollResizeObserver?.disconnect();
  scrollResizeObserver = null;
  coverLoadVersion += 1;
  clearCoverLoadUiTimer();
  stopCatalogCoverRefresh();
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  if (playbackStore.tempQueue.length > 0) {
    playbackStore.tempQueue = [];
  }
  // 进入在线详情：快照搜索页状态暂存，返回时恢复；
  // 其他去向（真正离开搜索页）：销毁缓存
  if (router.currentRoute.value.path === '/online-detail') {
    syncCatalogGridVirtualScrollState();
    onlineDetailStore.setSearchPageCache({
      selectedSourceId: selectedSourceId.value,
      activeSearchType: activeSearchType.value,
      snapshot: captureResultsSnapshot(),
    });
  } else {
    onlineDetailStore.clearSearchPageCache();
  }
});
</script>

<style scoped>
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
