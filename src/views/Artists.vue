<script setup lang="ts"> // 实现
// 歌手视图：首字母分组 + 固定行高的虚拟滚动，头像按需加载并缓存分组标题用图。
defineOptions({
  name: 'Artists',
});

import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { convertFileSrc as toFileSrc } from '@tauri-apps/api/core';
import { default as SortModeIcon } from '../components/common/SortModeIcon.vue';
import DragGhost from '../components/common/DragGhost.vue';
import { artistHeaderCache as headerPosterCache, artistViewportCoverSnapshotCache as viewportSnapshotCache } from '../caches/imageCaches';
import { dragSession as pointerDragState } from '../composables/dragState';
import { useCoverCache as createCoverManager } from '../composables/useCoverCache';
import { useHomeNavigation as createHomeNavigator } from '../composables/useHomeNavigation';
import { useListScrollMemory as rememberScrollPosition } from '../composables/useListScrollMemory';
import { useLibraryBrowse as createLibraryBrowser } from '../features/library/useLibraryBrowse';
import { type ArtistListItem } from '../features/library/playerLibraryViewShared';
import { getAlphabetIndexKey as letterKeyOf } from '../utils/alphabetIndex';

const libraryBrowser = createLibraryBrowser();
const visibleArtists = libraryBrowser.filteredArtistList;
const artistSortMode = libraryBrowser.artistSortMode;
const reorderArtists = libraryBrowser.updateArtistOrder;
const searchKeyword = libraryBrowser.searchQuery;

const gotoArtist = createHomeNavigator(useRouter()).openHomeArtist;
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
const dropTargetName = ref<string | null>(null);
const scrollBoxRef = ref<HTMLElement | null>(null);
const currentScrollTop = ref(0);
const viewportHeight = ref(720);
const coverUrlMap = reactive(new Map<string, string>());

let coverWatcher: IntersectionObserver | null = null;
let layoutResizeObserver: ResizeObserver | null = null;
let trackedCoverPaths = new Set<string>();

const SNAPSHOT_CACHE_KEY = 'artists-current';
const SNAPSHOT_MAX_COUNT = 72;
const ROW_GAP_Y = 16;
const GROUP_GAP_Y = 8;
const AVATAR_BLOCK_HEIGHT = 72;
const ROW_SPAN = AVATAR_BLOCK_HEIGHT + ROW_GAP_Y;
const GROUP_TITLE_HEIGHT = 24;
const OVERSCAN_ROW_COUNT = 2;

// 断点与列数对应表（与模板中的响应式栅格类一致）。
const COLUMN_BREAKPOINTS: ReadonlyArray<readonly [number, number]> = [
  [1536, 5],
  [1280, 4],
  [1024, 3],
];

function resolveColumnCount(): number {
  for (const [minWidth, columns] of COLUMN_BREAKPOINTS) {
    if (window.innerWidth >= minWidth) return columns;
  }
  return 2;
}

const columnCount = ref(resolveColumnCount());

function syncLayoutMetrics() {
  const box = scrollBoxRef.value;
  if (box) viewportHeight.value = box.clientHeight;
  columnCount.value = resolveColumnCount();
}

function onScrollCapture(event: Event) {
  currentScrollTop.value = (event.target as HTMLElement).scrollTop;
}

function resolveCoverSrc(path: string | undefined): string {
  if (!path) return '';
  return coverUrlMap.get(path) ?? cachedCovers.get(path) ?? '';
}

// 头像地址：独立头像文件走本地文件协议，否则退回首歌封面。
function avatarFor(artist: ArtistListItem): string {
  if (artist.avatarPath) return toFileSrc(artist.avatarPath);
  return resolveCoverSrc(artist.firstSongPath);
}

function avatarPending(artist: ArtistListItem): boolean {
  if (artist.avatarPath) return false;
  return coverLoadingNow(artist.firstSongPath);
}

function onArtistCardClick(artist: ArtistListItem) {
  const avatar = avatarFor(artist);
  if (avatar) headerPosterCache.set(artist.name, avatar);
  void gotoArtist(artist.name);
}

