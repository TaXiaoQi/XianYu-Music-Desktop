<template>
  <div class="flex flex-col h-full">
    <SearchSourceBar
      :tabs="searchTabs"
      :active-search-type="activeSearchType"
      :sources="allSourceList"
      :selected-source-id="selectedSourceId"
      :search-query="searchQuery"
      :result-count="resultCount"
      @type-change="handleSearchTypeChange"
      @select-source="handleSelectSource"
    />

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

        <SearchCatalogGrid
          v-else-if="activeSearchType === 'artist' || activeSearchType === 'album' || activeSearchType === 'playlist'"
          :key="activeSearchType"
          ref="catalogGridRef"
          :items="catalogGridItems"
          :active-search-type="activeSearchType"
          :refresh-catalog-results="refreshCatalogResults"
          @entry-click="handleCatalogEntryClick"
          @scroll-top="handleCatalogScrollTop"
        />
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
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type {
  Song,
  ArtistCatalogItem,
  AlbumCatalogItem,
  Playlist,
  PluginSearchResult,
  PluginPlaylistSearchResult,
} from '../types';
import type { LxSearchResultItem } from '../services/domain/lxMusicSdk';
import type { PluginArtistResult, PluginAlbumResult } from '../services/domain/pluginEngine';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { useUiStore } from '../shared/stores/ui';
import { usePlaybackStore } from '../features/playback/store';
import { useOnlineDetailStore, type SearchResultsSnapshot } from '../features/onlineDetail/store';

import DragGhost from '../components/common/DragGhost.vue';
import SearchSourceBar from '../components/search/SearchSourceBar.vue';
import SearchCatalogGrid from '../components/search/SearchCatalogGrid.vue';
import { useSearchSources } from '../composables/search/useSearchSources';
import { useSearchResults } from '../composables/search/useSearchResults';
import { useSearchQuery, type SearchTypeKey } from '../composables/search/useSearchQuery';
import { useSearchNavigation } from '../composables/search/useSearchNavigation';

const SongContextMenu = defineAsyncComponent(() => import('../components/overlays/SongContextMenu.vue'));
const SongTable = defineAsyncComponent(() => import('../components/song-list/SongTable.vue'));

const router = useRouter();
const { playSong } = usePlaybackController();
const uiStore = useUiStore();
const playbackStore = usePlaybackStore();
const onlineDetailStore = useOnlineDetailStore();

// ==================== 内容类型切换 ====================
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

// ==================== 音源 ====================
const sources = useSearchSources();
const {
  allSourceList,
  selectedSourceId,
  selectedSourceName,
  refreshPluginSourceList,
  handleSelectSource,
} = sources;

// ==================== 搜索结果状态 ====================
const results = useSearchResults({ activeSearchType, sources });
const {
  searching,
  loadingMore,
  hasMore,
  currentPage,
  lxSearchResults,
  pluginSearchResults,
  localSearchResults,
  localArtistResults,
  localAlbumResults,
  localPlaylistResults,
  pluginArtistResults,
  pluginAlbumResults,
  pluginPlaylistResults,
  resultCount,
  hasNoResults,
  onlineTrackSongs,
  catalogGridItems,
  refreshCatalogResults,
} = results;

// ==================== 搜索触发/防抖/取消 ====================
const catalogGridScrollTop = ref(0);
const catalogGridRef = ref<InstanceType<typeof SearchCatalogGrid> | null>(null);

const queryState = useSearchQuery({
  activeSearchType,
  sources,
  state: results,
  isRestoring: () => restoringSession,
  resetCatalogScroll: () => {
    catalogGridScrollTop.value = 0;
    catalogGridRef.value?.resetScroll();
  },
});
const { searchQuery, hasQuery, performSearch, loadMore } = queryState;

// ==================== 右键菜单与导航 ====================
const {
  showContextMenu,
  contextMenuX,
  contextMenuY,
  contextMenuTargetSong,
  handleTrackContextMenu,
  openAddToPlaylistSelection,
  handleOnlineViewArtist,
  handleOnlineViewAlbum,
  handleCatalogEntryClick,
} = useSearchNavigation({ sources });

const handleCatalogScrollTop = (top: number) => {
  catalogGridScrollTop.value = top;
};

const handlePlaySong = (song: Song) => {
  void playSong(song, { insertAfterCurrent: true });
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
    catalogGridRef.value?.setScrollTop(snapshot.scrollTop);
    nextTick(() => {
      requestAnimationFrame(() => {
        const el = catalogGridRef.value?.scrollEl;
        if (el) el.scrollTop = snapshot.scrollTop!;
      });
    });
  }
}

onMounted(() => {
  uiStore.showPlayerDetail = false;
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

onBeforeUnmount(() => {
  if (playbackStore.tempQueue.length > 0) {
    playbackStore.tempQueue = [];
  }
  if (router.currentRoute.value.path === '/online-detail') {
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
