<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { dragSession } from '../../composables/dragState';
import type { Song } from '../../types';
import { listScrollCache, songTableViewportCoverSnapshotCache } from '../../caches/imageCaches';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections';
import { getDisplayCoverUrl } from '../../utils/coverProxy';
import { useSettings } from '../../features/settings/useSettings';
import { useRoute, useRouter } from 'vue-router';
import { INDEX_KEYS } from '../../utils/alphabetIndex';
import { useCoverCache } from '../../composables/useCoverCache';
import { launchFlyingCover } from '../../composables/useFlyingCover';
import { useHomeNavigation } from '../../composables/useHomeNavigation';
import { useLibraryRuntimeActions } from '../../features/library/useLibraryRuntimeActions';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { usePlayerLibraryView } from '../../features/library/usePlayerLibraryView';
import { usePlayerViewState } from '../../composables/usePlayerViewState';
import { useListScrollMemory } from '../../composables/useListScrollMemory';
import { useSongTableAlphabetIndex } from '../../composables/useSongTableAlphabetIndex';
import { useSongTableLibraryState } from '../../features/library/useSongTableLibraryState';
import { useLibraryStore } from '../../features/library/store';
import { DEFAULT_SCROLLBAR_HOT_ZONE_PX, isPointerNearVerticalScrollbar } from '../../utils/scrollbarActivity';
import { useSongDetailCache } from '../../composables/useSongDetailCache';
import { getDownloadRecord, loadDownloadHistory } from '../../services/downloadHistory';
import { CircleCheck, Download } from 'lucide-vue-next';
import { useDownloadStore } from '../../features/download/store';
import { downloadToLocal } from '../../composables/useDownloadToLocal';
import { isDownloadableOnlineSong } from '../../services/downloadService';
import { getSongSourceLabel } from '../../utils/remoteSong';

/** 在线歌曲：路径以 lx:// 或 plugin:// 开头 */
const isOnlineSong = (song: Song) => {
  const path = song?.path ?? '';
  return path.startsWith('lx://') || path.startsWith('plugin://');
};

/** 已下载的在线歌曲 path 集合（响应式，供模板同步判断） */
const downloadedOnlinePaths = ref<Set<string>>(new Set());
/** 已下载在线歌曲 path → 本地音乐文件格式（大写扩展名），供"下载完成替换为本地"容器展示真实音质 */
const downloadedLocalFormats = ref<Map<string, string>>(new Map());
let downloadedPathsRequestId = 0;
const refreshDownloadedPaths = async (songs: Song[]) => {
  const requestId = ++downloadedPathsRequestId;
  await loadDownloadHistory();
  if (requestId !== downloadedPathsRequestId) return;

  const set = new Set<string>();
  const formats = new Map<string, string>();
  for (const song of songs) {
    if (!isOnlineSong(song)) continue;
    const record = getDownloadRecord(song.path);
    if (!record) continue;
    set.add(song.path);
    const fileName = record.fileName ?? (record as { localPath?: string }).localPath ?? '';
    const ext = localMusicFormatOf(fileName);
    if (ext) formats.set(song.path, ext);
  }
  downloadedOnlinePaths.value = set;
  downloadedLocalFormats.value = formats;
};

