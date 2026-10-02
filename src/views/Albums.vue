<script setup lang="ts"> // 实现
// 专辑视图：按首字母分组的虚拟滚动网格，负责封面按需加载、视口快照缓存与拖拽排序。
defineOptions({
  name: 'Albums',
});

import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { default as SortModeIcon } from '../components/common/SortModeIcon.vue';
import DragGhost from '../components/common/DragGhost.vue';
import { albumViewportCoverSnapshotCache as viewportSnapshotCache } from '../caches/imageCaches';
import { dragSession as pointerDragState } from '../composables/dragState';
import { useCoverCache as createCoverManager } from '../composables/useCoverCache';
import { useHomeNavigation as createHomeNavigator } from '../composables/useHomeNavigation';
import { useListScrollMemory as rememberScrollPosition } from '../composables/useListScrollMemory';
import { useLibraryBrowse as createLibraryBrowser } from '../features/library/useLibraryBrowse';
import { type AlbumListItem } from '../features/library/playerLibraryViewShared';
import { getAlphabetIndexKey as letterKeyOf } from '../utils/alphabetIndex';

const libraryBrowser = createLibraryBrowser();
const visibleAlbums = libraryBrowser.filteredAlbumList;
const albumSortMode = libraryBrowser.albumSortMode;
const reorderAlbums = libraryBrowser.updateAlbumOrder;
const searchKeyword = libraryBrowser.searchQuery;

const gotoAlbum = createHomeNavigator(useRouter()).openHomeAlbum;
const pageRoute = useRoute();

const searchFilterOn = computed(() => searchKeyword.value.trim().length > 0);

const coverManager = createCoverManager();
const cachedCovers = coverManager.coverCache;
const fetchCover = coverManager.loadCover;
const markCoversUsed = coverManager.touchCoverPaths;
const coverLoadingNow = coverManager.isCoverLoading;
const warmPriorityCovers = coverManager.preloadPriorityCovers;

// —— 界面状态 ——
const sortMenuOpen = ref(false);
const dropTargetKey = ref<string | null>(null);
const scrollBoxRef = ref<HTMLElement | null>(null);
const currentScrollTop = ref(0);
const viewportHeight = ref(720);
const viewportWidth = ref(1200);
const cardMeasuredHeight = ref(0);
const coverUrlMap = reactive(new Map<string, string>());

let coverWatcher: IntersectionObserver | null = null;
let layoutResizeObserver: ResizeObserver | null = null;
let observerRefreshRafId = 0;
let trackedCoverPaths = new Set<string>();

const SNAPSHOT_CACHE_KEY = 'albums-current';
const SNAPSHOT_MAX_COUNT = 72;
const GRID_GAP_X = 24;
const GRID_GAP_Y = 40;
const GROUP_GAP_Y = 8;
const CARD_EXTRA_HEIGHT = 108;
const GROUP_TITLE_HEIGHT = 24;
const OVERSCAN_ROW_COUNT = 2;

// 断点与网格列数的对应表（与模板中的响应式栅格类一致）。
const COLUMN_BREAKPOINTS: ReadonlyArray<readonly [number, number]> = [
  [1536, 7],
  [1280, 6],
  [1024, 5],
  [768, 4],
  [640, 3],
];

function resolveColumnCount(): number {
  for (const [minWidth, columns] of COLUMN_BREAKPOINTS) {
    if (window.innerWidth >= minWidth) return columns;
  }
  return 2;
}

const columnCount = ref(resolveColumnCount());

// 估算行高：列宽 + 卡片文字区 + 行间距，实测卡片高度后以实测为准。
const approxRowSpan = computed(() => {
  const columns = columnCount.value;
  const usableWidth = Math.max(0, viewportWidth.value - GRID_GAP_X * (columns - 1));
  const cardWidth = columns > 0 ? usableWidth / columns : viewportWidth.value;
  return cardWidth + CARD_EXTRA_HEIGHT + GRID_GAP_Y;
});

const rowSpan = computed(() =>
  cardMeasuredHeight.value > 0 ? cardMeasuredHeight.value + GRID_GAP_Y : approxRowSpan.value,
);

