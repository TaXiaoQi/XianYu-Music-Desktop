<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Song } from '../../types';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import { useCoverCache } from '../../composables/useCoverCache';
import { getDisplayCoverUrl } from '../../utils/coverProxy';
import { useLibraryStore } from '../../features/library/store';
import { useScrollShrinkHeader } from '../../composables/useScrollShrinkHeader';
import type { FavoriteCollectionEntry } from '../../features/collections/store';
import SortModeIcon from '../common/SortModeIcon.vue';
import CollectionFavoriteButton from '../favorites/CollectionFavoriteButton.vue';

const { playlistSortMode, setPlaylistSortMode, currentViewMode, filterCondition } = usePlayerViewState();
const { playlists } = useLibraryCollections();
const libraryStore = useLibraryStore();

const showSortMenu = ref(false);
const sortMenuX = ref(0);
const sortMenuY = ref(0);
const sortMenuIsRightAligned = ref(false);

const handleSortClick = (e: MouseEvent) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const windowWidth = window.innerWidth;
  
  if (rect.left > windowWidth / 2) {
    sortMenuIsRightAligned.value = true;
    sortMenuX.value = windowWidth - rect.right;
  } else {
    sortMenuIsRightAligned.value = false;
    sortMenuX.value = rect.left;
  }
  
  sortMenuY.value = rect.bottom + 8;
  showSortMenu.value = !showSortMenu.value;
};

const handleGlobalClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.sort-menu-trigger')) {
    showSortMenu.value = false;
  }
};

onMounted(() => window.addEventListener('click', handleGlobalClick));
onUnmounted(() => window.removeEventListener('click', handleGlobalClick));

const props = defineProps<{
  title: string;
  subtitle?: string;
  songs: Song[];
  isBatchMode: boolean;
  selectedCount: number;
  totalSongCount?: number;
  showRename?: boolean;
  /** 只读模式：禁用管理按钮、排序按钮和排序菜单 */
  readOnly?: boolean;
  /** 是否显示"收藏至歌单/添加到歌单"入口 */
  showAddToPlaylist?: boolean;
  /** 是否在详情展示模式显示"收藏至歌单"入口，默认跟随 showAddToPlaylist */
  showHeaderAddToPlaylist?: boolean;
  /** 在线封面 URL（readOnly 模式下优先使用） */
  coverUrlOverride?: string;
  /** 待收藏的歌单/专辑条目（传入即显示"收藏整张"按钮） */
  favoriteEntry?: FavoriteCollectionEntry | null;
  /** 歌曲列表滚动容器（用于滚动缩小封面效果） */
  scrollContainerRef?: HTMLElement | null;
}>();

const emit = defineEmits([
  'update:isBatchMode',
  'playAll',
  'batchPlay',
  'batchDelete',
  'openAddToPlaylist',
  'batchAddToFavorites',
  'batchDownload',
  'rename',
  'selectAll',
]);

const isAllSelected = computed(() => {
  const total = props.totalSongCount ?? props.songs.length;
  return total > 0 && props.selectedCount === total;
});

const shouldShowAddToPlaylist = computed(() => props.showAddToPlaylist !== false);
const shouldShowHeaderAddToPlaylist = computed(() =>
  props.showHeaderAddToPlaylist ?? shouldShowAddToPlaylist.value,
);

const headerCover = ref('');
// 显示用封面：B站等防盗链封面经后端代理成 data:URL（代理完成回填刷新），本地封面原样
const displayedHeaderCover = ref('');
watch(headerCover, (url) => {
  if (!url) { displayedHeaderCover.value = ''; return; }
  displayedHeaderCover.value = getDisplayCoverUrl(url, (dataUrl) => {
    displayedHeaderCover.value = dataUrl;
  });
}, { immediate: true });
let coverRequestId = 0;
const { loadCover, loadFullCover, primeCoverPath } = useCoverCache();

/** 判断字符串是否为可直接显示的网络/资源 URL */
const isDirectUrl = (path: string) =>
  /^https?:\/\//i.test(path) || path.startsWith('asset:') || path.startsWith('data:');

const resolveCoverPath = (coverPath: string): string => {
  if (!coverPath) return '';
  return isDirectUrl(coverPath) ? coverPath : convertFileSrc(coverPath);
};

