<script setup lang="ts"> // 实现
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'; // 实现
import { storeToRefs } from 'pinia'; // 实现
import { dragSession } from '../../composables/dragState'; // 实现
import type { Song } from '../../types'; // 实现
import { listScrollCache, songTableViewportCoverSnapshotCache } from '../../caches/imageCaches';
import { useLibraryCollections } from '../../features/collections/useLibraryCollections'; // 实现
import { getDisplayCoverUrl, tryProxyImage } from '../../utils/coverProxy';
import { useSettings } from '../../features/settings/useSettings'; // 实现
import { useRoute, useRouter } from 'vue-router'; // 实现
import { INDEX_KEYS } from '../../utils/alphabetIndex'; // 实现
import { useCoverCache } from '../../composables/useCoverCache'; // 实现
import { launchFlyingCover } from '../../composables/useFlyingCover';
import { useHomeNavigation } from '../../composables/useHomeNavigation'; // 实现
import { useLibraryRuntimeActions } from '../../features/library/useLibraryRuntimeActions'; // 实现
import { usePlaybackController } from '../../features/playback/usePlaybackController'; // 实现
import { usePlayerLibraryView } from '../../features/library/usePlayerLibraryView'; // 实现
import { usePlayerViewState } from '../../composables/usePlayerViewState'; // 实现
import { useListScrollMemory } from '../../composables/useListScrollMemory'; // 实现
import { useSongTableAlphabetIndex } from '../../composables/useSongTableAlphabetIndex'; // 实现
import { useSongTableLibraryState } from '../../features/library/useSongTableLibraryState'; // 实现
import { useLibraryStore } from '../../features/library/store'; // 实现
import { DEFAULT_SCROLLBAR_HOT_ZONE_PX, isPointerNearVerticalScrollbar } from '../../utils/scrollbarActivity'; // 实现
import { useSongDetailCache } from '../../composables/useSongDetailCache'; // 实现
import { getDownloadRecord, loadDownloadHistory } from '../../services/domain/downloadHistory';
import { CircleCheck, Download } from 'lucide-vue-next';
import { useDownloadStore } from '../../features/download/store';
import { downloadToLocal } from '../../composables/useDownloadToLocal';
import { isDownloadableOnlineSong } from '../../services/domain/downloadService';
import { getSongSourceTag } from '../../utils/remoteSong';

/**
 * 歌曲表格主组件
 * —— 虚拟滚动渲染、分段懒加载、封面/评论/下载标记、字母索引导航、拖拽排序位移动画。
 * 本文件为桌面端独立实现：对外 props/emits/expose 契约保持不变。
 */

// ==================== 空态与扫描英雄卡的固定文案 ====================
const HERO_TITLE_INTERRUPTED = '\u8fd9\u6bb5\u97f3\u4e50\u4e4b\u65c5\u6682\u65f6\u88ab\u6253\u65ad\u4e86';
const HERO_TITLE_DONE = '\u4e07\u7c41\u4ff1\u5bc2\uff0c\u9759\u5f85\u4e50\u8d77\u3002';
const HERO_TITLE_NO_SONGS = '\u8fd9\u6b21\u6ca1\u6709\u53d1\u73b0\u53ef\u5bfc\u5165\u7684\u6b4c\u66f2';
const HERO_TITLE_PENDING = '\u5373\u5c06\u5f00\u59cb\u7f8e\u5999\u7684\u97f3\u4e50\u4e4b\u65c5...';
const HERO_NOTE_NO_SONGS = '\u672a\u53d1\u73b0\u6b4c\u66f2';
const HERO_NOTE_INTERRUPTED = '\u5bfc\u5165\u5df2\u4e2d\u65ad';
const HERO_DETAIL_DONE = '\u73b0\u5728\u53ef\u4ee5\u5f00\u59cb\u6d4f\u89c8\u3001\u641c\u7d22\u548c\u64ad\u653e';
const HERO_DETAIL_ERROR = '\u91cd\u65b0\u626b\u63cf\u540e\u4f1a\u7ee7\u7eed\u5efa\u7acb\u97f3\u4e50\u5e93';
const HERO_DETAIL_PREP = '\u6b63\u5728\u51c6\u5907\u5bfc\u5165';
const ONBOARDING_HINT = '\u97f3\u4e50\u5e93\u7a7a\u7a7a\u5982\u4e5f\uff0c\u5feb\u53bb\u6dfb\u52a0\u4f60\u7684\u672c\u5730\u97f3\u4e50\u5427';
const CHECKING_TITLE = '\u6b63\u5728\u68c0\u67e5\u4f60\u7684\u97f3\u4e50\u5e93...';
const CHECKING_DESC = '\u542f\u52a8\u540e\u4f1a\u5728\u540e\u53f0\u5feb\u901f\u6838\u5bf9\u76ee\u5f55\u53d8\u5316\uff0c\u4e0d\u4f1a\u6253\u65ad\u5f53\u524d\u6d4f\u89c8\u3002';
const SCAN_FAIL_TITLE = '\u6682\u65f6\u65e0\u6cd5\u8bfb\u53d6\u4f60\u7684\u97f3\u4e50\u5e93';
const SCAN_EMPTY_TITLE = '\u672a\u5728\u5f53\u524d\u97f3\u4e50\u5e93\u4e2d\u53d1\u73b0\u53ef\u5bfc\u5165\u97f3\u9891';
const SCAN_FAIL_DESC = '\u4f60\u53ef\u4ee5\u524d\u5f80\u8bbe\u7f6e\u4e2d\u7684\u97f3\u4e50\u5e93\u9875\u91cd\u65b0\u626b\u63cf\uff0c\u6216\u68c0\u67e5\u76ee\u5f55\u662f\u5426\u4ecd\u7136\u53ef\u8bbf\u95ee\u3002';
const SCAN_EMPTY_DESC = '\u53ef\u4ee5\u5c1d\u8bd5\u91cd\u65b0\u9009\u62e9\u6587\u4ef6\u5939\uff0c\u6216\u786e\u8ba4\u76ee\u5f55\u4e2d\u5305\u542b\u53d7\u652f\u6301\u7684\u97f3\u9891\u6587\u4ef6\u3002';
const LIB_COUNT_SUFFIX = '\u9996\u5df2\u5165\u5e93';

// ==================== 布局与滚动参数 ====================
const ROW_PX = 72;                 // 单行固定高度（像素）
const RENDER_OVERSCAN_ROWS = 20;   // 视口上下额外预渲染的行数
const SEG_PAD_ROWS = 4;            // 每个分段在视口容量之外再补的行数
const SEG_MIN_BATCH = 20;          // 分段加载的单批下限
const LOAD_MORE_TRIGGER_ROWS = 10; // 距离底部多少行时触发追加分段
const SNAPSHOT_MAX_PATHS = 72;     // 封面快照最多记录多少条路径

// ==================== 在线歌曲下载状态 ====================
const savedStreamPaths = ref<Set<string>>(new Set());
const savedStreamFormats = ref<Map<string, string>>(new Map());
let savedQueryTicket = 0;

const isStreamSong = (song: Song) => {
  const p = song?.path ?? '';
  return p.startsWith('lx://') || p.startsWith('plugin://');
};

// 从文件名末尾取扩展名（大写）
const extOfLocalFile = (fileName: string) => {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toUpperCase();
};

// 重新汇总已下载的在线歌曲（带请求票号防竞态）
const refreshSavedDownloads = async (rows: Song[]) => {
  const ticket = ++savedQueryTicket;
  await loadDownloadHistory();
  if (ticket !== savedQueryTicket) return;

  const saved = new Set<string>();
  const exts = new Map<string, string>();
  rows.forEach((row) => {
    if (!isStreamSong(row)) return;
    const rec = getDownloadRecord(row.path);
    if (!rec) return;
    saved.add(row.path);
    const file = rec.fileName ?? (rec as { localPath?: string }).localPath ?? '';
    const ext = extOfLocalFile(file);
    if (ext) exts.set(row.path, ext);
  });
  savedStreamPaths.value = saved;
  savedStreamFormats.value = exts;
};