function syncLayoutMetrics() {
  const box = scrollBoxRef.value;
  if (box) {
    viewportHeight.value = box.clientHeight;
    viewportWidth.value = box.clientWidth;
  }
  columnCount.value = resolveColumnCount();
}

async function remeasureCardHeight() {
  await nextTick(); // 实现
  const firstCard = scrollBoxRef.value?.querySelector<HTMLElement>('[data-album-card]');
  if (!firstCard) return;
  const measured = firstCard.offsetHeight;
  if (measured > 0 && measured !== cardMeasuredHeight.value) cardMeasuredHeight.value = measured;
}

function onScrollCapture(event: Event) {
  currentScrollTop.value = (event.target as HTMLElement).scrollTop;
}

function resolveCoverSrc(path: string | undefined): string {
  if (!path) return '';
  return coverUrlMap.get(path) ?? cachedCovers.get(path) ?? '';
}

// 回到本页时先恢复上次离开前保存的视口封面，避免滚动后封面闪白。
function prefetchSnapshotCovers() {
  const snapshot = viewportSnapshotCache.get(SNAPSHOT_CACHE_KEY);
  if (!snapshot || snapshot.length === 0) return;
  warmPriorityCovers(snapshot);
}

// 离开前收集当前视口上下各一个屏高内、封面已就绪的路径并存入快照。
function persistSnapshotCovers() {
  const box = scrollBoxRef.value;
  if (!box) return;

  const boxRect = box.getBoundingClientRect();
  const buffer = box.clientHeight;
  const upperEdge = boxRect.top - buffer;
  const lowerEdge = boxRect.bottom + buffer;
  const picked: string[] = [];
  const seen = new Set<string>();

  for (const element of Array.from(box.querySelectorAll<HTMLElement>('[data-cover-path]'))) {
    if (picked.length >= SNAPSHOT_MAX_COUNT) break;

    const path = element.dataset.coverPath; // 实现
    if (!path || seen.has(path)) continue;

    const rect = element.getBoundingClientRect(); // 实现
    if (rect.bottom < upperEdge || rect.top > lowerEdge) continue;
    if (!resolveCoverSrc(path)) continue;

    seen.add(path);
    picked.push(path);
  }

  if (picked.length > 0) viewportSnapshotCache.set(SNAPSHOT_CACHE_KEY, picked);
  else viewportSnapshotCache.delete(SNAPSHOT_CACHE_KEY);
}

prefetchSnapshotCovers();

// 依据可见路径同步封面表：清理不可见项，缓存优先，其余异步加载并校验路径仍然可见。
function applyVisibleCovers(paths: string[]) {
  const nextPaths = new Set(paths.filter(Boolean));
  trackedCoverPaths = nextPaths;

  Array.from(coverUrlMap.keys()).forEach((path) => {
    if (!nextPaths.has(path)) coverUrlMap.delete(path);
  });

  const orderedPaths = Array.from(nextPaths);
  markCoversUsed(orderedPaths);

  for (const path of orderedPaths) {
    const readyUrl = cachedCovers.get(path);
    if (readyUrl) {
      coverUrlMap.set(path, readyUrl);
      continue;
    }
    if (coverUrlMap.has(path)) continue;

    void fetchCover(path).then((fetchedUrl) => {
      if (!fetchedUrl || !trackedCoverPaths.has(path)) return;
      coverUrlMap.set(path, fetchedUrl);
    });
  }
}

interface AlbumEntry { album: AlbumListItem; index: number }
interface TitleRow { type: 'header'; key: string; title: string }
interface CardRow { type: 'items'; key: string; items: AlbumEntry[]; bottomGap: number }
type GroupRow = TitleRow | CardRow;
type MeasuredTitleRow = TitleRow & { top: number; height: number };
type MeasuredCardRow = CardRow & { top: number; height: number };
type MeasuredGroupRow = MeasuredTitleRow | MeasuredCardRow;

// 依据首字母把专辑列表切成连续分组。
const letterGroups = computed(() => {
  const groups: Array<{ key: string; entries: AlbumEntry[] }> = [];

  visibleAlbums.value.forEach((album, index) => {
    const letter = letterKeyOf(album.name);
    const tail = groups[groups.length - 1];

    if (tail && tail.key === letter) {
      tail.entries.push({ album, index });
    } else {
      groups.push({ key: letter, entries: [{ album, index }] });
    }
  });

  return groups;
});