// 回到本页时用快照直接回填封面 URL，并预热对应路径。
function restoreSnapshotCovers() {
  const snapshot = viewportSnapshotCache.get(SNAPSHOT_CACHE_KEY);
  if (!snapshot || snapshot.length === 0) return;

  coverUrlMap.clear();
  for (const entry of snapshot) {
    if (entry.path && entry.url) coverUrlMap.set(entry.path, entry.url);
  }
  warmPriorityCovers(snapshot.map((entry) => entry.path));
}

// 离开前保存视口附近已就绪的 { path, url } 对，上限 SNAPSHOT_MAX_COUNT 条。
function persistSnapshotCovers() {
  const box = scrollBoxRef.value;
  if (!box) return;

  const boxRect = box.getBoundingClientRect();
  const buffer = box.clientHeight;
  const upperEdge = boxRect.top - buffer;
  const lowerEdge = boxRect.bottom + buffer;
  const picked: Array<{ path: string; url: string }> = [];
  const seen = new Set<string>();

  for (const element of Array.from(box.querySelectorAll<HTMLElement>('[data-cover-path]'))) {
    if (picked.length >= SNAPSHOT_MAX_COUNT) break;

    const path = element.dataset.coverPath; // 实现
    if (!path || seen.has(path)) continue;

    const rect = element.getBoundingClientRect(); // 实现
    if (rect.bottom < upperEdge || rect.top > lowerEdge) continue;

    const url = resolveCoverSrc(path);
    if (!url) continue;

    seen.add(path);
    picked.push({ path, url });
  }

  if (picked.length > 0) viewportSnapshotCache.set(SNAPSHOT_CACHE_KEY, picked);
  else viewportSnapshotCache.delete(SNAPSHOT_CACHE_KEY);
}

restoreSnapshotCovers();

// 同步可见路径对应的封面表：清理、命中缓存直接回填、未命中异步加载。
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

interface ArtistEntry { artist: ArtistListItem; index: number }
interface TitleRow { type: 'header'; key: string; title: string }
interface AvatarRow { type: 'items'; key: string; items: ArtistEntry[]; bottomGap: number }
type GroupRow = TitleRow | AvatarRow;
type MeasuredTitleRow = TitleRow & { top: number; height: number };
type MeasuredAvatarRow = AvatarRow & { top: number; height: number };
type MeasuredGroupRow = MeasuredTitleRow | MeasuredAvatarRow;

// 依据首字母把歌手列表切成连续分组。
const letterGroups = computed(() => {
  const groups: Array<{ key: string; entries: ArtistEntry[] }> = [];

  visibleArtists.value.forEach((artist, index) => {
    const letter = letterKeyOf(artist.name);
    const tail = groups[groups.length - 1];

    if (tail && tail.key === letter) tail.entries.push({ artist, index });
    else groups.push({ key: letter, entries: [{ artist, index }] });
  });

  return groups;
});

// 展开为 header / items 交替的虚拟行序列。
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
        bottomGap: groupTail ? GROUP_GAP_Y : ROW_GAP_Y,
      });
    }
  }

  return rows; // 实现
});

// 行高固定：标题行为 GROUP_TITLE_HEIGHT，内容行为头像块 + 行距。
const measuredSectionRows = computed<MeasuredGroupRow[]>(() => {
  let cursor = 0;

  return sectionRows.value.map((row) => {
    const height = row.type === 'header' ? GROUP_TITLE_HEIGHT : AVATAR_BLOCK_HEIGHT + row.bottomGap;
    const placed = { ...row, top: cursor, height };
    cursor += height;
    return placed;
  });
});

