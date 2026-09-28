<script setup lang="ts">
// 专辑详情头部：封面解析缓存、滚动收缩、批量工具条与专辑内排序菜单
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { albumHeaderCache } from '../../caches/imageCaches';
import { useCoverCache } from '../../composables/useCoverCache';
import { getDisplayCoverUrl } from '../../utils/coverProxy';
import { useScrollShrinkHeader } from '../../composables/useScrollShrinkHeader';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import type { FavoriteCollectionEntry } from '../../features/collections/store';
import SortModeIcon from '../common/SortModeIcon.vue';
import CollectionFavoriteButton from '../favorites/CollectionFavoriteButton.vue';
import SortOptionPopover from './sortPopover/SortOptionPopover.vue';

const props = defineProps<{
  albumName: string;
  albumArtist: string;
  isBatchMode: boolean;
  selectedCount?: number;
  totalSongCount?: number;
  songs?: Array<{ path: string }>;
  readOnly?: boolean;
  coverUrlOverride?: string;
  favoriteEntry?: FavoriteCollectionEntry | null;
  scrollContainerRef?: HTMLElement | null;
}>();

const emit = defineEmits([
  'update:isBatchMode',
  'playAll',
  'batchPlay',
  'addToPlaylist',
  'batchDelete',
  'batchMove',
  'selectAll',
]);

const {
  albumDetailSortMode,
  setAlbumDetailSortMode,
} = usePlayerViewState();

const trackAmount = computed(() => props.totalSongCount ?? props.songs?.length ?? 0);
const isAllSelected = computed(() => trackAmount.value > 0 && (props.selectedCount ?? 0) === trackAmount.value);

// ===== 排序弹出菜单 =====
type AlbumSortValue =
  | 'track_number'
  | 'track_number_desc'
  | 'title'
  | 'artist'
  | 'added_at'
  | 'added_at_asc'
  | 'file_modified_at'
  | 'file_modified_at_asc';

interface SortEntry {
  value: string;
  label: string;
}

const ALBUM_SORT_ENTRIES: SortEntry[] = [
  { value: 'track_number', label: '音轨号' },
  { value: 'title', label: '歌曲名' },
  { value: 'artist', label: '歌手' },
  { value: 'added_at', label: '添加时间' },
  { value: 'file_modified_at', label: '修改时间' },
];

const ALBUM_ARROW_MODES = ['track_number', 'added_at', 'file_modified_at'];
const ALBUM_DESC_MODES = ['track_number_desc', 'added_at_asc', 'file_modified_at_asc'];

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
  ALBUM_DESC_MODES.includes(albumDetailSortMode.value) ? ALBUM_ARROW_MODES : [],
);

const applyAlbumSort = (value: string) => {
  if (value === 'track_number') {
    setAlbumDetailSortMode(albumDetailSortMode.value === 'track_number' ? 'track_number_desc' : 'track_number');
  } else if (value === 'added_at') {
    setAlbumDetailSortMode(albumDetailSortMode.value === 'added_at' ? 'added_at_asc' : 'added_at');
  } else if (value === 'file_modified_at') {
    setAlbumDetailSortMode(albumDetailSortMode.value === 'file_modified_at' ? 'file_modified_at_asc' : 'file_modified_at');
  } else {
    setAlbumDetailSortMode(value as AlbumSortValue);
  }
  sortMenuShown.value = false;
};

// ===== 封面解析 =====
const FALLBACK_ARTIST = '未知歌手';
const artistName = computed(() => props.albumArtist || FALLBACK_ARTIST);
const albumCacheKey = computed(() => `${props.albumName}::${props.albumArtist || FALLBACK_ARTIST}`);

const coverUrl = ref('');
const isLoading = ref(false);
const displayedCover = ref('');
let coverRequestId = 0;
const { loadCover, peekCoverUrl } = useCoverCache();

const applyCoverState = (url: string) => {
  coverUrl.value = url;
  isLoading.value = false;
};

const isStale = (requestId: number) => requestId !== coverRequestId;

watch(
  coverUrl,
  (rawUrl) => {
    if (!rawUrl) {
      displayedCover.value = '';
      return;
    }
    displayedCover.value = getDisplayCoverUrl(rawUrl, (decoded) => {
      displayedCover.value = decoded;
    });
  },
  { immediate: true },
);