// 展开成 header / items 交替的虚拟行序列，组内按列数切片。
const sectionRows = computed<GroupRow[]>(() => {
  const rows: GroupRow[] = [];
  const cols = columnCount.value;

  for (const group of letterGroups.value) {
    rows.push({ type: 'header', title: group.key, key: ['header', group.key].join('::') });

    for (let offset = 0; offset < group.entries.length; offset += cols) {
      const groupTail = offset + cols >= group.entries.length;
      rows.push({
        type: 'items', // 实现
        key: ['items', group.key, String(offset)].join('::'),
        items: group.entries.slice(offset, offset + cols),
        bottomGap: groupTail ? GROUP_GAP_Y : GRID_GAP_Y,
      });
    }
  }

  return rows; // 实现
});

// 为每行累计 top / height，得到可直接用于布局的测量结果。
const measuredSectionRows = computed<MeasuredGroupRow[]>(() => {
  let cursor = 0;

  return sectionRows.value.map((row) => {
    const height = row.type === 'header' // 实现
      ? GROUP_TITLE_HEIGHT
      : cardMeasuredHeight.value > 0
        ? cardMeasuredHeight.value + row.bottomGap
        : approxRowSpan.value - GRID_GAP_Y + row.bottomGap;
    const placed = { ...row, top: cursor, height };
    cursor += height;
    return placed;
  });
});

// 分组模式下的可视窗口（含上下 overscan）与上下占位高度。
const groupedViewState = computed(() => {
  const overscanPx = rowSpan.value * OVERSCAN_ROW_COUNT;
  const viewTop = currentScrollTop.value;
  const lowerEdge = Math.max(0, viewTop - overscanPx);
  const upperEdge = viewTop + viewportHeight.value + overscanPx;

  const allRows = measuredSectionRows.value;
  const totalHeight = allRows.reduce((sum, row) => sum + row.height, 0);

  let firstIndex = 0;
  while (firstIndex < allRows.length && allRows[firstIndex].top + allRows[firstIndex].height <= lowerEdge) {
    firstIndex += 1;
  }

  let lastIndex = firstIndex;
  while (lastIndex < allRows.length && allRows[lastIndex].top < upperEdge) {
    lastIndex += 1;
  }

  const windowRows = allRows.slice(firstIndex, lastIndex);
  const headTop = windowRows[0]?.top ?? 0;
  const tailBottom = windowRows.length > 0
    ? windowRows[windowRows.length - 1].top + windowRows[windowRows.length - 1].height
    : 0;

  return {
    rows: windowRows,
    paddingTop: `${headTop}px`,
    paddingBottom: `${Math.max(0, totalHeight - tailBottom)}px`,
  };
});

// 字母悬浮标题：找出当前吸顶的分组及其位移补偿。
const floatingGroupTitle = computed(() => {
  if (albumSortMode.value !== 'name') return null;

  const titleRows = measuredSectionRows.value.filter((row): row is MeasuredTitleRow => row.type === 'header');
  if (titleRows.length === 0) return null;

  const scrollTop = currentScrollTop.value;
  let activeIndex = 0; // 实现
  for (let i = 0; i < titleRows.length; i += 1) {
    if (titleRows[i].top > scrollTop) break;
    activeIndex = i;
  }

  const activeRow = titleRows[activeIndex];
  const followingRow = titleRows[activeIndex + 1];
  const shift = followingRow ? Math.min(0, followingRow.top - scrollTop - activeRow.height) : 0;

  return {
    key: activeRow.key,
    title: activeRow.title,
    offset: `${shift}px`,
    shouldHideSourceRow: activeRow.top <= scrollTop,
  };
});

function shouldFadeSourceHeader(rowKey: string, rowTop: number): boolean {
  const floating = floatingGroupTitle.value;
  if (!floating) return false;
  return floating.key === rowKey && floating.shouldHideSourceRow && rowTop <= currentScrollTop.value;
}