/** 从本地文件名解析音乐格式（大写扩展名），无则返回空 */
const localMusicFormatOf = (name: string) => {
  const idx = name.lastIndexOf('.');
  if (idx < 0 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toUpperCase();
};

/** 音质列展示的格式：本地容器中已下载的在线歌显示其真实本地音质，否则显示歌曲扩展名 */
const displayedFormat = (song: Song) => {
  if (props.downloadCompletedAsLocal && downloadedOnlinePaths.value.has(song.path)) {
    return downloadedLocalFormats.value.get(song.path) || getSongExtension(song);
  }
  return getSongExtension(song);
};

const downloadStore = useDownloadStore();
/** 判断歌曲是否正在下载（与底栏下载 UI 共用同一 store） */
const isSongDownloading = (song: Song) =>
  downloadStore.isDownloading && downloadStore.downloadingSongPath === song.path;

/** 点击下载：走统一的下载至本地逻辑（与底栏/右键菜单一致） */
const handleDownloadClick = (song: Song) => {
  if (!isDownloadableOnlineSong(song)) return;
  void downloadToLocal(song);
};

const { settings } = useSettings();
const songClickAction = computed(() => settings.value.songClickAction || 'double');
const libraryStore = useLibraryStore();
const { libraryScanProgress, lastLibraryScanError } = storeToRefs(libraryStore);
const { currentSong, isPlaying, formatDuration } = usePlaybackController();

const props = defineProps<{
  songs: Song[];
  songPaths?: string[];
  resolveSongByPath?: (path: string) => Song | null;
  isBatchMode: boolean;
  selectedPaths: Set<string>;
  memoryScopeKey: string;
  /** 整页滚动模式：滚动由外层容器驱动，内部容器不产生滚动条（在线详情页与 header 一起滚动） */
  pageScrollMode?: boolean;
  /** 整页滚动模式下的外层滚动容器 */
  scrollContainerRef?: HTMLElement | null;
  /**
   * 禁用滚动记忆（离开即销毁的容器，如在线详情专辑/歌单）：不保存也不恢复滚动位置，
   * 返回时全新加载从顶部开始，避免继承上次访问该容器时的旧滚动位置。
   */
  disableScrollMemory?: boolean;
  /**
   * 已下载在线歌曲的展示策略：
   * true（我的收藏/最近播放/歌单等本地容器）时，下载完成的歌视为本地——音质列不占位且来源列显示"本地"；
   * false（搜索/在线详情容器）时，下载完成显示与底栏一致的绿色对勾且来源列保留音源名。
   */
  downloadCompletedAsLocal?: boolean;
}>();

const emit = defineEmits<{
  (e: 'play', song: Song): void;
  (e: 'contextmenu', event: MouseEvent, song: Song): void;
  (e: 'update:selectedPaths', newSet: Set<string>): void;
  (e: 'drag-start', payload: { event: PointerEvent; song: Song; index: number }): void;
  (e: 'load-more'): void;
}>();

const {
  currentViewMode,
  localSortMode,
  folderSortMode,
  activeRootPath,
  currentFolderFilter,
} = usePlayerViewState();
const {
  folderTree,
  searchQuery,
  librarySongs,
} = usePlayerLibraryView();
const {
  addLibraryFolder,
  scanLibrary,
  refreshFolder,
  expandFolderPath,
} = useLibraryRuntimeActions();
const { isFavorite, toggleFavorite } = useLibraryCollections();
const router = useRouter();
const route = useRoute();
const { openHomeArtist } = useHomeNavigation(router);
const { coverCache, loadCover, touchCoverPaths, preloadPriorityCovers, primeCoverPath } = useCoverCache();
const { loadSongDetail } = useSongDetailCache();

const ROW_HEIGHT = 72;
const OVERSCAN = 20;
const SEGMENT_BUFFER_ROWS = 4;
const MIN_SEGMENT_BATCH_SIZE = 20;
/** 滚动到距底部剩余多少行时触发加载下一段 */
const SCROLL_TRIGGER_ROWS = 10;
const VIEWPORT_SNAPSHOT_LIMIT = 72;
const rootRef = ref<HTMLElement | null>(null);
const containerRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const containerHeight = ref(600);
/** 整页滚动模式下使用外层滚动容器，否则使用内部容器 */
const activeScrollContainer = computed(() =>
  props.pageScrollMode ? (props.scrollContainerRef ?? null) : containerRef.value,
);
// 列表首行在外层滚动容器内的顶部偏移（整页滚动时为 header 高度），用于在线详情页的判定换算
const listOffsetTop = ref(0);
const updateListOffsetTop = () => {
  const root = containerRef.value;
  const outer = activeScrollContainer.value;
  if (props.pageScrollMode && root && outer && root !== outer) {
    listOffsetTop.value = Math.max(0, root.getBoundingClientRect().top - outer.getBoundingClientRect().top);
  } else {
    listOffsetTop.value = 0;
  }
};
const loadedSongCount = ref(0);
const isScrollbarHot = ref(false);
const isScrollbarScrolling = ref(false);
const isScrollbarActive = computed(() => isScrollbarHot.value || isScrollbarScrolling.value);
const displayedCoverUrls = reactive(new Map<string, string>());
const songCommentCache = reactive(new Map<string, string>());
const loadingSongCommentPaths = new Set<string>();
let visibleCoverPaths = new Set<string>();
let scrollbarActiveTimer: number | null = null;
const resolveListRoutePath = (path: string) =>
  ['/', '/favorites', '/recent'].includes(path) ? path : '/';
const listRoutePath = ref(resolveListRoutePath(route.path));

watch(
  () => route.path,
  (path) => {
    if (!['/', '/favorites', '/recent'].includes(path)) {
      return;
    }

    listRoutePath.value = path;
  },
  { immediate: true },
);

const getViewportPageSize = () => Math.max(
  1,
  Math.ceil(containerHeight.value / ROW_HEIGHT) + SEGMENT_BUFFER_ROWS,
);

const getSegmentBatchSize = () => Math.max(
  MIN_SEGMENT_BATCH_SIZE,
  getViewportPageSize(),
);

const sourceSongCount = computed(() => props.songPaths?.length ?? props.songs.length);

const tableViewportKey = computed(() =>
  [
    'song-table',
    listRoutePath.value,
    props.memoryScopeKey,
    localSortMode.value,
    folderSortMode.value,
  ].join('::'),
);

const resetLoadedSongCount = () => {
  loadedSongCount.value = Math.min(sourceSongCount.value, getSegmentBatchSize());
  scrollTop.value = 0;
  if (props.pageScrollMode && listScrollCache.get(tableViewportKey.value) !== undefined) {
    return;
  }
  if (activeScrollContainer.value) {
    activeScrollContainer.value.scrollTop = 0;
  }
};

const loadNextSongSegment = () => {
  if (loadedSongCount.value >= sourceSongCount.value) return;
  loadedSongCount.value = Math.min(
    sourceSongCount.value,
    loadedSongCount.value + getSegmentBatchSize(),
  );
};

const ensureViewportSegmentFilled = () => {
  if (loadedSongCount.value === 0 && sourceSongCount.value > 0) {
    resetLoadedSongCount();
    return;
  }

  if (loadedSongCount.value < getSegmentBatchSize()) {
    loadedSongCount.value = Math.min(sourceSongCount.value, getSegmentBatchSize());
  }
};

const segmentedSongs = computed(() => {
  if (sourceSongCount.value === 0) return [];
  const limit = loadedSongCount.value || getViewportPageSize();
  const sliceEnd = Math.min(sourceSongCount.value, limit);

  if (props.songPaths && props.resolveSongByPath) {
    return props.songPaths
      .slice(0, sliceEnd)
      .map(path => props.resolveSongByPath?.(path) ?? null)
      .filter((song): song is Song => !!song);
  }

  return props.songs.slice(0, sliceEnd);
});

// 歌曲列表变化时重置首屏段，避免切换大歌单时一次性挂载全部行。
// 仅当实际路径列表发生变化时才重置（切换歌单、增删歌曲），
// 收藏切换等仅更新元信息的操作会产生新数组引用但路径不变，此时应保持滚动位置。
// 使用 O(1) 快速签名（长度 + 首尾路径）替代 O(n) 字符串拼接，避免大歌单卡顿。
let prevSongsLen = -1;
let prevFirstPath = '';
let prevLastPath = '';
watch(() => props.songPaths ?? props.songs, (items) => {
  const len = items.length;
  const firstItem = len > 0 ? items[0] : '';
  const lastItem = len > 0 ? items[len - 1] : '';
  const firstPath = typeof firstItem === 'string' ? firstItem : firstItem?.path ?? '';
  const lastPath = typeof lastItem === 'string' ? lastItem : lastItem?.path ?? '';

  if (len === prevSongsLen && firstPath === prevFirstPath && lastPath === prevLastPath) {
    return;
  }

  // 追加场景（列表变长且首项未变，如搜索分页加载更多）：保留滚动位置，仅扩展已加载段
  const isAppend = len > prevSongsLen && firstPath === prevFirstPath && prevSongsLen >= 0;

  prevSongsLen = len;
  prevFirstPath = firstPath;
  prevLastPath = lastPath;
  if (isAppend) {
    loadedSongCount.value = Math.min(sourceSongCount.value, Math.max(loadedSongCount.value, getSegmentBatchSize()));
  } else {
    resetLoadedSongCount();
  }
  downloadedOnlinePaths.value = new Set();
  downloadedLocalFormats.value = new Map();
}, { immediate: true });

const getDisplayedCoverUrl = (path: string | undefined) => {
  if (!path) {
    return '';
  }

  const raw = displayedCoverUrls.get(path) ?? coverCache.get(path) ?? '';
  if (!raw) {
    return '';
  }

  // B站（hdslb 等）等防盗链封面需走后端代理成 data:URL，
  // 代理成功后回填 displayedCoverUrls 触发重新渲染（其余域名/本地封面原样返回）
  return getDisplayCoverUrl(raw, (dataUrl) => {
    displayedCoverUrls.set(path, dataUrl);
  });
};

const getSongComment = (song: Song) => (
  song.comment?.trim() || songCommentCache.get(song.path)?.trim() || ''
);

const hasVisibleSongComment = (song: Song) => settings.value.showSongComments && getSongComment(song).length > 0;

const extractExtension = (value: string | undefined) => {
  if (!value) {
    return '';
  }

  const fileName = value.split(/[\\/]/).pop() ?? '';
  const matched = /\.([A-Za-z0-9]+)$/.exec(fileName);
  return matched?.[1] ?? '';
};

// 扩展名列：优先用扫描写入的 format 字段，缺失时回退到文件名/路径后缀
const getSongExtension = (song: Song) => {
  const raw = song.format?.trim() || extractExtension(song.name) || extractExtension(song.path);
  return raw ? raw.replace(/^\./, '').toUpperCase() : '';
};

const loadVisibleSongComments = (songs: Song[]) => {
  if (!settings.value.showSongComments) {
    return;
  }

  songs.forEach((song) => {
    if (!song.path || song.comment?.trim() || songCommentCache.has(song.path) || loadingSongCommentPaths.has(song.path)) {
      return;
    }

    loadingSongCommentPaths.add(song.path);
    void loadSongDetail(song.path)
      .then((detail) => {
        songCommentCache.set(song.path, detail?.comment?.trim() ?? '');
      })
      .catch(() => {
        songCommentCache.set(song.path, '');
      })
      .finally(() => {
        loadingSongCommentPaths.delete(song.path);
      });
  });
};

const syncScrollTopFromContainer = () => {
  if (activeScrollContainer.value) {
    scrollTop.value = activeScrollContainer.value.scrollTop;
  }
};

const updateContainerHeight = () => {
  if (activeScrollContainer.value) {
    containerHeight.value = activeScrollContainer.value.clientHeight;
  }
  ensureViewportSegmentFilled();
};

const restoreViewportCoverSnapshot = (key = tableViewportKey.value) => {
  if (!key) {
    return;
  }

  const snapshot = songTableViewportCoverSnapshotCache.get(key);
  if (!snapshot || snapshot.length === 0) {
    return;
  }

  preloadPriorityCovers(snapshot);
};

const syncVisibleCoverUrls = (songs: Song[]) => {
  const nextVisiblePaths = new Set(songs.map(song => song.path).filter(Boolean));
  visibleCoverPaths = nextVisiblePaths;

  for (const path of Array.from(displayedCoverUrls.keys())) {
    if (!nextVisiblePaths.has(path)) {
      displayedCoverUrls.delete(path);
    }
  }

  const visiblePaths = Array.from(nextVisiblePaths);
  touchCoverPaths(visiblePaths);

  songs.forEach((song) => {
    const path = song.path;
    if (!path) {
      return;
    }

    const cachedUrl = coverCache.get(path);
    if (cachedUrl) {
      displayedCoverUrls.set(path, cachedUrl);
      return;
    }

    const persistedCoverUrl = primeCoverPath(path, song.cover_thumb_path);
    if (persistedCoverUrl) {
      displayedCoverUrls.set(path, persistedCoverUrl);
      return;
    }

    void loadCover(path).then((coverUrl) => {
      if (!coverUrl || !visibleCoverPaths.has(path)) {
        return;
      }

      displayedCoverUrls.set(path, coverUrl);
    });
  });
};

const preloadVirtualViewportCovers = () => {
  syncVisibleCoverUrls(virtualItems.value);
  const paths = virtualItems.value.map(song => song.path);
  preloadPriorityCovers(paths);
};

const restoreActiveViewportCovers = async () => {
  await restoreScrollPosition();
  await nextTick();
  syncScrollTopFromContainer();
  updateContainerHeight();
  restoreViewportCoverSnapshot();
  preloadVirtualViewportCovers();

  requestAnimationFrame(() => {
    syncScrollTopFromContainer();
    updateContainerHeight();
    restoreViewportCoverSnapshot();
    preloadVirtualViewportCovers();
  });
};

const saveViewportCoverSnapshot = (key = tableViewportKey.value) => {
  if (!key || !activeScrollContainer.value) {
    return;
  }

  const containerRect = activeScrollContainer.value.getBoundingClientRect();
  const viewportBuffer = activeScrollContainer.value.clientHeight;
  const snapshotTop = containerRect.top - viewportBuffer;
  const snapshotBottom = containerRect.bottom + viewportBuffer;
  const snapshot: string[] = [];
  const seenPaths = new Set<string>();

  activeScrollContainer.value.querySelectorAll<HTMLElement>('[data-cover-path]').forEach((element) => {
    if (snapshot.length >= VIEWPORT_SNAPSHOT_LIMIT) {
      return;
    }

    const path = element.dataset.coverPath;
    if (!path || seenPaths.has(path)) {
      return;
    }

    const rect = element.getBoundingClientRect();
    if (rect.bottom < snapshotTop || rect.top > snapshotBottom) {
      return;
    }

    if (!displayedCoverUrls.get(path) && !coverCache.get(path)) {
      return;
    }

    seenPaths.add(path);
    snapshot.push(path);
  });

  if (snapshot.length > 0) {
    songTableViewportCoverSnapshotCache.set(key, snapshot);
    return;
  }

  songTableViewportCoverSnapshotCache.delete(key);
};

const {
  saveScrollPosition,
  restoreScrollPosition,
} = useListScrollMemory(tableViewportKey, activeScrollContainer, { disabled: props.disableScrollMemory });

// 整页滚动模式：歌曲列表更新后若存在保存的滚动位置，触发恢复
// 解决返回导航时歌曲异步加载晚于 useListScrollMemory 初始恢复尝试的问题
watch(
  () => (props.pageScrollMode ? sourceSongCount.value : -1),
  (count) => {
    if (props.pageScrollMode && count > 0 && listScrollCache.get(tableViewportKey.value) !== undefined) {
      void restoreScrollPosition();
    }
  },
);

const virtualData = computed(() => {
  const songs = Array.isArray(segmentedSongs.value) ? segmentedSongs.value : [];
  const total = songs.length;
  const start = Math.floor(scrollTop.value / ROW_HEIGHT);
  const visibleCount = Math.ceil(containerHeight.value / ROW_HEIGHT);
  const renderStart = Math.max(0, start - OVERSCAN);
  const renderEnd = Math.min(total, start + visibleCount + OVERSCAN);

  return {
    items: songs.slice(renderStart, renderEnd).map((song, index) => ({
      ...song,
      virtualIndex: renderStart + index,
    })),
    paddingTop: renderStart * ROW_HEIGHT,
    paddingBottom: (total - renderEnd) * ROW_HEIGHT,
  };
});

const virtualPaddingTop = computed(() => `${virtualData.value?.paddingTop ?? 0}px`);
const virtualPaddingBottom = computed(() => `${virtualData.value?.paddingBottom ?? 0}px`);
const virtualItems = computed(() => virtualData.value?.items ?? []);

const clearScrollbarActiveTimer = () => {
  if (scrollbarActiveTimer !== null) {
    window.clearTimeout(scrollbarActiveTimer);
    scrollbarActiveTimer = null;
  }
};

const showScrollbarDuringScroll = () => {
  isScrollbarScrolling.value = true;
  clearScrollbarActiveTimer();
  scrollbarActiveTimer = window.setTimeout(() => {
    isScrollbarScrolling.value = false;
    scrollbarActiveTimer = null;
  }, 900);
};

const syncScrollbarHotZone = (event: MouseEvent | PointerEvent) => {
  if (!activeScrollContainer.value) {
    isScrollbarHot.value = false;
    return;
  }

  const rect = activeScrollContainer.value.getBoundingClientRect();
  isScrollbarHot.value = isPointerNearVerticalScrollbar(event.clientX, rect, DEFAULT_SCROLLBAR_HOT_ZONE_PX);
};

const handleSongTablePointerMove = (event: PointerEvent) => {
  handleRootMouseMove(event);
  syncScrollbarHotZone(event);
};

const handleSongTableMouseLeave = () => {
  handleRootMouseLeave();
  isScrollbarHot.value = false;
  isScrollbarScrolling.value = false;
  clearScrollbarActiveTimer();
};

const onScroll = (event: Event) => {
  const target = event.target as HTMLElement;
  scrollTop.value = target.scrollTop;
  updateListOffsetTop();
  if (target.scrollTop + target.clientHeight >= target.scrollHeight - ROW_HEIGHT * SCROLL_TRIGGER_ROWS) {
    loadNextSongSegment();
    // 已渲染完当前提供的全部歌曲仍接近底部时，通知父组件加载更多（如在线搜索分页）
    if (loadedSongCount.value >= sourceSongCount.value) {
      emit('load-more');
    }
  }
  showScrollbarDuringScroll();
};

const {
  showAlphabetIndex,
  firstSongIndexByKey,
  activeIndexKey,
  indexBarRef,
  isIndexDragging,
  dragIndexKey,
  hoverIndexKey,
  isIndexBarVisible,
  canLocateCurrentSong,
  showLocateCurrentSongButton,
  showScrollToTopButton,
  handleIndexHotspotEnter,
  handleIndexHotspotMove,
  handleIndexHotspotLeave,
  handleRootMouseMove,
  handleRootMouseLeave,
  handleIndexPointerDown,
  showIndexBar,
  scrollToCurrentSong,
  scrollToTop,
} = useSongTableAlphabetIndex({
  songs: segmentedSongs,
  scrollTop,
  containerHeight,
  containerRef: activeScrollContainer,
  rootRef,
  routePath: computed(() => route.path),
  currentViewMode,
  localSortMode,
  folderSortMode,
  activeRootPath,
  currentFolderFilter,
  folderTree,
  refreshFolder,
  expandFolderPath,
  listOffsetTop,
});

// 整页滚动模式：滚动发生在外层容器，动态监听其 scroll 事件驱动虚拟滚动
watch(
  () => props.scrollContainerRef,
  (el, oldEl) => {
    if (oldEl) oldEl.removeEventListener('scroll', onScroll);
    if (el) {
      el.addEventListener('scroll', onScroll, { passive: true });
      updateListOffsetTop();
    }
  },
  { immediate: true },
);

watch(
  () => virtualData.value.items,
  (newItems) => {
    syncVisibleCoverUrls(newItems);
    const paths = newItems.map(song => song.path);
    preloadPriorityCovers(paths);
    loadVisibleSongComments(newItems);
    void refreshDownloadedPaths(newItems);
  },
  { immediate: true },
);

watch(
  () => settings.value.showSongComments,
  (showSongComments) => {
    if (showSongComments) {
      loadVisibleSongComments(virtualItems.value);
    }
  },
);

watch(
  tableViewportKey,
  (newKey, oldKey) => {
    if (oldKey && oldKey !== newKey) {
      saveViewportCoverSnapshot(oldKey);
    }

    restoreViewportCoverSnapshot(newKey);
  },
  { immediate: true },
);

// 点击/双击播放：触发飞入封面动画并立即开始加载播放（并行执行）
// 飞封面动画用于掩盖起播延迟，与 playSong 同时启动可让动画结束时歌曲已就绪
const handlePlayClick = (song: Song) => {
  if (currentSong.value?.path === song.path && isPlaying.value) {
    return;
  }

  void launchFlyingCover(song.path, getDisplayedCoverUrl(song.path));
  emit('play', song);
};

const handlePointerDown = (event: PointerEvent, song: Song, index: number) => {
  if (event.pointerType === 'mouse' && event.button !== 0) {
    return;
  }
  emit('drag-start', { event, song, index });
};

const showDragIcon = computed(() => {
  // 在线搜索/详情是只读容器，不受本地 currentViewMode 残留影响，统一显示播放图标
  if (route.path === '/search' || route.path === '/online-detail') return false;
  return ['folder', 'playlist', 'all', 'artist', 'album', 'genre', 'year'].includes(currentViewMode.value);
});
const {
  showHeroScanCard,
  hasSearchQuery,
  showLibraryOnboarding,
  showFolderEmpty,
  showLibraryChecking,
  showLibraryEmptyResult,
  libraryScanPercent,
  libraryScanPhaseLabel,
  libraryScanFolderLabel,
  heroScanStatus,
  emptyStateMessage,
  retryHeroLibraryScan,
} = useSongTableLibraryState({
  currentViewMode,
  searchQuery,
  librarySongs,
  addLibraryFolder,
  scanLibrary,
});

const displayHeroTitle = computed(() => {
  if (heroScanStatus.value === 'error') {
    return '\u8fd9\u6bb5\u97f3\u4e50\u4e4b\u65c5\u6682\u65f6\u88ab\u6253\u65ad\u4e86';
  }
  if (heroScanStatus.value === 'success') {
    return librarySongs.value.length > 0
      ? '\u4e07\u7c41\u4ff1\u5bc2\uff0c\u9759\u5f85\u4e50\u8d77\u3002'
      : '\u8fd9\u6b21\u6ca1\u6709\u53d1\u73b0\u53ef\u5bfc\u5165\u7684\u6b4c\u66f2';
  }
  return '\u5373\u5c06\u5f00\u59cb\u7f8e\u5999\u7684\u97f3\u4e50\u4e4b\u65c5...';
});

const heroPercentValue = computed(() => {
  if (heroScanStatus.value === 'success') {
    return 100;
  }

  return Math.round(libraryScanPercent.value);
});

const heroPercentText = computed(() => `${heroPercentValue.value}%`);

const displayHeroProgressNote = computed(() => {
  const progress = libraryScanProgress.value;
  if (progress && progress.total > 0) {
    return `${progress.current} / ${progress.total}`;
  }
  if (heroScanStatus.value === 'success') {
    return librarySongs.value.length > 0 ? `${librarySongs.value.length} \u9996\u5df2\u5165\u5e93` : '\u672a\u53d1\u73b0\u6b4c\u66f2';
  }
  if (heroScanStatus.value === 'error') {
    return '\u5bfc\u5165\u5df2\u4e2d\u65ad';
  }
  return libraryScanPhaseLabel.value;
});

const displayHeroProgressDetail = computed(() => {
  const progress = libraryScanProgress.value;
  if (progress && progress.total > 0) {
    const folderPath = progress.folder_path?.trim();
    return folderPath || libraryScanPhaseLabel.value;
  }
  if (heroScanStatus.value === 'success') {
    return '\u73b0\u5728\u53ef\u4ee5\u5f00\u59cb\u6d4f\u89c8\u3001\u641c\u7d22\u548c\u64ad\u653e';
  }
  if (heroScanStatus.value === 'error') {
    return '\u91cd\u65b0\u626b\u63cf\u540e\u4f1a\u7ee7\u7eed\u5efa\u7acb\u97f3\u4e50\u5e93';
  }
  return libraryScanFolderLabel.value || '\u6b63\u5728\u51c6\u5907\u5bfc\u5165';
});

const onboardingMessage = computed(() =>
  showLibraryOnboarding.value
    ? '\u97f3\u4e50\u5e93\u7a7a\u7a7a\u5982\u4e5f\uff0c\u5feb\u53bb\u6dfb\u52a0\u4f60\u7684\u672c\u5730\u97f3\u4e50\u5427'
    : emptyStateMessage.value,
);
const libraryCheckingTitle = '\u6b63\u5728\u68c0\u67e5\u4f60\u7684\u97f3\u4e50\u5e93...';
const libraryCheckingDescription = '\u542f\u52a8\u540e\u4f1a\u5728\u540e\u53f0\u5feb\u901f\u6838\u5bf9\u76ee\u5f55\u53d8\u5316\uff0c\u4e0d\u4f1a\u6253\u65ad\u5f53\u524d\u6d4f\u89c8\u3002';
const emptyLibraryResultTitle = computed(() =>
  lastLibraryScanError.value
    ? '\u6682\u65f6\u65e0\u6cd5\u8bfb\u53d6\u4f60\u7684\u97f3\u4e50\u5e93'
    : '\u672a\u5728\u5f53\u524d\u97f3\u4e50\u5e93\u4e2d\u53d1\u73b0\u53ef\u5bfc\u5165\u97f3\u9891',
);
const emptyLibraryResultDescription = computed(() =>
  lastLibraryScanError.value
    ? '\u4f60\u53ef\u4ee5\u524d\u5f80\u8bbe\u7f6e\u4e2d\u7684\u97f3\u4e50\u5e93\u9875\u91cd\u65b0\u626b\u63cf\uff0c\u6216\u68c0\u67e5\u76ee\u5f55\u662f\u5426\u4ecd\u7136\u53ef\u8bbf\u95ee\u3002'
    : '\u53ef\u4ee5\u5c1d\u8bd5\u91cd\u65b0\u9009\u62e9\u6587\u4ef6\u5939\uff0c\u6216\u786e\u8ba4\u76ee\u5f55\u4e2d\u5305\u542b\u53d7\u652f\u6301\u7684\u97f3\u9891\u6587\u4ef6\u3002',
);
const getClickableArtistNames = (song: Song) =>
  (Array.isArray(song.artist_names) && song.artist_names.length > 0 ? song.artist_names : [song.artist]).filter(Boolean);

const handleArtistClick = (artistName: string) => {
  void openHomeArtist(artistName);
};

onMounted(() => {
  window.addEventListener('resize', updateContainerHeight);
  updateContainerHeight();
  ensureViewportSegmentFilled();
  void restoreActiveViewportCovers();
});

onActivated(() => {
  ensureViewportSegmentFilled();
  void restoreActiveViewportCovers();
});

onDeactivated(() => {
  saveScrollPosition();
  saveViewportCoverSnapshot();
});

onBeforeUnmount(() => {
  const scrollEl = activeScrollContainer.value;
  // 整页滚动模式下父容器可能在卸载前已把滚动清零（如在线详情类型切换），
  // 此时保存 0 会覆盖此前真实滚动位置；滚动监听已实时保存过真实位置，跳过即可
  if (!(props.pageScrollMode && scrollEl && scrollEl.scrollTop === 0)) {
    saveScrollPosition();
  }
  saveViewportCoverSnapshot();
  clearScrollbarActiveTimer();
  displayedCoverUrls.clear();
  songCommentCache.clear();
  loadingSongCommentPaths.clear();
  visibleCoverPaths = new Set<string>();
});

onUnmounted(() => {
  window.removeEventListener('resize', updateContainerHeight);
});

defineExpose({ containerRef });

// 预计算拖拽源在列表中的索引，避免 getRowStyle 每行都执行 O(n) findIndex
const dragSourcePath = computed(() => {
  if (!dragSession.active || !dragSession.songs.length) return '';
  return dragSession.songs[0]?.path ?? '';
});
const dragIndex = computed(() => {
  if (!dragSourcePath.value) return -1;
  if (props.songPaths) {
    return props.songPaths.findIndex(path => path === dragSourcePath.value);
  }
  return props.songs.findIndex(song => song.path === dragSourcePath.value);
});

const getRowStyle = (songIndex: number, songPath: string) => {
  const baseStyle: Record<string, string | number> = { height: `${ROW_HEIGHT}px` };

  if (!dragSession.active || dragSession.insertIndex === -1) {
    return baseStyle;
  }

  const currentDragIndex = dragIndex.value;
  const targetIndex = dragSession.insertIndex;

  if (songPath === dragSourcePath.value) {
    const diff = targetIndex - currentDragIndex;
    return {
      ...baseStyle,
      transform: `translateY(${diff * 100}%)`,
      transition: 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)',
      opacity: 0,
      zIndex: 0,
    };
  }

  let translateY = 0;

  if (targetIndex > currentDragIndex) {
    if (songIndex > currentDragIndex && songIndex <= targetIndex) {
      translateY = -100;
    }
  } else if (targetIndex < currentDragIndex) {
    if (songIndex >= targetIndex && songIndex < currentDragIndex) {
      translateY = 100;
    }
  }

  if (translateY !== 0) {
    return {
      ...baseStyle,
      transform: `translateY(${translateY}%)`,
      transition: 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)',
      zIndex: 1,
    };
  }

  return {
    ...baseStyle,
    transition: 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)',
  };
};
</script>