// 分组模式下的可视窗口（含 overscan）与上下占位。
const groupedViewState = computed(() => {
  const overscanPx = ROW_SPAN * OVERSCAN_ROW_COUNT;
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

// 吸顶字母标题：定位当前分组并计算与下一分组相撞时的位移。
const floatingGroupTitle = computed(() => {
  if (artistSortMode.value !== 'name') return null;

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
  const total = visibleArtists.value.length;
  const cols = columnCount.value;
  const totalRows = Math.ceil(total / cols);
  const firstRow = Math.max(0, Math.floor(currentScrollTop.value / ROW_SPAN) - OVERSCAN_ROW_COUNT);
  const lastRow = Math.min(totalRows, Math.ceil((currentScrollTop.value + viewportHeight.value) / ROW_SPAN) + OVERSCAN_ROW_COUNT);
  const firstIndex = firstRow * cols;
  const lastIndex = Math.min(total, lastRow * cols);

  return {
    items: visibleArtists.value.slice(firstIndex, lastIndex).map((artist, offset) => ({ artist, index: firstIndex + offset })),
    paddingTop: `${firstRow * ROW_SPAN}px`,
    paddingBottom: `${Math.max(0, (totalRows - lastRow) * ROW_SPAN)}px`,
  };
});

// 需要展示歌曲封面的路径（有独立头像的歌手不参与）。
const coverPathsInView = computed(() => {
  const fromGrouped = () =>
    groupedViewState.value.rows.flatMap((row) =>
      row.type === 'items'
        ? row.items
            .filter((entry) => !entry.artist.avatarPath)
            .map((entry) => entry.artist.firstSongPath)
            .filter((path): path is string => !!path)
        : [],
    );
  const fromFlat = () =>
    flatViewState.value.items
      .filter((entry) => !entry.artist.avatarPath)
      .map((entry) => entry.artist.firstSongPath)
      .filter((path): path is string => !!path);

  return artistSortMode.value === 'name' ? fromGrouped() : fromFlat();
});

// 每次刷新都重建观察器：先断开旧的，再观察当前所有封面元素。
async function setupCoverObserver() {
  await nextTick(); // 实现
  if (coverWatcher) coverWatcher.disconnect();
  const box = scrollBoxRef.value;
  if (!box) return;

  coverWatcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const element = entry.target as HTMLElement;
      const path = element.dataset.coverPath;
      if (path) warmPriorityCovers([path]);
      coverWatcher?.unobserve(element);
    }
  }, { root: box, rootMargin: '200px 0px' });

  box.querySelectorAll<HTMLElement>('[data-cover-path]').forEach((element) => {
    coverWatcher?.observe(element);
  });
}

const scrollCacheKey = computed(
  () => ['artists-view', pageRoute.path, artistSortMode.value, searchKeyword.value.trim()].join('::'),
);

rememberScrollPosition(scrollCacheKey, scrollBoxRef);

watch([coverPathsInView, artistSortMode], ([paths]) => {
  applyVisibleCovers(paths);
  warmPriorityCovers(paths);
  void setupCoverObserver();
}, { flush: 'post', immediate: true });

// 无独立头像时使用的兜底渐变底色序列（顺序固定，影响配色映射）。
const artistGradients = [
  'from-pink-500 to-rose-500', 'from-purple-500 to-indigo-500',
  'from-cyan-500 to-blue-500', 'from-emerald-400 to-teal-500',
  'from-amber-400 to-orange-500', 'from-fuchsia-500 to-pink-500',
  'from-blue-400 to-indigo-500', 'from-violet-500 to-purple-500',
];

// 按名字哈希稳定地挑一种渐变。
function gradientFor(name: string): string {
  let hash = 0; // 实现
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return artistGradients[Math.abs(hash) % artistGradients.length];
}

// —— 进入页面逐行入场动画（对齐音源榜单页手法；节奏与歌曲列表一致，快进快出不让用户等）——
const ROW_ENTER_BASE_DELAY = 40;
const ROW_ENTER_STAGGER = 40;
const ROW_ENTER_DURATION = 400;
const gridEnterAnimating = ref(false);
let gridEnterTimer: ReturnType<typeof setTimeout> | undefined;

function playGridEnterAnimation() {
  clearTimeout(gridEnterTimer);
  gridEnterAnimating.value = true;
  const rows = Math.ceil(viewportHeight.value / ROW_SPAN) + OVERSCAN_ROW_COUNT * 2 + 1;
  gridEnterTimer = setTimeout(() => {
    gridEnterAnimating.value = false;
  }, ROW_ENTER_BASE_DELAY + Math.max(0, rows - 1) * ROW_ENTER_STAGGER + ROW_ENTER_DURATION + 120);
}

function rowEnterStyle(rowIndex: number, extra?: Record<string, string>) {
  if (!gridEnterAnimating.value) return extra;
  return { ...extra, animationDelay: `${ROW_ENTER_BASE_DELAY + rowIndex * ROW_ENTER_STAGGER}ms` };
}