// 从歌曲名 / 路径里解析音频扩展名
const extFromName = (value: string | undefined) => {
  if (!value) return '';
  const base = value.split(/[\\/]/).pop() ?? '';
  const hit = /\.([A-Za-z0-9]+)$/.exec(base);
  return hit?.[1] ?? '';
};

const extLabelOf = (song: Song) => {
  const raw = song.format?.trim() || extFromName(song.name) || extFromName(song.path);
  return raw ? raw.replace(/^\./, '').toUpperCase() : '';
};

// ==================== 全局 store / 组合式依赖 ====================
const { settings: appPrefs } = useSettings();
const clickToPlayMode = computed(() => appPrefs.value.songClickAction || 'double');
const libraryStore = useLibraryStore(); // 实现
const {
  libraryScanProgress: scanProgress, lastLibraryScanError: lastScanError,
} = storeToRefs(libraryStore);
const {
  currentSong, isPlaying, formatDuration,
} = usePlaybackController();

const props = defineProps<{ // 实现
  selectedPaths: Set<string>;
  songs: Song[]; // 实现
  songPaths?: string[];
  resolveSongByPath?: (path: string) => Song | null;
  isBatchMode: boolean; // 实现
  memoryScopeKey: string; // 实现
  pageScrollMode?: boolean;
  scrollContainerRef?: HTMLElement | null;
  disableScrollMemory?: boolean;
  downloadCompletedAsLocal?: boolean;
  indexOffset?: number;
  songReasons?: Map<string, string>;
}>();

const emit = defineEmits<{ // 实现
  (e: 'play', song: Song): void; // 实现
  (e: 'contextmenu', event: MouseEvent, song: Song): void; // 实现
  (e: 'update:selectedPaths', newSet: Set<string>): void; // 实现
  (e: 'drag-start', payload: { event: PointerEvent; song: Song; index: number }): void; // 实现
  (e: 'load-more'): void;
}>();

const {
  currentViewMode, localSortMode, folderSortMode, activeRootPath, currentFolderFilter,
} = usePlayerViewState(); // 实现
const {
  folderTree, searchQuery: libSearchText, librarySongs: libSongs,
} = usePlayerLibraryView(); // 实现
const { addLibraryFolder, scanLibrary, refreshFolder, expandFolderPath } = useLibraryRuntimeActions();
const { isFavorite, toggleFavorite } = useLibraryCollections(); // 实现
const router = useRouter(); // 实现
const route = useRoute(); // 实现
const { openHomeArtist } = useHomeNavigation(router); // 实现
const {
  coverCache, loadCover, touchCoverPaths, preloadPriorityCovers, primeCoverPath,
} = useCoverCache();
const { loadSongDetail } = useSongDetailCache(); // 实现

const dlStore = useDownloadStore();
const isFetchingSong = (song: Song) =>
  dlStore.isDownloading && dlStore.downloadingSongPath === song.path;

const startSongDownload = (song: Song) => {
  if (!isDownloadableOnlineSong(song)) return;
  void downloadToLocal(song);
};

// ==================== 核心状态 ====================
const tableRootEl = ref<HTMLElement | null>(null);
const scrollBodyEl = ref<HTMLElement | null>(null);
const scrollPos = ref(0);
const viewportH = ref(600);
const hostOffset = ref(0);
const segRenderedRows = ref(0);
const scrollbarHot = ref(false);
const scrollbarBusy = ref(false);
const scrollbarAwake = computed(() => scrollbarHot.value || scrollbarBusy.value);
const coverUrlMap = reactive(new Map<string, string>());
const commentMemo = reactive(new Map<string, string>());
const pendingCommentPaths = new Set<string>();
let activeCoverPaths = new Set<string>();
let scrollbarHideTimer: number | null = null;

// 页面滚动模式下，实际滚动宿主可能是外层容器
const scrollHost = computed(() =>
  props.pageScrollMode ? (props.scrollContainerRef ?? null) : scrollBodyEl.value,
);

// 仅记忆三类路由的滚动位置
const normalizeMemoryRoute = (path: string) =>
  ['/', '/favorites', '/recent'].includes(path) ? path : '/'; // 实现
const memoryRoute = ref(normalizeMemoryRoute(route.path));

watch(
  () => route.path, // 实现
  (path) => {
    if (!['/', '/favorites', '/recent'].includes(path)) { // 实现
      return;
    }
    memoryRoute.value = path;
  },
  { immediate: true }, // 实现
);

// 视口容量 → 分段批量
const rowsPerViewport = () => Math.max(
  1,
  Math.ceil(viewportH.value / ROW_PX) + SEG_PAD_ROWS,
);
const segBatchRows = () => Math.max(
  SEG_MIN_BATCH,
  rowsPerViewport(),
);

// 滚动记忆键：路由 + 作用域 + 排序方式
const scrollMemoryKey = computed(() =>
  [
    'song-table',
    memoryRoute.value,
    props.memoryScopeKey,
    localSortMode.value,
    folderSortMode.value,
  ].join('::'),
);

// 回卷到首个分段
const rewindSegment = () => {
  segRenderedRows.value = Math.min(totalRows.value, segBatchRows());
  scrollPos.value = 0;
  // 页面滚动模式下若已有历史滚动缓存，则不强制归零
  if (props.pageScrollMode && listScrollCache.get(scrollMemoryKey.value) !== undefined) {
    return;
  }
  if (scrollHost.value) {
    scrollHost.value.scrollTop = 0;
  }
};

// 追加一个分段
const growSegment = () => {
  if (segRenderedRows.value >= totalRows.value) return;
  segRenderedRows.value = Math.min(
    totalRows.value,
    segRenderedRows.value + segBatchRows(),
  );
};

// 保证至少铺满一个分段
const fillSegmentFloor = () => {
  if (segRenderedRows.value === 0 && totalRows.value > 0) {
    rewindSegment();
    return;
  }
  if (segRenderedRows.value < segBatchRows()) {
    segRenderedRows.value = Math.min(totalRows.value, segBatchRows());
  }
};

// 数据源总行数（优先使用路径列表）
const totalRows = computed(() => props.songPaths?.length ?? props.songs.length);

// 当前已渲染分段对应的歌曲数组
const segSongs = computed<Song[]>(() => {
  if (totalRows.value === 0) return [];
  const limit = segRenderedRows.value || rowsPerViewport();
  const cut = Math.min(totalRows.value, limit);

  if (props.songPaths && props.resolveSongByPath) {
    return props.songPaths
      .slice(0, cut)
      .map(path => props.resolveSongByPath?.(path) ?? null)
      .filter((song): song is Song => !!song);
  }
  return props.songs.slice(0, cut);
});

// 监听数据源变化：识别“追加”与“重置”两种形态
let lastLen = -1;
let lastHead = '';
let lastTail = '';
watch(() => props.songPaths ?? props.songs, (rows) => {
  const len = rows.length;
  const headRaw = len > 0 ? rows[0] : '';
  const tailRaw = len > 0 ? rows[len - 1] : '';
  const headKey = typeof headRaw === 'string' ? headRaw : headRaw?.path ?? '';
  const tailKey = typeof tailRaw === 'string' ? tailRaw : tailRaw?.path ?? '';

  if (len === lastLen && headKey === lastHead && tailKey === lastTail) {
    return;
  }

  const appending = len > lastLen && headKey === lastHead && lastLen >= 0;
  lastLen = len;
  lastHead = headKey;
  lastTail = tailKey;

  if (appending) {
    segRenderedRows.value = Math.min(totalRows.value, Math.max(segRenderedRows.value, segBatchRows()));
  } else {
    rewindSegment();
  }
  savedStreamPaths.value = new Set();
  savedStreamFormats.value = new Map();
}, { immediate: true });