<template>
  <div
    ref="rootRef"
    class="min-w-0 relative overflow-x-auto"
    :class="{ 'flex-1 min-h-0': !pageScrollMode }"
    @pointermove="handleSongTablePointerMove"
    @mouseleave="handleSongTableMouseLeave"
  >
    <div
      ref="containerRef"
      class="overflow-x-auto pl-2.5 pb-8 custom-scrollbar song-list-scroll-container"
      :class="{
        'h-full overflow-y-auto': !pageScrollMode,
        'song-list-scrollbar-active': isScrollbarActive,
      }"
      @scroll="onScroll"
    >
      <div class="w-full relative">
        <div :style="{ height: virtualPaddingTop }"></div>

        <div
          v-for="song in virtualItems"
          :key="song.path"
          :data-index="song.virtualIndex"
          @pointerdown="handlePointerDown($event, song, song.virtualIndex)"
          @click="!isBatchMode && songClickAction === 'single' && handlePlayClick(song)"
          @dblclick="!isBatchMode && songClickAction !== 'single' && handlePlayClick(song)"
          @contextmenu.prevent="emit('contextmenu', $event, song)"
          @dragstart.prevent
          class="group w-full min-w-[580px] border-b border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5 select-none cursor-default relative flex items-center pl-2 pr-6 gap-3 [touch-action:none]"
          :class="{ 'bg-red-500/10 dark:bg-red-500/20': selectedPaths.has(song.path) }"
          :style="getRowStyle(song.virtualIndex, song.path)"
        >
          <div class="w-10 shrink-0 flex items-center justify-center">
            <div v-if="isBatchMode" class="flex items-center justify-center">
              <input type="checkbox" :checked="selectedPaths.has(song.path)" class="rounded text-[#EC4141] focus:ring-[#EC4141] pointer-events-none" />
            </div>
            <div v-else-if="currentSong?.path === song.path && isPlaying" class="flex items-center justify-center gap-[3px] w-5 h-5">
              <span class="spectrum-bar w-[3px] rounded-full bg-[#EC4141]" style="animation-delay: 0s"></span>
              <span class="spectrum-bar w-[3px] rounded-full bg-[#EC4141]" style="animation-delay: 0.2s"></span>
              <span class="spectrum-bar w-[3px] rounded-full bg-[#EC4141]" style="animation-delay: 0.4s"></span>
            </div>
            <div v-else-if="currentSong?.path === song.path && !isPlaying" class="flex items-center justify-center gap-[3px] w-5 h-5">
              <span class="w-[3px] h-[6px] rounded-full bg-[#EC4141]/60"></span>
              <span class="w-[3px] h-[10px] rounded-full bg-[#EC4141]/60"></span>
              <span class="w-[3px] h-[4px] rounded-full bg-[#EC4141]/60"></span>
            </div>
            <div v-else class="relative flex items-center justify-center w-5 h-5">
              <span class="absolute inset-0 flex items-center justify-center text-xs font-mono text-gray-400 dark:text-white/40 transition-opacity duration-150 group-hover:opacity-0">
                {{ song.virtualIndex + 1 < 10 ? '0' + (song.virtualIndex + 1) : song.virtualIndex + 1 }}
              </span>
              <div class="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                <span v-if="showDragIcon" class="text-gray-500 dark:text-white/60 active:text-[#EC4141] cursor-grab">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </span>
                <span v-else class="text-gray-500 dark:text-white/60 cursor-pointer hover:text-[#EC4141]" @click.stop="handlePlayClick(song)" @dblclick.stop.prevent>
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
                  </svg>
                </span>
              </div>
            </div>
          </div>

          <div class="w-12 h-12 rounded-lg bg-gray-200/50 dark:bg-white/5 flex items-center justify-center shrink-0 overflow-hidden text-gray-400 dark:text-white/40 relative border border-black/5 dark:border-white/5" :data-cover-path="song.path">
            <img v-if="getDisplayedCoverUrl(song.path)" :src="getDisplayedCoverUrl(song.path)" class="w-full h-full object-cover transition-opacity duration-300" alt="Cover" decoding="async" />
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-40 absolute inset-0 m-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>

          <div class="flex-[1_1_40%] max-w-[44%] min-w-[100px] flex flex-col justify-center gap-0.5">
            <div class="min-w-0 flex items-baseline gap-1.5 leading-snug">
              <span class="min-w-0 truncate text-[15px] text-gray-900 dark:text-gray-100 font-semibold">{{ song.title || song.name.replace(/\.[^/.]+$/, '') }}</span>
              <span
                v-if="hasVisibleSongComment(song)"
                class="max-w-[42%] shrink-0 truncate text-xs font-medium text-gray-500 dark:text-white/45"
                :title="getSongComment(song)"
              >（{{ getSongComment(song) }}）</span>
            </div>
            <div class="flex items-center gap-1.5 text-xs text-gray-900 dark:text-gray-100 leading-snug">
              <!-- 歌手名 -->
              <span v-if="currentViewMode === 'album'" class="truncate flex items-center gap-1 flex-wrap" :title="song.artist">
                <template v-for="(artistName, artistIndex) in getClickableArtistNames(song)" :key="`${song.path}-${artistName}`">
                  <button type="button" class="truncate hover:text-[#EC4141] transition-colors" @click.stop="handleArtistClick(artistName)">
                    {{ artistName }}
                  </button>
                  <span v-if="artistIndex < getClickableArtistNames(song).length - 1" class="opacity-60">/</span>
                </template>
              </span>
              <span v-else class="truncate" :title="song.artist">{{ song.artist }}</span>
            </div>
          </div>

          <div class="flex-1 min-w-[9rem] truncate text-xs text-gray-900 dark:text-gray-100" :title="song.album">
            {{ song.album }}
          </div>

          <!-- 音质/格式列：在线歌曲显示下载状态（下载中圆环 / 未下载按钮）；本地容器中已下载的歌展示本地真实音质；在线容器中已下载显示绿色对勾 -->
          <div class="w-16 shrink-0 flex items-center justify-center gap-1 text-center text-xs font-mono text-gray-500 dark:text-white/50">
            <span class="min-w-0 truncate" :title="displayedFormat(song)">{{ displayedFormat(song) }}</span>
            <template v-if="isOnlineSong(song)">
              <div
                v-if="isSongDownloading(song)"
                class="relative h-5 w-5 shrink-0 text-[#EC4141]"
                :title="`下载中 ${Math.floor(downloadStore.progress)}%`"
              >
                <svg class="h-full w-full -rotate-90" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-opacity="0.15" stroke-width="4" />
                  <circle
                    cx="10" cy="10" r="7" fill="none" stroke="currentColor"
                    stroke-width="4" stroke-linecap="round"
                    :stroke-dasharray="43.98"
                    :stroke-dashoffset="43.98 * (1 - downloadStore.progress / 100)"
                    class="transition-[stroke-dashoffset] duration-150"
                  />
                </svg>
              </div>
              <CircleCheck
                v-else-if="!downloadCompletedAsLocal && downloadedOnlinePaths.has(song.path)"
                class="h-4 w-4 shrink-0 text-emerald-500"
                :title="`已下载：${song.title || song.name}`"
              />
              <button
                v-else-if="!downloadedOnlinePaths.has(song.path)"
                type="button"
                class="shrink-0 text-gray-400 dark:text-white/40 hover:text-[#EC4141] transition-colors cursor-pointer"
                :title="`下载：${song.title || song.name}`"
                @click.stop="handleDownloadClick(song)"
              >
                <Download class="h-3.5 w-3.5" />
              </button>
            </template>
          </div>

          <div class="shrink-0 flex items-center gap-3 text-xs font-mono text-gray-900 dark:text-gray-100" :class="{ 'opacity-20 pointer-events-none': dragSession.active }">
            <button v-if="!isBatchMode" @click.stop="toggleFavorite(song)" class="focus:outline-none">
              <svg v-if="isFavorite(song)" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-[#EC4141]" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd" /></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 dark:text-white/40 hover:text-gray-600 dark:hover:text-white opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            </button>
            <span class="w-10 text-right">{{ formatDuration(song.duration) }}</span>
          </div>

          <!-- 来源标签：在线容器始终显示音源名（下载完成也保留）；本地容器中已下载或在读本地歌曲显示"本地" -->
          <div class="w-16 shrink-0 flex items-center justify-center">
            <span
              v-if="isOnlineSong(song) && !(downloadCompletedAsLocal && downloadedOnlinePaths.has(song.path))"
              class="max-w-full truncate rounded-full border border-[#EC4141]/20 bg-[#EC4141]/10 px-1.5 py-[1px] text-[10px] font-bold text-[#EC4141]"
              :title="getSongSourceLabel(song)"
            >{{ getSongSourceLabel(song) }}</span>
            <span
              v-else
              class="whitespace-nowrap rounded-full border border-[#EC4141]/20 bg-[#EC4141]/10 px-1.5 py-[1px] text-[10px] font-bold text-[#EC4141]"
            >本地</span>
          </div>
        </div>

        <div :style="{ height: virtualPaddingBottom }"></div>
      </div>

      <div v-if="sourceSongCount === 0" class="py-20 flex flex-col justify-center items-center select-none text-gray-500 dark:text-white/60">
        <template v-if="showLibraryOnboarding || showFolderEmpty || hasSearchQuery">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-16 h-16 mb-4 text-gray-300 dark:text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M4 7.25a2 2 0 012-2h3.35c.52 0 1.02.2 1.4.56l1.1 1.04c.38.36.88.56 1.4.56H18a2 2 0 012 2v7.35a2 2 0 01-2 2H6a2 2 0 01-2-2V7.25z" />
            <path d="M14.5 13.2V9.8l3.4-.7v3.4" />
            <circle cx="12.8" cy="13.6" r="1.45" />
            <circle cx="16.2" cy="12.9" r="1.45" />
          </svg>
          <p class="mb-6 text-[15px]">{{ onboardingMessage }}</p>
          <button v-if="showLibraryOnboarding" @click="addLibraryFolder" class="flex items-center gap-2 px-6 py-2.5 bg-[#EC4141] text-white hover:bg-[#b92f2f] rounded-full text-[14px] font-medium transition-colors shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            &#28155;&#21152;&#26412;&#22320;&#38899;&#20048;
          </button>
        </template>
        <template v-else-if="showLibraryChecking">
          <div class="flex h-14 w-14 items-center justify-center rounded-full bg-white/70 shadow-[0_10px_30px_rgba(15,23,42,0.08)] dark:bg-white/10">
            <div class="h-6 w-6 rounded-full border-2 border-[#ec4141]/25 border-t-[#ec4141] scan-spinner"></div>
          </div>
          <p class="mt-5 text-[15px] font-medium text-gray-700 dark:text-white/80">{{ libraryCheckingTitle }}</p>
          <p class="mt-2 text-[13px] opacity-70">{{ libraryCheckingDescription }}</p>
        </template>
        <template v-else-if="showLibraryEmptyResult">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-16 h-16 mb-4 text-gray-300 dark:text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M4 7.25a2 2 0 012-2h3.35c.52 0 1.02.2 1.4.56l1.1 1.04c.38.36.88.56 1.4.56H18a2 2 0 012 2v7.35a2 2 0 01-2 2H6a2 2 0 01-2-2V7.25z" />
            <path d="M14.5 13.2V9.8l3.4-.7v3.4" />
            <circle cx="12.8" cy="13.6" r="1.45" />
            <circle cx="16.2" cy="12.9" r="1.45" />
          </svg>
          <p class="mb-2 text-[15px]">{{ emptyLibraryResultTitle }}</p>
          <p class="text-[13px] opacity-70">
            {{ emptyLibraryResultDescription }}
          </p>
        </template>
        <template v-else-if="currentViewMode === 'playlist'">
          <p>{{ emptyStateMessage }}</p>
        </template>
        <template v-else>
          <p>{{ emptyStateMessage }}</p>
        </template>
      </div>
    </div>

    <Teleport to="body">
      <transition name="library-hero">
        <div
          v-if="showHeroScanCard"
          class="library-hero-overlay"
        >
          <div class="library-hero-backdrop"></div>

          <div class="library-hero-card" :class="`library-hero-card-${heroScanStatus}`">
            <p class="library-hero-phase">{{ libraryScanPhaseLabel }}</p>
            <h3 class="library-hero-title">{{ displayHeroTitle }}</h3>

            <div class="library-hero-progress-track">
              <div
                class="library-hero-progress-fill"
                :class="{ 'scan-progress-indeterminate': libraryScanProgress && libraryScanProgress.total <= 0 && heroScanStatus === 'scanning' }"
                :style="{ width: `${heroPercentValue}%` }"
              ></div>
            </div>

            <div class="library-hero-progress-meta">
              <span class="library-hero-progress-note" :title="displayHeroProgressDetail">{{ displayHeroProgressDetail }}</span>
              <span class="library-hero-progress-value">{{ displayHeroProgressNote }} &middot; {{ heroPercentText }}</span>
            </div>

            <div v-if="heroScanStatus === 'error'" class="library-hero-actions">
              <button type="button" class="hero-primary-btn" @click="retryHeroLibraryScan">&#37325;&#26032;&#25195;&#25551;</button>
              <button type="button" class="hero-secondary-btn" @click="addLibraryFolder">&#37325;&#26032;&#36873;&#25321;&#25991;&#20214;&#22841;</button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>

    <div
      v-if="showAlphabetIndex"
      class="absolute inset-y-0 right-0 z-20 flex items-center justify-end w-16 pr-3 pointer-events-none"
    >
      <div
        class="flex flex-col items-center gap-2 transition-all duration-300 ease-out"
        :class="isIndexBarVisible ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 translate-x-2 pointer-events-none'"
        @mouseenter="handleIndexHotspotEnter"
        @mousemove="handleIndexHotspotMove"
        @mouseleave="handleIndexHotspotLeave"
      >
        <div
          ref="indexBarRef"
          class="flex flex-col items-center gap-[1px] rounded-full bg-white px-1 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.08)] dark:bg-black"
        >
          <button
            v-for="key in INDEX_KEYS"
            :key="key"
            type="button"
            class="index-nav-item"
            :class="{
              'index-nav-item-active': activeIndexKey === key,
              'index-nav-item-hover': hoverIndexKey === key && activeIndexKey !== key && dragIndexKey !== key,
              'index-nav-item-drag': dragIndexKey === key && activeIndexKey !== key,
              'index-nav-item-disabled': !firstSongIndexByKey.has(key),
            }"
            :disabled="!firstSongIndexByKey.has(key)"
            @mouseenter="hoverIndexKey = key; showIndexBar()"
            @mouseleave="hoverIndexKey = null"
            @pointerdown="handleIndexPointerDown($event, key)"
          >
            {{ key }}
          </button>
        </div>
      </div>
    </div>

    <!-- target 未就绪时 disabled 就地渲染，避免 Teleport null target 触发 Vue patch 崩溃；
         整页滚动（在线详情）时挂回滚动容器，sticky 吸在容器可视区底部——容器可视区正好位于
         底部播放栏上方，按钮既不随内容滚出视口，也不会盖住底栏（与本地容器绝对定位同理） -->
    <Teleport
      :disabled="!pageScrollMode || !scrollContainerRef"
      :to="scrollContainerRef"
    >
      <div
        class="grid grid-cols-[36px_36px] gap-3"
        :class="pageScrollMode ? 'sticky bottom-6 z-[60] ml-auto mr-6 w-fit' : 'absolute right-6 bottom-6 z-30'"
      >
        <div class="h-9 w-9">
          <transition name="locate-fab">
            <button
              v-if="settings.enableScrollToTopButton && showScrollToTopButton"
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200/50 bg-white/80 text-gray-500 shadow-[0_4px_16px_rgba(0,0,0,0.08)] backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:text-[#ec4141] hover:shadow-[0_6px_20px_rgba(0,0,0,0.12)] cursor-pointer dark:border-white/10 dark:bg-black/50 dark:text-gray-400 dark:shadow-[0_4px_16px_rgba(0,0,0,0.3)] dark:hover:bg-gray-800 dark:hover:text-[#ec4141]"
              title="回到顶部"
              @click="scrollToTop"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M5 12l7-7 7 7M12 5v14" />
              </svg>
            </button>
          </transition>
        </div>

        <div class="h-9 w-9">
          <transition name="locate-fab">
            <button
              v-if="showLocateCurrentSongButton"
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200/50 bg-white/80 text-gray-500 shadow-[0_4px_16px_rgba(0,0,0,0.08)] backdrop-blur-md transition-all duration-300 dark:border-white/10 dark:bg-black/50 dark:text-gray-400 dark:shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
              :class="canLocateCurrentSong ? 'hover:bg-white dark:hover:bg-gray-800 hover:text-[#ec4141] dark:hover:text-[#ec4141] hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,0,0,0.12)] cursor-pointer' : 'opacity-40 cursor-not-allowed'"
              :disabled="!canLocateCurrentSong"
              title="定位当前播放歌曲"
              @click="scrollToCurrentSong"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
                <circle cx="12" cy="12" r="3.25" stroke-width="1.8" />
              </svg>
            </button>
          </transition>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <transition name="index-bubble">
        <div v-if="isIndexDragging && dragIndexKey" class="fixed inset-0 z-[9998] pointer-events-none flex items-center justify-center">
          <div class="rounded-[28px] bg-black/72 px-7 py-5 text-5xl font-bold tracking-[0.12em] text-white shadow-2xl backdrop-blur-xl dark:bg-black/78">
            {{ dragIndexKey }}
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.song-list-scroll-container {
  overflow-anchor: none;
}

.song-list-scroll-container::-webkit-scrollbar {
  width: 10px;
}

.song-list-scroll-container::-webkit-scrollbar-track {
  background: transparent;
}

.song-list-scroll-container::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 9999px;
  background-color: rgba(0, 0, 0, 0.14);
  background-clip: content-box;
}

.song-list-scroll-container::-webkit-scrollbar-thumb:hover {
  border-width: 2px;
  background-color: rgba(236, 65, 65, 0.68);
}

:global(.dark) .song-list-scroll-container::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.22);
}

