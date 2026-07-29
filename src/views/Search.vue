<template>
  <div class="flex flex-col h-full">
    <!-- 搜索结果头部 -->
    <div class="px-6 shrink-0 select-none">
      <!-- 第一层：内容类型切换（音乐/作者/专辑/歌单） -->
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
            :class="(source.type === 'lx' ? selectedLxSource === source.id : selectedMfSource === source.id)
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
        <!-- 非音乐类型提示 -->
        <div v-if="activeSearchType !== 'track'" class="flex-1 flex flex-col items-center justify-center text-black/30 dark:text-white/30">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <p class="text-base font-medium">{{ searchTabs.find(t => t.type === activeSearchType)?.label }}搜索</p>
          <p class="text-sm mt-1">该类型搜索功能开发中</p>
        </div>

        <!-- 加载中 -->
        <div v-else-if="searching" class="flex-1 flex items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
            <svg class="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p class="text-sm">正在从 {{ selectedSourceName }} 搜索…</p>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else-if="!hasQuery" class="flex-1 flex flex-col items-center justify-center text-black/30 dark:text-white/30">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p class="text-base font-medium">在上方搜索框输入关键词</p>
          <p class="text-sm mt-1">结果来自 {{ selectedSourceName }}</p>
        </div>

        <!-- 无结果 -->
        <div v-else-if="lxSearchResults.length === 0 && pluginSearchResults.length === 0" class="flex-1 flex flex-col items-center justify-center text-black/40 dark:text-white/40">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="text-base font-medium">没有找到与"{{ searchQuery }}"相关的内容</p>
          <p class="text-sm mt-1">试试更换音源或调整关键词</p>
        </div>

        <!-- 搜索结果列表 -->
        <div
          v-else
          ref="resultsScrollRef"
          class="flex-1 overflow-y-auto custom-scrollbar"
          @scroll="handleScroll"
        >
          <table class="w-full text-left">
            <thead class="sticky top-0 z-10 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md">
              <tr class="border-b border-black/5 dark:border-white/5 text-xs text-black/40 dark:text-white/40">
                <th class="w-10 py-2 px-4 text-center font-normal">#</th>
                <th class="w-14 py-2 px-2 font-normal"></th>
                <th class="py-2 px-2 font-normal">歌曲</th>
                <th class="py-2 px-2 font-normal">歌手</th>
                <th class="py-2 px-2 font-normal">专辑</th>
                <th class="w-16 py-2 px-4 text-right font-normal">时长</th>
              </tr>
            </thead>
            <tbody>
              <!-- 落雪 LX 搜索结果 -->
              <tr
                v-for="(item, index) in lxSearchResults"
                :key="`lx-${item.source}-${item.songmid}-${index}`"
                class="group border-b border-black/5 dark:border-white/5 cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                @click="handlePlaySong(item)"
                @contextmenu="handleContextMenu($event, item)"
              >
                <td class="py-2 px-4 text-center text-xs text-black/40 dark:text-white/40">
                  {{ index + 1 }}
                </td>
                <td class="py-2 px-2">
                  <div class="w-11 h-11 rounded-lg bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-lg font-black shrink-0">
                    <img
                      v-if="item.img"
                      :src="item.img"
                      class="w-full h-full object-cover"
                      alt=""
                      loading="lazy"
                      @error="handleImgError(item)"
                    />
                    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                </td>
                <td class="py-2 px-2 text-sm text-black dark:text-white font-medium truncate max-w-[200px]">
                  {{ item.name }}
                </td>
                <td class="py-2 px-2 text-sm text-black/60 dark:text-white/60 truncate max-w-[150px]">
                  {{ item.singer }}
                </td>
                <td class="py-2 px-2 text-sm text-black/40 dark:text-white/40 truncate max-w-[150px]">
                  {{ item.albumName }}
                </td>
                <td class="py-2 px-4 text-xs text-black/40 dark:text-white/40 text-right whitespace-nowrap">
                  {{ item.interval }}
                </td>
              </tr>
              <!-- MusicFree 插件搜索结果 -->
              <tr
                v-for="(item, index) in pluginSearchResults"
                :key="`mf-${item.platform}-${item.id}-${index}`"
                class="group border-b border-black/5 dark:border-white/5 cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                @click="handlePlayMfSong(item)"
                @contextmenu="handleMfContextMenu($event, item)"
              >
                <td class="py-2 px-4 text-center text-xs text-black/40 dark:text-white/40">
                  {{ lxSearchResults.length + index + 1 }}
                </td>
                <td class="py-2 px-2">
                  <div class="w-11 h-11 rounded-lg bg-black/10 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[#EC4141] text-lg font-black shrink-0">
                    <img
                      v-if="item.coverUrl"
                      :src="getMfCoverUrl(item)"
                      class="w-full h-full object-cover"
                      alt=""
                      loading="lazy"
                      @error="handleMfImgError($event, item)"
                    />
                    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                </td>
                <td class="py-2 px-2 text-sm text-black dark:text-white font-medium truncate max-w-[200px]">
                  {{ item.title }}
                </td>
                <td class="py-2 px-2 text-sm text-black/60 dark:text-white/60 truncate max-w-[150px]">
                  {{ item.artist }}
                </td>
                <td class="py-2 px-2 text-sm text-black/40 dark:text-white/40 truncate max-w-[150px]">
                  {{ item.album }}
                </td>
                <td class="py-2 px-4 text-xs text-black/40 dark:text-white/40 text-right whitespace-nowrap">
                  {{ item.duration ? formatMfDuration(item.duration) : '--:--' }}
                </td>
              </tr>
            </tbody>
          </table>
          <!-- 加载更多指示器 -->
          <div v-if="loadingMore" class="flex items-center justify-center py-4 text-black/40 dark:text-white/40">
            <svg class="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="text-sm">加载更多…</span>
          </div>
          <div v-else-if="!hasMore && lxSearchResults.length > 0" class="flex items-center justify-center py-4 text-xs text-black/30 dark:text-white/30">
            没有更多了
          </div>
        </div>
      </section>
    </div>

    <DragGhost />

    <SongContextMenu
      :visible="showContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :song="contextMenuTargetSong"
      :is-playlist-view="false"
      @close="showContextMenu = false"
      @add-to-playlist="openAddToPlaylistSelection"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { Song } from '../types';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { useUiStore } from '../shared/stores/ui';