const activePlaylist = computed(() =>
  currentViewMode.value === 'playlist'
    ? playlists.value.find(p => p.id === filterCondition.value)
    : null,
);

const activePlaylistCoverKey = computed(() => {
  const playlist = activePlaylist.value;
  if (!playlist) return '';
  return [
    playlist.id,
    playlist.coverPath ?? '',
    playlist.songPaths[0] ?? '',
    playlist.songPaths.length,
  ].join('::');
});

const updateHeaderCover = async () => {
  const requestId = ++coverRequestId;

  // readOnly 模式优先使用在线封面 URL
  if (props.readOnly && props.coverUrlOverride) {
    headerCover.value = props.coverUrlOverride;
    return;
  }

  if (currentViewMode.value === 'playlist') {
      const pl = activePlaylist.value;
      // 优先使用歌单自定义封面
      if (pl && pl.coverPath) {
        if (requestId !== coverRequestId) return;
        headerCover.value = resolveCoverPath(pl.coverPath);
        return;
      }
      // 云端同步封面（cloudCoverUrl）：服务端存储的 https URL，本地封面不可用时优先使用
      if (pl && pl.cloudCoverUrl && /^https?:\/\//i.test(pl.cloudCoverUrl)) {
        if (requestId !== coverRequestId) return;
        headerCover.value = pl.cloudCoverUrl;
        return;
      }
      if (pl && pl.songPaths.length > 0) {
        const firstSongPath = pl.songPaths[0];

        // 1. 尝试多渠道查找首曲元信息（pl.songs -> songLookup -> props.songs）
        const songFromPl = pl.songs?.find(s => s.path === firstSongPath) ?? pl.songs?.[0];
        const songFromLookup = libraryStore.songLookup.get(firstSongPath);
        const songFromProps = props.songs.find(s => s.path === firstSongPath) ?? props.songs[0];
        
        const candidateSong = songFromPl ?? songFromLookup ?? songFromProps;
        const onlineCoverPath = candidateSong?.cover_thumb_path || (candidateSong as any)?.coverUrl || '';
        
        if (onlineCoverPath) {
          const primedUrl = primeCoverPath(candidateSong?.path || firstSongPath, onlineCoverPath);
          if (primedUrl || isDirectUrl(onlineCoverPath)) {
            if (requestId !== coverRequestId) return;
            headerCover.value = primedUrl || onlineCoverPath;
            return;
          }
        }

        // 2. 在线歌曲协议（lx://, plugin://, http://, https://）跳过后端本地文件解包，避免 invoke 失败清空封面
        const isOnlinePath = firstSongPath.startsWith('lx://') ||
          firstSongPath.startsWith('plugin://') ||
          firstSongPath.startsWith('http://') ||
          firstSongPath.startsWith('https://');

        if (!isOnlinePath) {
          try {
            const fullCover = await loadFullCover(firstSongPath);
            if (requestId !== coverRequestId) return;
            if (fullCover) {
              headerCover.value = fullCover;
              return;
            }

            const thumbnailCover = await loadCover(firstSongPath);
            if (requestId !== coverRequestId) return;
            if (thumbnailCover) {
              headerCover.value = thumbnailCover;
              return;
            }
          } catch {
            // 本地提取失败不重置 headerCover（上方可能已从网络/元数据拿到了封面）
          }
        }

        if (requestId !== coverRequestId) return;
        headerCover.value = onlineCoverPath || '';
      } else {
        if (requestId !== coverRequestId) return;
        headerCover.value = '';
      }
  } else if (props.songs.length > 0) {
    const firstSong = props.songs[0];
    const firstSongPath = firstSong.path;
    const onlineCoverPath = firstSong.cover_thumb_path || (firstSong as any)?.coverUrl || '';

    if (onlineCoverPath) {
      const primedUrl = primeCoverPath(firstSongPath, onlineCoverPath);
      if (primedUrl || isDirectUrl(onlineCoverPath)) {
        if (requestId !== coverRequestId) return;
        headerCover.value = primedUrl || onlineCoverPath;
        return;
      }
    }

    const isOnlinePath = firstSongPath.startsWith('lx://') ||
      firstSongPath.startsWith('plugin://') ||
      firstSongPath.startsWith('http://') ||
      firstSongPath.startsWith('https://');

    if (!isOnlinePath) {
      try {
        const fullCover = await loadFullCover(firstSongPath);
        if (requestId !== coverRequestId) return;
        if (fullCover) {
          headerCover.value = fullCover;
          return;
        }

        const thumbnailCover = await loadCover(firstSongPath);
        if (requestId !== coverRequestId) return;
        if (thumbnailCover) {
          headerCover.value = thumbnailCover;
          return;
        }
      } catch {
        // 本地解包失败忽略
      }
    }

    if (requestId !== coverRequestId) return;
    headerCover.value = onlineCoverPath || '';
  } else {
    if (requestId !== coverRequestId) return;
    headerCover.value = '';
  }
};