:global(.dark) .song-list-scroll-container.song-list-scrollbar-active::-webkit-scrollbar-thumb {
  background-color: rgba(236, 65, 65, 0.72);
}

:global(.dark) .song-list-scroll-container::-webkit-scrollbar-thumb:hover {
  background-color: rgba(236, 65, 65, 0.82);
}

.spectrum-bar {
  animation: spectrum 1s ease-in-out infinite;
}

.scan-spinner {
  animation: scan-spin 0.9s linear infinite;
}

.library-hero-overlay {
  position: fixed;
  inset: 0;
  z-index: 170;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.library-hero-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(244, 246, 250, 0.72);
  backdrop-filter: blur(4px);
}

.library-hero-card {
  position: relative;
  z-index: 1;
  width: min(100%, 500px);
  overflow: hidden;
  padding: 1.55rem 1.6rem 1.2rem;
  border: 1px solid rgba(255, 255, 255, 0.68);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(248, 250, 252, 0.8));
  box-shadow:
    0 16px 40px rgba(15, 23, 42, 0.12),
    0 2px 12px rgba(15, 23, 42, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(30px) saturate(1.04);
}

.library-hero-card-success {
  background: linear-gradient(180deg, rgba(247, 252, 249, 0.8), rgba(242, 249, 245, 0.82));
}

