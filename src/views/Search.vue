<template>
  <div class="flex flex-col h-full">
    <div class="px-6 shrink-0 select-none">
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

        <div class="flex items-center gap-2 min-w-0 shrink-0">
          <span v-if="searchQuery.trim()" class="text-[clamp(0.75rem,0.9vw,0.875rem)] text-black/50 dark:text-white/50 truncate max-w-[16rem]">
            "{{ searchQuery }}" · {{ resultCount }} 个结果
          </span>
        </div>
      </div>
    </div>

    <div class="flex-1 flex overflow-hidden relative">
      <section class="flex-1 flex overflow-hidden relative">
        <transition name="page-fade">
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

        <div v-else-if="searching" key="searching" class="absolute inset-0 flex items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
            <svg class="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p class="text-sm">正在从 {{ selectedSourceName }} 搜索…</p>
          </div>
        </div>

        <div v-else-if="!hasQuery" key="no-query" class="absolute inset-0 flex flex-col items-center justify-center text-black/30 dark:text-white/30">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p class="text-base font-medium">在上方搜索框输入关键词</p>
          <p class="text-sm mt-1">结果来自 {{ selectedSourceName }}</p>
        </div>

        <div v-else-if="hasNoResults" key="no-results" class="absolute inset-0 flex flex-col items-center justify-center text-black/40 dark:text-white/40">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="text-base font-medium">没有找到与"{{ searchQuery }}"相关的内容</p>
          <p class="text-sm mt-1">试试更换音源或调整关键词</p>
        </div>

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
                class="search-card rounded-xl p-3 transition-colors cursor-pointer group hover:bg-black/5 dark:hover:bg-white/5"
                :class="[
                  entry.type === 'artist' ? 'flex flex-col items-center gap-2' : 'flex flex-col gap-2',
                  cardHopDirections[entry.key] === 'left' ? 'hop-left' : cardHopDirections[entry.key] === 'right' ? 'hop-right' : ''
                ]"
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

let restoringSession = false;

const handleSearchTypeChange = (type: SearchTypeKey) => {
  activeSearchType.value = type;
};

// ==================== 来源列表（从插件加载，无插件则索引本地）====================
type SourceItem = {
  id: string;
  name: string;
  type: 'musicfree' | 'anime' | 'lx' | 'local';
  source?: PluginSource;
  lxSourceId?: LxSourceId;
};

const pluginSourceList = ref<SourceItem[]>([]);

const VALID_LX_SOURCES: ReadonlySet<string> = new Set(['kw', 'kg', 'tx', 'wy', 'mg']);

function refreshPluginSourceList() {
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
      items.push({ id: p.id, name: p.name, type: 'musicfree', source: p });
    } else if (p.format === 'anime') {
      items.push({ id: p.id, name: p.name, type: 'anime', source: p });
    } else if (p.format === 'lx' && p.sources.length > 0) {
      const lxSources = p.sources.filter(s => VALID_LX_SOURCES.has(s)) as LxSourceId[];
      if (lxSources.length === 0) continue;

      if (lxSources.length === 1) {
        items.push({ id: p.id, name: p.name, type: 'lx', source: p, lxSourceId: lxSources[0] });
      } else {
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

const allSourceList = computed<SourceItem[]>(() => {
  if (pluginSourceList.value.length === 0) {
    return [{ id: 'local', name: '本地', type: 'local' }];
  }
  return pluginSourceList.value;
});

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
const pluginArtistResults = shallowRef<PluginArtistResult[]>([]);
const pluginAlbumResults = shallowRef<PluginAlbumResult[]>([]);
const pluginPlaylistResults = shallowRef<PluginPlaylistSearchResult[]>([]);
const resultsScrollRef = ref<HTMLElement | null>(null);

const catalogGridScrollTop = ref(0);
const catalogGridViewportHeight = ref(720);
const catalogGridWidth = ref(960);
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

let coverLoadVersion = 0;
let coverLoadUiTimer: ReturnType<typeof setInterval> | null = null;

const clearCoverLoadUiTimer = () => {
  if (coverLoadUiTimer) {
    clearInterval(coverLoadUiTimer);
    coverLoadUiTimer = null;
  }
};

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

const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuTargetSong = ref<Song | null>(null);

const hasQuery = computed(() => searchQuery.value.trim().length > 0);

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
  if (activeSearchType.value === 'artist') return pluginArtistResults.value.length;
  if (activeSearchType.value === 'album') return pluginAlbumResults.value.length;
  if (activeSearchType.value === 'playlist') return pluginPlaylistResults.value.length;
  return 0;
});

