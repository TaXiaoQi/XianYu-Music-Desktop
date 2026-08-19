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
        <!-- 来源横向平铺选择 -->
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

        <!-- 搜索关键词 + 结果数 -->
        <div class="flex items-center gap-2 min-w-0">
          <span v-if="searchQuery.trim()" class="text-[clamp(0.75rem,0.9vw,0.875rem)] text-black/50 dark:text-white/50 truncate">
            "{{ searchQuery }}" · {{ resultCount }} 个结果
          </span>
        </div>
      </div>
    </div>

    <!-- 搜索结果列表 -->
    <div class="flex-1 flex overflow-hidden relative">
      <section class="flex-1 flex overflow-hidden">
        <transition name="page-fade" mode="out-in">
        <!-- 加载中 -->
        <div v-if="searching" key="searching" class="flex-1 flex items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
            <svg class="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p class="text-sm">正在从 {{ selectedSourceName }} 搜索…</p>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else-if="!hasQuery" key="no-query" class="flex-1 flex flex-col items-center justify-center text-black/30 dark:text-white/30">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p class="text-base font-medium">在上方搜索框输入关键词</p>
          <p class="text-sm mt-1">结果来自 {{ selectedSourceName }}</p>
        </div>

        <!-- 无结果 -->
        <div v-else-if="hasNoResults" key="no-results" class="flex-1 flex flex-col items-center justify-center text-black/40 dark:text-white/40">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="text-base font-medium">没有找到与"{{ searchQuery }}"相关的内容</p>
          <p class="text-sm mt-1">试试更换音源或调整关键词</p>
        </div>

        <!-- 音乐搜索结果列表 -->
        <div
          v-else-if="activeSearchType === 'track'"
          key="track"
          ref="resultsScrollRef"
          class="flex-1 overflow-y-auto custom-scrollbar"
          @scroll="handleScroll"
        >
          <div
            v-if="isLocalSource"
            class="sticky top-0 z-10 grid grid-cols-[56px_60px_minmax(160px,1.4fr)_minmax(120px,1fr)_minmax(120px,1fr)_80px] border-b border-black/5 bg-white/80 text-xs text-black/40 backdrop-blur-md dark:border-white/5 dark:bg-neutral-900/80 dark:text-white/40"
          >
            <div class="px-4 py-2 text-center">#</div>
            <div class="px-2 py-2"></div>
            <div class="px-2 py-2">歌曲</div>
            <div class="px-2 py-2">歌手</div>
            <div class="px-2 py-2">专辑</div>
            <div class="px-4 py-2 text-right">时长</div>
          </div>

          <div class="relative w-full" :style="{ height: `${trackVirtualTotalHeight}px` }">
            <div
              v-for="entry in virtualTrackItems"
              :key="entry.key"
              class="absolute left-0 grid w-full grid-cols-[56px_60px_minmax(160px,1.4fr)_minmax(120px,1fr)_minmax(120px,1fr)_80px] items-center border-b border-black/5 cursor-default select-none transition-colors hover:bg-black/5 dark:border-white/5 dark:hover:bg-white/5"
              :style="{ height: `${TRACK_ROW_HEIGHT}px`, transform: `translateY(${entry.start}px)` }"
              @click="handleVirtualTrackClick(entry)"
              @dblclick="handleVirtualTrackDoubleClick(entry)"
              @contextmenu="handleVirtualTrackContextMenu($event, entry)"
            >
              <div class="px-4 text-center text-xs text-black/40 dark:text-white/40">
                {{ entry.globalIndex + 1 }}
              </div>
              <div class="px-2">
                <div
                  class="w-11 h-11 rounded-lg bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-lg font-black shrink-0"
                  :data-cover-path="getVirtualTrackCoverPath(entry)"
                >
                  <img
                    v-if="getVirtualTrackCoverUrl(entry)"
                    :src="getVirtualTrackCoverUrl(entry)"
                    class="w-full h-full object-cover"
                    alt=""
                    loading="lazy"
                    referrerpolicy="no-referrer"
                    @error="handleVirtualTrackImageError($event, entry)"
                  />
                  <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
              </div>
              <div class="truncate px-2 text-sm font-medium text-black dark:text-white">
                {{ getVirtualTrackTitle(entry) }}
              </div>
              <div class="truncate px-2 text-sm text-black/60 dark:text-white/60">
                {{ getVirtualTrackArtist(entry) }}
              </div>
              <div class="truncate px-2 text-sm text-black/40 dark:text-white/40">
                {{ getVirtualTrackAlbum(entry) }}
              </div>
              <div class="whitespace-nowrap px-4 text-right text-xs text-black/40 dark:text-white/40">
                {{ getVirtualTrackDuration(entry) }}
              </div>
            </div>
          </div>

          <!-- 加载更多指示器 -->
          <div v-if="loadingMore" class="flex items-center justify-center py-4 text-black/40 dark:text-white/40">
            <svg class="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="text-sm">加载更多…</span>
          </div>
          <div v-else-if="!hasMore && (lxSearchResults.length > 0 || pluginSearchResults.length > 0 || localSearchResults.length > 0)" class="flex items-center justify-center py-4 text-xs text-black/30 dark:text-white/30">
            没有更多了
          </div>
        </div>

        <!-- 歌手/专辑/歌单搜索结果：按行虚拟滚动，避免大量卡片常驻 DOM -->
        <div
          v-else-if="activeSearchType === 'artist' || activeSearchType === 'album' || activeSearchType === 'playlist'"
          :key="activeSearchType"
          ref="resultsScrollRef"
          class="flex-1 overflow-y-auto custom-scrollbar p-4"
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
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
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
import { launchFlyingCover } from '../composables/useFlyingCover';
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
} from '../services/lxMusicSdk';
import { parseIntervalToSeconds } from '../utils/remoteSong';
import { cacheLxSong } from '../services/lxSongCache';
import { getDisplayCoverUrl, tryProxyImage } from '../utils/coverProxy';
import {
  getStoredPlugins,
  pluginsVersion,
  pluginSearch,
  pluginGetMusicInfo,
  pluginGetBakaMusicInfo,
  isBakaPlugin,
  pluginGetLyric,
  pluginGetCover,
  getLastPluginError,
  pluginArtistSearch,
  pluginAlbumSearch,
  pluginPlaylistSearch,
  pluginSupportsSearchType,
} from '../services/pluginEngine';
import { ensureLxPluginInstance, lxPluginGetPic } from '../services/lxPluginEngine';
import type { PluginArtistResult, PluginAlbumResult } from '../services/pluginEngine';
import type { PluginSource, PluginSearchResult, PluginPlaylistSearchResult } from '../types';
import { useOnlineDetailStore, type SourceSearchType } from '../features/onlineDetail/store';
import { cacheLxSongInfo } from '../services/lxLyricFetcher';
import { useSettingsStore } from '../features/settings/store';
import { extractCoverUrl, extractDuration } from '../services/pluginResultMappers';
import { fetchWyTrackMetaByIds } from '../services/playlistImport';
import { reportSearch, reportInputStats } from '../services/usageStats';