.library-hero-card-error {
  background: linear-gradient(180deg, rgba(255, 248, 248, 0.82), rgba(253, 243, 243, 0.84));
}

.library-hero-phase {
  margin: 0 0 0.55rem;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(79, 92, 112, 0.78);
}

.library-hero-card-success .library-hero-phase {
  color: rgba(6, 95, 70, 0.78);
}

.library-hero-card-error .library-hero-phase {
  color: rgba(185, 28, 28, 0.78);
}

.library-hero-title {
  margin: 0;
  font-size: clamp(1.58rem, 2.7vw, 2.02rem);
  line-height: 1.16;
  letter-spacing: -0.025em;
  color: rgb(15, 23, 42);
}

.library-hero-progress-track {
  overflow: hidden;
  height: 0.52rem;
  border-radius: 9999px;
  background: rgba(15, 23, 42, 0.08);
  margin-top: 1rem;
}

.library-hero-progress-fill {
  position: relative;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #0a66ff 0%, #3b82f6 100%);
  transition: width 0.3s ease-out;
}

.library-hero-card-success .library-hero-progress-fill {
  background: linear-gradient(90deg, #059669 0%, #10b981 100%);
}

.library-hero-card-error .library-hero-progress-fill {
  background: linear-gradient(90deg, #dc2626 0%, #f87171 100%);
}

.library-hero-progress-meta {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 0.6rem;
  font-size: 0.78rem;
  color: rgba(71, 85, 105, 0.78);
}

.library-hero-progress-note {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.library-hero-progress-value {
  flex-shrink: 0;
  color: rgba(15, 23, 42, 0.56);
}

.library-hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
  margin-top: 0.9rem;
}

.hero-primary-btn,
.hero-secondary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 132px;
  border-radius: 9999px;
  padding: 0.82rem 1.3rem;
  font-size: 0.94rem;
  font-weight: 700;
  transition:
    transform 0.18s ease,
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
}

.hero-primary-btn {
  color: white;
  background: linear-gradient(180deg, #1677ff, #0a66ff);
  box-shadow: 0 10px 20px rgba(10, 102, 255, 0.18);
}

.hero-primary-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 24px rgba(10, 102, 255, 0.22);
}

.hero-secondary-btn {
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: rgba(255, 255, 255, 0.72);
  color: rgb(31, 41, 55);
}

.hero-secondary-btn:hover {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.94);
}