// 非字母排序下的平铺虚拟列表。
const flatViewState = computed(() => {
  const total = visibleAlbums.value.length;
  const cols = columnCount.value;
  const totalRows = Math.ceil(total / cols);
  const firstRow = Math.max(0, Math.floor(currentScrollTop.value / rowSpan.value) - OVERSCAN_ROW_COUNT);
  const lastRow = Math.min(totalRows, Math.ceil((currentScrollTop.value + viewportHeight.value) / rowSpan.value) + OVERSCAN_ROW_COUNT);
  const firstIndex = firstRow * cols;
  const lastIndex = Math.min(total, lastRow * cols);

  return {
    items: visibleAlbums.value.slice(firstIndex, lastIndex).map((album, offset) => ({ album, index: firstIndex + offset })),
    paddingTop: `${firstRow * rowSpan.value}px`,
    paddingBottom: `${Math.max(0, (totalRows - lastRow) * rowSpan.value)}px`,
  };
});

// 当前视口需要的封面路径集合，供缓存同步与预热。
const coverPathsInView = computed(() => {
  const fromGrouped = () =>
    groupedViewState.value.rows.flatMap((row) =>
      row.type === 'items'
        ? row.items.map((entry) => entry.album.firstSongPath).filter((path): path is string => !!path)
        : [],
    );
  const fromFlat = () =>
    flatViewState.value.items.map((entry) => entry.album.firstSongPath).filter((path): path is string => !!path);

  return albumSortMode.value === 'name' ? fromGrouped() : fromFlat();
});

async function setupCoverObserver() {
  await nextTick(); // 实现
  const box = scrollBoxRef.value;
  if (!box) return;

  if (!coverWatcher) {
    coverWatcher = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        const path = element.dataset.coverPath;
        if (path) warmPriorityCovers([path]);
        coverWatcher?.unobserve(element);
      }
    }, { root: box, rootMargin: '200px 0px' });
  } else {
    coverWatcher.disconnect();
  }

  box.querySelectorAll<HTMLElement>('[data-cover-path]').forEach((element) => {
    coverWatcher?.observe(element);
  });
}

function queueObserverRefresh() {
  if (observerRefreshRafId) cancelAnimationFrame(observerRefreshRafId);
  observerRefreshRafId = requestAnimationFrame(() => {
    observerRefreshRafId = 0;
    void setupCoverObserver();
  });
}

const scrollCacheKey = computed(
  () => ['albums-view', pageRoute.path, albumSortMode.value, searchKeyword.value.trim()].join('::'),
);

rememberScrollPosition(scrollCacheKey, scrollBoxRef);

watch([coverPathsInView, albumSortMode], ([paths]) => {
  applyVisibleCovers(paths);
  warmPriorityCovers(paths);
  queueObserverRefresh();
}, { flush: 'post', immediate: true });

watch([albumSortMode, columnCount, visibleAlbums], () => {
  void remeasureCardHeight();
}, { flush: 'post', immediate: true });

// —— 排序菜单 ——
function toggleSortMenu() {
  sortMenuOpen.value = !sortMenuOpen.value;
}

function closeSortMenu() {
  sortMenuOpen.value = false;
}

function pickSortMode(mode: 'count' | 'name' | 'artist' | 'custom') {
  albumSortMode.value = mode;
  sortMenuOpen.value = false;
}

function sortOptionClass(mode: 'count' | 'name' | 'artist' | 'custom') {
  return albumSortMode.value === mode ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200';
}

// —— 卡片展示辅助 ——
function openAlbumTarget(albumKey: string) {
  void gotoAlbum(albumKey);
}

function albumInitial(name: string) {
  return name ? name.substring(0, 1).toUpperCase() : 'A';
}

function albumCountText(album: AlbumListItem) {
  return `${album.count}首`;
}

function albumCardClass(albumKey: string) {
  const dragging = pointerDragState.active && pointerDragState.type === 'album';
  return [
    dragging && pointerDragState.data?.key === albumKey ? 'opacity-50 scale-[0.97]' : '',
    {
      'ring-2 ring-[#EC4141] bg-red-50 dark:bg-red-900/20':
        dragging && dropTargetKey.value === albumKey && pointerDragState.data?.key !== albumKey,
    },
  ];
}