// —— 排序菜单 ——
function toggleSortMenu() {
  sortMenuOpen.value = !sortMenuOpen.value;
}

function closeSortMenu() {
  sortMenuOpen.value = false;
}

function pickSortMode(mode: 'count' | 'name' | 'custom') {
  artistSortMode.value = mode;
  sortMenuOpen.value = false;
}

function sortOptionClass(mode: 'count' | 'name' | 'custom') {
  return artistSortMode.value === mode ? 'text-[#EC4141] font-medium' : 'text-gray-700 dark:text-gray-200';
}

// —— 卡片展示辅助 ——
function artistInitial(name: string) {
  return name.charAt(0).toUpperCase();
}

function artistCardClass(name: string) {
  const dragging = pointerDragState.active && pointerDragState.type === 'artist';
  return [dragging && pointerDragState.data?.name === name ? 'opacity-50 scale-[0.97]' : ''];
}

function isDropTarget(name: string) {
  return pointerDragState.active && pointerDragState.type === 'artist' && dropTargetName.value === name && pointerDragState.data?.name !== name;
}

// —— 拖拽排序手势 ——
interface PressTracking { x: number; y: number; index: number; artist: ArtistListItem }
let pressTracking: PressTracking | null = null;

function onCardPress(event: PointerEvent, index: number, artist: ArtistListItem) {
  if (searchFilterOn.value) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  pressTracking = { x: event.clientX, y: event.clientY, index, artist };
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
  pointerDragState.type = 'artist';
  pointerDragState.data = { index: pressTracking.index, name: pressTracking.artist.name };
  pointerDragState.showGhost = true;
  pointerDragState.mouseX = event.clientX;
  pointerDragState.mouseY = event.clientY;
}

function clearDragState() {
  pressTracking = null;
  if (pointerDragState.type === 'artist') {
    pointerDragState.active = false;
    pointerDragState.showGhost = false;
    pointerDragState.type = 'song';
    pointerDragState.data = null;
    dropTargetName.value = null;
  }
}

function finishPointerGesture(cancelled = false) {
  const dropping = !cancelled && pointerDragState.active && pointerDragState.type === 'artist' && dropTargetName.value && pressTracking;
  if (dropping && pressTracking) {
    const fromIndex = pressTracking.index;
    const targetIndex = visibleArtists.value.findIndex((artist) => artist.name === dropTargetName.value);

    if (targetIndex !== -1 && targetIndex !== fromIndex) {
      const reordered = [...visibleArtists.value];
      const [movedArtist] = reordered.splice(fromIndex, 1);
      if (movedArtist) {
        reordered.splice(targetIndex, 0, movedArtist);
        reorderArtists(reordered.map((artist) => artist.name));
      }
    }
  }

  clearDragState();
}

const onWindowPointerUp = () => finishPointerGesture(false);
const onWindowPointerCancel = () => finishPointerGesture(true);

function onCardPointerMove(_event: PointerEvent, artistName: string) {
  if (pointerDragState.active && pointerDragState.type === 'artist') dropTargetName.value = artistName;
}

function onDocClick(event: MouseEvent) {
  const target = event.target as HTMLElement; // 实现
  if (!target.closest('.relative.z-50')) sortMenuOpen.value = false;
}

onMounted(() => { // 实现
  syncLayoutMetrics();
  playGridEnterAnimation();
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerCancel);
  window.addEventListener('click', onDocClick);
  window.addEventListener('resize', syncLayoutMetrics);

  const box = scrollBoxRef.value;
  if (box) {
    layoutResizeObserver = new ResizeObserver(() => { syncLayoutMetrics(); });
    layoutResizeObserver.observe(box);
  }

  requestAnimationFrame(() => { void setupCoverObserver(); });
});

onBeforeUnmount(() => { persistSnapshotCovers(); });

