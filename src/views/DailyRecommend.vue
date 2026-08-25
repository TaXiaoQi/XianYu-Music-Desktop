<template>
  <div class="flex flex-col h-full">
    <!-- 头部：日期徽章 + 副标题 + 操作（嵌入首页 TAB，无大标题） -->
    <div class="px-6 pt-4 pb-3 shrink-0 select-none">
      <div class="flex items-end justify-between gap-6 flex-wrap">
        <div class="min-w-0 flex items-center gap-3 flex-wrap">
          <span class="px-2 py-0.5 rounded-full text-[clamp(0.75rem,1vw,0.875rem)] text-[#EC4141] font-medium bg-red-50 dark:bg-red-500/10 whitespace-nowrap">
            {{ dateLabel }}
          </span>
          <span class="text-[clamp(0.75rem,1vw,0.875rem)] text-black/50 dark:text-white/50 font-light tracking-wider">
            {{ subtitleText }}
          </span>
        </div>
        <div v-if="songList.length > 0" class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            class="px-4 py-2 rounded-lg bg-[#EC4141] text-white text-[clamp(0.8rem,1vw,0.9rem)] font-medium hover:bg-[#d63a3a] transition-colors cursor-pointer active:scale-[0.97] flex items-center gap-1.5"
            @click="handlePlayAll"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            播放全部
          </button>
          <button
            type="button"
            :disabled="refreshing"
            class="px-3 py-1.5 rounded-lg text-[clamp(0.7rem,0.9vw,0.8rem)] font-medium text-black/70 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer active:scale-[0.97] flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="handleRefresh"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              :class="{ 'animate-spin': refreshing }"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            换一批
          </button>
        </div>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="flex-1 overflow-hidden relative">
      <transition name="page-fade" mode="out-in">
        <!-- 加载中 -->
        <div v-if="loading" key="loading" class="h-full flex items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
            <svg class="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p class="text-sm">正在为你生成今日推荐…</p>
          </div>
        </div>

        <!-- 未登录 -->
        <div v-else-if="notLoggedIn" key="not-logged-in" class="h-full flex items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-1 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <p class="text-base font-medium text-black/60 dark:text-white/60">登录后解锁每日推荐</p>
            <p class="text-sm">基于你的听歌记录，每天为你量身定制</p>
            <button
              type="button"
              class="mt-2 px-5 py-2 rounded-lg bg-[#EC4141] text-white text-sm font-medium hover:bg-[#d63a3a] transition-colors cursor-pointer active:scale-[0.97]"
              @click="goLogin"
            >
              去登录
            </button>
          </div>
        </div>

        <!-- 无插件 -->
        <div v-else-if="noPlugin" key="no-plugin" class="h-full flex items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-black/30 dark:text-white/30">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-1 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
            </svg>
            <p class="text-base font-medium">暂无可用音源插件</p>
            <p class="text-sm">请先在「插件管理」中安装音源插件</p>
            <button
              type="button"
              class="mt-2 px-5 py-2 rounded-lg bg-[#EC4141] text-white text-sm font-medium hover:bg-[#d63a3a] transition-colors cursor-pointer active:scale-[0.97]"
              @click="goPlugins"
            >
              去安装插件
            </button>
          </div>
        </div>

        <!-- 生成失败 -->
        <div v-else-if="loadError" key="error" class="h-full flex items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-black/40 dark:text-white/40">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-1 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p class="text-base font-medium">{{ loadError }}</p>
            <button
              type="button"
              class="mt-2 px-5 py-2 rounded-lg bg-[#EC4141] text-white text-sm font-medium hover:bg-[#d63a3a] transition-colors cursor-pointer active:scale-[0.97]"
              @click="load(false)"
            >
              重试
            </button>
          </div>
        </div>

        <!-- 推荐歌曲列表：复用在线歌单列表容器（天然支持播放/下载/收藏/来源） -->
        <section v-else key="list" class="h-full flex overflow-hidden">
          <SongTable
            ref="songTableRef"
            :songs="songList"
            :isBatchMode="isBatchMode"
            :selectedPaths="selectedPaths"
            :memoryScopeKey="memoryScopeKey"
            @play="handlePlaySong"
            @contextmenu="handleContextMenu"
            @update:selectedPaths="selectedPaths = $event"
            @drag-start="handleTableDragStart"
          />
        </section>
      </transition>
    </div>

    <DragGhost />

    <!-- 右键菜单（与在线详情页一致：支持收藏、下载、加入歌单、查看歌手/专辑等） -->
    <SongContextMenu
      v-if="showContextMenu"
      :visible="showContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :song="contextMenuTargetSong"
      :is-playlist-view="false"
      :is-online-search="contextMenuIsOnlineSearch"
      :resolved-file-path="contextMenuResolvedPath"
      @close="showContextMenu = false"
      @add-to-playlist="handleContextMenuAddToPlaylist"
      @view-online-artist="handleOnlineViewArtist"
      @view-online-album="handleOnlineViewAlbum"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { useAuthStore } from '../features/auth/store';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { useToast } from '../composables/toast';