// —— 拖拽排序手势 ——
interface PressTracking { x: number; y: number; index: number; album: AlbumListItem }
let pressTracking: PressTracking | null = null;

function onCardPress(event: PointerEvent, index: number, album: AlbumListItem) {
  if (searchFilterOn.value) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  pressTracking = { x: event.clientX, y: event.clientY, index, album };
}

function onWindowPointerMove(event: PointerEvent) {
  if (pointerDragState.active) {
    pointerDragState.mouseX = event.clientX;
    pointerDragState.mouseY = event.clientY;
    return;
  }
  if (!pressTracking) return;

  if (event.pointerType !== 'mouse') event.preventDefault();

  const moved = Math.hypot(event.clientX - pressTracking.x, event.clientY - pressTracking.y);
  if (moved <= 5) return;

  pointerDragState.active = true;
  pointerDragState.type = 'album';
  pointerDragState.data = { index: pressTracking.index, key: pressTracking.album.key };
  pointerDragState.showGhost = true;
  pointerDragState.mouseX = event.clientX;
  pointerDragState.mouseY = event.clientY;
}

function clearDragState() {
  pressTracking = null;
  if (pointerDragState.type === 'album') {
    pointerDragState.active = false;
    pointerDragState.showGhost = false;
    pointerDragState.type = 'song';
    pointerDragState.data = null;
    dropTargetKey.value = null;
  }
}

function finishPointerGesture(cancelled = false) {
  const dropping = !cancelled && pointerDragState.active && pointerDragState.type === 'album' && dropTargetKey.value && pressTracking;
  if (dropping && pressTracking) {
    const fromIndex = pressTracking.index;
    const targetIndex = visibleAlbums.value.findIndex((album) => album.key === dropTargetKey.value);

    if (targetIndex !== -1 && targetIndex !== fromIndex) {
      const reordered = [...visibleAlbums.value];
      const [movedAlbum] = reordered.splice(fromIndex, 1);
      if (movedAlbum) {
        reordered.splice(targetIndex, 0, movedAlbum);
        reorderAlbums(reordered.map((album) => album.key));
      }
    }
  }

  clearDragState();
}

const onWindowPointerUp = () => finishPointerGesture(false);
const onWindowPointerCancel = () => finishPointerGesture(true);

function onCardPointerMove(_event: PointerEvent, albumKey: string) {
  if (pointerDragState.active && pointerDragState.type === 'album') dropTargetKey.value = albumKey;
}

function onDocClick(event: MouseEvent) {
  const target = event.target as HTMLElement; // 实现
  if (!target.closest('.relative.z-50')) sortMenuOpen.value = false;
}

onMounted(() => { // 实现
  syncLayoutMetrics();
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerCancel);
  window.addEventListener('click', onDocClick);
  window.addEventListener('resize', syncLayoutMetrics);

  const box = scrollBoxRef.value;
  if (box) {
    layoutResizeObserver = new ResizeObserver(() => {
      syncLayoutMetrics();
      void remeasureCardHeight();
    });
    layoutResizeObserver.observe(box);
  }

  requestAnimationFrame(() => { // 实现
    void remeasureCardHeight();
    queueObserverRefresh();
  });
});

onBeforeUnmount(() => { persistSnapshotCovers(); });