@media (max-width: 720px) {
  .library-hero-overlay {
    padding: 1rem;
  }

  .library-hero-card {
    padding: 1.45rem 1.2rem 1.15rem;
  }

  .library-hero-progress-meta {
    flex-direction: column;
    align-items: flex-start;
  }
}

.index-nav-item {
  width: 1.05rem;
  height: 0.78rem;
  border-radius: 9999px;
  font-size: 0.58rem;
  line-height: 1;
  color: rgba(75, 85, 99, 0.85);
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.index-nav-item:hover {
  background: rgba(15, 23, 42, 0.08);
  color: rgb(17, 24, 39);
}

.index-nav-item-active {
  background: rgba(236, 65, 65, 0.18);
  color: #ec4141;
  transform: scale(1.06);
}

.index-nav-item-hover {
  background: rgba(15, 23, 42, 0.08);
  color: rgb(17, 24, 39);
}

.index-nav-item-drag {
  background: rgba(15, 23, 42, 0.12);
  color: rgb(17, 24, 39);
  transform: scale(1.04);
}

.index-nav-item-disabled {
  opacity: 0.25;
  cursor: not-allowed;
  pointer-events: none;
}


:global(.dark) .library-hero-backdrop {
  background: rgba(2, 6, 23, 0.68);
  backdrop-filter: blur(4px);
}

:global(.dark) .library-hero-card {
  border-color: rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, rgba(12, 18, 28, 0.8), rgba(10, 16, 25, 0.84));
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

:global(.dark) .library-hero-card-success {
  background: linear-gradient(180deg, rgba(7, 46, 39, 0.84), rgba(8, 58, 47, 0.86));
}

:global(.dark) .library-hero-card-error {
  background: linear-gradient(180deg, rgba(67, 13, 13, 0.84), rgba(82, 18, 18, 0.86));
}

:global(.dark) .library-hero-title,
:global(.dark) .library-hero-progress-value {
  color: rgba(255, 255, 255, 0.96);
}

:global(.dark) .library-hero-phase {
  color: rgba(191, 201, 216, 0.8);
}

:global(.dark) .library-hero-card-success .library-hero-phase {
  color: rgba(110, 231, 183, 0.82);
}

:global(.dark) .library-hero-card-error .library-hero-phase {
  color: rgba(252, 165, 165, 0.88);
}

:global(.dark) .library-hero-progress-meta,
:global(.dark) .library-hero-progress-note {
  color: rgba(226, 232, 240, 0.72);
}

:global(.dark) .index-nav-item {
  color: rgba(255, 255, 255, 0.72);
}

:global(.dark) .index-nav-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.96);
}