watch(
  () => [
    currentViewMode.value,
    filterCondition.value,
    activePlaylistCoverKey.value,
    props.songs,
    props.coverUrlOverride,
  ],
  () => {
    void updateHeaderCover();
  },
  { immediate: true },
);

const handlePlayAll = () => {
  emit('playAll');
};

// ===== 滚动缩小封面（QQ 音乐桌面版风格）=====
const scrollContainer = computed(() => props.scrollContainerRef ?? null);
const { scrollProgress } = useScrollShrinkHeader(scrollContainer, 160);

/** 封面尺寸：160px → 44px */
const coverSize = computed(() => `${160 - 116 * scrollProgress.value}px`);
/** 右侧信息列高度：160px → 64px */
const columnHeight = computed(() => `${160 - 96 * scrollProgress.value}px`);
/** 标题字号：30px → 16px（同步压缩行高避免占位过高） */
const titleSize = computed(() => `${30 - 14 * scrollProgress.value}px`);
const titleLineHeight = computed(() => `${36 - 18 * scrollProgress.value}px`);
/** 副标题在收缩早期淡出并收起 */
const subtitleOpacity = computed(() => Math.max(0, 1 - scrollProgress.value * 3));
const subtitleMaxHeight = computed(() => `${Math.round(18 * Math.max(0, 1 - scrollProgress.value * 3))}px`);
</script>