// ==================== 封面 / 评论 / 推荐理由 ====================
const coverUrlFor = (path: string | undefined) => {
  if (!path) { // 实现
    return '';
  }
  const raw = coverUrlMap.get(path) ?? coverCache.get(path) ?? '';
  if (!raw) {
    return '';
  }
  return getDisplayCoverUrl(raw, (dataUrl) => {
    coverUrlMap.set(path, dataUrl);
  });
};

// 在线封面直链被防盗链拦截时（WebView2 默认携带 tauri.localhost Referer），
// 降级走 Rust 图片代理重试，与 OnlineSongList 的处理保持一致
const handleCoverError = (e: Event) => {
  const img = e.target as HTMLImageElement;
  const src = img.src;
  if (!src || src.startsWith('data:')) return;
  const host = img.closest('[data-cover-path]') as HTMLElement | null;
  const path = host?.dataset.coverPath;
  void tryProxyImage(src).then((dataUrl) => {
    if (dataUrl && path) {
      coverUrlMap.set(path, dataUrl);
    }
  });
};

const commentOf = (song: Song) =>
  song.comment?.trim() || commentMemo.get(song.path)?.trim() || '';

const showsComment = (song: Song) =>
  appPrefs.value.showSongComments && commentOf(song).length > 0;

const reasonOf = (song: Song) => props.songReasons?.get(song.path)?.trim() || '';

// 预取视口内歌曲的详情评论
const prefetchComments = (rows: Song[]) => {
  if (!appPrefs.value.showSongComments) {
    return;
  }
  rows.forEach((song) => {
    const p = song.path;
    if (!p || song.comment?.trim() || commentMemo.has(p) || pendingCommentPaths.has(p)) {
      return;
    }
    pendingCommentPaths.add(p);
    void loadSongDetail(p)
      .then((detail) => { // 实现
        commentMemo.set(p, detail?.comment?.trim() ?? '');
      })
      .catch(() => { // 实现
        commentMemo.set(p, '');
      })
      .finally(() => { // 实现
        pendingCommentPaths.delete(p);
      });
  });
};

const readScrollTop = () => {
  if (scrollHost.value) {
    scrollPos.value = scrollHost.value.scrollTop;
  }
};

const measureViewport = () => {
  if (scrollHost.value) {
    viewportH.value = scrollHost.value.clientHeight;
  }
  fillSegmentFloor();
};

// 页面滚动模式下测量列表相对滚动宿主的偏移
const trackHostOffset = () => {
  const inner = scrollBodyEl.value;
  const outer = scrollHost.value;
  if (props.pageScrollMode && inner && outer && inner !== outer) {
    hostOffset.value = Math.max(0, inner.getBoundingClientRect().top - outer.getBoundingClientRect().top);
  } else {
    hostOffset.value = 0;
  }
};

// 重放已缓存的视口封面快照
const replayCoverSnapshot = (key = scrollMemoryKey.value) => {
  if (!key) {
    return;
  }
  const snap = songTableViewportCoverSnapshotCache.get(key);
  if (!snap || snap.length === 0) {
    return;
  }
  preloadPriorityCovers(snap);
};

// 同步可见行的封面地址（缓存 → 持久化 → 异步加载）
const applyCoverUrls = (rows: Song[]) => {
  const live = new Set(rows.map(song => song.path).filter(Boolean));
  activeCoverPaths = live;

  Array.from(coverUrlMap.keys()).forEach((p) => {
    if (!live.has(p)) {
      coverUrlMap.delete(p);
    }
  });

  touchCoverPaths(Array.from(live));

  rows.forEach((song) => {
    const p = song.path;
    if (!p) {
      return;
    }
    const hit = coverCache.get(p);
    if (hit) {
      coverUrlMap.set(p, hit);
      return;
    }
    const seeded = primeCoverPath(p, song.cover_thumb_path || (song as any).coverUrl);
    if (seeded) {
      coverUrlMap.set(p, seeded);
      return;
    }
    void loadCover(p).then((url) => {
      if (!url || !activeCoverPaths.has(p)) {
        return;
      }
      coverUrlMap.set(p, url);
    });
  });
};

const warmViewportCovers = () => {
  applyCoverUrls(rowsForRender.value);
  preloadPriorityCovers(rowsForRender.value.map(song => song.path));
};

// 恢复滚动位置后重放封面与量高（含一帧后的二次校准）
const resumeViewportState = async () => {
  await regainScrollPos();
  await nextTick(); // 实现
  readScrollTop();
  measureViewport();
  replayCoverSnapshot();
  warmViewportCovers();

  requestAnimationFrame(() => { // 实现
    readScrollTop();
    measureViewport();
    replayCoverSnapshot();
    warmViewportCovers();
  });
};

// 记录当前视口（含上下缓冲一屏）内的封面路径快照
const stashCoverSnapshot = (key = scrollMemoryKey.value) => {
  if (!key || !scrollHost.value) {
    return;
  }
  const host = scrollHost.value;
  const box = host.getBoundingClientRect();
  const pad = host.clientHeight;
  const topEdge = box.top - pad;
  const bottomEdge = box.bottom + pad;
  const picked: string[] = [];
  const seen = new Set<string>();

  host.querySelectorAll<HTMLElement>('[data-cover-path]').forEach((el) => {
    if (picked.length >= SNAPSHOT_MAX_PATHS) {
      return;
    }
    const p = el.dataset.coverPath;
    if (!p || seen.has(p)) {
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.bottom < topEdge || rect.top > bottomEdge) {
      return;
    }
    if (!coverUrlMap.get(p) && !coverCache.get(p)) {
      return;
    }
    seen.add(p);
    picked.push(p);
  });

  if (picked.length > 0) {
    songTableViewportCoverSnapshotCache.set(key, picked);
    return;
  }
  songTableViewportCoverSnapshotCache.delete(key); // 实现
};

// 滚动位置记忆
const {
  saveScrollPosition: stashScrollPos,
  restoreScrollPosition: regainScrollPos,
} = useListScrollMemory(scrollMemoryKey, scrollHost, { disabled: props.disableScrollMemory });

// 页面滚动模式下，数据就绪后尝试恢复历史滚动位置
watch(
  () => (props.pageScrollMode ? totalRows.value : -1),
  (count) => {
    if (props.pageScrollMode && count > 0 && listScrollCache.get(scrollMemoryKey.value) !== undefined) {
      void regainScrollPos();
    }
  },
);

// ==================== 虚拟滚动窗口计算 ====================
const viewportData = computed(() => {
  const rows = Array.isArray(segSongs.value) ? segSongs.value : [];
  const count = rows.length;
  const first = Math.floor(scrollPos.value / ROW_PX);
  const visible = Math.ceil(viewportH.value / ROW_PX);
  const from = Math.max(0, first - RENDER_OVERSCAN_ROWS);
  const to = Math.min(count, first + visible + RENDER_OVERSCAN_ROWS);

  return {
    items: rows.slice(from, to).map((song, i) => ({
      ...song,
      virtualIndex: from + i + (props.indexOffset ?? 0),
    })),
    paddingTop: from * ROW_PX,
    paddingBottom: (count - to) * ROW_PX,
  };
});

const virtualPadTop = computed(() => `${viewportData.value?.paddingTop ?? 0}px`);
const virtualPadBottom = computed(() => `${viewportData.value?.paddingBottom ?? 0}px`);
const rowsForRender = computed(() => viewportData.value?.items ?? []);

// ==================== 滚动条热区与滚动联动 ====================
const stopScrollbarTimer = () => {
  if (scrollbarHideTimer !== null) {
    window.clearTimeout(scrollbarHideTimer);
    scrollbarHideTimer = null;
  }
};

const wakeScrollbar = () => {
  scrollbarBusy.value = true;
  stopScrollbarTimer();
  scrollbarHideTimer = window.setTimeout(() => {
    scrollbarBusy.value = false;
    scrollbarHideTimer = null;
  }, 900);
};

