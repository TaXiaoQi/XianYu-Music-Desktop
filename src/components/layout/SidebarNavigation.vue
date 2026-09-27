<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { SidebarItemKey, SidebarSettings } from '../../types';
import { useI18n, type I18nKey } from '../../features/i18n';
import { SIDEBAR_ITEMS, normalizeSidebarOrder } from '../../features/settings/sidebarItems';
import { computeNavIndicatorGeometry, type NavIndicatorGeometry } from '../../composables/navIndicatorGeometry';

interface Props {
  sidebar: SidebarSettings;
  currentViewMode: string;
  currentPath: string;
  isDragActive: boolean;
}

const props = defineProps<Props>();
const { t } = useI18n();

const sidebarLabelKeys: Record<SidebarItemKey, I18nKey> = {
  localMusic: 'sidebar.localMusic',
  artists: 'sidebar.artists',
  albums: 'sidebar.albums',
  favorites: 'sidebar.favorites',
  recent: 'sidebar.recent',
  folders: 'sidebar.folders',
  plugins: 'sidebar.plugins',
  account: 'sidebar.account',
};

const emit = defineEmits<{
  (event: 'openHome'): void;
  (event: 'select', key: SidebarItemKey): void;
  (event: 'hoverArtists'): void;
  (event: 'hoverAlbums'): void;
}>();

const hoveredItem = ref<string | null>(null);
let leaveTimer: ReturnType<typeof setTimeout> | undefined;

function handleItemEnter(id: string) {
  clearTimeout(leaveTimer);
  hoveredItem.value = id;

  if (id === 'artists') emit('hoverArtists');
  if (id === 'albums') emit('hoverAlbums');
}

function handleItemLeave() {
  leaveTimer = setTimeout(() => {
    hoveredItem.value = null;
  }, 150);
}

const orderedItems = computed(() => {
  const order = normalizeSidebarOrder(props.sidebar.order);
  return order
    .map(key => SIDEBAR_ITEMS.find(item => item.key === key))
    .filter((item): item is (typeof SIDEBAR_ITEMS)[number] => !!item)
    .filter(item => props.sidebar[item.visibilityKey] === true);
});

const isHomeActive = computed(
  () =>
    props.currentPath === '/' &&
    ['statistics', 'leaderboard', 'dailyRecommend', 'topLists'].includes(props.currentViewMode),
);

const activeKey = computed<SidebarItemKey | null>(() => {
  const { currentPath, currentViewMode } = props;

  if (currentPath === '/') {
    if (currentViewMode === 'all') return 'localMusic';
    if (currentViewMode === 'folder') return 'folders';
    return null;
  }

  switch (currentPath) {
    case '/artists':
      return 'artists';
    case '/albums':
      return 'albums';
    case '/favorites':
      return 'favorites';
    case '/recent':
      return 'recent';
    case '/plugins':
      return 'plugins';
    case '/auth':
      return 'account';
    default:
      return null;
  }
});

const baseNavClasses = 'relative z-[1] px-3 py-2 mx-2 rounded-md cursor-pointer flex items-center transition-all duration-100 text-sm font-medium active:scale-[0.97] whitespace-nowrap min-w-0';
const activeNavClasses = 'text-black dark:text-white font-semibold';
const idleClasses = 'text-gray-800 dark:text-gray-200';
const hoverClasses = 'bg-black/5 dark:bg-white/5 text-black dark:text-white translate-x-1';

const itemClasses = (key: SidebarItemKey) => {
  const isActive = activeKey.value === key;
  return [
    baseNavClasses,
    isActive ? activeNavClasses : idleClasses,
    hoveredItem.value === key && !isActive ? hoverClasses : '',
  ];
};

// --- 滑动指示块（跨页共享元素）---
// 列表里始终只有一个常驻的绝对定位指示块；它的 top/height 由「激活项在列表中的偏移 + 高度」算出。
const listWrapperRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const indicatorGeometry = ref<NavIndicatorGeometry>({ top: 0, height: 0, visible: false });

