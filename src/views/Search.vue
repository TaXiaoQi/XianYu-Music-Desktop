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
            v-for="plugin in enabledPlugins"
            :key="plugin.id"
            type="button"
            class="px-3 py-1.5 rounded-md text-[clamp(0.8rem,1vw,0.9rem)] font-medium transition-colors cursor-pointer whitespace-nowrap"
            :class="activePluginId === plugin.id
              ? 'text-[#EC4141] bg-red-50 dark:bg-red-500/10'
              : 'text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5'"
            @click="handleSelectPlugin(plugin.id)"
          >
            {{ plugin.name }}
          </button>
        </div>

        <!-- 搜索关键词 + 结果数 -->
        <div class="flex items-center gap-2 min-w-0">
          <span v-if="searchQuery.trim()" class="text-[clamp(0.75rem,0.9vw,0.875rem)] text-black/50 dark:text-white/50 truncate">
            “{{ searchQuery }}” · {{ resultCount }} 个结果
          </span>
        </div>
      </div>
    </div>

    <!-- 搜索结果列表 -->
    <div class="flex-1 flex overflow-hidden relative">
      <section class="flex-1 flex overflow-hidden">
        <!-- 加载中 -->
        <div v-if="searching" class="flex-1 flex items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
            <svg class="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p class="text-sm">正在从 {{ activePlugin?.name }} 搜索…</p>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else-if="!hasQuery" class="flex-1 flex flex-col items-center justify-center text-black/30 dark:text-white/30">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p class="text-base font-medium">在上方搜索框输入关键词</p>
          <p class="text-sm mt-1">结果来自 {{ activePlugin?.name ?? '插件' }}</p>
        </div>

        <!-- 无结果 -->
        <div v-else-if="resultCount === 0" class="flex-1 flex flex-col items-center justify-center text-black/40 dark:text-white/40">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="text-base font-medium">没有找到与“{{ searchQuery }}”相关的内容</p>
          <p class="text-sm mt-1">试试更换插件或调整关键词</p>
        </div>

        <!-- 音乐结果列表 -->
        <SongTable
          v-else-if="activeSearchType === 'track'"
          ref="songTableRef"
          :songs="trackSongs"
          :isBatchMode="false"
          :selectedPaths="selectedPaths"
          memoryScopeKey="plugin-search-view"
          @play="handlePlaySong"
          @contextmenu="handleContextMenu"
          @update:selectedPaths="selectedPaths = $event"
        />

        <!-- 作者结果网格 -->
        <div v-else-if="activeSearchType === 'artist'" class="flex-1 overflow-y-auto custom-scrollbar p-6">
          <div class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5">
            <div
              v-for="artist in artistResults"
              :key="artist.id"
              class="flex flex-col items-center gap-3 p-4 rounded-2xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer group"
              @click="handleArtistClick(artist)"
            >
              <div class="h-28 w-28 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden grid place-items-center text-[#EC4141] text-3xl font-black">
                <img v-if="artist.avatarUrl" :src="artist.avatarUrl" alt="" class="h-full w-full object-cover" />
                <span v-else>{{ artist.name.slice(0, 1) }}</span>
              </div>
              <div class="text-center min-w-0 w-full">
                <p class="text-sm font-medium text-black dark:text-white truncate">{{ artist.name }}</p>
                <p class="text-xs text-black/50 dark:text-white/50 mt-0.5">{{ artist.songCount ?? 0 }} 首歌曲</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 专辑结果网格 -->
        <div v-else-if="activeSearchType === 'album'" class="flex-1 overflow-y-auto custom-scrollbar p-6">
          <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-5">
            <div
              v-for="album in albumResults"
              :key="album.id"
              class="flex flex-col gap-3 p-3 rounded-2xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer group"
              @click="handleAlbumClick(album)"
            >
              <div class="aspect-square rounded-xl bg-black/10 dark:bg-white/10 overflow-hidden grid place-items-center text-[#EC4141] text-4xl font-black">
                <img v-if="album.coverUrl" :src="album.coverUrl" alt="" class="h-full w-full object-cover" />
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-black dark:text-white truncate">{{ album.name }}</p>
                <p class="text-xs text-black/50 dark:text-white/50 mt-0.5 truncate">{{ album.artist }} · {{ album.year ?? '' }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 歌单结果网格 -->
        <div v-else-if="activeSearchType === 'playlist'" class="flex-1 overflow-y-auto custom-scrollbar p-6">
          <div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
            <div
              v-for="playlist in playlistResults"
              :key="playlist.id"
              class="flex flex-col gap-3 p-3 rounded-2xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer group"
              @click="handlePlaylistClick(playlist)"
            >
              <div class="aspect-square rounded-xl bg-gradient-to-br from-[#EC4141]/20 to-[#EC4141]/5 dark:from-[#EC4141]/30 dark:to-[#EC4141]/10 overflow-hidden grid place-items-center text-[#EC4141] text-5xl font-black">
                <img v-if="playlist.coverUrl" :src="playlist.coverUrl" alt="" class="h-full w-full object-cover" />
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-black dark:text-white truncate">{{ playlist.name }}</p>
                <p class="text-xs text-black/50 dark:text-white/50 mt-0.5 truncate">
                  by {{ playlist.creator ?? '未知' }} · {{ playlist.songCount ?? 0 }} 首
                </p>
              </div>
            </div>
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
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { Song } from '../types';
import type { PluginAlbum, PluginArtist, PluginPlaylist, PluginSearchType, PluginTrack } from '../types/plugin';
import { usePluginsStore } from '../features/plugins/store';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { useUiStore } from '../shared/stores/ui';
import { useNavigationStore } from '../shared/stores/navigation';
import { pluginApi } from '../services/tauri/pluginApi';
import { pluginTrackToSong } from '../utils/pluginSong';

import SongTable from '../components/song-list/SongTable.vue';
import DragGhost from '../components/common/DragGhost.vue';
import SongContextMenu from '../components/overlays/SongContextMenu.vue';

const pluginsStore = usePluginsStore();
const { enabledPlugins, activePlugin, activePluginId, activeSearchType } = storeToRefs(pluginsStore);
const { playSong } = usePlaybackController();
const uiStore = useUiStore();
const navigationStore = useNavigationStore();
const { searchQuery } = storeToRefs(navigationStore);

const searchTabs: { type: PluginSearchType; label: string }[] = [
  { type: 'track', label: '音乐' },
  { type: 'artist', label: '作者' },
  { type: 'album', label: '专辑' },
  { type: 'playlist', label: '歌单' },
];

// 搜索状态
const searching = ref(false);
const trackResults = ref<PluginTrack[]>([]);
const artistResults = ref<PluginArtist[]>([]);
const albumResults = ref<PluginAlbum[]>([]);
const playlistResults = ref<PluginPlaylist[]>([]);

// 选中的歌曲集合（SongTable 用）
const selectedPaths = ref<Set<string>>(new Set());
const songTableRef = ref<any>(null);
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuTargetSong = ref<Song | null>(null);

// 是否有搜索关键词
const hasQuery = computed(() => searchQuery.value.trim().length > 0);

// 音乐结果转 Song 列表
const trackSongs = computed<Song[]>(() =>
  trackResults.value.map(track => pluginTrackToSong(track, activePluginId.value || 'unknown')),
);

// 当前插件 ID（非空，用于搜索请求）
const currentPluginId = computed(() => activePluginId.value || '');

// 当前类型的结果数量
const resultCount = computed(() => {
  switch (activeSearchType.value) {
    case 'track': return trackResults.value.length;
    case 'artist': return artistResults.value.length;
    case 'album': return albumResults.value.length;
    case 'playlist': return playlistResults.value.length;
    default: return 0;
  }
});

// 执行搜索
let searchAbortController: AbortController | null = null;

const performSearch = async () => {
  const query = searchQuery.value.trim();
  if (!query || !currentPluginId.value) {
    trackResults.value = [];
    artistResults.value = [];
    albumResults.value = [];
    playlistResults.value = [];
    return;
  }

  // 取消上一次搜索
  if (searchAbortController) {
    searchAbortController.abort();
  }
  searchAbortController = new AbortController();

  searching.value = true;
  try {
    const response = await pluginApi.pluginSearch({
      pluginId: currentPluginId.value,
      query,
      type: activeSearchType.value,
      page: 1,
      pageSize: 30,
    });
    // 若已被后续搜索取消，丢弃结果
    if (searchAbortController.signal.aborted) return;
    trackResults.value = response.tracks;
    artistResults.value = response.artists;
    albumResults.value = response.albums;
    playlistResults.value = response.playlists;
  } catch (err) {
    if (!searchAbortController.signal.aborted) {
      console.warn('Plugin search failed:', err);
      trackResults.value = [];
      artistResults.value = [];
      albumResults.value = [];
      playlistResults.value = [];
    }
  } finally {
    if (!searchAbortController.signal.aborted) {
      searching.value = false;
    }
  }
};

// 切换插件时重新搜索
const handleSelectPlugin = (pluginId: string) => {
  pluginsStore.setActivePlugin(pluginId);
};

// 切换搜索类型
const handleSearchTypeChange = (type: PluginSearchType) => {
  pluginsStore.setActiveSearchType(type);
};

// 监听关键词变化（防抖）
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchQuery, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    performSearch();
  }, 400);
});