const probeScrollbarZone = (event: MouseEvent | PointerEvent) => {
  if (!scrollHost.value) {
    scrollbarHot.value = false;
    return;
  }
  scrollbarHot.value = isPointerNearVerticalScrollbar(
    event.clientX,
    scrollHost.value.getBoundingClientRect(),
    DEFAULT_SCROLLBAR_HOT_ZONE_PX,
  );
};

const handleScrollEvent = (event: Event) => {
  const el = event.target as HTMLElement;
  scrollPos.value = el.scrollTop;
  trackHostOffset();
  // 接近底部时先补分段，分段耗尽再请求外部加载更多
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_PX * LOAD_MORE_TRIGGER_ROWS) {
    growSegment();
    if (segRenderedRows.value >= totalRows.value) {
      emit('load-more');
    }
  }
  wakeScrollbar();
};

// ==================== 字母索引导航 ====================
const {
  showAlphabetIndex: showAlphaRail,
  firstSongIndexByKey: railFirstKeys,
  activeIndexKey: railActiveKey,
  indexBarRef: railBarRef,
  isIndexDragging: railDragging,
  dragIndexKey: railDragKey,
  hoverIndexKey: railHoverKey,
  isIndexBarVisible: railShown,
  canLocateCurrentSong: canLocateNow,
  showLocateCurrentSongButton: showLocateFab,
  showScrollToTopButton: showTopFab,
  handleIndexHotspotEnter: onRailHotspotEnter,
  handleIndexHotspotMove: onRailHotspotMove,
  handleIndexHotspotLeave: onRailHotspotLeave,
  handleRootMouseMove: onRootMouseMove,
  handleRootMouseLeave: onRootMouseLeave,
  handleIndexPointerDown: onRailPointerDown,
  showIndexBar: wakeRail,
  scrollToCurrentSong: jumpToNowPlaying,
  scrollToTop: jumpToTop,
} = useSongTableAlphabetIndex({ // 实现
  songs: segSongs,
  scrollTop: scrollPos,
  containerHeight: viewportH,
  containerRef: scrollHost,
  rootRef: tableRootEl,
  routePath: computed(() => route.path), // 实现
  currentViewMode, // 实现
  localSortMode, // 实现
  folderSortMode, // 实现
  activeRootPath, // 实现
  currentFolderFilter, // 实现
  folderTree,
  refreshFolder, // 实现
  expandFolderPath, // 实现
  listOffsetTop: hostOffset,
});

const railFloatClass = computed(() => (railShown.value
  ? 'opacity-100 translate-x-0 pointer-events-auto'
  : 'opacity-0 translate-x-2 pointer-events-none'));

const onTablePointerMove = (event: PointerEvent) => {
  onRootMouseMove(event);
  probeScrollbarZone(event);
};

const onTableMouseLeave = () => {
  onRootMouseLeave();
  scrollbarHot.value = false;
  scrollbarBusy.value = false;
  stopScrollbarTimer();
};

// 外层滚动容器切换时重挂滚动监听
watch(
  () => props.scrollContainerRef,
  (el, oldEl) => {
    if (oldEl) oldEl.removeEventListener('scroll', handleScrollEvent);
    if (el) {
      el.addEventListener('scroll', handleScrollEvent, { passive: true });
      trackHostOffset();
    }
  },
  { immediate: true }, // 实现
);

// 视口行变化 → 同步封面 / 预取 / 预热 / 下载标记
watch(
  () => viewportData.value.items,
  (items) => {
    applyCoverUrls(items);
    preloadPriorityCovers(items.map(song => song.path));
    prefetchComments(items);
    void refreshSavedDownloads(items);
  },
  { immediate: true }, // 实现
);

// 打开评论展示开关时补拉一次
watch(
  () => appPrefs.value.showSongComments,
  (enabled) => {
    if (enabled) {
      prefetchComments(rowsForRender.value);
    }
  },
);

// 记忆键切换：存旧快照、取新快照
watch(
  scrollMemoryKey,
  (newKey, oldKey) => { // 实现
    if (oldKey && oldKey !== newKey) { // 实现
      stashCoverSnapshot(oldKey);
    }
    replayCoverSnapshot(newKey);
  },
  { immediate: true }, // 实现
);

// ==================== 行为处理 ====================
const triggerPlay = (song: Song) => {
  if (currentSong.value?.path === song.path && isPlaying.value) {
    return;
  }
  void launchFlyingCover(song.path, coverUrlFor(song.path));
  emit('play', song);
};

const onRowClick = (song: Song) => {
  if (!props.isBatchMode && clickToPlayMode.value === 'single') {
    triggerPlay(song);
  }
};

const onRowDblClick = (song: Song) => {
  if (!props.isBatchMode && clickToPlayMode.value !== 'single') {
    triggerPlay(song);
  }
};

const onRowContext = (event: MouseEvent, song: Song) => {
  emit('contextmenu', event, song);
};

const onRowPointerDown = (event: PointerEvent, song: Song, index: number) => {
  if (event.pointerType === 'mouse' && event.button !== 0) { // 实现
    return;
  }
  emit('drag-start', { event, song, index }); // 实现
};

// 仅部分视图允许拖拽排序
const dragChipVisible = computed(() => {
  if (route.path === '/search' || route.path === '/online-detail') return false;
  return ['folder', 'playlist', 'all', 'artist', 'album', 'genre', 'year'].includes(currentViewMode.value);
});

const {
  showHeroScanCard: heroCardVisible,
  hasSearchQuery: queryActive,
  showLibraryOnboarding: needOnboarding,
  showFolderEmpty: folderIsEmpty,
  showLibraryChecking: scanChecking,
  showLibraryEmptyResult: scanEmptyResult,
  libraryScanPercent: scanPercentRaw,
  libraryScanPhaseLabel: heroPhaseLabel,
  libraryScanFolderLabel: scanFolderHint,
  heroScanStatus: scanStatus,
  emptyStateMessage: emptyStateText,
  retryHeroLibraryScan: redoScan,
} = useSongTableLibraryState({ // 实现
  currentViewMode, // 实现
  searchQuery: libSearchText,
  librarySongs: libSongs,
  addLibraryFolder, // 实现
  scanLibrary, // 实现
});

// 英雄卡文案与百分比
const heroTitle = computed(() => {
  if (scanStatus.value === 'error') {
    return HERO_TITLE_INTERRUPTED;
  }
  if (scanStatus.value === 'success') {
    return libSongs.value.length > 0 ? HERO_TITLE_DONE : HERO_TITLE_NO_SONGS;
  }
  return HERO_TITLE_PENDING;
});

const heroPercent = computed(() => {
  if (scanStatus.value === 'success') {
    return 100;
  }
  return Math.round(scanPercentRaw.value);
});

const heroPercentLabel = computed(() => `${heroPercent.value}%`);

const heroNote = computed(() => {
  const progress = scanProgress.value;
  if (progress && progress.total > 0) { // 实现
    return `${progress.current} / ${progress.total}`; // 实现
  }
  if (scanStatus.value === 'success') {
    return libSongs.value.length > 0 ? `${libSongs.value.length} ${LIB_COUNT_SUFFIX}` : HERO_NOTE_NO_SONGS;
  }
  if (scanStatus.value === 'error') {
    return HERO_NOTE_INTERRUPTED;
  }
  return heroPhaseLabel.value;
});

const heroDetail = computed(() => {
  const progress = scanProgress.value;
  if (progress && progress.total > 0) { // 实现
    const folderPath = progress.folder_path?.trim(); // 实现
    return folderPath || heroPhaseLabel.value;
  }
  if (scanStatus.value === 'success') {
    return HERO_DETAIL_DONE;
  }
  if (scanStatus.value === 'error') {
    return HERO_DETAIL_ERROR;
  }
  return scanFolderHint.value || HERO_DETAIL_PREP;
});

// 空态文案
const emptyHint = computed(() =>
  needOnboarding.value ? ONBOARDING_HINT : emptyStateText.value);
const checkingTitle = CHECKING_TITLE;
const checkingDesc = CHECKING_DESC;
const emptyScanTitle = computed(() =>
  lastScanError.value ? SCAN_FAIL_TITLE : SCAN_EMPTY_TITLE);