// 激活项下标：0 为固定的「首页」项，其余按 orderedItems 顺序顺延
const activeItemIndex = computed(() => {
  if (isHomeActive.value) return 0;

  const key = activeKey.value;
  if (!key) return -1;

  const index = orderedItems.value.findIndex(item => item.key === key);
  return index < 0 ? -1 : index + 1;
});

const measureIndicator = () => {
  const list = listRef.value;
  if (!list) {
    indicatorGeometry.value = { top: 0, height: 0, visible: false };
    return;
  }

  const items = Array.from(list.children)
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element.tagName === 'LI')
    .map(element => ({ offsetTop: element.offsetTop, offsetHeight: element.offsetHeight }));

  indicatorGeometry.value = computeNavIndicatorGeometry(items, activeItemIndex.value);
};

let resizeObserver: ResizeObserver | undefined;

onMounted(() => {
  measureIndicator();

  // 侧边栏拖宽/收起展开、字体加载导致的尺寸变化统一靠 ResizeObserver 触发重测（不做逐帧轮询）
  if (typeof ResizeObserver !== 'undefined' && listWrapperRef.value) {
    resizeObserver = new ResizeObserver(measureIndicator);
    resizeObserver.observe(listWrapperRef.value);
  }
  window.addEventListener('resize', measureIndicator);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = undefined;
  window.removeEventListener('resize', measureIndicator);
});

// 激活项变化：同步重测（列表项的位置/高度与谁激活无关），保证导航过渡能采到更新后的几何
watch(activeItemIndex, measureIndicator);
// 列表项顺序/可见性变化：等 DOM 刷新后再重测
watch(orderedItems, () => {
  void nextTick(measureIndicator);
});
</script>

<template>
  <div
    ref="listWrapperRef"
    class="relative transition-all duration-200"
    :class="{ 'opacity-30 grayscale pointer-events-none': isDragActive }"
  >
    <ul ref="listRef" class="space-y-1">
      <li
        @click="emit('openHome')"
        @mouseenter="handleItemEnter('home')"
        @mouseleave="handleItemLeave()"
        :class="[baseNavClasses, isHomeActive ? activeNavClasses : idleClasses, hoveredItem === 'home' && !isHomeActive ? hoverClasses : '']"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
        <span class="truncate min-w-0">{{ t('sidebar.home') }}</span>
      </li>

      <li
        v-for="item in orderedItems"
        :key="item.key"
        @click="emit('select', item.key)"
        @mouseenter="handleItemEnter(item.key)"
        @mouseleave="handleItemLeave()"
        :class="itemClasses(item.key)"
      >
        <svg
          v-if="item.iconKind === 'albums'"
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4 mr-3 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <circle cx="12" cy="12" r="10" stroke-width="2" />
          <circle cx="12" cy="12" r="3" stroke-width="2" />
        </svg>
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4 mr-3 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="item.iconPath" />
        </svg>
        <span class="truncate min-w-0">{{ t(sidebarLabelKeys[item.key]) }}</span>
      </li>
    </ul>

    <div
      v-if="indicatorGeometry.visible"
      class="nav-indicator"
      aria-hidden="true"
      :style="{ top: `${indicatorGeometry.top}px`, height: `${indicatorGeometry.height}px` }"
    ></div>
  </div>
</template>

<style scoped>
/* 跨页共享元素：整块常驻、由几何计算定位；view-transition-name 让浏览器在路由切换时自动补间到新位置 */
.nav-indicator {
  position: absolute;
  left: 0.5rem;
  right: 0.5rem;
  z-index: 0;
  border-radius: 0.375rem;
  background-color: rgb(0 0 0 / 0.1);
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  pointer-events: none;
  view-transition-name: nav-indicator;
  /* 不支持 View Transitions 或 reduced-motion 时，退化为自身过渡（同一份 token） */
  transition:
    top var(--motion-dur-base) var(--motion-ease-emphasized),
    height var(--motion-dur-base) var(--motion-ease-emphasized);
}

.dark .nav-indicator {
  background-color: rgb(255 255 255 / 0.1);
}
</style>