import { useNavigationStore } from '../shared/stores/navigation';
import {
  lxSearch,
  lxGetPic,
  LX_SOURCE_NAMES,
  type LxSearchResultItem,
  type LxSourceId,
} from '../services/lxMusicSdk';
import { parseIntervalToSeconds } from '../utils/remoteSong';
import { cacheLxSong } from '../services/lxSongCache';
import { getStoredPlugins, pluginSearch, pluginGetMusicInfo, pluginGetLyric, pluginGetCover } from '../services/pluginEngine';
import type { PluginSource, PluginSearchResult } from '../types';
import { cacheLxSongInfo } from '../services/lxLyricFetcher';

import DragGhost from '../components/common/DragGhost.vue';
import SongContextMenu from '../components/overlays/SongContextMenu.vue';

const { playSong } = usePlaybackController();
const uiStore = useUiStore();
const navigationStore = useNavigationStore();
const { searchQuery } = storeToRefs(navigationStore);

// ==================== 内容类型切换 ====================
type SearchTypeKey = 'track' | 'artist' | 'album' | 'playlist';
const activeSearchType = ref<SearchTypeKey>('track');
const searchTabs: { type: SearchTypeKey; label: string }[] = [
  { type: 'track', label: '音乐' },
  { type: 'artist', label: '作者' },
  { type: 'album', label: '专辑' },
  { type: 'playlist', label: '歌单' },
];

const handleSearchTypeChange = (type: SearchTypeKey) => {
  activeSearchType.value = type;
};

// ==================== 来源列表 ====================
const lxSourceList = Object.entries(LX_SOURCE_NAMES).map(([id, name]) => ({
  id: id as LxSourceId,
  name,
  type: 'lx' as const,
}));