watch([albumCacheKey, () => props.songs, () => props.coverUrlOverride], async ([cacheKey, tracks, coverOverride]) => {
  const requestId = ++coverRequestId;

  if (props.readOnly && coverOverride) {
    applyCoverState(coverOverride);
    return;
  }

  const leadTrackPath = tracks?.[0]?.path;
  if (!leadTrackPath) {
    applyCoverState('');
    return;
  }

  const cachedHeader = albumHeaderCache.get(cacheKey);
  if (cachedHeader) {
    applyCoverState(cachedHeader);
    return;
  }

  const cachedThumb = peekCoverUrl(leadTrackPath);
  if (cachedThumb) {
    albumHeaderCache.set(cacheKey, cachedThumb);
    applyCoverState(cachedThumb);
    return;
  }

  isLoading.value = true;
  try {
    const resolved = await loadCover(leadTrackPath);
    if (isStale(requestId)) return;

    if (resolved) {
      albumHeaderCache.set(cacheKey, resolved);
      coverUrl.value = resolved;
    } else {
      coverUrl.value = '';
    }
  } catch {
    if (isStale(requestId)) return;
    coverUrl.value = '';
  } finally {
    if (!isStale(requestId)) {
      isLoading.value = false;
    }
  }
}, { immediate: true });

// 按专辑名稳定散列到一组渐变底色（无封面时的占位）
const GRADIENT_PALETTE = [
  'from-blue-500 to-cyan-500',
  'from-purple-500 to-pink-500',
  'from-emerald-400 to-teal-500',
  'from-orange-400 to-rose-400',
  'from-indigo-500 to-purple-500',
  'from-rose-400 to-red-500',
  'from-fuchsia-500 to-pink-500',
  'from-amber-400 to-orange-500',
];

const gradientForAlbum = (albumTitle: string) => {
  if (!albumTitle) return GRADIENT_PALETTE[0];
  let acc = 0;
  for (let cursor = 0; cursor < albumTitle.length; cursor += 1) {
    acc = albumTitle.charCodeAt(cursor) + ((acc << 5) - acc);
  }
  return GRADIENT_PALETTE[Math.abs(acc) % GRADIENT_PALETTE.length];
};

// ===== 滚动收缩（对齐 QQ 音乐桌面版的头部表现） =====
const scrollContainer = computed(() => props.scrollContainerRef ?? null);
const { scrollProgress: shrinkRatioSource } = useScrollShrinkHeader(scrollContainer, 144);
const shrinkRatio = computed(() => shrinkRatioSource.value);

const coverSize = computed(() => `${44 + 100 * (1 - shrinkRatio.value)}px`);
const columnHeight = computed(() => `${64 + 80 * (1 - shrinkRatio.value)}px`);
const titleSize = computed(() => `${16 + 16 * (1 - shrinkRatio.value)}px`);
const titleLineHeight = computed(() => `${20 + 20 * (1 - shrinkRatio.value)}px`);
const titleMarginBottom = computed(() => `${4 + 12 * (1 - shrinkRatio.value)}px`);
const artistOpacity = computed(() => Math.max(0, 1 - 2 * shrinkRatio.value));
const artistMaxHeight = computed(() => `${Math.round(24 * Math.max(0, 1 - 2 * shrinkRatio.value))}px`);

// ===== 批量工具条 =====
type BatchIconName = 'check' | 'plus' | 'trash';

const BATCH_ICON_PATHS: Record<Exclude<BatchIconName, 'check'>, string> = {
  plus: 'M12 4v16m8-8H4',
  trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
};

const batchButtonClass =
  'px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95 bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-white/10 dark:hover:bg-white/20 dark:text-gray-200';

const batchActions = computed(() => [
  { key: 'select-all', caption: isAllSelected.value ? '取消全选' : '全选', icon: 'check' as const, run: () => emit('selectAll') },
  { key: 'collect', caption: '收藏到歌单', icon: 'plus' as const, run: () => emit('addToPlaylist') },
  { key: 'remove', caption: '删除', icon: 'trash' as const, run: () => emit('batchDelete') },
]);

const detailButtonClass =
  'rounded-full text-[15px] font-medium transition flex items-center gap-2 active:scale-95 shadow-sm bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 hover:border-gray-200 dark:hover:border-white/20';