const emptyScanDesc = computed(() =>
  lastScanError.value ? SCAN_FAIL_DESC : SCAN_EMPTY_DESC);

// 歌手名集合：优先使用拆分后的多歌手字段
const artistChips = (song: Song) =>
  (Array.isArray(song.artist_names) && song.artist_names.length > 0 ? song.artist_names : [song.artist]).filter(Boolean); // 实现

const gotoArtist = (artistName: string) => {
  void openHomeArtist(artistName); // 实现
};

// 行内格式列文案：已下载为本地时显示真实容器格式
const formatCellOf = (song: Song) => {
  if (props.downloadCompletedAsLocal && savedStreamPaths.value.has(song.path)) {
    return savedStreamFormats.value.get(song.path) || extLabelOf(song);
  }
  return extLabelOf(song);
};

// 下载图标悬浮文案
const downloadingTitle = () => `下载中 ${Math.floor(dlStore.progress)}%`;
const savedTitleOf = (song: Song) => `已下载：${song.title || song.name}`;
const fetchTitleOf = (song: Song) => `下载：${song.title || song.name}`;

// 标题列：无 title 时回退到去除扩展名的文件名
const titleTextOf = (song: Song) => song.title || song.name.replace(/\.[^/.]+$/, '');

// 序号不足两位时补 0
const padRowIndex = (idx: number) => (idx + 1 < 10 ? `0${idx + 1}` : idx + 1);

// ==================== 生命周期 ====================
onMounted(() => { // 实现
  window.addEventListener('resize', measureViewport);
  measureViewport();
  fillSegmentFloor();
  void resumeViewportState();
});

onActivated(() => { // 实现
  fillSegmentFloor();
  void resumeViewportState();
});

onDeactivated(() => { // 实现
  stashScrollPos();
  stashCoverSnapshot();
});

onBeforeUnmount(() => { // 实现
  const host = scrollHost.value;
  // 页面滚动模式下宿主已回到顶部时无需重复记忆
  if (!(props.pageScrollMode && host && host.scrollTop === 0)) {
    stashScrollPos();
  }
  stashCoverSnapshot();
  stopScrollbarTimer();
  coverUrlMap.clear();
  commentMemo.clear();
  pendingCommentPaths.clear();
  activeCoverPaths = new Set<string>();
});

onUnmounted(() => { // 实现
  window.removeEventListener('resize', measureViewport);
});

defineExpose({ containerRef: scrollBodyEl });

// ==================== 拖拽排序的行位移动画 ====================
const draggingPath = computed(() => {
  if (!dragSession.active || !dragSession.songs.length) return '';
  return dragSession.songs[0]?.path ?? '';
});

const draggingPos = computed(() => {
  if (!draggingPath.value) return -1;
  if (props.songPaths) {
    return props.songPaths.findIndex(p => p === draggingPath.value);
  }
  return props.songs.findIndex(song => song.path === draggingPath.value);
});

const DRAG_EASE = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)';

const rowShiftStyle = (rowIdx: number, rowPath: string): Record<string, string | number> => {
  const base: Record<string, string | number> = { height: `${ROW_PX}px` };

  if (!dragSession.active || dragSession.insertIndex === -1) { // 实现
    return base;
  }

  const fromIdx = draggingPos.value;
  const toIdx = dragSession.insertIndex;

  // 被拖拽行本身：按插入点位移并隐藏
  if (rowPath === draggingPath.value) {
    return {
      ...base,
      transform: `translateY(${(toIdx - fromIdx) * 100}%)`,
      transition: DRAG_EASE,
      opacity: 0,
      zIndex: 0,
    };
  }

  // 其余行：落在受影响区间内的让出位置
  let shift = 0;
  if (toIdx > fromIdx && rowIdx > fromIdx && rowIdx <= toIdx) {
    shift = -100;
  }
  if (toIdx < fromIdx && rowIdx >= toIdx && rowIdx < fromIdx) {
    shift = 100;
  }

  if (shift !== 0) {
    return {
      ...base,
      transform: `translateY(${shift}%)`,
      transition: DRAG_EASE,
      zIndex: 1,
    };
  }

  return {
    ...base,
    transition: DRAG_EASE,
  };
};
</script>