// 监听插件 / 搜索类型变化，立即重新搜索
watch([activePluginId, activeSearchType], () => {
  performSearch();
});

// 播放搜索到的歌曲
const handlePlaySong = (song: Song) => {
  void playSong(song, { insertAfterCurrent: true });
  // 进入歌曲详情页
  uiStore.showPlayerDetail = true;
};

// 作者/专辑/歌单点击（预留入口，后续接入详情页）
const handleArtistClick = (_artist: PluginArtist) => {
  // TODO: 进入插件作者详情页
};
const handleAlbumClick = (_album: PluginAlbum) => {
  // TODO: 进入插件专辑详情页
};
const handlePlaylistClick = (_playlist: PluginPlaylist) => {
  // TODO: 进入插件歌单详情页
};

// 右键菜单
const handleContextMenu = (e: MouseEvent, song: Song) => {
  contextMenuTargetSong.value = song;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
};

const openAddToPlaylistSelection = () => {
  const songPaths = contextMenuTargetSong.value ? [contextMenuTargetSong.value.path] : [];
  // 复用现有添加到歌单对话框（插件歌曲的 path 是虚拟路径，需后端支持）
  console.warn('Add plugin song to playlist - path:', songPaths);
};

// 初始化：加载插件列表
onMounted(async () => {
  // 进入搜索页面时强制关闭 PlayerDetail，避免覆盖层拦截滚动
  uiStore.showPlayerDetail = false;
  await pluginsStore.loadPlugins();
  // 默认选中音乐类型和第一个已启用插件（store 内已处理默认值）
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
