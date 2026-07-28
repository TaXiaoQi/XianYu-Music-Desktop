<script setup lang="ts">
import { computed, ref } from 'vue';

import type { SidebarItemKey, SidebarSettings } from '../../types';
import { SIDEBAR_ITEMS, normalizeSidebarOrder } from '../../features/settings/sidebarItems';

interface Props {
  sidebar: SidebarSettings;
  currentViewMode: string;
  currentPath: string;
  isDragActive: boolean;
}

const props = defineProps<Props>();

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

  // 歌手/专辑悬浮时预加载对应列表（保持原有行为）
  if (id === 'artists') emit('hoverArtists');
  if (id === 'albums') emit('hoverAlbums');
}

function handleItemLeave() {
  leaveTimer = setTimeout(() => {
    hoveredItem.value = null;
  }, 150);
}

/** 按用户配置的顺序渲染，并过滤掉已隐藏的项 */
const orderedItems = computed(() => {
  const order = normalizeSidebarOrder(props.sidebar.order);
  return order
    .map(key => SIDEBAR_ITEMS.find(item => item.key === key))
    .filter((item): item is (typeof SIDEBAR_ITEMS)[number] => !!item)
    .filter(item => props.sidebar[item.visibilityKey] === true);
});

/** 首页是否激活（统计页） */
const isHomeActive = computed(
  () => props.currentViewMode === 'statistics' && props.currentPath === '/',
);

/**
 * 当前激活的侧边栏项。
 * 各项判定规则与改造前逐项保持一致：
 * 本地音乐/文件夹依赖 currentViewMode + 根路径，其余依赖具体路由路径。
 */
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

const baseNavClasses = 'px-3 py-2 mx-2 rounded-md cursor-pointer flex items-center transition-all duration-100 text-sm font-medium active:scale-[0.97]';
const activeNavClasses = 'bg-black/10 dark:bg-white/10 text-black dark:text-white font-semibold shadow-sm translate-x-1';
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
</script>

<template>
  <ul class="space-y-1 transition-all duration-200" :class="{ 'opacity-30 grayscale pointer-events-none': isDragActive }">
    <!-- 首页：固定置顶，不参与排序 -->
    <li
      @click="emit('openHome')"
      @mouseenter="handleItemEnter('home')"
      @mouseleave="handleItemLeave()"
      :class="[baseNavClasses, isHomeActive ? activeNavClasses : idleClasses, hoveredItem === 'home' && !isHomeActive ? hoverClasses : '']"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
      <span>首页</span>
    </li>

    <!-- 其余项：按用户配置的顺序渲染 -->
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
        class="h-4 w-4 mr-3"
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
        class="h-4 w-4 mr-3"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="item.iconPath" />
      </svg>
      <span>{{ item.label }}</span>
    </li>
  </ul>
</template>
