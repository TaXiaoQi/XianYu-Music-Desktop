<script setup lang="ts"> // 实现
// 歌单/列表详情页头部：滚动收缩封面、批量工具条、排序弹出菜单
import { computed, onMounted, onUnmounted, ref, watch, type Component } from 'vue';
import { convertFileSrc as toAssetProtocolUrl } from '@tauri-apps/api/core';
import { ListChecks, ListPlus, PencilLine, RefreshCw } from 'lucide-vue-next';
import type { Song } from '../../types'; // 实现
import { usePlayerViewState } from '../../composables/usePlayerViewState'; // 实现
import { useLibraryCollections } from '../../features/collections/useLibraryCollections'; // 实现
import { useCoverCache } from '../../composables/useCoverCache'; // 实现
import { getDisplayCoverUrl } from '../../utils/coverProxy';
import { useLibraryStore } from '../../features/library/store';
import { useScrollShrinkHeader } from '../../composables/useScrollShrinkHeader';
import type { FavoriteCollectionEntry } from '../../features/collections/store';
import SortModeIcon from '../common/SortModeIcon.vue'; // 实现
import CollectionFavoriteButton from '../favorites/CollectionFavoriteButton.vue';
import SortOptionPopover from './sortPopover/SortOptionPopover.vue';
import HeaderOverflowMenu from './HeaderOverflowMenu.vue';

const props = defineProps<{ // 实现
  title: string; // 实现
  subtitle?: string; // 实现
  songs: Song[]; // 实现
  isBatchMode: boolean; // 实现
  selectedCount: number; // 实现
  totalSongCount?: number;
  showRename?: boolean; // 实现
  readOnly?: boolean;
  showAddToPlaylist?: boolean;
  showHeaderAddToPlaylist?: boolean;
  showSourceUpdate?: boolean;
  coverUrlOverride?: string;
  favoriteEntry?: FavoriteCollectionEntry | null;
  scrollContainerRef?: HTMLElement | null;
}>();

const emit = defineEmits([ // 实现
  'update:isBatchMode', // 实现
  'playAll',
  'batchPlay', // 实现
  'batchDelete', // 实现
  'openAddToPlaylist', // 实现
  'batchAddToFavorites',
  'batchDownload',
  'rename',
  'selectAll',
  'updateFromSource',
]);

const { playlistSortMode, setPlaylistSortMode, currentViewMode, filterCondition } = usePlayerViewState();
const { playlists } = useLibraryCollections();
const libraryStore = useLibraryStore();

const totalTrackAmount = computed(() => props.totalSongCount ?? props.songs.length);
const isAllSelected = computed(() => totalTrackAmount.value > 0 && props.selectedCount === totalTrackAmount.value);
const canBatchCollectToPlaylist = computed(() => props.showAddToPlaylist !== false);
const canCollectFromHeader = computed(() => props.showHeaderAddToPlaylist ?? canBatchCollectToPlaylist.value);

// 头部保留“全部播放 / 收藏(心形) / 排序”这类主操作；重命名、源端更新、收藏至歌单、批量操作收进“更多”菜单。
const HEADER_OVERFLOW_BUTTON =
  'px-3 py-2 rounded-full text-sm font-medium transition flex items-center active:scale-95 shadow-sm bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-300 hover:border-gray-200 dark:hover:border-white/20';

const overflowItems = computed<{ id: string; label: string; icon: Component }[]>(() => {
  const items: { id: string; label: string; icon: Component }[] = [];
  if (props.showRename) items.push({ id: 'rename', label: '修改信息', icon: PencilLine });
  if (props.showSourceUpdate) items.push({ id: 'update', label: '从源端更新', icon: RefreshCw });
  if (canCollectFromHeader.value) items.push({ id: 'collect', label: '收藏至歌单', icon: ListPlus });
  if (!props.readOnly) items.push({ id: 'batch', label: '批量操作', icon: ListChecks });
  return items;
});

function handleOverflowPick(id: string) {
  if (id === 'rename') emit('rename');
  else if (id === 'update') emit('updateFromSource');
  else if (id === 'collect') emit('openAddToPlaylist');
  else if (id === 'batch') emit('update:isBatchMode', true);
}

// ===== 排序弹出菜单 =====
type PlaylistSortValue = 'title' | 'name' | 'artist' | 'added_at' | 'added_at_asc' | 'custom';

interface SortEntry {
  value: string;
  label: string;
}