// MusicFree 插件音源
const mfSourceList = ref<{ id: string; name: string; type: 'musicfree'; source: PluginSource }[]>([]);

function refreshMfSourceList() {
  const plugins = getStoredPlugins().filter(p => p.enabled && p.format === 'musicfree');
  mfSourceList.value = plugins.map(p => ({ id: p.id, name: p.name, type: 'musicfree' as const, source: p }));
}

// 统一来源列表 = 落雪音源 + MusicFree 插件音源
const allSourceList = computed(() => [...lxSourceList, ...mfSourceList.value]);

// 当前选中的来源（既可以是 LX 也可以是 MusicFree）
const selectedLxSource = ref<LxSourceId>('kw');
const selectedMfSource = ref<string | null>(null); // MusicFree 插件 ID

const selectedSourceName = computed(() => {
  if (selectedMfSource.value) {
    return mfSourceList.value.find(s => s.id === selectedMfSource.value)?.name ?? '未知音源';
  }
  return LX_SOURCE_NAMES[selectedLxSource.value] ?? '未知音源';
});

const isLxSource = computed(() => !selectedMfSource.value);

// ==================== 搜索状态 ====================
const searching = ref(false);
const loadingMore = ref(false);
const hasMore = ref(false);
const currentPage = ref(1);
const lxSearchResults = shallowRef<LxSearchResultItem[]>([]);
const pluginSearchResults = shallowRef<PluginSearchResult[]>([]);
const resultsScrollRef = ref<HTMLElement | null>(null);

// 封面加载任务版本号，用于在新搜索时取消旧任务
let coverLoadVersion = 0;

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
    return lxSearchResults.value.length + pluginSearchResults.value.length;
  }
  return 0;
});

// ==================== 搜索逻辑 ====================
let searchAbortController: AbortController | null = null;

const performSearch = async () => {
  const query = searchQuery.value.trim();
  if (!query) {
    lxSearchResults.value = [];
    pluginSearchResults.value = [];
    hasMore.value = false;
    return;
  }

  // 取消上一次搜索
  if (searchAbortController) {
    searchAbortController.abort();
  }
  searchAbortController = new AbortController();

  // 重置分页
  currentPage.value = 1;
  hasMore.value = false;
  searching.value = true;
  try {
    if (isLxSource.value) {
      // 落雪 LX 搜索
      pluginSearchResults.value = [];
      const result = await lxSearch(selectedLxSource.value, query, 1);
      if (searchAbortController.signal.aborted) return;
      lxSearchResults.value = result.list;
      hasMore.value = result.list.length >= result.limit;
      triggerCoverLoading();
    } else {
      // MusicFree 插件搜索
      lxSearchResults.value = [];
      const mfSource = mfSourceList.value.find(s => s.id === selectedMfSource.value);
      if (mfSource) {
        const results = await pluginSearch(mfSource.source, query, 1, 30);
        if (searchAbortController.signal.aborted) return;
        pluginSearchResults.value = results;
        hasMore.value = results.length >= 30;
      }
    }
  } catch (err) {
    if (!searchAbortController.signal.aborted) {
      console.warn('[Search] failed:', err);
      lxSearchResults.value = [];
      pluginSearchResults.value = [];
    }
  } finally {
    if (!searchAbortController.signal.aborted) {
      searching.value = false;
    }
  }
};