import DragGhost from '../components/common/DragGhost.vue';
const SongContextMenu = defineAsyncComponent(() => import('../components/overlays/SongContextMenu.vue'));

const formatSearchDuration = (seconds: number): string => {
  if (!seconds || Number.isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const router = useRouter();
const { playSong } = usePlaybackController();
const uiStore = useUiStore();
const navigationStore = useNavigationStore();
const libraryStore = useLibraryStore();
const collectionsStore = useCollectionsStore();
const settingsStore = useSettingsStore();
const songClickAction = computed(() => settingsStore.settings.songClickAction || 'double');
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
const trackScrollTop = ref(0);
const trackViewportHeight = ref(720);
const TRACK_ROW_HEIGHT = 60;
const TRACK_HEADER_HEIGHT = 33;
const TRACK_OVERSCAN = 8;

type SearchTrackEntry =
  | {
      kind: 'lx';
      key: string;
      globalIndex: number;
      item: LxSearchResultItem;
    }
  | {
      kind: 'plugin';
      key: string;
      globalIndex: number;
      item: PluginSearchResult;
    }
  | {
      kind: 'local';
      key: string;
      globalIndex: number;
      item: Song;
    };

type VirtualSearchTrackEntry = SearchTrackEntry & {
  start: number;
};

const trackSearchItems = computed<SearchTrackEntry[]>(() => {
  const entries: SearchTrackEntry[] = [];

  lxSearchResults.value.forEach((item, index) => {
    entries.push({
      kind: 'lx',
      key: `lx-${item.source}-${item.songmid}-${index}`,
      globalIndex: entries.length,
      item,
    });
  });

  pluginSearchResults.value.forEach((item, index) => {
    entries.push({
      kind: 'plugin',
      key: `mf-${item.platform}-${item.id}-${index}`,
      globalIndex: entries.length,
      item,
    });
  });

  localSearchResults.value.forEach((item, index) => {
    entries.push({
      kind: 'local',
      key: `local-${item.path}-${index}`,
      globalIndex: entries.length,
      item,
    });
  });

  return entries;
});

const trackVirtualTotalHeight = computed(() => trackSearchItems.value.length * TRACK_ROW_HEIGHT);

const virtualTrackItems = computed<VirtualSearchTrackEntry[]>(() => {
  const listTop = Math.max(0, trackScrollTop.value - (isLocalSource.value ? TRACK_HEADER_HEIGHT : 0));
  const startIndex = Math.max(0, Math.floor(listTop / TRACK_ROW_HEIGHT) - TRACK_OVERSCAN);
  const visibleCount = Math.ceil(trackViewportHeight.value / TRACK_ROW_HEIGHT) + TRACK_OVERSCAN * 2;
  const endIndex = Math.min(trackSearchItems.value.length, startIndex + visibleCount);

  return trackSearchItems.value.slice(startIndex, endIndex).map((entry, offset) => ({
    ...entry,
    start: (startIndex + offset) * TRACK_ROW_HEIGHT,
  }));
});

const syncTrackVirtualScrollState = () => {
  const el = resultsScrollRef.value;
  if (!el) return;
  trackScrollTop.value = el.scrollTop;
  trackViewportHeight.value = el.clientHeight || trackViewportHeight.value;
};

const resetTrackVirtualScroll = () => {
  trackScrollTop.value = 0;
  const el = resultsScrollRef.value;
  if (!el) return;
  el.scrollTop = 0;
  trackViewportHeight.value = el.clientHeight || trackViewportHeight.value;
};

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
    syncTrackVirtualScrollState();
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
    return lxSearchResults.value.length + pluginSearchResults.value.length + localSearchResults.value.length;
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
  resetTrackVirtualScroll();
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

/** 加载下一页 */
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
const handleScroll = () => {
  syncTrackVirtualScrollState();
  const el = resultsScrollRef.value;
  if (!el || loadingMore.value || !hasMore.value) return;
  const { scrollTop, scrollHeight, clientHeight } = el;
  // 距离底部 200px 时触发加载
  if (scrollHeight - scrollTop - clientHeight < 200) {
    loadMore();
  }
};

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

/** 封面加载失败时，尝试代理回退；若代理也失败则清除 img 显示占位符 */
const handleImgError = (item: LxSearchResultItem) => {
  const originalUrl = item.img;
  if (originalUrl && !originalUrl.startsWith('data:')) {
    (async () => {
      const dataUrl = await tryProxyImage(originalUrl);
      if (dataUrl) {
        item.img = dataUrl;
      } else {
        item.img = '';
      }
      lxSearchResults.value = [...lxSearchResults.value];
    })();
    return;
  }
  item.img = '';
  lxSearchResults.value = [...lxSearchResults.value];
};

// 切换来源
const handleSelectSource = (source: SourceItem) => {
  selectedSourceId.value = source.id;
};

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
  performSearch();
});