<template>
  <div
    ref="tableRootEl"
    class="relative min-w-0 overflow-x-auto"
    :class="{ 'flex-1 min-h-0': !pageScrollMode }"
    @mouseleave="onTableMouseLeave"
    @pointermove="onTablePointerMove"
  >
    <div
      ref="scrollBodyEl"
      class="overflow-x-auto pb-8 pl-2.5 custom-scrollbar song-list-scroll-container"
      :class="{
        'song-list-scrollbar-active': scrollbarAwake,
        'h-full overflow-y-auto': !pageScrollMode,
      }"
      @scroll="handleScrollEvent"
    >
      <div class="relative w-full">
        <div :style="{ height: virtualPadTop }"></div>

        <div
          v-for="song in rowsForRender"
          :key="song.path" 
          class="group relative flex w-full min-w-[580px] items-center gap-3 border-b border-black/5 pl-2 pr-6 [touch-action:none] select-none cursor-default hover:bg-black/5 dark:border-white/5 dark:hover:bg-white/5"
          :class="{ 'bg-red-500/10 dark:bg-red-500/20': selectedPaths.has(song.path) }"
          :style="rowShiftStyle(song.virtualIndex, song.path)"
          :data-index="song.virtualIndex" 
          @pointerdown="onRowPointerDown($event, song, song.virtualIndex)"
          @click="onRowClick(song)"
          @dblclick="onRowDblClick(song)"
          @contextmenu.prevent="onRowContext($event, song)"
          @dragstart.prevent 
        >
          <!-- 序号 / 播放状态 / 批量勾选 -->
          <div class="w-10 flex shrink-0 items-center justify-center">
            <div v-if="isBatchMode" class="flex items-center justify-center"> 
              <input
                type="checkbox"
                class="rounded text-[#EC4141] focus:ring-[#EC4141] pointer-events-none"
                :checked="selectedPaths.has(song.path)"
              />
            </div>
            <div v-else-if="currentSong?.path === song.path && isPlaying" class="flex w-5 h-5 items-center justify-center gap-[3px]">
              <span style="animation-delay: 0s" class="spectrum-bar w-[3px] rounded-full bg-[#EC4141]"></span>
              <span style="animation-delay: 0.2s" class="spectrum-bar w-[3px] rounded-full bg-[#EC4141]"></span>
              <span style="animation-delay: 0.4s" class="spectrum-bar w-[3px] rounded-full bg-[#EC4141]"></span>
            </div>
            <div v-else-if="currentSong?.path === song.path && !isPlaying" class="flex w-5 h-5 items-center justify-center gap-[3px]">
              <span class="w-[3px] rounded-full h-[6px] bg-[#EC4141]/60"></span>
              <span class="w-[3px] rounded-full h-[10px] bg-[#EC4141]/60"></span>
              <span class="w-[3px] rounded-full h-[4px] bg-[#EC4141]/60"></span>
            </div>
            <div v-else class="relative flex w-5 h-5 items-center justify-center">
              <span class="absolute inset-0 flex items-center justify-center text-xs font-mono text-gray-400 transition-opacity duration-150 group-hover:opacity-0 dark:text-white/40">
                {{ padRowIndex(song.virtualIndex) }}
              </span>
              <div class="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100"> 
                <span v-if="dragChipVisible" class="text-gray-500 cursor-grab active:text-[#EC4141] dark:text-white/60">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 12h16M4 18h16" /> 
                  </svg>
                </span>
                <span v-else class="text-gray-500 cursor-pointer hover:text-[#EC4141] dark:text-white/60" @click.stop="triggerPlay(song)" @dblclick.stop.prevent>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" class="h-5 w-5" fill="currentColor">
                    <path clip-rule="evenodd" fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
                  </svg>
                </span>
              </div>
            </div>
          </div>

          <!-- 封面 -->
          <div
            class="w-12 h-12 flex items-center justify-center shrink-0 overflow-hidden rounded-lg bg-gray-200/50 relative border border-black/5 text-gray-400 dark:bg-white/5 dark:text-white/40 dark:border-white/5"
            :data-cover-path="song.path"
          >
            <img
              v-if="coverUrlFor(song.path)"
              :src="coverUrlFor(song.path)"
              class="w-full h-full object-cover transition-opacity duration-300"
              alt="Cover"
              decoding="async"
              referrerpolicy="no-referrer"
              @error="handleCoverError"
            />
            <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-5 w-5 opacity-40 absolute inset-0 m-auto" fill="none" stroke="currentColor">
              <path d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
            </svg>
          </div>

          <!-- 标题 + 评论 + 推荐理由 + 歌手 -->
          <div class="flex-[1_1_40%] flex max-w-[44%] min-w-[100px] flex-col justify-center gap-0.5">
            <div class="flex min-w-0 items-baseline gap-1.5 leading-snug">
              <span class="truncate min-w-0 text-[15px] text-gray-900 font-semibold dark:text-gray-100">{{ titleTextOf(song) }}</span>
              <span
                v-if="showsComment(song)"
                class="max-w-[42%] shrink-0 truncate text-xs font-medium text-gray-500 dark:text-white/45" 
                :title="commentOf(song)"
              >（{{ commentOf(song) }}）</span>
              <span
                v-if="reasonOf(song)"
                class="max-w-[42%] shrink-0 truncate text-xs font-medium text-[#EC4141]/75 dark:text-[#EC4141]/60"
                :title="reasonOf(song)"
              >（{{ reasonOf(song) }}）</span>
            </div>
            <div class="flex items-center gap-1.5 text-xs text-gray-900 leading-snug dark:text-gray-100">
              <span v-if="currentViewMode === 'album'" class="truncate flex flex-wrap items-center gap-1" :title="song.artist">
                <template v-for="(artistName, artistIndex) in artistChips(song)" :key="`${song.path}-${artistName}`">
                  <button type="button" class="truncate transition-colors hover:text-[#EC4141]" @click.stop="gotoArtist(artistName)">{{ artistName }}</button>
                  <span v-if="artistIndex < artistChips(song).length - 1" class="opacity-60">/</span>
                </template>
              </span>
              <span v-else class="truncate" :title="song.artist">{{ song.artist }}</span>
            </div>
          </div>

          <!-- 专辑 -->
          <div :title="song.album" class="truncate flex-1 min-w-[9rem] text-xs text-gray-900 dark:text-gray-100">{{ song.album }}</div>

          <!-- 格式 + 下载状态 -->
          <div class="w-16 flex shrink-0 items-center justify-center gap-1 text-center text-xs font-mono text-gray-500 dark:text-white/50">
            <span class="truncate min-w-0" :title="formatCellOf(song)">{{ formatCellOf(song) }}</span>
            <template v-if="isStreamSong(song)">
              <div
                v-if="isFetchingSong(song)"
                class="relative w-5 h-5 shrink-0 text-[#EC4141]"
                :title="downloadingTitle()"
              >
                <svg class="w-full h-full -rotate-90" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-opacity="0.15" stroke-width="4" />
                  <circle
                    cx="10" cy="10" r="7" fill="none" stroke="currentColor"
                    stroke-width="4" stroke-linecap="round"
                    :stroke-dasharray="43.98"
                    :stroke-dashoffset="43.98 * (1 - dlStore.progress / 100)"
                    class="transition-[stroke-dashoffset] duration-150"
                  />
                </svg>
              </div>
              <CircleCheck
                v-else-if="!downloadCompletedAsLocal && savedStreamPaths.has(song.path)"
                class="w-4 h-4 shrink-0 text-emerald-500"
                :title="savedTitleOf(song)"
              />
              <button
                v-else-if="!savedStreamPaths.has(song.path)"
                type="button"
                class="shrink-0 text-gray-400 transition-colors cursor-pointer hover:text-[#EC4141] dark:text-white/40"
                :title="fetchTitleOf(song)"
                @click.stop="startSongDownload(song)"
              >
                <Download class="w-3.5 h-3.5" />
              </button>
            </template>
          </div>

          <!-- 收藏 + 时长 -->
          <div class="flex shrink-0 items-center gap-3 text-xs font-mono text-gray-900 dark:text-gray-100" :class="{ 'pointer-events-none opacity-20': dragSession.active }">
            <button v-if="!isBatchMode" class="focus:outline-none" @click.stop="toggleFavorite(song)">
              <svg v-if="isFavorite(song)" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" class="h-4 w-4 text-[color:var(--favorite-color)]" fill="currentColor">
                <path clip-rule="evenodd" fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" />
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 hover:text-gray-600 dark:text-white/40 dark:hover:text-white" fill="none" stroke="currentColor">
                <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
              </svg>
            </button>
            <span class="w-10 text-right">{{ formatDuration(song.duration) }}</span> 
          </div>

          <!-- 来源标签 -->
          <div class="w-16 flex shrink-0 items-center justify-center">
            <span
              v-if="isStreamSong(song) && !(downloadCompletedAsLocal && savedStreamPaths.has(song.path))"
              class="max-w-full truncate rounded-full border border-[#EC4141]/20 bg-[#EC4141]/10 px-1.5 py-[1px] text-[10px] font-bold text-[#EC4141]"
              :title="getSongSourceTag(song).label"
            >{{ getSongSourceTag(song).label }}</span>
            <span
              v-else
              class="whitespace-nowrap rounded-full border border-[#EC4141]/20 bg-[#EC4141]/10 px-1.5 py-[1px] text-[10px] font-bold text-[#EC4141]"
            >本地</span>
          </div>
        </div>

        <div :style="{ height: virtualPadBottom }"></div>
      </div>

      <!-- 空态 -->
      <div v-if="totalRows === 0" class="py-20 flex flex-col justify-center items-center select-none text-gray-500 dark:text-white/60">
        <template v-if="needOnboarding || folderIsEmpty || queryActive">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-16 h-16 mb-4 text-gray-300 dark:text-white/20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M4 7.25a2 2 0 012-2h3.35c.52 0 1.02.2 1.4.56l1.1 1.04c.38.36.88.56 1.4.56H18a2 2 0 012 2v7.35a2 2 0 01-2 2H6a2 2 0 01-2-2V7.25z" />
            <path d="M14.5 13.2V9.8l3.4-.7v3.4" />
            <circle r="1.45" cx="12.8" cy="13.6" />
            <circle r="1.45" cx="16.2" cy="12.9" />
          </svg>
          <p class="mb-6 text-[15px]">{{ emptyHint }}</p>
          <button v-if="needOnboarding" class="flex items-center gap-2 px-6 py-2.5 bg-[#EC4141] text-white hover:bg-[#b92f2f] rounded-full text-[14px] font-medium transition-colors shadow-sm" @click="addLibraryFolder">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            &#28155;&#21152;&#26412;&#22320;&#38899;&#20048;</button>
        </template>
        <template v-else-if="scanChecking">
          <div class="flex h-14 w-14 items-center justify-center rounded-full bg-white/70 shadow-[0_10px_30px_rgba(15,23,42,0.08)] dark:bg-white/10"> 
            <div class="h-6 w-6 rounded-full border-2 border-[#ec4141]/25 border-t-[#ec4141] scan-spinner"></div> 
          </div>
          <p class="mt-5 text-[15px] font-medium text-gray-700 dark:text-white/80">{{ checkingTitle }}</p>
          <p class="mt-2 text-[13px] opacity-70">{{ checkingDesc }}</p>
        </template>
        <template v-else-if="scanEmptyResult">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-16 h-16 mb-4 text-gray-300 dark:text-white/20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M4 7.25a2 2 0 012-2h3.35c.52 0 1.02.2 1.4.56l1.1 1.04c.38.36.88.56 1.4.56H18a2 2 0 012 2v7.35a2 2 0 01-2 2H6a2 2 0 01-2-2V7.25z" />
            <path d="M14.5 13.2V9.8l3.4-.7v3.4" />
            <circle r="1.45" cx="12.8" cy="13.6" />
            <circle r="1.45" cx="16.2" cy="12.9" />
          </svg>
          <p class="mb-2 text-[15px]">{{ emptyScanTitle }}</p>
          <p class="text-[13px] opacity-70"> 
            {{ emptyScanDesc }}
          </p>
        </template>
        <template v-else-if="currentViewMode === 'playlist'"> 
          <p>{{ emptyStateText }}</p>
        </template>
        <template v-else> 
          <p>{{ emptyStateText }}</p>
        </template>
      </div>
    </div>

    <!-- 扫描英雄卡 -->
    <Teleport to="body"> 
      <transition name="library-hero"> 
        <div v-if="heroCardVisible" class="library-hero-overlay">
          <div :class="'library-hero-backdrop'"></div>

          <div class="library-hero-card" :class="`library-hero-card-${scanStatus}`">
            <p class="library-hero-phase">{{ heroPhaseLabel }}</p>
            <h3 class="library-hero-title">{{ heroTitle }}</h3>

            <div class="library-hero-progress-track"> 
              <div
                class="library-hero-progress-fill" 
                :class="{ 'scan-progress-indeterminate': scanProgress && scanProgress.total <= 0 && scanStatus === 'scanning' }"
                :style="{ width: `${heroPercent}%` }"
              ></div>
            </div>

            <div class="library-hero-progress-meta"> 
              <span class="library-hero-progress-note" :title="heroDetail">{{ heroDetail }}</span>
              <span class="library-hero-progress-value">{{ heroNote }} &middot; {{ heroPercentLabel }}</span>
            </div>

            <div v-if="scanStatus === 'error'" class="library-hero-actions">
              <button type="button" class="hero-primary-btn" @click="redoScan">&#37325;&#26032;&#25195;&#25551;</button>
              <button type="button" class="hero-secondary-btn" @click="addLibraryFolder">&#37325;&#26032;&#36873;&#25321;&#25991;&#20214;&#22841;</button> 
            </div>
          </div>
        </div>
      </transition> 
    </Teleport>

    <!-- 字母索引导航 -->
    <div v-if="showAlphaRail" class="pointer-events-none absolute inset-y-0 right-0 z-20 flex w-16 items-center justify-end pr-3">
      <div
        class="flex flex-col items-center gap-2 transition-all duration-300 ease-out" 
        :class="railFloatClass"
        @mouseenter="onRailHotspotEnter"
        @mousemove="onRailHotspotMove"
        @mouseleave="onRailHotspotLeave"
      >
        <div
          ref="railBarRef"
          class="flex flex-col items-center gap-[1px] rounded-full bg-white px-1 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.08)] dark:bg-black" 
        >
          <button
            v-for="key in INDEX_KEYS" 
            :key="key"
            type="button" 
            class="index-nav-item" 
            :class="{
              'index-nav-item-active': railActiveKey === key,
              'index-nav-item-hover': railHoverKey === key && railActiveKey !== key && railDragKey !== key,
              'index-nav-item-drag': railDragKey === key && railActiveKey !== key,
              'index-nav-item-disabled': !railFirstKeys.has(key),
            }"
            :disabled="!railFirstKeys.has(key)"
            @mouseenter="railHoverKey = key; wakeRail()"
            @mouseleave="railHoverKey = null"
            @pointerdown="onRailPointerDown($event, key)"
          >{{ key }}</button>
        </div>
      </div>
    </div>

    <!-- 回顶 / 定位悬浮按钮 -->
    <Teleport
      :disabled="!pageScrollMode || !scrollContainerRef"
      :to="scrollContainerRef"
    >
      <div class="grid grid-cols-[36px_36px] gap-3" :class="pageScrollMode ? 'sticky bottom-6 z-[60] ml-auto mr-6 w-fit' : 'absolute right-6 bottom-6 z-30'">
        <div class="h-9 w-9">
          <transition name="locate-fab">
            <button
              v-if="appPrefs.enableScrollToTopButton && showTopFab"
              type="button"
              title="回到顶部"
              class="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200/50 bg-white/80 text-gray-500 shadow-[0_4px_16px_rgba(0,0,0,0.08)] backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:text-[#ec4141] hover:shadow-[0_6px_20px_rgba(0,0,0,0.12)] cursor-pointer dark:border-white/10 dark:bg-black/50 dark:text-gray-400 dark:shadow-[0_4px_16px_rgba(0,0,0,0.3)] dark:hover:bg-gray-800 dark:hover:text-[#ec4141]"
              @click="jumpToTop"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-[18px] w-[18px]" fill="none" stroke="currentColor">
                <path d="M5 12l7-7 7 7M12 5v14" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
              </svg>
            </button>
          </transition>
        </div>

        <div class="h-9 w-9">
          <transition name="locate-fab">
            <button
              v-if="showLocateFab"
              type="button"
              :disabled="!canLocateNow"
              title="定位当前播放歌曲"
              class="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200/50 bg-white/80 text-gray-500 shadow-[0_4px_16px_rgba(0,0,0,0.08)] backdrop-blur-md transition-all duration-300 dark:border-white/10 dark:bg-black/50 dark:text-gray-400 dark:shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
              :class="canLocateNow ? 'hover:bg-white hover:text-[#ec4141] hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,0,0,0.12)] cursor-pointer dark:hover:bg-gray-800 dark:hover:text-[#ec4141]' : 'cursor-not-allowed opacity-40'"
              @click="jumpToNowPlaying"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-[18px] w-[18px]" fill="none" stroke="currentColor">
                <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
                <circle r="3.25" cx="12" cy="12" stroke-width="1.8" />
              </svg>
            </button>
          </transition>
        </div>
      </div>
    </Teleport>

    <!-- 拖拽索引气泡 -->
    <Teleport to="body"> 
      <transition name="index-bubble"> 
        <div v-if="railDragging && railDragKey" class="pointer-events-none fixed inset-0 z-[9998] flex items-center justify-center">
          <div class="rounded-[28px] bg-black/72 px-7 py-5 text-5xl font-bold tracking-[0.12em] text-white shadow-2xl backdrop-blur-xl dark:bg-black/78">{{ railDragKey }}</div>
        </div>
      </transition> 
    </Teleport>
  </div>