/** 加载下一页 */
const loadMore = async () => {
  if (loadingMore.value || !hasMore.value || searching.value) return;
  const query = searchQuery.value.trim();
  if (!query) return;

  loadingMore.value = true;
  const nextPage = currentPage.value + 1;
  try {
    if (isLxSource.value) {
      // 落雪 LX 分页
      const result = await lxSearch(selectedLxSource.value, query, nextPage);
      if (result.list.length > 0) {
        currentPage.value = nextPage;
        lxSearchResults.value = [...lxSearchResults.value, ...result.list];
        hasMore.value = result.list.length >= result.limit;
        triggerCoverLoading();
      } else {
        hasMore.value = false;
      }
    } else {
      // MusicFree 插件分页
      const mfSource = mfSourceList.value.find(s => s.id === selectedMfSource.value);
      if (mfSource) {
        const results = await pluginSearch(mfSource.source, query, nextPage, 30);
        if (results.length > 0) {
          currentPage.value = nextPage;
          pluginSearchResults.value = [...pluginSearchResults.value, ...results];
          hasMore.value = results.length >= 30;
        } else {
          hasMore.value = false;
        }
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
  const el = resultsScrollRef.value;
  if (!el || loadingMore.value || !hasMore.value) return;
  const { scrollTop, scrollHeight, clientHeight } = el;
  // 距离底部 200px 时触发加载
  if (scrollHeight - scrollTop - clientHeight < 200) {
    loadMore();
  }
};

/** 触发封面加载（滑动窗口并发版） */
function triggerCoverLoading() {
  const version = ++coverLoadVersion;
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
        const picUrl = await Promise.race([
          lxGetPic(item),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 8000)),
        ]);
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
      return;
    }
    if (hasUpdate) {
      hasUpdate = false;
      lxSearchResults.value = [...lxSearchResults.value];
    }
  }, 500);

  // 全部完成后做最后一次刷新并清理定时器
  Promise.all(workers).then(() => {
    clearInterval(uiTimer);
    if (version === coverLoadVersion && hasUpdate) {
      lxSearchResults.value = [...lxSearchResults.value];
    }
  });
}

/** 封面加载失败时，清除 img 以显示占位符 */
const handleImgError = (item: LxSearchResultItem) => {
  item.img = '';
  lxSearchResults.value = [...lxSearchResults.value];
};

// 切换来源
const handleSelectSource = (source: { id: string; type: 'lx' | 'musicfree' }) => {
  if (source.type === 'lx') {
    selectedLxSource.value = source.id as LxSourceId;
    selectedMfSource.value = null;
  } else {
    selectedMfSource.value = source.id;
  }
};

// 监听关键词变化（防抖）
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchQuery, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    performSearch();
  }, 400);
});

// 监听来源变化，立即重新搜索
watch([selectedLxSource, selectedMfSource], () => {
  performSearch();
});

