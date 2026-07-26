<script setup lang="ts">
import { ref } from 'vue';

interface SidebarSettings {
  showLocalMusic: boolean;
  showArtists: boolean;
  showAlbums: boolean;
  showFavorites: boolean;
  showRecent: boolean;
  showFolders: boolean;
  showStatistics: boolean;
}

interface Props {
  sidebar: SidebarSettings;
  currentViewMode: string;
  currentPath: string;
  isDragActive: boolean;
}

const props = defineProps<Props>();

defineEmits<{
  (event: 'openHome'): void;
  (event: 'openAll'): void;
  (event: 'openArtists'): void;
  (event: 'openAlbums'): void;
  (event: 'openFavorites'): void;
  (event: 'openRecent'): void;
  (event: 'openFolder'): void;
  (event: 'openPlugins'): void;
  (event: 'hoverArtists'): void;
  (event: 'hoverAlbums'): void;
}>();

const hoveredItem = ref<string | null>(null);
let leaveTimer: ReturnType<typeof setTimeout> | undefined;

function handleItemEnter(id: string) {
  clearTimeout(leaveTimer);
  hoveredItem.value = id;
}

function handleItemLeave() {
  leaveTimer = setTimeout(() => {
    hoveredItem.value = null;
  }, 150);
}

const baseNavClasses = 'px-3 py-2 mx-2 rounded-md cursor-pointer flex items-center transition-all duration-100 text-sm font-medium active:scale-[0.97]';
const activeNavClasses = 'bg-black/10 dark:bg-white/10 text-black dark:text-white font-semibold shadow-sm translate-x-1';
const idleClasses = 'text-gray-800 dark:text-gray-200';
const hoverClasses = 'bg-black/5 dark:bg-white/5 text-black dark:text-white translate-x-1';
</script>

<template>
  <ul class="space-y-1 transition-all duration-200" :class="{ 'opacity-30 grayscale pointer-events-none': isDragActive }">
    <li
      @click="$emit('openHome')"
      @mouseenter="handleItemEnter('home')"
      @mouseleave="handleItemLeave()"
      :class="[baseNavClasses, (props.currentViewMode === 'statistics' && props.currentPath === '/') ? activeNavClasses : idleClasses, hoveredItem === 'home' && !(props.currentViewMode === 'statistics' && props.currentPath === '/') ? hoverClasses : '']"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
      <span>首页</span>
    </li>

    <template v-if="props.sidebar.showLocalMusic">
      <li
        @click="$emit('openAll')"
        @mouseenter="handleItemEnter('all')"
        @mouseleave="handleItemLeave()"
        :class="[baseNavClasses, (props.currentViewMode === 'all' && props.currentPath === '/') ? activeNavClasses : idleClasses, hoveredItem === 'all' && !(props.currentViewMode === 'all' && props.currentPath === '/') ? hoverClasses : '']"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
        <span>本地音乐</span>
      </li>
    </template>

    <template v-if="props.sidebar.showArtists">
      <li
        @click="$emit('openArtists')"
        @mouseenter="handleItemEnter('artists'); $emit('hoverArtists')"
        @mouseleave="handleItemLeave()"
        :class="[baseNavClasses, props.currentPath === '/artists' ? activeNavClasses : idleClasses, hoveredItem === 'artists' && props.currentPath !== '/artists' ? hoverClasses : '']"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
        <span>歌手</span>
      </li>
    </template>

    <template v-if="props.sidebar.showAlbums">
      <li
        @click="$emit('openAlbums')"
        @mouseenter="handleItemEnter('albums'); $emit('hoverAlbums')"
        @mouseleave="handleItemLeave()"
        :class="[baseNavClasses, props.currentPath === '/albums' ? activeNavClasses : idleClasses, hoveredItem === 'albums' && props.currentPath !== '/albums' ? hoverClasses : '']"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2" /><circle cx="12" cy="12" r="3" stroke-width="2" /></svg>
        <span>专辑</span>
      </li>
    </template>

    <template v-if="props.sidebar.showFavorites">
      <li
        @click="$emit('openFavorites')"
        @mouseenter="handleItemEnter('favorites')"
        @mouseleave="handleItemLeave()"
        :class="[baseNavClasses, props.currentPath === '/favorites' ? activeNavClasses : idleClasses, hoveredItem === 'favorites' && props.currentPath !== '/favorites' ? hoverClasses : '']"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
        <span>我的收藏</span>
      </li>
    </template>

    <template v-if="props.sidebar.showRecent">
      <li
        @click="$emit('openRecent')"
        @mouseenter="handleItemEnter('recent')"
        @mouseleave="handleItemLeave()"
        :class="[baseNavClasses, props.currentPath === '/recent' ? activeNavClasses : idleClasses, hoveredItem === 'recent' && props.currentPath !== '/recent' ? hoverClasses : '']"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span>最近播放</span>
      </li>
    </template>

    <template v-if="props.sidebar.showFolders">
      <li
        @click="$emit('openFolder')"
        @mouseenter="handleItemEnter('folders')"
        @mouseleave="handleItemLeave()"
        :class="[baseNavClasses, (props.currentViewMode === 'folder' && props.currentPath === '/') ? activeNavClasses : idleClasses, hoveredItem === 'folders' && !(props.currentViewMode === 'folder' && props.currentPath === '/') ? hoverClasses : '']"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
        <span>文件夹</span>
      </li>
    </template>

    <li
      @click="$emit('openPlugins')"
      @mouseenter="handleItemEnter('plugins')"
      @mouseleave="handleItemLeave()"
      :class="[baseNavClasses, props.currentPath === '/plugins' ? activeNavClasses : idleClasses, hoveredItem === 'plugins' && props.currentPath !== '/plugins' ? hoverClasses : '']"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>
      <span>插件管理</span>
    </li>
  </ul>
</template>