</template>

<style scoped> /* 样式 */
/* ===== 滚动容器与滚动条 ===== */
.song-list-scroll-container { overflow-anchor: none; }
.song-list-scroll-container::-webkit-scrollbar { width: 10px; }
.song-list-scroll-container::-webkit-scrollbar-track { background: transparent; }
.song-list-scroll-container::-webkit-scrollbar-thumb { /* 样式 */
  border: 3px solid transparent; background-color: rgba(0,0,0,.14); background-clip: content-box; border-radius: 9999px;
}
.song-list-scroll-container::-webkit-scrollbar-thumb:hover { border-width: 2px; background-color: rgba(236,65,65,.68); }
:global(.dark) .song-list-scroll-container::-webkit-scrollbar-thumb { background-color: rgba(255,255,255,.22); }
:global(.dark) .song-list-scroll-container.song-list-scrollbar-active::-webkit-scrollbar-thumb { background-color: rgba(236,65,65,.72); }
:global(.dark) .song-list-scroll-container::-webkit-scrollbar-thumb:hover { background-color: rgba(236,65,65,.82); }

/* ===== 播放频谱与扫描动画 ===== */
.spectrum-bar { animation: spectrum 1s ease-in-out infinite; }
.scan-spinner { animation: scan-spin .9s linear infinite; }