const PLAYLIST_SORT_ENTRIES: SortEntry[] = [
  { value: 'title', label: '歌曲名' },
  { value: 'name', label: '文件名' },
  { value: 'artist', label: '歌手' },
  { value: 'added_at', label: '添加时间' },
  { value: 'custom', label: '自定义' },
];

const SORT_ARROW_ENTRIES = ['added_at'];

const sortMenuShown = ref(false);
const sortMenuPosX = ref(0);
const sortMenuPosY = ref(0);
const sortMenuDockRight = ref(false);

const toggleSortMenu = (event: MouseEvent) => {
  const anchorBox = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const dockToRight = anchorBox.left > window.innerWidth / 2;
  sortMenuDockRight.value = dockToRight;
  sortMenuPosX.value = dockToRight ? window.innerWidth - anchorBox.right : anchorBox.left;
  sortMenuPosY.value = anchorBox.bottom + 8;
  sortMenuShown.value = !sortMenuShown.value;
};

const closeSortMenuFromOutside = (event: MouseEvent) => {
  if ((event.target as HTMLElement).closest('.sort-menu-trigger')) return;
  sortMenuShown.value = false;
};

onMounted(() => window.addEventListener('click', closeSortMenuFromOutside));
onUnmounted(() => window.removeEventListener('click', closeSortMenuFromOutside));

const sortReversedEntries = computed(() =>
  playlistSortMode.value === 'added_at_asc' ? SORT_ARROW_ENTRIES : [],
);

const applyPlaylistSort = (value: string) => {
  if (value === 'added_at') {
    setPlaylistSortMode(playlistSortMode.value === 'added_at' ? 'added_at_asc' : 'added_at');
  } else {
    setPlaylistSortMode(value as PlaylistSortValue);
  }
  sortMenuShown.value = false;
};

// ===== 批量工具条 =====
type BatchIconName = 'check' | 'heart' | 'plus' | 'download' | 'trash';

const BATCH_ICON_PATHS: Record<Exclude<BatchIconName, 'check'>, string> = {
  heart: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
  plus: 'M12 4v16m8-8H4',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M5 21h14',
  trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
};

const batchButtonClass =
  'px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95 bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-white/10 dark:hover:bg-white/20 dark:text-gray-200';

const pillButtonClass =
  'px-5 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 active:scale-95 shadow-sm bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 hover:border-gray-200 dark:hover:border-white/20';

const batchActions = computed(() => {
  const actions: Array<{ key: string; caption: string; icon: BatchIconName; run: () => void }> = [
    { key: 'select-all', caption: isAllSelected.value ? '取消全选' : '全选', icon: 'check', run: () => emit('selectAll') },
    { key: 'like', caption: '添加至我喜欢', icon: 'heart', run: () => emit('batchAddToFavorites') },
  ];
  if (canBatchCollectToPlaylist.value) {
    actions.push({ key: 'collect', caption: '收藏到歌单', icon: 'plus', run: () => emit('openAddToPlaylist') });
  }
  actions.push(
    { key: 'download', caption: '下载', icon: 'download', run: () => emit('batchDownload') },
    { key: 'remove', caption: '移除', icon: 'trash', run: () => emit('batchDelete') },
  );
  return actions;
});

// ===== 头图封面解析 =====
const headerCover = ref(''); // 实现
const displayedHeaderCover = ref('');
let coverRequestId = 0; // 实现
const { loadCover, loadFullCover, primeCoverPath } = useCoverCache(); // 封面缓存

watch(
  headerCover,
  (rawUrl) => {
    if (!rawUrl) {
      displayedHeaderCover.value = '';
      return;
    }
    displayedHeaderCover.value = getDisplayCoverUrl(rawUrl, (decoded) => {
      displayedHeaderCover.value = decoded;
    });
  },
  { immediate: true },
);