import { launchFlyingCover } from '../composables/useFlyingCover';
import { useSongContextActions } from '../composables/useSongContextActions';
import { useSongDrag } from '../composables/useSongDrag';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useLibraryStore } from '../features/library/store';
import {
  DailyRecommendError,
  getDailyRecommendation,
  type DailyRecommendAlgorithm,
  type DailyRecommendItem,
} from '../services/dailyRecommend';
import { getStoredPlugins, pluginsVersion } from '../services/pluginEngine';
import { extractDurationMs } from '../services/pluginResultMappers';
import { fetchWyTrackMetaByIds } from '../services/playlistImport';
import type { PluginSearchResult, PluginSource, Song } from '../types';

const SongTable = defineAsyncComponent(() => import('../components/song-list/SongTable.vue'));
const DragGhost = defineAsyncComponent(() => import('../components/common/DragGhost.vue'));
const SongContextMenu = defineAsyncComponent(() => import('../components/overlays/SongContextMenu.vue'));

const router = useRouter();
const authStore = useAuthStore();
const { showToast } = useToast();
const { playSong, clearQueue, addSongsToQueue } = usePlaybackController();
const libraryStore = useLibraryStore();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();

// ==================== 状态 ====================
const loading = ref(false);
const refreshing = ref(false);
const notLoggedIn = ref(false);
const noPlugin = ref(false);
const loadError = ref('');
const items = ref<DailyRecommendItem[]>([]);
const algorithm = ref<DailyRecommendAlgorithm | null>(null);
const batch = ref(0);

// 列表容器状态（SongTable 必需 props）
const isBatchMode = ref(false);
const selectedPaths = ref<Set<string>>(new Set());
const songTableRef = ref<any>(null);

const hasPlugin = () =>
  getStoredPlugins().some(p => p.enabled && p.format === 'musicfree');

// ==================== 展示文案 ====================
const dateLabel = computed(() => {
  const now = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  return `${now.getMonth() + 1}月${now.getDate()}日 · 周${week}`;
});

const subtitleText = computed(() => {
  const profile = algorithm.value?.profile;
  if (!profile || profile.total_plays < 10) {
    return '每天为你挑选新鲜歌单，多听听歌推荐会更懂你';
  }
  return `根据你近 90 天 ${profile.total_plays} 次播放记录生成`;
});

// ==================== 数据加载 ====================
let loadToken = 0;