onUnmounted(() => { // 实现
  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerup', onWindowPointerUp);
  window.removeEventListener('pointercancel', onWindowPointerCancel);
  window.removeEventListener('click', onDocClick);
  window.removeEventListener('resize', syncLayoutMetrics);

  layoutResizeObserver?.disconnect();
  layoutResizeObserver = null;
  coverWatcher?.disconnect();
  coverWatcher = null;

  if (observerRefreshRafId) {
    cancelAnimationFrame(observerRefreshRafId);
    observerRefreshRafId = 0;
  }

  coverUrlMap.clear();
  trackedCoverPaths = new Set<string>();
});
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden bg-transparent h-full min-h-0" @click="closeSortMenu">
    <header class="h-auto px-6 pt-2 pb-3 shrink-0 select-none flex flex-col justify-center z-10 relative"> 
      <div class="flex items-center justify-between"> 
        <div class="flex items-center gap-2 pb-1"><h2 class="text-xl font-bold text-gray-900 dark:text-white">专辑列表</h2></div>

        <div class="relative z-50 flex items-center gap-2"> 
          <button title="排序方式" @click.stop="toggleSortMenu" class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20">
            <SortModeIcon class="h-4 w-4" /> 
          </button>

          <div v-if="sortMenuOpen" class="absolute right-0 top-full mt-2 w-48 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-xl shadow-xl border border-gray-100 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right">
            <div class="py-1"> 
              <button @click="pickSortMode('artist')" :class="sortOptionClass('artist')" class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between"><span>按专辑艺人排序</span><svg v-if="albumSortMode === 'artist'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg></button>
              <button @click="pickSortMode('name')" :class="sortOptionClass('name')" class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between"><span>按名称排序 (A-Z)</span><svg v-if="albumSortMode === 'name'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg></button>
              <button @click="pickSortMode('count')" :class="sortOptionClass('count')" class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between"><span>按数量排序 (多->少)</span><svg v-if="albumSortMode === 'count'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg></button>
              <button :class="sortOptionClass('custom')" class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between cursor-default"><span>自定义排序 (拖拽触发)</span><svg v-if="albumSortMode === 'custom'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg></button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section ref="scrollBoxRef" @scroll="onScrollCapture" class="albums-scroll-container flex-1 overflow-y-auto px-4 pb-4 pt-2 md:px-6 md:pb-6 md:pt-3 lg:px-8 lg:pb-8 lg:pt-3 custom-scrollbar relative z-0">
      <div v-if="floatingGroupTitle" aria-hidden="true" class="pointer-events-none sticky top-0 z-20" :style="{ height: `${GROUP_TITLE_HEIGHT}px`, marginBottom: `-${GROUP_TITLE_HEIGHT}px` }">
        <div class="h-6 flex items-end gap-3 pb-0" :style="{ transform: `translateY(${floatingGroupTitle.offset})`, willChange: 'transform' }">
          <div class="text-xl md:text-2xl font-black tracking-[0.2em] text-gray-900 dark:text-white/90">{{ floatingGroupTitle.title }}</div>
        </div>
      </div>

      <div v-if="albumSortMode === 'name'" :style="{ paddingTop: groupedViewState.paddingTop, paddingBottom: groupedViewState.paddingBottom }">
        <template v-for="row in groupedViewState.rows" :key="row.key">
          <div v-if="row.type === 'header'" :class="{ 'opacity-0': shouldFadeSourceHeader(row.key, row.top) }" class="h-6 flex items-end gap-3 pb-0 transition-opacity duration-150">
            <div class="text-xl md:text-2xl font-black tracking-[0.2em] text-gray-900 dark:text-white/90">{{ row.title }}</div>
          </div>

          <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-6" :style="{ paddingBottom: `${row.bottomGap}px` }">
            <div v-for="item in row.items" :key="item.album.key" data-album-card @pointerdown="onCardPress($event, item.index, item.album)" @pointermove="onCardPointerMove($event, item.album.key)" @click="openAlbumTarget(item.album.key)" :class="albumCardClass(item.album.key)" class="group cursor-pointer rounded-xl p-2 md:p-3 transition-all duration-300 flex flex-col relative select-none hover:bg-white/40 dark:hover:bg-white/5 [touch-action:none]">
              <div class="relative w-full aspect-square mb-3 mt-1" :data-cover-path="item.album.firstSongPath"> 
                <div class="absolute inset-x-2 top-0 bottom-1/2 bg-[#1c1c1c] rounded-t-full shadow-inner origin-bottom translate-y-[-10%] group-hover:translate-y-[-24%] transition-transform duration-500 ease-out z-0 flex items-center justify-center overflow-hidden border border-[#333]"> 
                  <div class="absolute inset-0 rounded-t-full border border-white/5 scale-90"></div><div class="absolute inset-0 rounded-t-full border border-white/5 scale-75"></div><div class="absolute inset-0 rounded-t-full border border-white/5 scale-50"></div>
                </div>

                <div class="absolute inset-0 z-10 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-100 dark:border-white/10 p-1 flex items-center justify-center overflow-hidden group-hover:shadow-xl transition-shadow duration-300"> 
                  <img v-if="resolveCoverSrc(item.album.firstSongPath)" :src="resolveCoverSrc(item.album.firstSongPath)" :alt="item.album.name" class="w-full h-full rounded-sm object-cover select-none" loading="lazy" decoding="async" draggable="false" />
                  <div v-else :class="{ 'animate-pulse': coverLoadingNow(item.album.firstSongPath) }" class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-white/5 dark:to-white/10 rounded-sm flex items-center justify-center text-4xl font-bold text-gray-300 dark:text-gray-600 shadow-inner">{{ albumInitial(item.album.name) }}</div>
                </div>
              </div>

              <div class="flex flex-col items-start px-1 z-20"> 
                <h3 class="font-bold text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-tight">{{ item.album.name }}</h3>
                <p class="text-xs text-gray-500 dark:text-gray-400 truncate w-full mt-1.5 flex items-center gap-1.5 opacity-80"><span class="font-medium">{{ albumCountText(item.album) }}</span><span class="w-0.5 h-0.5 rounded-full bg-gray-400"></span><span>{{ item.album.artist }}</span></p>
              </div>
            </div>
          </div>
        </template>
      </div>

      <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-6 gap-y-10" :style="{ paddingTop: flatViewState.paddingTop, paddingBottom: flatViewState.paddingBottom }">
        <div v-for="item in flatViewState.items" :key="item.album.key" data-album-card @pointerdown="onCardPress($event, item.index, item.album)" @pointermove="onCardPointerMove($event, item.album.key)" @click="openAlbumTarget(item.album.key)" :class="albumCardClass(item.album.key)" class="group cursor-pointer rounded-xl p-2 md:p-3 transition-all duration-300 flex flex-col relative select-none hover:bg-white/40 dark:hover:bg-white/5 [touch-action:none]">
          <div class="relative w-full aspect-square mb-3 mt-1" :data-cover-path="item.album.firstSongPath"> 
            <div class="absolute inset-x-2 top-0 bottom-1/2 bg-[#1c1c1c] rounded-t-full shadow-inner origin-bottom translate-y-[-10%] group-hover:translate-y-[-24%] transition-transform duration-500 ease-out z-0 flex items-center justify-center overflow-hidden border border-[#333]"> 
              <div class="absolute inset-0 rounded-t-full border border-white/5 scale-90"></div><div class="absolute inset-0 rounded-t-full border border-white/5 scale-75"></div><div class="absolute inset-0 rounded-t-full border border-white/5 scale-50"></div>
            </div>

            <div class="absolute inset-0 z-10 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-100 dark:border-white/10 p-1 flex items-center justify-center overflow-hidden group-hover:shadow-xl transition-shadow duration-300"> 
              <img v-if="resolveCoverSrc(item.album.firstSongPath)" :src="resolveCoverSrc(item.album.firstSongPath)" :alt="item.album.name" class="w-full h-full rounded-sm object-cover select-none" loading="lazy" decoding="async" draggable="false" />
              <div v-else :class="{ 'animate-pulse': coverLoadingNow(item.album.firstSongPath) }" class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-white/5 dark:to-white/10 rounded-sm flex items-center justify-center text-4xl font-bold text-gray-300 dark:text-gray-600 shadow-inner">{{ albumInitial(item.album.name) }}</div>
            </div>
          </div>

          <div class="flex flex-col items-start px-1 z-20"> 
            <h3 class="font-bold text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-tight">{{ item.album.name }}</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400 truncate w-full mt-1.5 flex items-center gap-1.5 opacity-80"><span class="font-medium">{{ albumCountText(item.album) }}</span><span class="w-0.5 h-0.5 rounded-full bg-gray-400"></span><span>{{ item.album.artist }}</span></p>
          </div>
        </div>
      </div>
    </section>
  <DragGhost />
  </div>
</template>

<style scoped> /* 样式 */
/* 关闭滚动锚定，避免虚拟列表占位高度变化时浏览器自行调整滚动位置。 */
.albums-scroll-container { overflow-anchor: none; }
</style>