</script>

<template>
  <div class="px-8 shrink-0 select-none flex flex-col pt-6 pb-0 h-auto justify-start border-b border-black/5 dark:border-white/5 relative z-20 w-full bg-transparent">
    <div v-if="isBatchMode" class="flex items-center justify-between mb-4 animate-in fade-in slide-in-from-top-1 duration-200">
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

    <div v-else class="mt-2 mb-6 flex items-center gap-6 h-auto">
      <div
        class="rounded-lg shadow-sm flex items-center justify-center shrink-0 overflow-hidden group relative select-none bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10"
        :style="{ width: coverSize, height: coverSize }"
      >
        <div v-if="isLoading" class="w-full h-full bg-gray-200 dark:bg-white/10 animate-pulse"></div>
        <img
          v-else-if="displayedCover"
          :src="displayedCover"
          class="w-full h-full object-cover select-none animate-in fade-in duration-300"
          draggable="false"
          :alt="albumName"
          decoding="async"
        />
        <div
          v-else
          class="w-full h-full flex items-center justify-center text-4xl font-bold text-white bg-gradient-to-br animate-in fade-in duration-300"
          :class="gradientForAlbum(albumName)"
        >
          ♪
        </div>
      </div>

      <div class="pt-2 pb-1 flex-1 min-w-0 relative z-20 flex flex-col justify-start" :style="{ minHeight: columnHeight }">
        <div :style="{ marginBottom: titleMarginBottom }">
          <h1 :style="{ fontSize: titleSize, lineHeight: titleLineHeight }" class="font-bold text-gray-900 dark:text-white truncate max-w-[600px] leading-tight flex items-center gap-2">
            <span class="bg-[#EC4141] text-white text-[12px] px-1.5 py-0.5 rounded border border-[#EC4141] font-normal leading-none -mt-1 relative top-[1px]">专辑</span>
            {{ albumName }}
          </h1>
          <p
            class="text-[14px] text-gray-500 dark:text-gray-400 mt-2 truncate w-full flex items-center gap-2 overflow-hidden"
            :style="{ opacity: artistOpacity, maxHeight: artistMaxHeight }"
          >
            <span>专辑艺人:</span>
            <span class="text-[#507DAF] dark:text-[#6a9adb]">{{ artistName }}</span>
          </p>
        </div>

        <div class="flex items-center gap-3 mt-auto">
          <button :class="detailButtonClass" class="px-6 py-2" @click="emit('playAll')">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 5.5v13l10-6.5-10-6.5Z" />
            </svg>
            全部播放
          </button>

          <button :class="detailButtonClass" class="px-5 py-2" title="收藏至歌单" @click="emit('addToPlaylist')">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
            收藏至歌单
          </button>

          <CollectionFavoriteButton :entry="favoriteEntry ?? null" />

          <button v-if="!readOnly" :class="detailButtonClass" class="px-5 py-2" title="批量操作" @click="emit('update:isBatchMode', true)">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            管理
          </button>

          <template v-if="!readOnly">
            <button
              @click.stop="toggleSortMenu"
              title="排序方式"
              class="sort-menu-trigger rounded-full text-[15px] font-medium transition flex items-center gap-2 active:scale-95 shadow-sm bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 hover:border-gray-200 dark:hover:border-white/20 px-5 py-2"
            >
              <SortModeIcon class="h-5 w-5" />
              排序
            </button>

            <SortOptionPopover
              :shown="sortMenuShown"
              :pos-x="sortMenuPosX"
              :pos-y="sortMenuPosY"
              :dock-right="sortMenuDockRight"
              :options="ALBUM_SORT_ENTRIES"
              :current-mode="albumDetailSortMode"
              :arrow-modes="ALBUM_ARROW_MODES"
              :reversed-modes="sortReversedEntries"
              @pick="applyAlbumSort"
            />
          </template>
        </div>
      </div>
    </div>

    <div class="flex gap-8 text-[15px] font-medium mt-auto w-full">
      <div class="pb-1.5 transition-colors relative text-gray-900 dark:text-white font-bold">
        歌曲
        <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-3/4 h-[3px] bg-[#EC4141] rounded-t-full"></div>
      </div>
    </div>
  </div>
</template>