async function load(refresh: boolean) {
  const token = ++loadToken;

  if (!authStore.isLoggedIn) {
    notLoggedIn.value = true;
    loading.value = false;
    items.value = [];
    algorithm.value = null;
    return;
  }
  notLoggedIn.value = false;
  loadError.value = '';

  if (!hasPlugin()) {
    noPlugin.value = true;
    loading.value = false;
    items.value = [];
    algorithm.value = null;
    return;
  }
  noPlugin.value = false;

  if (refresh) {
    refreshing.value = true;
  } else {
    loading.value = true;
    items.value = [];
    algorithm.value = null;
  }

  try {
    const result = await getDailyRecommendation(refresh);
    if (token !== loadToken) return;
    algorithm.value = result.algorithm;
    items.value = result.items;
    batch.value = result.batch;
    if (result.items.length === 0) {
      // 插件全部搜索失败时给出提示
      loadError.value = '推荐生成失败，请检查音源插件后重试';
      items.value = [];
    }
    // 异步补齐网易云歌曲缺失的封面/时长（不阻塞列表渲染，完成后 pop 进图）
    void backfillMissingCovers();
  } catch (e) {
    if (token !== loadToken) return;
    if (e instanceof DailyRecommendError && e.kind === 'not_logged_in') {
      notLoggedIn.value = true;
    } else {
      loadError.value = e instanceof Error ? e.message : '推荐生成失败，请稍后重试';
    }
  } finally {
    if (token === loadToken) {
      loading.value = false;
      refreshing.value = false;
    }
  }
}

function handleRefresh() {
  void load(true);
}

/** 判断音源是否为网易云（对齐在线搜索页 isNeteaseSource；决定是否走官方 weapi 批量补全封面） */
const isNeteaseSource = (plugin: PluginSource): boolean => {
  if (plugin.sources?.some(s => s === 'wy' || /网易云|netease/i.test(s))) return true;
  return /网易云|netease/i.test(plugin.name || '');
};

/**
 * 日推中网易云歌曲的封面/时长批量补全。
 * 参考在线搜索页 backfillWyTrackMeta：部分第三方网易云 MusicFree 插件
 * （如时迁酱）的歌曲结果既不返回可用 artwork（weapi 的 album 只有 picId，
 * 没有 picUrl），也不返回 duration，导致日推列表里网易云歌曲无封面。
 * 这里复用官方 weapi 的 song/detail 按 ID 批量补全，绕过插件实现差异。
 */
async function backfillMissingCovers() {
  const token = loadToken;
  const neteasePlugins = new Map<string, PluginSource>();
  for (const p of getStoredPlugins()) {
    if (p.enabled && p.format === 'musicfree' && isNeteaseSource(p)) {
      neteasePlugins.set(p.name, p);
    }
  }
  if (neteasePlugins.size === 0) return;

  // 只补缺封面或缺时长、ID 是网易云纯数字、且确实来自网易云插件的条目
  const pending = items.value.filter((item) => {
    const song = item.song;
    if (!song || (song.coverUrl && song.duration)) return false;
    if (!/^\d+$/.test(String(song.id))) return false;
    return neteasePlugins.has(item.pluginName);
  });
  if (pending.length === 0) return;

  const patches = await fetchWyTrackMetaByIds(pending.map(item => String(item.song.id)));
  if (token !== loadToken || patches.size === 0) return;

  let changed = false;
  for (const item of pending) {
    const patch = patches.get(String(item.song.id));
    if (!patch) continue;
    if (!item.song.coverUrl && patch.coverUrl) {
      item.song.coverUrl = patch.coverUrl;
      changed = true;
    }
    if (!item.song.duration && patch.durationMs > 0) {
      item.song.duration = patch.durationMs;
      changed = true;
    }
  }
  if (changed) {
    items.value = [...items.value];
  }
}

// 推荐结果变化时清空多选状态（换一批后 path 全新，旧选中集无效）
watch(items, () => {
  isBatchMode.value = false;
  selectedPaths.value = new Set();
});

// ==================== 列表数据 ====================