// 监听搜索类型变化，重新搜索
watch(activeSearchType, () => {
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

// 播放搜索到的歌曲
const handlePlaySong = (item: LxSearchResultItem) => {
  // 飞入封面动画（掩盖起播延迟）
  launchFlyingCover(`lx://${item.source}/${item.songmid}`, item.img || '');
  // 缓存完整歌曲元信息（hash/_types/copyrightId 等），供 playerPlayback 解析 URL 时使用
  cacheLxSong(item);
  // 同时缓存到 lxLyricFetcher（供歌词获取使用）
  const songDuration = parseIntervalToSeconds(item.interval);
  cacheLxSongInfo(item.source, item.songmid, {
    songmid: item.songmid,
    hash: item.hash,
    name: item.name,
    singer: item.singer,
    albumName: item.albumName,
    interval: item.interval,
    _interval: songDuration > 0 ? Math.round(songDuration) : undefined,
    songId: item.songId,
    strMediaMid: item.strMediaMid,
    albumMid: item.albumMid,
    albumId: item.albumId,
    copyrightId: item.copyrightId,
    source: item.source,
  });
  // 构造 Song 对象，使用 lx:// 协议
  const artistNames = item.singer ? item.singer.split('、').filter(Boolean) : ['未知歌手'];
  const song: Song = {
    name: item.name,
    title: item.name,
    path: `lx://${item.source}/${item.songmid}`,
    artist: item.singer || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album: item.albumName || '未知专辑',
    album_artist: item.singer || '未知歌手',
    album_key: `${item.albumName || '未知专辑'}-${item.singer || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: songDuration,
    cover_thumb_path: item.img || '',
    source_type: 'remote',
    remote_source_id: `lx://${item.source}/${item.songmid}`,
  } as any;
  // 传递 LX 解析所需的元信息
  (song as any)._hash = item.hash;
  (song as any)._types = item._types;
  (song as any)._copyrightId = item.copyrightId;
  (song as any)._songmid = item.songmid;
  (song as any)._source = item.source;
  (song as any)._songId = item.songId;
  (song as any)._strMediaMid = item.strMediaMid;
  (song as any)._albumMid = item.albumMid;
  (song as any)._albumId = item.albumId;
  void playSong(song, { insertAfterCurrent: true });
};

// ==================== MusicFree 插件歌曲播放 ====================

const formatMfDuration = formatSearchDuration;

const getMfCoverUrl = (item: PluginSearchResult) => {
  if (!item.coverUrl) return '';
  return getDisplayCoverUrl(item.coverUrl, () => {
    pluginSearchResults.value = [...pluginSearchResults.value];
  });
};

const handleMfImgError = (e: Event) => {
  const img = e.target as HTMLImageElement;
  const src = img.src;
  if (!src || src.startsWith('data:')) return;
  (async () => {
    const dataUrl = await tryProxyImage(src);
    if (dataUrl) {
      pluginSearchResults.value = [...pluginSearchResults.value];
    }
  })();
};

const handlePlayMfSong = async (item: PluginSearchResult) => {
  // 飞入封面动画（掩盖 getMusicInfo 网络请求延迟）
  launchFlyingCover(`plugin://${item.platform}/${item.id}`, item.coverUrl || '');
  const mfSource = pluginSourceList.value.find(s => s.id === item.pluginId && s.type === 'musicfree');
  if (!mfSource || !mfSource.source) {
    console.warn('[MusicFree] 插件未找到:', item.pluginId);
    return;
  }
  const pluginSrc = mfSource.source;

  try {
    // 1. 读取音质：优先使用底部栏会话级临时覆盖，回退到设置页的在线播放音质
    const requestedQuality = playbackStore.sessionQualityOverride
      || settingsStore.settings.audio.onlineDefaultQuality || '320k';
    const fallbackBehavior = settingsStore.settings.audio.onlineQualityFallbackBehavior ?? 'lower';

    // 2. 并行获取播放 URL（阻塞）和歌词（getMediaSource 可能不返回歌词，用 pluginGetLyric 补获）
    //    URL 必须等待，歌词不阻塞播放但尽量在 playSong 前就绪
    const lyricPromise = pluginGetLyric(pluginSrc, item).catch(() => null);
    // Baka 插件使用独立的 12 档音质方法，原版 MF 使用三档映射
    const musicInfo = await isBakaPlugin(pluginSrc)
      ? await pluginGetBakaMusicInfo(pluginSrc, item, requestedQuality, fallbackBehavior)
      : await pluginGetMusicInfo(pluginSrc, item, requestedQuality, fallbackBehavior);
    if (!musicInfo?.url) {
      const detail = getLastPluginError();
      console.warn('[MusicFree] 无法获取播放URL:', item.title, detail);
      showToast(detail ? `无法获取播放URL：${detail}` : '无法获取播放URL', 'error');
      return;
    }

    const artistNames = item.artist ? item.artist.split(/[、,/&]/).filter(Boolean).map(s => s.trim()) : ['未知歌手'];
    const song: Song = {
      name: item.title,
      title: item.title,
      path: `plugin://${item.platform}/${item.id}`,
      artist: item.artist || '未知歌手',
      artist_names: artistNames,
      effective_artist_names: artistNames,
      album: item.album || '未知专辑',
      album_artist: item.artist || '未知歌手',
      album_key: `${item.album || '未知专辑'}-${item.artist || '未知歌手'}`,
      is_various_artists_album: false,
      collapse_artist_credits: false,
      duration: Math.floor((item.duration || 0) / 1000),
      cover_thumb_path: item.coverUrl || musicInfo.coverUrl || '',
      source_type: 'plugin',
      plugin_id: item.pluginId,
      remote_source_id: musicInfo.url,
      remote_requested_quality: requestedQuality as any,
      remote_fallback_behavior: fallbackBehavior,
      remote_actual_quality: musicInfo.actualQuality,
      remote_headers: musicInfo.headers && Object.keys(musicInfo.headers).length > 0 ? musicInfo.headers : undefined,
      remote_ekey: musicInfo.ekey,
      remote_cek: musicInfo.cek,
      rawData: item,
    } as any;

    // 歌词优先级：getMediaSource 返回的 lyricsRaw > pluginGetLyric 获取的歌词
    if (musicInfo.lyricsRaw) {
      (song as any).lyrics_raw = musicInfo.lyricsRaw;
    } else {
      // 等待并行获取的歌词（不阻塞太久，最多等 1.5 秒）
      try {
        const lyricData = await withTimeoutFallback(lyricPromise, 1500, null);
        if (lyricData?.lyricsRaw) {
          (song as any).lyrics_raw = lyricData.lyricsRaw;
        }
      } catch { /* 歌词获取失败不阻塞播放 */ }
    }

    // 3. 设置播放队列（所有歌曲统一使用 plugin:// 协议前缀并携带 rawData）
    const allSongs = pluginSearchResults.value.map((mfItem) => {
      const aNames = mfItem.artist ? mfItem.artist.split(/[、,/&]/).filter(Boolean).map(s => s.trim()) : ['未知歌手'];
      return {
        name: mfItem.title,
        title: mfItem.title,
        path: `plugin://${mfItem.platform}/${mfItem.id}`,
        artist: mfItem.artist || '未知歌手',
        artist_names: aNames,
        effective_artist_names: aNames,
        album: mfItem.album || '未知专辑',
        album_artist: mfItem.artist || '未知歌手',
        album_key: `${mfItem.album || '未知专辑'}-${mfItem.artist || '未知歌手'}`,
        is_various_artists_album: false,
        collapse_artist_credits: false,
        duration: Math.floor((mfItem.duration || 0) / 1000),
        cover_thumb_path: mfItem.coverUrl || '',
        source_type: 'plugin' as const,
        plugin_id: mfItem.pluginId,
        rawData: mfItem,
      } as Song;
    });
    const songIndex = allSongs.findIndex(s => s.name === song.name && s.artist === song.artist);
    if (songIndex >= 0) {
      allSongs[songIndex] = song;
    }

    // 4. 立即播放（歌词已尽可能就绪，封面由 playSong 内部异步补获）
    void playSong(song, { insertAfterCurrent: true });

    // 5. 后台异步获取封面（不阻塞播放）
    if (!song.cover_thumb_path) {
      void pluginGetCover(pluginSrc, item).then((coverUrl) => {
        if (coverUrl) song.cover_thumb_path = coverUrl;
      }).catch(() => { /* 封面加载失败，忽略 */ });
    }
  } catch (e: any) {
    console.warn('[MusicFree] 播放失败:', e?.message);
  }
};

const handleMfContextMenu = (e: MouseEvent, item: PluginSearchResult) => {
  e.preventDefault();
  const artistNames = item.artist ? item.artist.split(/[、,/&]/).filter(Boolean).map(s => s.trim()) : ['未知歌手'];
  contextMenuTargetSong.value = {
    name: item.title,
    title: item.title,
    path: `plugin://${item.platform}/${item.id}`,
    artist: item.artist || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album: item.album || '未知专辑',
    album_artist: item.artist || '未知歌手',
    album_key: `${item.album || '未知专辑'}-${item.artist || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: Math.floor((item.duration || 0) / 1000),
    cover_thumb_path: item.coverUrl || '',
    source_type: 'plugin',
    plugin_id: item.pluginId,
    remote_source_id: `plugin://${item.platform}/${item.id}`,
    rawData: item,
  } as any;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

// 右键菜单
const handleContextMenu = (e: MouseEvent, item: LxSearchResultItem) => {
  e.preventDefault();
  // 缓存完整歌曲元信息（hash/_types/copyrightId 等），供 playerPlayback 解析 URL 时使用
  // 下一首播放/添加到队尾等操作会延迟调用 playSong，必须提前缓存否则解析失败
  cacheLxSong(item);
  const contextMenuDuration = parseIntervalToSeconds(item.interval);
  cacheLxSongInfo(item.source, item.songmid, {
    songmid: item.songmid,
    hash: item.hash,
    name: item.name,
    singer: item.singer,
    albumName: item.albumName,
    interval: item.interval,
    _interval: contextMenuDuration > 0 ? Math.round(contextMenuDuration) : undefined,
    songId: item.songId,
    strMediaMid: item.strMediaMid,
    albumMid: item.albumMid,
    albumId: item.albumId,
    copyrightId: item.copyrightId,
    source: item.source,
  });
  const artistNames = item.singer ? item.singer.split('、').filter(Boolean) : ['未知歌手'];
  contextMenuTargetSong.value = {
    name: item.name,
    title: item.name,
    path: `lx://${item.source}/${item.songmid}`,
    artist: item.singer || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album: item.albumName || '未知专辑',
    album_artist: item.singer || '未知歌手',
    album_key: `${item.albumName || '未知专辑'}-${item.singer || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: contextMenuDuration,
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
  } as any;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

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
      onlineDetailStore.setContext({
        type: 'artist',
        title: artist.name,
        subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
        coverUrl: artist.avatarUrl,
        pluginSource,
        rawData: artist.rawData,
        sourceSearchType: activeSearchType.value as SourceSearchType,
      });
      void router.push({ path: '/online-detail', query: { type: 'artist' } });
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
      onlineDetailStore.setContext({
        type: 'album',
        title: album.name,
        subtitle: album.artist,
        coverUrl: album.coverUrl,
        pluginSource,
        rawData: album.rawData,
        sourceSearchType: activeSearchType.value as SourceSearchType,
      });
      void router.push({ path: '/online-detail', query: { type: 'album' } });
    } catch (e: any) {
      showToast(`查看专辑失败: ${e?.message || e}`, 'error');
    }
    return;
  }

  // LX 落雪源暂不支持专辑详情页
  showToast('当前音源暂不支持查看专辑', 'info');
};

// ==================== 本地歌曲播放与右键菜单 ====================

const formatLocalDuration = formatSearchDuration;

const getLocalCoverUrl = (song: Song): string => {
  if (!song.cover_thumb_path) return '';
  // 本地文件路径通过 convertFileSrc 转为可访问的 URL
  if (song.cover_thumb_path.startsWith('http') || song.cover_thumb_path.startsWith('asset:') || song.cover_thumb_path.startsWith('data:')) {
    return song.cover_thumb_path;
  }
  try {
    return convertFileSrc(song.cover_thumb_path);
  } catch {
    return '';
  }
};

const handlePlayLocalSong = (song: Song) => {
  void launchFlyingCover(song.path, getLocalCoverUrl(song) || song.cover_thumb_path || '');
  void playSong(song, { insertAfterCurrent: true });
};

const handleLocalContextMenu = (e: MouseEvent, song: Song) => {
  e.preventDefault();
  contextMenuTargetSong.value = song;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

const getVirtualTrackCoverPath = (entry: SearchTrackEntry) => {
  if (entry.kind === 'lx') return `lx://${entry.item.source}/${entry.item.songmid}`;
  if (entry.kind === 'plugin') return `plugin://${entry.item.platform}/${entry.item.id}`;
  return entry.item.path;
};

const getVirtualTrackCoverUrl = (entry: SearchTrackEntry) => {
  if (entry.kind === 'lx') return entry.item.img ? getDisplayCoverUrl(entry.item.img, () => { lxSearchResults.value = [...lxSearchResults.value]; }) : '';
  if (entry.kind === 'plugin') {
    const coverUrl = entry.item.coverUrl || extractCoverUrl(entry.item) || extractCoverUrl(entry.item.rawData);
    if (coverUrl && !entry.item.coverUrl) {
      entry.item.coverUrl = coverUrl;
    }
    return coverUrl ? getMfCoverUrl(entry.item) : '';
  }
  return entry.item.cover_thumb_path ? getLocalCoverUrl(entry.item) : '';
};

const getVirtualTrackTitle = (entry: SearchTrackEntry) => {
  if (entry.kind === 'lx') return entry.item.name;
  if (entry.kind === 'plugin') return entry.item.title;
  return entry.item.title || entry.item.name;
};

const getVirtualTrackArtist = (entry: SearchTrackEntry) => {
  if (entry.kind === 'lx') return entry.item.singer;
  if (entry.kind === 'plugin') return entry.item.artist;
  return entry.item.artist;
};

const getVirtualTrackAlbum = (entry: SearchTrackEntry) => {
  if (entry.kind === 'lx') return entry.item.albumName;
  if (entry.kind === 'plugin') return entry.item.album;
  return entry.item.album;
};

const getVirtualTrackDuration = (entry: SearchTrackEntry) => {
  if (entry.kind === 'lx') return entry.item.interval;
  if (entry.kind === 'plugin') {
    const durationMs = entry.item.duration || extractDuration(entry.item) || extractDuration(entry.item.rawData);
    return durationMs > 0 ? formatMfDuration(Math.floor(durationMs / 1000)) : '--:--';
  }
  return formatLocalDuration(entry.item.duration);
};

const handleVirtualTrackClick = (entry: SearchTrackEntry) => {
  if (songClickAction.value !== 'single') return;
  if (entry.kind === 'lx') handlePlaySong(entry.item);
  else if (entry.kind === 'plugin') void handlePlayMfSong(entry.item);
  else handlePlayLocalSong(entry.item);
};

const handleVirtualTrackDoubleClick = (entry: SearchTrackEntry) => {
  if (songClickAction.value === 'single') return;
  if (entry.kind === 'lx') handlePlaySong(entry.item);
  else if (entry.kind === 'plugin') void handlePlayMfSong(entry.item);
  else handlePlayLocalSong(entry.item);
};

const handleVirtualTrackContextMenu = (event: MouseEvent, entry: SearchTrackEntry) => {
  if (entry.kind === 'lx') handleContextMenu(event, entry.item);
  else if (entry.kind === 'plugin') handleMfContextMenu(event, entry.item);
  else handleLocalContextMenu(event, entry.item);
};

const handleVirtualTrackImageError = (event: Event, entry: SearchTrackEntry) => {
  if (entry.kind === 'lx') {
    handleImgError(entry.item);
    return;
  }
  if (entry.kind === 'plugin') {
    handleMfImgError(event);
    return;
  }
  (event.target as HTMLImageElement).style.display = 'none';
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

/** 根据 pluginId 查找对应的 PluginSource */
function findPluginSource(pluginId: string): PluginSource | undefined {
  const item = pluginSourceList.value.find(s => s.id === pluginId && s.type === 'musicfree');
  return item?.source;
}

const handlePluginArtistClick = (artist: PluginArtistResult) => {
  if (selectedSourceItem.value?.type === 'lx') {
    const lxSourceId = selectedSourceItem.value.lxSourceId!;
    onlineDetailStore.setContext({
      type: 'artist',
      title: artist.name,
      subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
      description: artist.description || '',
      coverUrl: artist.avatarUrl,
      pluginSource: selectedSourceItem.value.source!,
      rawData: artist.rawData,
      sourceSearchType: 'artist' as SourceSearchType,
      engineType: 'lx',
      lxSourceId,
    });
    void router.push({ path: '/online-detail', query: { type: 'artist' } });
    return;
  }
  const pluginSource = findPluginSource(artist.pluginId);
  if (!pluginSource) {
    void router.push({ path: '/search', query: { q: artist.name } });
    return;
  }
  onlineDetailStore.setContext({
    type: 'artist',
    title: artist.name,
    subtitle: artist.description || (artist.songCount ? `${artist.songCount} 首歌曲` : ''),
    description: artist.description || '',
    coverUrl: artist.avatarUrl,
    pluginSource,
    rawData: artist.rawData,
    sourceSearchType: 'artist' as SourceSearchType,
    engineType: 'musicfree',
  });
  void router.push({ path: '/online-detail', query: { type: 'artist' } });
};

const handlePluginAlbumClick = (album: PluginAlbumResult) => {
  if (selectedSourceItem.value?.type === 'lx') {
    const lxSourceId = selectedSourceItem.value.lxSourceId!;
    onlineDetailStore.setContext({
      type: 'album',
      title: album.name,
      subtitle: album.artist,
      coverUrl: album.coverUrl,
      pluginSource: selectedSourceItem.value.source!,
      rawData: album.rawData,
      sourceSearchType: 'album' as SourceSearchType,
      engineType: 'lx',
      lxSourceId,
    });
    void router.push({ path: '/online-detail', query: { type: 'album' } });
    return;
  }
  const pluginSource = findPluginSource(album.pluginId);
  if (!pluginSource) {
    void router.push({ path: '/search', query: { q: album.name } });
    return;
  }
  onlineDetailStore.setContext({
    type: 'album',
    title: album.name,
    subtitle: album.artist,
    coverUrl: album.coverUrl,
    pluginSource,
    rawData: album.rawData,
    sourceSearchType: 'album' as SourceSearchType,
    engineType: 'musicfree',
  });
  void router.push({ path: '/online-detail', query: { type: 'album' } });
};

const handlePluginPlaylistClick = (playlist: PluginPlaylistSearchResult) => {
  if (selectedSourceItem.value?.type === 'lx') {
    const lxSourceId = selectedSourceItem.value.lxSourceId!;
    onlineDetailStore.setContext({
      type: 'playlist',
      title: playlist.title,
      subtitle: playlist.trackCount ? `${playlist.trackCount} 首` : (playlist.artist || ''),
      coverUrl: playlist.coverUrl,
      pluginSource: selectedSourceItem.value.source!,
      rawData: playlist.rawData,
      sourceSearchType: 'playlist' as SourceSearchType,
      engineType: 'lx',
      lxSourceId,
    });
    void router.push({ path: '/online-detail', query: { type: 'playlist' } });
    return;
  }
  const pluginSource = findPluginSource(playlist.pluginId);
  if (!pluginSource) {
    void router.push({ path: '/search', query: { q: playlist.title } });
    return;
  }
  onlineDetailStore.setContext({
    type: 'playlist',
    title: playlist.title,
    subtitle: playlist.trackCount ? `${playlist.trackCount} 首` : (playlist.artist || ''),
    coverUrl: playlist.coverUrl,
    pluginSource,
    rawData: playlist.rawData,
    sourceSearchType: 'playlist' as SourceSearchType,
    engineType: 'musicfree',
  });
  void router.push({ path: '/online-detail', query: { type: 'playlist' } });
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

// 初始化
onMounted(() => {
  uiStore.showPlayerDetail = false;
  window.addEventListener('resize', handleWindowResize);
  refreshPluginSourceList();
  // 初始化来源选择：优先选第一个插件，无插件则选本地
  if (allSourceList.value.length > 0) {
    selectedSourceId.value = allSourceList.value[0].id;
  }
  // 从在线详情返回时，恢复对应的搜索 tab（"从哪儿来回哪儿去"）
  const pendingType = onlineDetailStore.consumePendingSearchType();
  if (pendingType) {
    activeSearchType.value = pendingType;
  }
  setupScrollResizeObserver();
  if (!hasQuery.value) return;
  performSearch();
});

// resultsScrollRef 在 track/catalog 视图切换时重新挂载，需重新绑定 ResizeObserver
watch(resultsScrollRef, () => setupScrollResizeObserver());

// 搜索页不再缓存。离开时终止未完成任务并释放只属于搜索页的临时状态。
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