:global(.dark) .index-nav-item-active {
  background: rgba(236, 65, 65, 0.24);
  color: #fda4af;
}

:global(.dark) .index-nav-item-hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.96);
}

:global(.dark) .index-nav-item-drag {
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.98);
}


.index-bubble-enter-active,
.index-bubble-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.index-bubble-enter-from,
.index-bubble-leave-to {
  opacity: 0;
  transform: scale(0.92);
}

.locate-fab-enter-active,
.locate-fab-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.locate-fab-enter-from,
.locate-fab-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.94);
}

.library-hero-enter-active,
.library-hero-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.library-hero-enter-from,
.library-hero-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

.scan-progress-indeterminate {
  min-width: 28%;
  animation: scan-progress-indeterminate 1.1s ease-in-out infinite alternate;
}

@keyframes scan-progress-indeterminate {
  from {
    transform: translateX(-14%);
  }

  to {
    transform: translateX(14%);
  }
}

@keyframes scan-spin {
  to {
    transform: rotate(360deg);
  }
}

:global(.dark) .hero-secondary-btn {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
}

:global(.dark) .hero-secondary-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

@keyframes spectrum {
  0%, 100% { height: 4px; }
  25% { height: 14px; }
  50% { height: 6px; }
  75% { height: 12px; }
}
</style>