/** 将插件搜索结果转换为 Song（plugin:// 协议，由 playSong 解析真实播放地址） */
function recommendItemToSong(item: DailyRecommendItem): Song {
  const result: PluginSearchResult = item.song;
  const artistNames = result.artist
    ? result.artist.split(/[、,/&]/).filter(Boolean).map(s => s.trim())
    : ['未知歌手'];

  let album = result.album || '';
  if (!album && (result.rawData as any)) {
    const raw = result.rawData as any;
    album = raw.al?.name || raw.album?.name || raw.albumName || '';
  }
  album = album || '未知专辑';

  let durationMs = result.duration || 0;
  if ((!durationMs || durationMs <= 0) && result.rawData) {
    durationMs = extractDurationMs(result.rawData);
  }

  return {
    name: result.title,
    title: result.title,
    path: `plugin://${result.platform}/${result.id}`,
    artist: result.artist || '未知歌手',
    artist_names: artistNames,
    effective_artist_names: artistNames,
    album,
    album_artist: result.artist || '未知歌手',
    album_key: `${album}-${result.artist || '未知歌手'}`,
    is_various_artists_album: false,
    collapse_artist_credits: false,
    duration: Math.floor((durationMs || 0) / 1000),
    cover_thumb_path: result.coverUrl || '',
    source_type: 'plugin',
    remote_source_id: `plugin://${result.platform}/${result.id}`,
    rawData: result,
  } as any;
}

const songList = computed<Song[]>(() => items.value.map(recommendItemToSong));

/** 列表滚动记忆键：含日期与批次，换一批/跨天自动重置滚动位置 */
const memoryScopeKey = computed(
  () => `daily-recommend::${algorithm.value?.date ?? ''}::b${batch.value}`,
);

// ==================== 播放 ====================

/** 播放单首：插入当前歌曲之后 */
const handlePlaySong = (song: Song) => {
  void playSong(song, { insertAfterCurrent: true });
};

/** 播放全部：清空队列加入全部推荐歌曲后播放第一首 */
async function handlePlayAll() {
  if (songList.value.length === 0) return;
  try {
    const songs = songList.value;
    const firstSong = songs[0];
    launchFlyingCover(firstSong.path, firstSong.cover_thumb_path || '');
    await clearQueue();
    addSongsToQueue(songs);
    await playSong(firstSong, { preserveQueue: true });
  } catch (e: any) {
    showToast(`播放失败: ${e?.message || e}`, 'error');
  }
}

// ==================== 拖拽与右键菜单 ====================

// 拖拽到歌单/队列（与最近播放页一致的拖拽能力）
const { handleTableDragStart } = useSongDrag(songList, isBatchMode, selectedPaths, songTableRef);

// 右键菜单状态（自动区分本地/在线歌曲，已下载在线歌曲索引至本地文件）
const {
  showContextMenu,
  contextMenuX,
  contextMenuY,
  contextMenuTargetSong,
  contextMenuResolvedPath,
  contextMenuIsOnlineSearch,
  handleContextMenu,
  handleOnlineViewArtist,
  handleOnlineViewAlbum,
} = useSongContextActions({ isBatchMode });

/** 右键菜单：收藏至歌单（在线歌曲需先缓存元信息到 songPool） */
function handleContextMenuAddToPlaylist() {
  const song = contextMenuTargetSong.value;
  if (!song) return;
  libraryStore.setExtraSong(song);
  openAddToPlaylistDialog([song.path], { songs: [song] });
}

// ==================== 导航 ====================
const goLogin = () => {
  void router.push('/auth');
};

const goPlugins = () => {
  void router.push('/plugins');
};

// ==================== 生命周期 ====================
onMounted(() => {
  void load(false);
});

// 登录态变化（登录/登出/切换账号）时重新加载
watch(() => authStore.isLoggedIn, () => {
  void load(false);
});

// 插件变更（安装/卸载/启停）时重新加载
watch(pluginsVersion, () => {
  if (!loading.value) void load(false);
});
</script>