// 播放搜索到的歌曲
const handlePlaySong = (item: LxSearchResultItem) => {
  // 缓存完整歌曲元信息（hash/_types/copyrightId 等），供 playerPlayback 解析 URL 时使用
  cacheLxSong(item);
  // 同时缓存到 lxLyricFetcher（供歌词获取使用）
  cacheLxSongInfo(item.source, item.songmid, {
    songmid: item.songmid,
    hash: item.hash,
    name: item.name,
    singer: item.singer,
    albumName: item.albumName,
    interval: item.interval,
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
    duration: parseIntervalToSeconds(item.interval),
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
  void playSong(song, { insertAfterCurrent: true });
  uiStore.showPlayerDetail = true;
};

// ==================== MusicFree 插件歌曲播放 ====================

const formatMfDuration = (seconds: number): string => {
  if (!seconds || Number.isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// B站图片代理：hdslb.com/bilivideo.com 需要 Referer 头
const mfCoverProxyCache = new Map<string, string>();
const getMfCoverUrl = (item: PluginSearchResult) => {
  if (!item.coverUrl) return '';
  // 非 B站 URL 直接返回
  if (!item.coverUrl.includes('hdslb.com') && !item.coverUrl.includes('bilivideo.com')) {
    return item.coverUrl;
  }
  // 已缓存 data URL
  const cached = mfCoverProxyCache.get(item.id);
  if (cached) return cached;
  // 异步代理并刷新
  (async () => {
    try {
      const { pluginApi } = await import('../services/tauri/pluginApi');
      const dataUrl = await pluginApi.proxyImage(item.coverUrl);
      mfCoverProxyCache.set(item.id, dataUrl);
      // 触发响应式更新
      pluginSearchResults.value = [...pluginSearchResults.value];
    } catch { /* ignore */ }
  })();
  return item.coverUrl; // 先显示原图（可能 403），代理完成后刷新
};

const handleMfImgError = (e: Event, _item: PluginSearchResult) => {
  (e.target as HTMLImageElement).style.display = 'none';
};

const handlePlayMfSong = async (item: PluginSearchResult) => {
  const mfSource = mfSourceList.value.find(s => s.id === item.pluginId);
  if (!mfSource) {
    console.warn('[MusicFree] 插件未找到:', item.pluginId);
    return;
  }

  try {
    // 1. 通过插件获取播放 URL（与 MusicFree PluginMethods.getMediaSource 完全一致）
    const musicInfo = await pluginGetMusicInfo(mfSource.source, item, 'standard');
    if (!musicInfo?.url) {
      console.warn('[MusicFree] 无法获取播放URL:', item.title);
      return;
    }

    const artistNames = item.artist ? item.artist.split(/[、,/&]/).filter(Boolean).map(s => s.trim()) : ['未知歌手'];
    const song: Song = {
      name: item.title,
      title: item.title,
      path: musicInfo.url,
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
      source_type: 'remote',
      remote_source_id: musicInfo.url,
    } as any;

    // 2. 从 getMediaSource 返回值中提取歌词
    if (musicInfo.lyric) {
      (song as any).lyrics_raw = musicInfo.lyric;
      if (musicInfo.tlyric) {
        (song as any).lyrics_raw += '\n[offset:0]\n' + musicInfo.tlyric;
      }
    }

    // 3. 如果没有歌词，通过插件获取
    if (!(song as any).lyrics_raw) {
      try {
        const lyricData = await pluginGetLyric(mfSource.source, item);
        if (lyricData?.lyric) {
          (song as any).lyrics_raw = lyricData.lyric;
          if (lyricData.tlyric) {
            (song as any).lyrics_raw += '\n[offset:0]\n' + lyricData.tlyric;
          }
        }
      } catch { /* ignore */ }
    }

    // 4. 如果没有封面，通过插件获取
    if (!song.cover_thumb_path) {
      try {
        const coverUrl = await pluginGetCover(mfSource.source, item);
        if (coverUrl) {
          song.cover_thumb_path = coverUrl;
        }
      } catch { /* ignore */ }
    }

    // 5. 设置播放队列（与 YinDongMusic 完全一致）
    const allSongs = pluginSearchResults.value.map((mfItem) => {
      const aNames = mfItem.artist ? mfItem.artist.split(/[、,/&]/).filter(Boolean).map(s => s.trim()) : ['未知歌手'];
      return {
        name: mfItem.title,
        title: mfItem.title,
        path: '',
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
        source_type: 'remote' as const,
      } as Song;
    });
    const songIndex = allSongs.findIndex(s => s.name === song.name && s.artist === song.artist);
    if (songIndex >= 0) {
      allSongs[songIndex] = song;
    }

    void playSong(song, { insertAfterCurrent: true });
    uiStore.showPlayerDetail = true;
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
    duration: item.duration || 0,
    cover_thumb_path: item.coverUrl || '',
    source_type: 'remote',
    remote_source_id: `plugin://${item.platform}/${item.id}`,
  } as any;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

// 右键菜单
const handleContextMenu = (e: MouseEvent, item: LxSearchResultItem) => {
  e.preventDefault();
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
    duration: parseIntervalToSeconds(item.interval),
    cover_thumb_path: item.img || '',
    source_type: 'remote',
    remote_source_id: `lx://${item.source}/${item.songmid}`,
    _hash: item.hash,
    _types: item._types,
    _copyrightId: item.copyrightId,
    _songmid: item.songmid,
    _source: item.source,
  } as any;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

const openAddToPlaylistSelection = () => {
  const songPaths = contextMenuTargetSong.value ? [contextMenuTargetSong.value.path] : [];
  console.warn('Add lx song to playlist - path:', songPaths);
};

// 初始化
onMounted(() => {
  uiStore.showPlayerDetail = false;
  refreshMfSourceList();
  if (!hasQuery.value) return;
  performSearch();
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
