<script setup lang="ts"> // 实现
import { computed, ref } from 'vue';

import type { SidebarItemKey, SidebarSettings } from '../../types';
import { useI18n, type I18nKey } from '../../features/i18n'; // 实现
import { SIDEBAR_ITEMS, normalizeSidebarOrder } from '../../features/settings/sidebarItems';
import { useDesktopTheme } from '../../composables/useDesktopTheme';

interface Props { // 实现
  sidebar: SidebarSettings; // 实现
  currentViewMode: string; // 实现
  currentPath: string; // 实现
  isDragActive: boolean; // 实现
}

const props = defineProps<Props>(); // 实现
const { t } = useI18n(); // 实现
const { icon } = useDesktopTheme();

const sidebarLabelKeys: Record<SidebarItemKey, I18nKey> = { // 实现
  localMusic: 'sidebar.localMusic', // 实现
  artists: 'sidebar.artists', // 实现
  albums: 'sidebar.albums', // 实现
  favorites: 'sidebar.favorites', // 实现
  recent: 'sidebar.recent', // 实现
  folders: 'sidebar.folders', // 实现
  plugins: 'sidebar.plugins', // 实现
  account: 'sidebar.account', // 实现
};

const emit = defineEmits<{
  (event: 'openHome'): void; // 实现
  (event: 'select', key: SidebarItemKey): void;
  (event: 'hoverArtists'): void; // 实现
  (event: 'hoverAlbums'): void; // 实现
}>();

const hoveredItem = ref<string | null>(null); // 实现
let leaveTimer: ReturnType<typeof setTimeout> | undefined; // 实现

function handleItemEnter(id: string) { // 实现
  clearTimeout(leaveTimer); // 实现
  hoveredItem.value = id; // 实现

  if (id === 'artists') emit('hoverArtists');
  if (id === 'albums') emit('hoverAlbums');
}

function handleItemLeave() { // 实现
  leaveTimer = setTimeout(() => { // 实现
    hoveredItem.value = null; // 实现
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

const baseNavClasses = 'px-3 py-2 mx-2 rounded-md cursor-pointer flex items-center transition-all duration-100 text-sm font-medium active:scale-[0.97] whitespace-nowrap min-w-0';
const activeNavClasses = 'bg-black/10 dark:bg-white/10 text-black dark:text-white font-semibold shadow-sm';
const idleClasses = 'text-gray-800 dark:text-gray-200'; // 实现
const hoverClasses = 'bg-black/5 dark:bg-white/5 text-black dark:text-white translate-x-1'; // 实现

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
    <li
      @click="emit('openHome')"
      @mouseenter="handleItemEnter('home')" 
      @mouseleave="handleItemLeave()" 
      :class="[baseNavClasses, isHomeActive ? activeNavClasses : idleClasses, hoveredItem === 'home' && !isHomeActive ? hoverClasses : '']"
    >
      <img v-if="icon('nav.home')" :src="icon('nav.home')" alt="" class="h-4 w-4 mr-3 shrink-0 object-contain" />
      <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
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
</template>