<template>
  <div class="relative z-20 w-full px-6 shrink-0 select-none flex flex-col pt-[clamp(0px,0.3vh,4px)] pb-[clamp(8px,1.4vh,16px)] h-auto justify-start">
    
    <!-- 批量操作模式 -->
    <div v-if="isBatchMode" class="flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-200">
      <div class="flex items-center gap-3">
        <button @click="emit('selectAll')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path v-if="isAllSelected" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /><template v-else><circle cx="12" cy="12" r="9" stroke-width="2" /></template></svg>
          {{ isAllSelected ? '取消全选' : '全选' }}
        </button>
        <button @click="emit('batchAddToFavorites')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
          添加至我喜欢
        </button>
        <button v-if="shouldShowAddToPlaylist" @click="emit('openAddToPlaylist')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg> 收藏到歌单
        </button>
        <button @click="emit('batchDownload')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>
          下载
        </button>
        <button @click="emit('batchDelete')" class="bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 px-4 py-1.5 rounded text-sm transition flex items-center gap-1 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> 移除
        </button>
      </div>
      <div class="flex items-center gap-4">
        <button @click="emit('update:isBatchMode', false)" class="text-[#EC4141] hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1 rounded transition">完成</button>
      </div>
    </div>

    <!-- 详情展示模式 -->
    <div v-else class="flex items-center gap-6 h-auto mt-1">
      <!-- 封面图 -->
      <div :style="{ width: coverSize, height: coverSize }" class="rounded-2xl shadow-sm flex items-center justify-center shrink-0 overflow-hidden group relative select-none bg-gray-100 dark:bg-white/5">
        <img v-if="displayedHeaderCover" :src="displayedHeaderCover" class="w-full h-full object-cover animate-in fade-in duration-300" alt="Cover" decoding="async" />
        <div v-else class="flex flex-col items-center justify-center h-full w-full">
           <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-16 h-16 text-indigo-500/50 mb-2 drop-shadow-md"><path fill-rule="evenodd" d="M19.952 1.651a.75.75 0 01.298.599V16.303a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V6.994l-9 2.572v9.737a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V9.017c0-.528.246-1.032.67-1.371l10.038-5.996z" clip-rule="evenodd" /></svg>
        </div>
      </div>
      
      <!-- 文本信息与操作 -->
      <div :style="{ minHeight: columnHeight }" class="flex flex-col justify-between gap-2 py-1 flex-1 min-w-0 relative z-20">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <h1 :style="{ fontSize: titleSize, lineHeight: titleLineHeight }" class="font-bold text-gray-800 dark:text-white truncate max-w-[500px]">{{ title }}</h1>
            <button
              v-if="showRename"
              @click="emit('rename')"
              class="text-gray-500 dark:text-white/60 hover:text-gray-800 dark:hover:text-white transition p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 shrink-0"
              title="修改信息"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
          
          <div v-if="subtitle" class="text-xs text-gray-600 dark:text-gray-300 font-medium overflow-hidden" :style="{ opacity: subtitleOpacity, maxHeight: subtitleMaxHeight }">
             {{ subtitle }}
          </div>
        </div>

        <div class="flex items-center gap-3">
           <button @click="handlePlayAll" title="播放全部" class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 px-5 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20">
             <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
               <path d="M9 5.5v13l10-6.5-10-6.5Z" />
             </svg>
             全部播放
           </button>

           <button
             v-if="shouldShowHeaderAddToPlaylist"
             @click="emit('openAddToPlaylist')"
             title="收藏至歌单"
             class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 px-5 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
           >
             <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
             收藏至歌单
           </button>

           <CollectionFavoriteButton :entry="favoriteEntry ?? null" />
           
           <button
             v-if="!readOnly"
             @click="emit('update:isBatchMode', true)"
             title="批量操作"
             class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 px-5 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
           >
             <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
             </svg>
           </button>

           <template v-if="!readOnly">
           <!-- 排序方式按钮 -->
           <button 
             @click.stop="handleSortClick"
             title="排序方式"
             class="sort-menu-trigger bg-white/1 hover:bg-white/10 border border-white/1 text-gray-900 dark:text-gray-100 px-5 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20"
             :class="{ 'text-blue-500 border-blue-200 bg-blue-50/50 dark:bg-blue-500/10': playlistSortMode !== 'custom' }"
           >
             <SortModeIcon class="h-5 w-5" />
           </button>

           <!-- 排序菜单 -->
           <Teleport to="body">
             <div 
               v-if="showSortMenu"
               class="fixed z-[9999] bg-white dark:bg-[#262626] rounded-lg shadow-xl border border-gray-100 dark:border-white/10 py-1 min-w-[120px] isolate animate-in fade-in zoom-in-95 duration-100"
               :style="sortMenuIsRightAligned 
                 ? { right: sortMenuX + 'px', top: sortMenuY + 'px' }
                 : { left: sortMenuX + 'px', top: sortMenuY + 'px' }"
             >
               <div 
                 v-for="mode in (['title', 'name', 'artist', 'added_at', 'custom'] as const)" 
                 :key="mode"
                 @click="
                   if (mode === 'added_at') {
                     setPlaylistSortMode(playlistSortMode === 'added_at' ? 'added_at_asc' : 'added_at');
                   } else {
                     setPlaylistSortMode(mode);
                   }
                   showSortMenu = false;
                 "
                 class="px-3 py-2 text-xs cursor-pointer flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                 :class="(playlistSortMode || '').startsWith(mode) ? 'text-blue-500 font-medium' : 'text-gray-600 dark:text-gray-300'"
               >
                 <span>{{ { title: '\u6b4c\u66f2\u540d', name: '\u6587\u4ef6\u540d', artist: '\u6b4c\u624b', added_at: '\u6dfb\u52a0\u65f6\u95f4', custom: '\u81ea\u5b9a\u4e49' }[mode] }}</span>
                 <div v-if="(playlistSortMode || '').startsWith(mode)" class="flex items-center gap-1.5">
                   <svg v-if="mode === 'added_at'" xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 transition-transform duration-200" :class="{ 'rotate-180': playlistSortMode === 'added_at_asc' }" viewBox="0 0 20 20" fill="currentColor">
                     <path fill-rule="evenodd" d="M14.707 12.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l2.293-2.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                   </svg>
                   <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                     <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                   </svg>
                 </div>
               </div>
             </div>
           </Teleport>
           </template>
        </div>
      </div>
    </div>

  </div>
</template>