onUnmounted(() => { // 实现
  clearTimeout(gridEnterTimer);
  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerup', onWindowPointerUp);
  window.removeEventListener('pointercancel', onWindowPointerCancel);
  window.removeEventListener('click', onDocClick);
  window.removeEventListener('resize', syncLayoutMetrics);

  layoutResizeObserver?.disconnect();
  layoutResizeObserver = null;
  coverWatcher?.disconnect();
  coverWatcher = null;

  coverUrlMap.clear();
  trackedCoverPaths = new Set<string>();
});
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden bg-transparent h-full min-h-0" @click="closeSortMenu">
    <header class="h-auto px-6 pt-2 pb-3 shrink-0 select-none flex flex-col justify-center z-10 relative"> 
      <div class="flex items-center justify-between"> 
        <div class="flex items-center gap-2 pb-1"><h2 class="text-xl font-bold text-gray-900 dark:text-white">歌手列表</h2></div>

        <div class="relative z-50 flex items-center gap-2"> 
          <button title="排序方式" @click.stop="toggleSortMenu" class="bg-white/1 hover:bg-white/10 border border-white/1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 w-7 h-7 flex items-center justify-center rounded-full transition active:scale-95 shadow-sm hover:border-gray-200 dark:hover:border-white/20">
            <SortModeIcon class="h-4 w-4" /> 
          </button>

          <div v-if="sortMenuOpen" class="absolute right-0 top-full mt-2 w-48 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-xl shadow-xl border border-gray-100 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right">
            <div class="py-1"> 
              <button @click="pickSortMode('name')" :class="sortOptionClass('name')" class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between"><span>按名称排序 (A-Z)</span><svg v-if="artistSortMode === 'name'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg></button>
              <button @click="pickSortMode('count')" :class="sortOptionClass('count')" class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between"><span>按数量排序 (多->少)</span><svg v-if="artistSortMode === 'count'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg></button>
              <button :class="sortOptionClass('custom')" class="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 flex items-center justify-between cursor-default"><span>自定义排序 (拖拽触发)</span><svg v-if="artistSortMode === 'custom'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg></button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section ref="scrollBoxRef" @scroll="onScrollCapture" class="artists-scroll-container flex-1 overflow-y-auto px-4 pb-4 pt-2 md:px-6 md:pb-6 md:pt-3 lg:px-8 lg:pb-8 lg:pt-3 custom-scrollbar relative z-0">
      <div v-if="floatingGroupTitle" aria-hidden="true" class="pointer-events-none sticky top-0 z-20" :style="{ height: `${GROUP_TITLE_HEIGHT}px`, marginBottom: `-${GROUP_TITLE_HEIGHT}px` }">
        <div class="h-6 flex items-end gap-3 pb-0" :style="{ transform: `translateY(${floatingGroupTitle.offset})`, willChange: 'transform' }">
          <div class="text-xl md:text-2xl font-black tracking-[0.2em] text-gray-900 dark:text-white/90">{{ floatingGroupTitle.title }}</div>
        </div>
      </div>

      <div v-if="artistSortMode === 'name'" :style="{ paddingTop: groupedViewState.paddingTop, paddingBottom: groupedViewState.paddingBottom }">
        <template v-for="(row, rowIndex) in groupedViewState.rows" :key="row.key">
          <div v-if="row.type === 'header'" :class="{ 'opacity-0': shouldFadeSourceHeader(row.key, row.top), 'row-enter-anim': gridEnterAnimating && !shouldFadeSourceHeader(row.key, row.top) }" :style="rowEnterStyle(rowIndex)" class="h-6 flex items-end gap-3 pb-0 transition-opacity duration-150">
            <div class="text-xl md:text-2xl font-black tracking-[0.2em] text-gray-900 dark:text-white/90">{{ row.title }}</div>
          </div>

          <div v-else :class="{ 'row-enter-anim': gridEnterAnimating }" :style="rowEnterStyle(rowIndex, { paddingBottom: `${row.bottomGap}px` })" class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-6">
            <div v-for="item in row.items" :key="item.artist.name" @pointerdown="onCardPress($event, item.index, item.artist)" @pointermove="onCardPointerMove($event, item.artist.name)" @click="onArtistCardClick(item.artist)" :class="artistCardClass(item.artist.name)" class="group cursor-pointer flex items-center gap-4 hover:bg-black/5 dark:hover:bg-white/5 p-2 rounded-lg transition-all duration-200 relative select-none [touch-action:none]">
              <div class="relative w-12 h-12 md:w-14 md:h-14 shrink-0 transition-shadow duration-200" :data-cover-path="item.artist.avatarPath ? undefined : item.artist.firstSongPath" :class="{ 'ring-2 ring-[#EC4141] ring-offset-2 ring-offset-gray-50 dark:ring-offset-[#262626] rounded-full': isDropTarget(item.artist.name) }">
                <div class="w-full h-full rounded-full overflow-hidden shadow-sm group-hover:shadow transition-shadow duration-300 relative bg-gray-100 dark:bg-white/5 flex items-center justify-center"> 
                  <img v-if="avatarFor(item.artist)" :src="avatarFor(item.artist)" :alt="item.artist.name" class="w-full h-full object-cover select-none animate-in fade-in duration-300" draggable="false">
                  <div v-else :class="[gradientFor(item.artist.name), { 'animate-pulse': avatarPending(item.artist) }]" class="w-full h-full flex items-center justify-center text-lg md:text-xl font-bold text-white bg-gradient-to-br animate-in fade-in duration-300">{{ artistInitial(item.artist.name) }}</div>
                  <div class="absolute inset-0 bg-white/0 group-hover:bg-white/10 dark:bg-black/5 dark:group-hover:bg-transparent transition-colors duration-300"></div> 
                </div>
              </div>

              <div class="flex-1 min-w-0"><h3 class="font-medium text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-snug">{{ item.artist.name }}</h3></div>
            </div>
          </div>
        </template>
      </div>

      <div v-else class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-6 gap-y-4" :style="{ paddingTop: flatViewState.paddingTop, paddingBottom: flatViewState.paddingBottom }">
        <div v-for="(item, itemOffset) in flatViewState.items" :key="item.artist.name" @pointerdown="onCardPress($event, item.index, item.artist)" @pointermove="onCardPointerMove($event, item.artist.name)" @click="onArtistCardClick(item.artist)" :class="[artistCardClass(item.artist.name), { 'row-enter-anim': gridEnterAnimating }]" :style="rowEnterStyle(Math.floor(itemOffset / columnCount))" class="group cursor-pointer flex items-center gap-4 hover:bg-black/5 dark:hover:bg-white/5 p-2 rounded-lg transition-all duration-200 relative select-none [touch-action:none]">
          <div class="relative w-12 h-12 md:w-14 md:h-14 shrink-0 transition-shadow duration-200" :data-cover-path="item.artist.avatarPath ? undefined : item.artist.firstSongPath" :class="{ 'ring-2 ring-[#EC4141] ring-offset-2 ring-offset-gray-50 dark:ring-offset-[#262626] rounded-full': isDropTarget(item.artist.name) }">
            <div class="w-full h-full rounded-full overflow-hidden shadow-sm group-hover:shadow transition-shadow duration-300 relative bg-gray-100 dark:bg-white/5 flex items-center justify-center"> 
              <img v-if="avatarFor(item.artist)" :src="avatarFor(item.artist)" :alt="item.artist.name" class="w-full h-full object-cover select-none animate-in fade-in duration-300" draggable="false">
              <div v-else :class="[gradientFor(item.artist.name), { 'animate-pulse': avatarPending(item.artist) }]" class="w-full h-full flex items-center justify-center text-lg md:text-xl font-bold text-white bg-gradient-to-br animate-in fade-in duration-300">{{ artistInitial(item.artist.name) }}</div>
              <div class="absolute inset-0 bg-white/0 group-hover:bg-white/10 dark:bg-black/5 dark:group-hover:bg-transparent transition-colors duration-300"></div> 
            </div>
          </div>

          <div class="flex-1 min-w-0"><h3 class="font-medium text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-snug">{{ item.artist.name }}</h3></div>
        </div>
      </div>
    </section>
  <DragGhost />
  </div>
</template>

<style scoped> /* 样式 */
/* 关闭滚动锚定，避免虚拟列表占位高度变化时浏览器自行调整滚动位置。 */
.artists-scroll-container { overflow-anchor: none; }

/* 进入页面：行自下而上错峰浮入（与音源榜单页同一套曲线与步长）。 */
.row-enter-anim { animation: row-enter-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) backwards; }

@keyframes row-enter-in {
  from { opacity: 0; transform: translateY(30px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