const hasNoResults = computed(() => {
  if (activeSearchType.value === 'track') {
    return lxSearchResults.value.length === 0 && pluginSearchResults.value.length === 0 && localSearchResults.value.length === 0;
  }
  if (isLocalSource.value) {
    if (activeSearchType.value === 'artist') return localArtistResults.value.length === 0;
    if (activeSearchType.value === 'album') return localAlbumResults.value.length === 0;
    if (activeSearchType.value === 'playlist') return localPlaylistResults.value.length === 0;
  }
  if (activeSearchType.value === 'artist') return pluginArtistResults.value.length === 0;
  if (activeSearchType.value === 'album') return pluginAlbumResults.value.length === 0;
  if (activeSearchType.value === 'playlist') return pluginPlaylistResults.value.length === 0;
  return true;
});

// ==================== 在线歌曲结果转换（SongTable 容器） ====================

function mfResultToSong(item: PluginSearchResult): Song {
  const artistNames = item.artist ? item.artist.split(/[、,/&]/).filter(Boolean).map(s => s.trim()) : ['未知歌手'];

  let album = item.album || '';
  if (!album && item.rawData) {
    const raw = item.rawData;
    album = raw.al?.name || raw.album?.name || raw.albumName || '';
  }
  album = album || '未知专辑';

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

  if (searchAbortController) {
    searchAbortController.abort();
  }
  searchAbortController = new AbortController();
  const activeController = searchAbortController;
  stopCatalogCoverRefresh();

  currentPage.value = 1;
  hasMore.value = false;
  searching.value = true;
  resetCatalogGridVirtualScroll();
  try {
    const source = selectedSourceItem.value;
    if (!source) return;

    if (source.type === 'local') {
      pluginSearchResults.value = [];
      lxSearchResults.value = [];
      pluginArtistResults.value = [];
      pluginAlbumResults.value = [];
      pluginPlaylistResults.value = [];
      localSearchResults.value = [];
      localArtistResults.value = [];
      localAlbumResults.value = [];
      localPlaylistResults.value = [];
      const lowerQuery = query.toLowerCase();

      if (activeSearchType.value === 'track') {
        const results = await libraryApi.searchLibrarySongs(query, 200);
        if (!activeController.signal.aborted) {
          localSearchResults.value = results;
        }
      } else if (activeSearchType.value === 'artist') {
        localArtistResults.value = artistList.value.filter(artist =>
          (artist.name || '').toLowerCase().includes(lowerQuery),
        ).slice(0, 200);
      } else if (activeSearchType.value === 'album') {
        localAlbumResults.value = albumList.value.filter(album =>
          (album.name || '').toLowerCase().includes(lowerQuery) ||
          (album.artist || '').toLowerCase().includes(lowerQuery),
        ).slice(0, 200);
      } else if (activeSearchType.value === 'playlist') {
        localPlaylistResults.value = playlists.value.filter(playlist =>
          (playlist.name || '').toLowerCase().includes(lowerQuery),
        ).slice(0, 200);
      }
      hasMore.value = false;
    } else if (source.type === 'lx' && source.lxSourceId) {
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
    } else if ((source.type === 'musicfree' || source.type === 'anime') && source.source) {
      lxSearchResults.value = [];
      localSearchResults.value = [];
      localArtistResults.value = [];
      localAlbumResults.value = [];
      localPlaylistResults.value = [];

      if (activeSearchType.value === 'track') {
        pluginArtistResults.value = [];
        pluginAlbumResults.value = [];
        pluginPlaylistResults.value = [];
        const results = await pluginSearch(source.source, query, 1, 30);
        if (activeController.signal.aborted) return;
        pluginSearchResults.value = results;
        hasMore.value = results.length >= 30;
        triggerMfCoverLoading(source.source);
        if (source.type === 'musicfree') {
          void backfillWyTrackMeta(source.source, results);
          void backfillQqTrackMeta(source.source, results);
        }
      } else if (activeSearchType.value === 'artist') {
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
      if (selectedSourceItem.value) {
        reportSearch(query, selectedSourceName.value, resultCount.value);
      }
    }
  }
};

const loadMore = async () => {
  if (loadingMore.value || !hasMore.value || searching.value) return;
  const query = searchQuery.value.trim();
  if (!query) return;

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
      const result = await lxSearch(source.lxSourceId, query, nextPage);
      if (result.list.length > 0) {
        currentPage.value = nextPage;
        lxSearchResults.value = [...lxSearchResults.value, ...result.list];
        hasMore.value = result.list.length >= result.limit;
        triggerCoverLoading();
      } else {
        hasMore.value = false;
      }
    } else if ((source.type === 'musicfree' || source.type === 'anime') && source.source) {
      const results = await pluginSearch(source.source, query, nextPage, 30);
      if (results.length > 0) {
        currentPage.value = nextPage;
        pluginSearchResults.value = [...pluginSearchResults.value, ...results];
        hasMore.value = results.length >= 30;
        triggerMfCoverLoading(source.source);
        if (source.type === 'musicfree') {
          void backfillWyTrackMeta(source.source, results);
          void backfillQqTrackMeta(source.source, results);
        }
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

const handleCatalogGridScroll = () => {
  syncCatalogGridVirtualScrollState();
};

function triggerCoverLoading() {
  const version = ++coverLoadVersion;
  clearCoverLoadUiTimer();
  const items = lxSearchResults.value.filter(item => item.img === null);
  if (items.length === 0) return;

  const CONCURRENCY = 8;
  let nextIdx = 0;
  let hasUpdate = false;

  const worker = async () => {
    while (nextIdx < items.length) {
      if (version !== coverLoadVersion) return;
      const item = items[nextIdx++];
      try {
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
          item.img = '';
        }
      } catch {
        item.img = '';
      }
    }
  };

  const workers = Array.from({ length: CONCURRENCY }, () => worker());

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

const mfCoverAttempted = new WeakSet<PluginSearchResult>();

const isNeteaseSource = (pluginSource: PluginSource): boolean => {
  if (pluginSource.sources?.some(s => s === 'wy' || /网易云|netease/i.test(s))) return true;
  return /网易云|netease/i.test(pluginSource.name || '');
};

async function backfillWyTrackMeta(pluginSource: PluginSource, items: PluginSearchResult[]) {
  if (!isNeteaseSource(pluginSource)) return;

  const version = coverLoadVersion;
  const pending = items.filter(item => (
    (!item.coverUrl || !item.duration) && /^\d+$/.test(String(item.id))
  ));
  if (pending.length === 0) return;

  const patches = await fetchWyTrackMetaByIds(pending.map(item => String(item.id)));
  if (patches.size === 0) return;
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

function triggerMfCoverLoading(pluginSource: PluginSource) {
  const version = ++coverLoadVersion;
  clearCoverLoadUiTimer();
  const items = pluginSearchResults.value.filter((item) => {
    if ((item.coverUrl && item.duration) || mfCoverAttempted.has(item)) return false;
    mfCoverAttempted.add(item);
    return true;
  });
  if (items.length === 0) return;

  const CONCURRENCY = 8;
  let nextIdx = 0;
  let hasUpdate = false;

  const worker = async () => {
    while (nextIdx < items.length) {
      if (version !== coverLoadVersion) return;
      const item = items[nextIdx++];
      try {
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
        if (item.duration) hasUpdate = true;
      } catch { /* 已在 WeakSet 中标记，不再重试 */ }
    }
  };

  const workers = Array.from({ length: CONCURRENCY }, () => worker());

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

const handleSelectSource = (source: SourceItem) => {
  selectedSourceId.value = source.id;
};


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
  nextTick(() => scrollSelectedSourceIntoView());
});

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

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastQueryLength = 0;
watch(searchQuery, (newVal) => {
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

watch(selectedSourceId, () => {
  if (restoringSession) return;
  performSearch();
});

watch(activeSearchType, () => {
  if (restoringSession) return;
  performSearch();
});

watch(pluginsVersion, () => {
  const prevSelectedId = selectedSourceId.value;
  refreshPluginSourceList();
  const stillExists = allSourceList.value.some(s => s.id === prevSelectedId);
  if (!stillExists && allSourceList.value.length > 0) {
    selectedSourceId.value = allSourceList.value[0].id;
  }
});

// ==================== MusicFree 插件歌曲播放 ====================

const openAddToPlaylistSelection = () => {
  const song = contextMenuTargetSong.value;
  if (!song) return;

  libraryStore.setExtraSong(song);

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

  showToast('当前音源暂不支持查看专辑', 'info');
};

const handlePlaySong = (song: Song) => {
  void playSong(song, { insertAfterCurrent: true });
};

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

function pushDetail(context: Parameters<typeof openOnlineDetail>[0]) {
  openOnlineDetail(context);
}

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

// ==================== 搜索结果快照（进详情 → 返回时免重搜） ====================

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

onMounted(() => {
  uiStore.showPlayerDetail = false;
  window.addEventListener('resize', handleWindowResize);
  refreshPluginSourceList();
  const cache = onlineDetailStore.consumeSearchPageCache();
  const restoredSourceId = cache?.selectedSourceId ?? '';
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

watch(resultsScrollRef, () => setupScrollResizeObserver());

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

/* ==================== 搜索网格卡片悬停跳跃动画 ==================== */
.search-card {
  transition: background-color 0.2s ease, opacity 0.2s ease, transform 0.25s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.search-card.hop-right:hover {
  transform: translateX(12px);
  animation: search-card-hop-right 0.36s;
}

.search-card.hop-left:hover {
  transform: translateX(-12px);
  animation: search-card-hop-left 0.36s;
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