const isDirectUrl = (candidate: string) => {
  if (/^https?:\/\//i.test(candidate)) return true;
  return candidate.startsWith('asset:') || candidate.startsWith('data:');
};

const REMOTE_TRACK_PREFIXES = ['lx://', 'plugin://', 'http://', 'https://'] as const;

const isRemoteTrackPath = (candidate: string) =>
  REMOTE_TRACK_PREFIXES.some((prefix) => candidate.startsWith(prefix));

const resolveCoverPath = (coverPath: string): string =>
  !coverPath ? '' : isDirectUrl(coverPath) ? coverPath : toAssetProtocolUrl(coverPath);

const activePlaylist = computed(() =>
  currentViewMode.value === 'playlist'
    ? playlists.value.find((item) => item.id === filterCondition.value) ?? null
    : null,
);

const playlistCoverKey = computed(() => {
  const playlist = activePlaylist.value;
  if (!playlist) return '';
  return `${playlist.id}::${playlist.coverPath ?? ''}::${playlist.songPaths[0] ?? ''}::${playlist.songPaths.length}`;
});

const unpackLocalCover = async (trackPath: string): Promise<string | null> => {
  try {
    const fullArtwork = await loadFullCover(trackPath);
    if (fullArtwork) return fullArtwork;

    const thumbnail = await loadCover(trackPath);
    if (thumbnail) return thumbnail;
  } catch {
    // 本地提取失败不作为致命错误，交由外层候选值兜底
  }
  return null;
};

const resolvePlaylistCover = async (): Promise<string> => {
  const playlist = activePlaylist.value;
  if (!playlist) return '';
  if (playlist.coverPath) return resolveCoverPath(playlist.coverPath);
  if (playlist.cloudCoverUrl && /^https?:\/\//i.test(playlist.cloudCoverUrl)) return playlist.cloudCoverUrl;
  if (playlist.songPaths.length === 0) return '';

  const leadTrackPath = playlist.songPaths[0];
  const metaFromPlaylist = playlist.songs?.find((item) => item.path === leadTrackPath) ?? playlist.songs?.[0];
  const metaFromLookup = libraryStore.songLookup.get(leadTrackPath);
  const metaFromProps = props.songs.find((item) => item.path === leadTrackPath) ?? props.songs[0];
  const metaTrack = metaFromPlaylist ?? metaFromLookup ?? metaFromProps;
  const onlineCover = metaTrack?.cover_thumb_path || (metaTrack as any)?.coverUrl || '';

  if (onlineCover) {
    const primed = primeCoverPath(metaTrack?.path || leadTrackPath, onlineCover);
    if (primed || isDirectUrl(onlineCover)) return primed || onlineCover;
  }

  if (!isRemoteTrackPath(leadTrackPath)) {
    const unpacked = await unpackLocalCover(leadTrackPath);
    if (unpacked) return unpacked;
  }

  return onlineCover || '';
};

const resolveSongListCover = async (): Promise<string> => {
  const leadTrack = props.songs[0];
  const onlineCover = leadTrack.cover_thumb_path || (leadTrack as any)?.coverUrl || '';

  if (onlineCover) {
    const primed = primeCoverPath(leadTrack.path, onlineCover);
    if (primed || isDirectUrl(onlineCover)) return primed || onlineCover;
  }

  if (!isRemoteTrackPath(leadTrack.path)) {
    const unpacked = await unpackLocalCover(leadTrack.path);
    if (unpacked) return unpacked;
  }

  return onlineCover || '';
};

const resolveHeaderCover = async (): Promise<string> => {
  if (props.readOnly && props.coverUrlOverride) return props.coverUrlOverride;
  if (currentViewMode.value === 'playlist') return resolvePlaylistCover();
  if (props.songs.length > 0) return resolveSongListCover();
  return '';
};

const refreshHeaderCover = async () => {
  const requestId = ++coverRequestId;
  const candidate = await resolveHeaderCover();
  if (requestId !== coverRequestId) return;
  headerCover.value = candidate;
};

watch(
  () => [
    currentViewMode.value,
    filterCondition.value,
    playlistCoverKey.value,
    props.songs,
    props.coverUrlOverride,
  ],
  () => {
    void refreshHeaderCover();
  },
  { immediate: true },
);

// ===== 滚动收缩（对齐 QQ 音乐桌面版的头部表现） =====
const scrollContainer = computed(() => props.scrollContainerRef ?? null);
const { scrollProgress: shrinkRatioSource } = useScrollShrinkHeader(scrollContainer, 160);
const shrinkRatio = computed(() => shrinkRatioSource.value);

const coverSize = computed(() => `${44 + 116 * (1 - shrinkRatio.value)}px`);
const columnHeight = computed(() => `${64 + 96 * (1 - shrinkRatio.value)}px`);
const titleSize = computed(() => `${16 + 14 * (1 - shrinkRatio.value)}px`);
const titleLineHeight = computed(() => `${18 + 18 * (1 - shrinkRatio.value)}px`);
const subtitleOpacity = computed(() => Math.max(0, 1 - 3 * shrinkRatio.value));
const subtitleMaxHeight = computed(() => `${Math.round(18 * Math.max(0, 1 - 3 * shrinkRatio.value))}px`);
</script>

<template>
  <div class="relative z-20 w-full px-6 shrink-0 select-none flex flex-col pt-[clamp(0px,0.3vh,4px)] pb-[clamp(8px,1.4vh,16px)] h-auto justify-start">
    <div v-if="isBatchMode" class="flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-200"> 
      <div class="flex items-center gap-3"> 
        <button
          v-for="action in batchActions"
          :key="action.key"
          :class="batchButtonClass"
          @click="action.run()"
        >
          <svg
            v-if="action.icon === 'check'"
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path v-if="isAllSelected" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            <template v-else>
              <circle cx="12" cy="12" r="9" stroke-width="2" />
            </template>
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="BATCH_ICON_PATHS[action.icon]" />
          </svg>
          {{ action.caption }}
        </button>
      </div>
      <div class="flex items-center gap-4"> 
        <button @click="emit('update:isBatchMode', false)" class="text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1 rounded transition">完成</button> 
      </div>
    </div>

    <div v-else class="mt-1 flex items-center gap-6 h-auto">
      <div
        class="rounded-2xl shadow-sm flex items-center justify-center shrink-0 overflow-hidden group relative select-none bg-gray-100 dark:bg-white/5"
        :style="{ width: coverSize, height: coverSize }"
      >
        <img
          v-if="displayedHeaderCover"
          :src="displayedHeaderCover"
          class="w-full h-full object-cover animate-in fade-in duration-300"
          alt="Cover"
          decoding="async"
        />
        <div v-else class="h-full w-full flex flex-col items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-16 h-16 text-indigo-500/50 mb-2 drop-shadow-md"><path fill-rule="evenodd" clip-rule="evenodd" d="M19.952 1.651a.75.75 0 01.298.599V16.303a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V6.994l-9 2.572v9.737a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V9.017c0-.528.246-1.032.67-1.371l10.038-5.996z" /></svg>
        </div>
      </div>

      <div class="py-1 flex-1 min-w-0 relative z-20 flex flex-col justify-between gap-2" :style="{ minHeight: columnHeight }">
        <div>
          <div class="mb-1 flex items-center gap-2">
            <h1 :style="{ fontSize: titleSize, lineHeight: titleLineHeight }" class="font-bold text-gray-800 dark:text-white truncate max-w-[500px]">{{ title }}</h1>
          </div>

          <div
            v-if="subtitle"
            class="text-xs text-gray-600 dark:text-gray-300 font-medium overflow-hidden"
            :style="{ opacity: subtitleOpacity, maxHeight: subtitleMaxHeight }"
          >
            {{ subtitle }}
          </div>
        </div>

        <div class="flex items-center gap-3"> 
          <button :class="pillButtonClass" title="播放全部" @click="emit('playAll')">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 5.5v13l10-6.5-10-6.5Z" />
            </svg>
            全部播放
          </button>

          <CollectionFavoriteButton :entry="favoriteEntry ?? null" />

          <template v-if="!readOnly">
            <button
              @click.stop="toggleSortMenu"
              title="排序方式"
              class="sort-menu-trigger px-5 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 active:scale-95 shadow-sm bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 hover:border-gray-200 dark:hover:border-white/20"
              :class="{ 'text-blue-500 border-blue-200 bg-blue-50/50 dark:bg-blue-500/10': playlistSortMode !== 'custom' }"
            >
              <SortModeIcon class="h-5 w-5" />
            </button>

            <SortOptionPopover
              :shown="sortMenuShown"
              :pos-x="sortMenuPosX"
              :pos-y="sortMenuPosY"
              :dock-right="sortMenuDockRight"
              :options="PLAYLIST_SORT_ENTRIES"
              :current-mode="playlistSortMode"
              :arrow-modes="SORT_ARROW_ENTRIES"
              :reversed-modes="sortReversedEntries"
              @pick="applyPlaylistSort"
            />
          </template>

          <HeaderOverflowMenu
            v-if="overflowItems.length"
            :items="overflowItems"
            :button-class="HEADER_OVERFLOW_BUTTON"
            icon-class="h-5 w-5"
            @pick="handleOverflowPick"
          />
        </div>
      </div>
    </div>
  </div>
</template>