/* ===== 扫描英雄卡 ===== */
.library-hero-overlay { position: fixed; inset: 0; z-index: 170; display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
.library-hero-backdrop { position: absolute; inset: 0; background: rgba(244,246,250,.72); backdrop-filter: blur(4px); }
.library-hero-card { /* 样式 */
  position: relative; z-index: 1; width: min(100%, 500px); overflow: hidden;
  padding: 1.55rem 1.6rem 1.2rem; border: 1px solid rgba(255,255,255,.68); border-radius: 20px;
  background: linear-gradient(180deg, rgba(255,255,255,.76), rgba(248,250,252,.8));
  box-shadow: 0 16px 40px rgba(15,23,42,.12), 0 2px 12px rgba(15,23,42,.05), inset 0 1px 0 rgba(255,255,255,.92);
  backdrop-filter: blur(30px) saturate(1.04); /* 样式 */
}
.library-hero-card-success { background: linear-gradient(180deg, rgba(247,252,249,.8), rgba(242,249,245,.82)); }
.library-hero-card-error { background: linear-gradient(180deg, rgba(255,248,248,.82), rgba(253,243,243,.84)); }
.library-hero-phase { margin: 0 0 .55rem; font-size: .74rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: rgba(79,92,112,.78); }
.library-hero-card-success .library-hero-phase { color: rgba(6,95,70,.78); }
.library-hero-card-error .library-hero-phase { color: rgba(185,28,28,.78); }
.library-hero-title { margin: 0; font-size: clamp(1.58rem, 2.7vw, 2.02rem); line-height: 1.16; letter-spacing: -.025em; color: rgb(15,23,42); }
.library-hero-progress-track { overflow: hidden; height: .52rem; border-radius: 9999px; background: rgba(15,23,42,.08); margin-top: 1rem; }
.library-hero-progress-fill { position: relative; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #0a66ff 0%, #3b82f6 100%); transition: width .3s ease-out; }
.library-hero-card-success .library-hero-progress-fill { background: linear-gradient(90deg, #059669 0%, #10b981 100%); }
.library-hero-card-error .library-hero-progress-fill { background: linear-gradient(90deg, #dc2626 0%, #f87171 100%); }
.library-hero-progress-meta { display: flex; justify-content: space-between; gap: .75rem; margin-top: .6rem; font-size: .78rem; color: rgba(71,85,105,.78); }
.library-hero-progress-note { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.library-hero-progress-value { flex-shrink: 0; color: rgba(15,23,42,.56); }
.library-hero-actions { display: flex; flex-wrap: wrap; gap: .7rem; margin-top: .9rem; }
.hero-primary-btn, /* 样式 */
.hero-secondary-btn { /* 样式 */
  display: inline-flex; align-items: center; justify-content: center; min-width: 132px; border-radius: 9999px;
  padding: .82rem 1.3rem; font-size: .94rem; font-weight: 700;
  transition: transform .18s ease, background-color .18s ease, border-color .18s ease, color .18s ease, box-shadow .18s ease;
}
.hero-primary-btn { color: white; background: linear-gradient(180deg, #1677ff, #0a66ff); box-shadow: 0 10px 20px rgba(10,102,255,.18); }
.hero-primary-btn:hover { transform: translateY(-1px); box-shadow: 0 14px 24px rgba(10,102,255,.22); }
.hero-secondary-btn { border: 1px solid rgba(15,23,42,.1); background: rgba(255,255,255,.72); color: rgb(31,41,55); }
.hero-secondary-btn:hover { transform: translateY(-1px); background: rgba(255,255,255,.94); }

@media (max-width: 720px) { /* 样式 */
  .library-hero-overlay { padding: 1rem; }
  .library-hero-card { padding: 1.45rem 1.2rem 1.15rem; }
  .library-hero-progress-meta { flex-direction: column; align-items: flex-start; }
}

/* ===== 字母索引导航 ===== */
.index-nav-item { /* 样式 */
  width: 1.05rem; height: .78rem; border-radius: 9999px; font-size: .58rem; line-height: 1;
  color: rgba(75,85,99,.85);
  transition: background-color .18s ease, color .18s ease, transform .18s ease;
}
.index-nav-item:hover { background: rgba(15,23,42,.08); color: rgb(17,24,39); }
.index-nav-item-active { background: rgba(236,65,65,.18); color: #ec4141; transform: scale(1.06); }
.index-nav-item-hover { background: rgba(15,23,42,.08); color: rgb(17,24,39); }
.index-nav-item-drag { background: rgba(15,23,42,.12); color: rgb(17,24,39); transform: scale(1.04); }
.index-nav-item-disabled { opacity: .25; cursor: not-allowed; pointer-events: none; }

/* ===== 英雄卡暗色模式 ===== */
:global(.dark) .library-hero-backdrop { background: rgba(2,6,23,.68); backdrop-filter: blur(4px); }
:global(.dark) .library-hero-card { /* 样式 */
  border-color: rgba(255,255,255,.08);
  background: linear-gradient(180deg, rgba(12,18,28,.8), rgba(10,16,25,.84));
  box-shadow: 0 18px 44px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.05);
}
:global(.dark) .library-hero-card-success { background: linear-gradient(180deg, rgba(7,46,39,.84), rgba(8,58,47,.86)); }
:global(.dark) .library-hero-card-error { background: linear-gradient(180deg, rgba(67,13,13,.84), rgba(82,18,18,.86)); }
:global(.dark) .library-hero-title, /* 样式 */
:global(.dark) .library-hero-progress-value { color: rgba(255,255,255,.96); }
:global(.dark) .library-hero-phase { color: rgba(191,201,216,.8); }
:global(.dark) .library-hero-card-success .library-hero-phase { color: rgba(110,231,183,.82); }
:global(.dark) .library-hero-card-error .library-hero-phase { color: rgba(252,165,165,.88); }
:global(.dark) .library-hero-progress-meta, /* 样式 */
:global(.dark) .library-hero-progress-note { color: rgba(226,232,240,.72); }

/* ===== 字母索引暗色模式 ===== */
:global(.dark) .index-nav-item { color: rgba(255,255,255,.72); }
:global(.dark) .index-nav-item:hover { background: rgba(255,255,255,.1); color: rgba(255,255,255,.96); }
:global(.dark) .index-nav-item-active { background: rgba(236,65,65,.24); color: #fda4af; }
:global(.dark) .index-nav-item-hover { background: rgba(255,255,255,.1); color: rgba(255,255,255,.96); }
:global(.dark) .index-nav-item-drag { background: rgba(255,255,255,.14); color: rgba(255,255,255,.98); }

/* ===== 过渡动画 ===== */
.index-bubble-enter-active, /* 样式 */
.index-bubble-leave-active { transition: opacity .18s ease, transform .18s ease; }
.index-bubble-enter-from, /* 样式 */
.index-bubble-leave-to { opacity: 0; transform: scale(.92); }

.locate-fab-enter-active, /* 样式 */
.locate-fab-leave-active { transition: opacity .18s ease, transform .18s ease; }
.locate-fab-enter-from, /* 样式 */
.locate-fab-leave-to { opacity: 0; transform: translateY(8px) scale(.94); }

.library-hero-enter-active, /* 样式 */
.library-hero-leave-active { transition: opacity .22s ease, transform .22s ease; }
.library-hero-enter-from, /* 样式 */
.library-hero-leave-to { opacity: 0; transform: scale(.98); }

/* ===== 关键帧 ===== */
.scan-progress-indeterminate { min-width: 28%; animation: scan-progress-indeterminate 1.1s ease-in-out infinite alternate; }
@keyframes scan-progress-indeterminate { from { transform: translateX(-14%); } to { transform: translateX(14%); } }
@keyframes scan-spin { to { transform: rotate(360deg); } }
:global(.dark) .hero-secondary-btn { border-color: rgba(255,255,255,.12); background: rgba(255,255,255,.06); color: rgba(255,255,255,.9); }
:global(.dark) .hero-secondary-btn:hover { background: rgba(255,255,255,.12); }
@keyframes spectrum { /* 样式 */
  0%,100% { height: 4px; }
  25% { height: 14px; } /* 样式 */
  50% { height: 6px; } /* 样式 */
  75% { height: 12px; } /* 样式 */
}
</style>
