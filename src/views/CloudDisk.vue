<template>
  <div class="flex flex-col h-full">
    <!-- ── 头部：标题行 + 下划线视图 tab 行 + 来源 chip 横滑行（在线搜索结果页同款） ── -->
    <div v-if="sources.length > 0" class="px-6 pt-4 pb-2 shrink-0 select-none">
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <h1 class="text-2xl font-bold text-black dark:text-white m-0">{{ t('sidebar.cloud') }}</h1>
        <div class="flex items-center gap-1.5 shrink-0">
          <!-- 隐藏重复歌曲（歌名+歌手 key，与移动端网盘页同款） -->
          <button
            type="button"
            class="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 cursor-pointer"
            :class="hideDuplicates
              ? 'bg-red-50 dark:bg-red-500/10 text-[#EC4141]'
              : 'bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50 hover:bg-black/10 dark:hover:bg-white/15'"
            :title="hideDuplicates ? t('cloud.showDuplicates') : t('cloud.hideDuplicates')"
            @click="hideDuplicates = !hideDuplicates"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </button>
          <!-- 排序：档位下拉 + 当选档升/降序切换（与移动端同语义） -->
          <div class="relative">
            <button
              type="button"
              class="h-9 rounded-full flex items-center justify-center gap-1 px-3 transition-all active:scale-95 cursor-pointer"
              :class="cloudSortMode !== 'none'
                ? 'bg-red-50 dark:bg-red-500/10 text-[#EC4141]'
                : 'bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50 hover:bg-black/10 dark:hover:bg-white/15'"
              :title="t('cloud.sort')"
              @click="sortMenuOpen = !sortMenuOpen"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4 4m0 0l4-4m-4 4V7" />
              </svg>
              <span v-if="cloudSortMode !== 'none'" class="text-[0.72rem] font-medium">
                {{ cloudSortAsc ? '↑' : '↓' }}
              </span>
            </button>
            <div
              v-if="sortMenuOpen"
              class="absolute right-0 top-full mt-1.5 w-44 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-xl shadow-xl border border-black/5 dark:border-white/10 overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100 origin-top-right"
            >
              <button
                v-for="opt in cloudSortOptions"
                :key="opt.key"
                type="button"
                class="w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-2 transition-colors cursor-pointer"
                :class="cloudSortMode === opt.key
                  ? 'text-[#EC4141] font-medium bg-red-50/60 dark:bg-red-500/5'
                  : 'text-black/70 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/10'"
                @click="pickCloudSort(opt.key)"
              >
                <span>{{ opt.label }}</span>
                <svg v-if="cloudSortMode === opt.key && opt.key !== 'none'" class="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" @click.stop="toggleCloudSortAsc">
                  <path stroke-linecap="round" stroke-linejoin="round" :d="cloudSortAsc ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'" />
                </svg>
              </button>
            </div>
            <div v-if="sortMenuOpen" class="fixed inset-0 z-40 cursor-default" @click="sortMenuOpen = false" />
          </div>
          <button
            type="button"
            :disabled="currentRefreshing"
            class="w-9 h-9 rounded-full bg-[#EC4141] text-white flex items-center justify-center shadow-sm transition-all hover:opacity-90 active:scale-95 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
            :title="t('cloud.refresh')"
            @click="refreshCurrent"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              :class="{ 'animate-spin': currentRefreshing }"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2.2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 视图 tab：下划线指示器样式，与搜索结果页一致 -->
      <div class="flex items-center gap-1 mt-1 border-b border-black/5 dark:border-white/5">
        <button
          v-for="tab in viewTabs"
          :key="tab.key"
          type="button"
          class="relative px-5 py-2.5 text-[0.95rem] font-medium tracking-wide transition-colors cursor-pointer"
          :class="viewTab === tab.key
            ? 'text-[#EC4141]'
            : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          @click="switchViewTab(tab.key)"
        >
          {{ tab.label }}
          <span
            class="absolute left-1/2 -translate-x-1/2 -bottom-px h-[2px] w-8 bg-[#EC4141] rounded-full origin-center transition-all duration-300 ease-out"
            :class="viewTab === tab.key ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'"
          />
        </button>
      </div>

      <!-- 来源 chip 行：「来源」前缀 + 横滑 chip + 右侧计数提示 -->
      <div class="flex items-center justify-between gap-4 py-2.5">
        <div class="flex items-center min-w-0 flex-1">
          <span class="text-[0.8rem] text-black/50 dark:text-white/50 mr-1 shrink-0">{{ t('cloud.sourceLabel') }}</span>
          <div
            ref="sourceScrollEl"
            class="flex items-center gap-1 overflow-x-auto no-h-scrollbar min-w-0 pr-3 cursor-grab"
            :class="{ 'cursor-grabbing': isDraggingSource }"
          >
            <button
              v-for="p in sources"
              :key="p.id"
              type="button"
              class="px-3 py-1.5 rounded-md text-[0.85rem] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
              :class="selectedId === p.id
                ? 'text-[#EC4141] bg-red-50 dark:bg-red-500/10'
                : 'text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5'"
              @click="selectSource(p.id)"
            >
              {{ p.displayName }}
            </button>
          </div>
        </div>
        <div class="flex items-center gap-2 min-w-0 shrink-0">
          <span class="text-[0.8rem] text-black/50 dark:text-white/50 truncate max-w-[16rem]">
            {{ currentProvider?.displayName }} · {{ currentSourceItems.length }} {{ t('cloud.songsSuffix') }}
          </span>
        </div>
      </div>
    </div>

    <!-- ── 主体 ── -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <!-- 空态：尚未绑定网盘 -->
      <div v-if="sources.length === 0" class="h-full flex flex-col items-center justify-center gap-3 select-none">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-black/25 dark:text-white/25" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
        </svg>
        <p class="text-sm text-black/50 dark:text-white/50 m-0">{{ t('cloud.diskEmpty') }}</p>
        <button
          type="button"
          class="px-4 py-2 rounded-lg bg-[#EC4141] text-white text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer active:scale-[0.97]"
          @click="goBind"
        >
          {{ t('cloud.goBind') }}
        </button>
      </div>

      <template v-else>
        <!-- 加载中 / 出错 -->
        <div v-if="currentLoading && currentSourceItems.length === 0" class="h-full flex flex-col items-center justify-center gap-3 select-none">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 animate-spin text-[#EC4141]" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
            <path d="M12 2a10 10 0 019.54 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
          <p class="text-sm text-black/50 dark:text-white/50 m-0">{{ t('cloud.diskLoading') }}</p>
        </div>
        <div v-else-if="currentError" class="h-full flex flex-col items-center justify-center gap-3 select-none px-6 text-center">
          <p class="text-sm text-black/60 dark:text-white/60 m-0 break-all">{{ currentError }}</p>
          <button
            type="button"
            class="px-4 py-2 rounded-lg bg-[#EC4141] text-white text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer active:scale-[0.97]"
            @click="refreshCurrent"
          >
            {{ t('cloud.retry') }}
          </button>
        </div>

        <!-- 歌手/专辑 分组列表 -->
        <div v-else-if="viewTab !== 0 && activeDrill == null" class="h-full overflow-y-auto px-6 pb-6">
          <div v-if="currentGroups.length === 0" class="h-full flex items-center justify-center">
            <p class="text-sm text-black/50 dark:text-white/50 m-0">{{ t('cloud.noAudio') }}</p>
          </div>
          <button
            v-for="g in currentGroups"
            :key="g.name"
            type="button"
            class="w-full flex items-center justify-between gap-4 px-4 py-3 rounded-xl transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer text-left"
            @click="enterGroup(g)"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-lg bg-black/5 dark:bg-white/10 flex items-center justify-center shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-black/40 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                  <path v-if="viewTab === 1" stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  <path v-else stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
                </svg>
              </div>
              <span class="text-sm font-medium text-black dark:text-white truncate">{{ g.name }}</span>
            </div>
            <span class="text-xs text-black/40 dark:text-white/40 shrink-0">{{ g.songs.length }}</span>
          </button>
        </div>

        <!-- 分组下钻：该歌手/专辑的曲目列表 -->
        <template v-else-if="activeDrill != null">
          <div class="flex flex-col h-full">
            <div class="px-6 pt-3 pb-2 shrink-0 flex items-center gap-3 select-none">
              <button
                type="button"
                class="w-8 h-8 rounded-full flex items-center justify-center text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                :title="t('cloud.back')"
                @click="activeDrill = null"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div class="min-w-0">
                <h2 class="text-lg font-semibold text-black dark:text-white m-0 truncate">{{ activeDrill.name }}</h2>
                <p class="text-xs text-black/50 dark:text-white/50 m-0">{{ drillSongs.length }} {{ t('cloud.songsSuffix') }}</p>
              </div>
            </div>
            <div class="flex-1 min-h-0 overflow-hidden">
              <SongTable
                ref="songTableRef"
                :songs="drillSongs"
                :isBatchMode="isBatchMode"
                :selectedPaths="selectedPaths"
                :memoryScopeKey="drillMemoryKey"
                @play="handlePlaySong"
                @contextmenu="handleContextMenu"
                @update:selectedPaths="selectedPaths = $event"
              />
            </div>
          </div>
        </template>

        <!-- 全部：当前来源全量列表（顶栏搜索词客户端过滤） -->
        <template v-else>
          <div v-if="filteredSongs.length === 0" class="h-full flex items-center justify-center px-6">
            <p class="text-sm text-black/50 dark:text-white/50 m-0 text-center select-none">
              {{ searchKw !== '' ? t('cloud.diskNoMatch') : t('cloud.noAudio') }}
            </p>
          </div>
          <SongTable
            v-else
            ref="songTableRef"
            :songs="displaySongs"
            :isBatchMode="isBatchMode"
            :selectedPaths="selectedPaths"
            :memoryScopeKey="memoryScopeKey"
            @play="handlePlaySong"
            @contextmenu="handleContextMenu"
            @update:selectedPaths="selectedPaths = $event"
          />
        </template>
      </template>
    </div>

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
/**
 * 网盘页：移动端横屏模式网盘面板（CloudDiskPage paneEmbedded）的桌面端移植。
 * 结构同构：来源 pill 行（按 设置-插件 网盘排序）+ 全部/歌手/专辑 三个视图
 * tab + 全量音频列表（SongTable，cloud:// 行自动预探封面/歌词/时长）。
 * 顶栏搜索词（usePlayerViewState.searchQuery）对当前来源做客户端过滤，
 * 与移动端面板态「搜索词来自壳层全局顶栏」语义一致。
 * 数据按来源模块级缓存（keep-alive：退路由保留，重进不重拉），刷新按钮强制重拉。
 */
import { computed, defineAsyncComponent, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from '../features/i18n';
import { useSettings } from '../features/settings/useSettings';
import { cloudProviders, cloudProviderById } from '../services/cloud/cloudRegistry';
import {
  CloudCredentialsStore,
} from '../services/cloud/cloudCredentialsStore';
import { CloudScanCacheStore } from '../services/cloud/cloudScanCacheStore';
import { CloudFolderSelectionStore } from '../services/cloud/cloudFolderSelectionStore';
import { listAllCloudAudio } from '../services/cloud/cloudScopedQuery';
import { cloudFileToSong } from '../features/library/cloudFolderTree';
import { usePlaybackController } from '../features/playback/usePlaybackController';
import { usePlaybackStore } from '../features/playback/store';
import { usePlayerViewState } from '../composables/usePlayerViewState';
import { useDragScrollX } from '../composables/useDragScrollX';
import { useSongContextActions } from '../composables/useSongContextActions';
import { useAddToPlaylistDialog } from '../features/collections/addToPlaylistDialog';
import { useLibraryStore } from '../features/library/store';
import type { Song } from '../types';
import type { CloudProvider } from '../services/cloud/cloudProvider';

const SongTable = defineAsyncComponent(() => import('../components/song-list/SongTable.vue'));
const SongContextMenu = defineAsyncComponent(() => import('../components/overlays/SongContextMenu.vue'));

const { t } = useI18n();
const router = useRouter();
const { playSong } = usePlaybackController();
const playbackStore = usePlaybackStore();
const { settings: appPrefs } = useSettings();
const { searchQuery } = usePlayerViewState();
const libraryStore = useLibraryStore();
const { openAddToPlaylistDialog } = useAddToPlaylistDialog();

// ==================== 来源状态（模块级缓存，路由退场保留） ====================

interface CloudDiskSourceState {
  loading: boolean;
  loaded: boolean;
  error: string;
  songs: Song[];
}

const sourceCache = reactive(new Map<string, CloudDiskSourceState>());

const ensureState = (id: string): CloudDiskSourceState => {
  let s = sourceCache.get(id);
  if (!s) {
    s = reactive({ loading: false, loaded: false, error: '', songs: [] });
    sourceCache.set(id, s);
  }
  return s;
};

/** 拉取某网盘全部音频并入缓存；非 force 时已加载/加载中直接跳过。
 * 结果先查 24h 落盘缓存（重启免重扫，对应移动端「扫完重启就空」反馈）；
 * 未命中才遍历。多账号时按绑定顺序逐个尝试：旧账号失效/无文件则换下一个
 * （浏览器用的是手选账号，固定取 accounts[0] 会拿到失效凭据而静默 0 首）。
 * 已选文件夹 → 只遍历选定范围；未选 → 全盘遍历（与移动端一致）。 */
const loadSource = async (providerId: string, force = false): Promise<void> => {
  const cur = sourceCache.get(providerId);
  if (cur?.loading) return;
  if (!force && cur?.loaded) return;
  const s = ensureState(providerId);
  s.loading = true;
  s.error = '';
  try {
    const provider = cloudProviderById(providerId);
    if (!provider) throw new Error(t('cloud.unsupportedProvider'));
    const accounts = await CloudCredentialsStore.instance.accountsFor(providerId);
    if (accounts.length === 0) throw new Error(t('cloud.accountMissing'));
    let lastError: unknown = null;
    for (const acc of accounts) {
      if (!force) {
        const cached = CloudScanCacheStore.instance.loadFresh(providerId, acc.accountId);
        if (cached) {
          s.songs = cached.files.map((f) =>
            cloudFileToSong(f, providerId, provider.displayName, acc.accountId),
          );
          s.loaded = true;
          return;
        }
      }
      try {
        const roots = await CloudFolderSelectionStore.instance.pathsFor(providerId, acc.accountId);
        const files = await listAllCloudAudio(provider, acc.cred, roots);
        CloudScanCacheStore.instance.save(providerId, acc.accountId, files);
        s.songs = files.map((f) =>
          cloudFileToSong(f, providerId, provider.displayName, acc.accountId),
        );
        s.loaded = true;
        return;
      } catch (e) {
        // 该账号遍历失败（凭据失效/风控）：多账号换下一个，单账号向上抛
        lastError = e;
        if (accounts.length === 1) throw e;
      }
    }
    throw lastError ?? new Error(t('cloud.accountMissing'));
  } catch (e) {
    s.error = e instanceof Error ? e.message : String(e);
  } finally {
    s.loading = false;
  }
};

// ==================== 来源列表（绑定账号驱动，sortIndex 排序） ====================

const accountsMap = ref<Record<string, boolean>>({});
const sourcesLoading = ref(true);

const refreshSources = async (): Promise<void> => {
  const map: Record<string, boolean> = {};
  for (const p of cloudProviders) {
    const accounts = await CloudCredentialsStore.instance.accountsFor(p.id);
    map[p.id] = accounts.length > 0;
  }
  accountsMap.value = map;
  sourcesLoading.value = false;
};

const sources = computed<CloudProvider[]>(() => {
  const prefs = appPrefs.value.plugins?.cloudSources ?? {};
  const bound = cloudProviders.filter((p) => accountsMap.value[p.id]);
  return bound
    .map((p, i) => ({ p, idx: prefs[p.id]?.sortIndex ?? (1 << 30) + i }))
    .sort((a, b) => a.idx - b.idx)
    .map((e) => e.p);
});

const selectedId = ref('');
const currentProvider = computed(() => sources.value.find((p) => p.id === selectedId.value) ?? null);
const currentSourceItems = computed<Song[]>(() => sourceCache.get(selectedId.value)?.songs ?? []);
const currentLoading = computed(() => sourceCache.get(selectedId.value)?.loading ?? false);
const currentError = computed(() => sourceCache.get(selectedId.value)?.error ?? '');
const currentRefreshing = computed(() => currentLoading.value);

const selectSource = (id: string): void => {
  if (selectedId.value === id) return;
  selectedId.value = id;
  activeDrill.value = null;
};

const refreshCurrent = (): void => {
  if (selectedId.value !== '') {
    activeDrill.value = null;
    void loadSource(selectedId.value, true);
  }
};

const goBind = (): void => {
  void router.push('/settings?tab=account');
};

// 来源 chip 行横向拖拽滚动（搜索结果页来源行同款交互）
const sourceScrollEl = ref<HTMLElement | null>(null);
const { isDragging: isDraggingSource } = useDragScrollX(sourceScrollEl);

// ==================== 视图 tab 与分组 ====================

type ViewTab = 0 | 1 | 2;
const viewTab = ref<ViewTab>(0);
const UNKNOWN_ALBUM = computed(() => t('cloud.unknownAlbum'));

const viewTabs = computed(() => [
  { key: 0 as ViewTab, label: t('cloud.tabAll') },
  { key: 1 as ViewTab, label: t('cloud.tabArtists') },
  { key: 2 as ViewTab, label: t('cloud.tabAlbums') },
]);

interface CloudGroup {
  name: string;
  songs: Song[];
}

const currentGroups = computed<CloudGroup[]>(() => {
  const items = dedupedSourceItems.value;
  if (items.length === 0) return [];
  const keyOf = viewTab.value === 1
    ? (s: Song) => s.artist
    : (s: Song) => s.album || UNKNOWN_ALBUM.value;
  const map = new Map<string, CloudGroup>();
  for (const s of items) {
    const key = keyOf(s);
    const g = map.get(key);
    if (g) g.songs.push(s);
    else map.set(key, { name: key, songs: [s] });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
});

const activeDrill = ref<CloudGroup | null>(null);

const switchViewTab = (tab: ViewTab): void => {
  if (viewTab.value === tab) return;
  viewTab.value = tab;
  activeDrill.value = null;
};

const enterGroup = (g: CloudGroup): void => {
  activeDrill.value = g;
};

// ==================== 搜索过滤（顶栏搜索词，客户端匹配） ====================

const searchKw = computed(() => searchQuery.value.trim().toLowerCase());

const filterSongs = (list: Song[]): Song[] => {
  const kw = searchKw.value;
  if (kw === '') return list;
  return list.filter(
    (s) =>
      (s.title ?? '').toLowerCase().includes(kw) ||
      s.artist.toLowerCase().includes(kw) ||
      (s.album ?? '').toLowerCase().includes(kw),
  );
};

const filteredSongs = computed(() => filterSongs(dedupedSourceItems.value));
const drillSongs = computed(() => filterSongs(activeDrill.value?.songs ?? []));

// ==================== 去重与排序（移动端网盘页同款，偏好落盘） ====================

/** 隐藏重复歌曲：歌名+歌手 key，同键保留首条；纯展示层过滤，不写扫描缓存 */
const HIDE_DUP_KEY = 'cloud_disk_hide_duplicates';
const hideDuplicates = ref(localStorage.getItem(HIDE_DUP_KEY) === '1');
watch(hideDuplicates, (v) => localStorage.setItem(HIDE_DUP_KEY, v ? '1' : '0'));

/** 去重后来源条目（分组视图与全部列表共用，保持原始序） */
const dedupedSourceItems = computed<Song[]>(() => {
  if (!hideDuplicates.value) return currentSourceItems.value;
  const seen = new Set<string>();
  return currentSourceItems.value.filter((s) => {
    const key = `${s.title ?? ''}::${s.artist}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

/** 排序档与方向（默认排序 = 网盘原始序，降序即倒序展示；与移动端
 * PageSortPrefs 同语义，localStorage 落盘） */
type CloudSortMode = 'none' | 'title' | 'artist' | 'album';
const CLOUD_SORT_MODES: readonly CloudSortMode[] = ['none', 'title', 'artist', 'album'];
const SORT_MODE_KEY = 'cloud_disk_sort_mode';
const SORT_ASC_KEY = 'cloud_disk_sort_asc';
const savedSortMode = localStorage.getItem(SORT_MODE_KEY) as CloudSortMode | null;
const cloudSortMode = ref<CloudSortMode>(
  savedSortMode != null && CLOUD_SORT_MODES.includes(savedSortMode) ? savedSortMode : 'none',
);
const cloudSortAsc = ref(localStorage.getItem(SORT_ASC_KEY) !== '0');
watch(cloudSortMode, (v) => localStorage.setItem(SORT_MODE_KEY, v));
watch(cloudSortAsc, (v) => localStorage.setItem(SORT_ASC_KEY, v ? '1' : '0'));

const cloudSortOptions = computed(() => [
  { key: 'none' as CloudSortMode, label: t('cloud.sortDefault') },
  { key: 'title' as CloudSortMode, label: t('cloud.sortAZ') },
  { key: 'artist' as CloudSortMode, label: t('cloud.sortArtist') },
  { key: 'album' as CloudSortMode, label: t('cloud.sortAlbum') },
]);

const pickCloudSort = (mode: CloudSortMode): void => {
  cloudSortMode.value = mode;
};

const toggleCloudSortAsc = (): void => {
  cloudSortAsc.value = !cloudSortAsc.value;
};

const sortMenuOpen = ref(false);

/** 排序（中文按 zh-CN 拼音序；歌手/专辑档内再按标题稳定排）。
 * 仅作用于「全部」列表，分组视图保持网盘原始序（与移动端一致）。 */
const sortSongs = (list: Song[]): Song[] => {
  const mode = cloudSortMode.value;
  if (mode === 'none') {
    // 默认排序：升序 = 网盘原始序，降序 = 倒序展示（与移动端一致）
    return cloudSortAsc.value ? [...list] : [...list].reverse();
  }
  const asc = cloudSortAsc.value;
  const dir = asc ? 1 : -1;
  const cmp = (a: string, b: string) => dir * a.localeCompare(b, 'zh-CN');
  const keyOf = (s: Song) =>
    mode === 'title' ? s.title ?? '' : mode === 'artist' ? s.artist : s.album ?? '';
  return [...list].sort((a, b) => {
    const c = cmp(keyOf(a), keyOf(b));
    if (mode === 'title' || c !== 0) return c;
    return cmp(a.title ?? '', b.title ?? '');
  });
};

// ==================== 播放：队列 = 当前列表，当前曲目即所点歌曲 ====================

const displaySongs = computed<Song[]>(() =>
  activeDrill.value != null ? drillSongs.value : sortSongs(filteredSongs.value),
);

const handlePlaySong = (song: Song): void => {
  const list = displaySongs.value;
  if (list.length === 0) return;
  playbackStore.setQueueFromPaths(
    list.map((s) => s.path),
    list,
  );
  void playSong(song, { preserveQueue: true });
};

// ==================== 批量选择与右键菜单 ====================

const songTableRef = ref<InstanceType<typeof SongTable> | null>(null);
const isBatchMode = ref(false);
const selectedPaths = ref<Set<string>>(new Set());

const memoryScopeKey = computed(() => `cloud-disk::${selectedId.value}`);
const drillMemoryKey = computed(
  () => `cloud-disk::${selectedId.value}::${viewTab.value}::${activeDrill.value?.name ?? ''}`,
);

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

function handleContextMenuAddToPlaylist() {
  const song = contextMenuTargetSong.value;
  if (!song) return;
  libraryStore.setExtraSong(song);
  openAddToPlaylistDialog([song.path], { songs: [song] });
}

// ==================== 生命周期 ====================

onMounted(() => {
  void refreshSources();
});

// 来源就绪/变化：清理失效缓存 → 兜底选中 → 确保当前来源已加载
watch(
  sources,
  (list) => {
    if (sourcesLoading.value) return;
    const alive = new Set(list.map((p) => p.id));
    for (const key of [...sourceCache.keys()]) {
      if (!alive.has(key)) sourceCache.delete(key);
    }
    if (!list.some((p) => p.id === selectedId.value)) {
      selectedId.value = list.length > 0 ? list[0].id : '';
      activeDrill.value = null;
    }
    if (selectedId.value !== '') void loadSource(selectedId.value);
  },
  { immediate: true },
);
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
</style>
