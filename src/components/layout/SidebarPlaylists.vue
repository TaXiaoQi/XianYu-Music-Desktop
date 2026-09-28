<script setup lang="ts">
import { ref } from 'vue';
import { Download } from 'lucide-vue-next';

import type { Playlist } from '../../types';
import type { FavoriteCollectionEntry } from '../../features/collections/store';
import FavoriteCollectionPanel from './sidebar/FavoriteCollectionPanel.vue';

interface SidebarPlaylistProps {
  isOpen: boolean; playlists: Playlist[]; selectedPlaylistIds: Set<string>;
  favoriteCollections?: FavoriteCollectionEntry[];
  playlistCoverCacheVersion: number; getPlaylistCover: (playlistId: string) => string | undefined;
  dragState: { active: boolean; type: string; data: any; targetPlaylist: { id: string } | null };
  dragOverId: string | null; dragPosition: 'top' | 'bottom' | null;
}

const sideProps = defineProps<SidebarPlaylistProps>();

const trigger = defineEmits<{
  (event: 'update:isOpen', value: boolean): void; (event: 'createPlaylist', nativeEvent: MouseEvent): void;
  (event: 'importPlaylist', nativeEvent: MouseEvent): void; (event: 'pointerDown', nativeEvent: PointerEvent, index: number, playlist: Playlist): void;
  (event: 'itemPointerMove', nativeEvent: PointerEvent, playlistId: string): void; (event: 'playlistClick', nativeEvent: MouseEvent, id: string): void;
  (event: 'playlistContextMenu', nativeEvent: MouseEvent, playlist: Playlist): void; (event: 'deletePlaylist', id: string, name: string): void;
  (event: 'favoriteCollectionClick', entry: FavoriteCollectionEntry): void; (event: 'removeFavoriteCollection', key: string): void;
}>();

const favGroupExpanded = ref(true);

const toggleGroupOpen = () => trigger('update:isOpen', !sideProps.isOpen);

// 读取前触碰缓存版本号，确保封面刷新后模板重新求值
const coverFor = (playlistId: string) => {
  void sideProps.playlistCoverCacheVersion;
  return sideProps.getPlaylistCover(playlistId);
};

// 行内拖拽/选中态样式聚合计算
const rowStateClass = (list: Playlist) => {
  const beingDragged = sideProps.dragState.active
    && sideProps.dragState.type === 'playlist'
    && sideProps.dragState.data?.id === list.id;
  const receivingSongs = sideProps.dragState.active
    && sideProps.dragState.targetPlaylist?.id === list.id
    && sideProps.dragState.type === 'song';
  const edgeTop = sideProps.dragState.type === 'playlist' && sideProps.dragOverId === list.id && sideProps.dragPosition === 'top';
  const edgeBottom = sideProps.dragState.type === 'playlist' && sideProps.dragOverId === list.id && sideProps.dragPosition === 'bottom';

  return {
    'bg-black/10 dark:bg-white/10 text-black dark:text-white font-medium shadow-sm translate-x-1':
      sideProps.selectedPlaylistIds.has(list.id),
    'hover:bg-black/5 dark:hover:bg-white/5 text-gray-600 dark:text-gray-300 hover:translate-x-1':
      !sideProps.selectedPlaylistIds.has(list.id),
    'opacity-50 bg-gray-100 dark:bg-white/5': beingDragged,
    '!bg-red-500/10 !ring-2 !ring-[#EC4141] ring-inset': receivingSongs,
    '!border-t-[#EC4141]': edgeTop,
    '!border-b-[#EC4141]': edgeBottom,
  };
};

const rowBaseClass = 'playlist-drop-target px-3 py-2 mx-2 rounded-md cursor-pointer flex items-center transition-all duration-300 group relative select-none active:scale-[0.98] border-t-2 border-transparent border-b-2 [touch-action:none]';

const itemActionClass = 'absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-gray-400 dark:text-white/60 hover:text-red-500 transition-all p-1';
</script>

<template>
  <section class="mt-6">
    <!-- 分组标题：折叠开关 + 新建/导入入口 -->
    <div class="group px-4 pr-3 py-2 flex items-center justify-between">
      <div
        class="flex items-center gap-1 cursor-pointer text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
        @click.stop="toggleGroupOpen">
        <svg :class="['h-3 w-3 transition-transform duration-200', isOpen ? 'rotate-90' : '']" fill="none" viewBox="0 0 24 24" stroke="currentColor" xmlns="http://www.w3.org/2000/svg"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
        <span class="font-bold text-xs tracking-wide">我的歌单</span>
        <span class="text-xs font-normal ml-0.5 text-gray-500 dark:text-gray-400">{{ playlists.length }}</span></div>
      <div class="flex items-center gap-2">
        <button
          class="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded p-0.5 transition-colors"
          title="新建歌单"
          @click.stop="$emit('createPlaylist', $event)">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg></button>
        <button
          class="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded p-0.5 transition-colors"
          title="导入歌单"
          @click.stop="$emit('importPlaylist', $event)">
          <Download class="h-4 w-4" :stroke-width="2" /></button></div></div>

    <Transition name="group-reveal">
      <ul v-show="isOpen" class="mt-1 space-y-0.5 overflow-hidden">
        <TransitionGroup name="row-slide">
          <li v-for="(list, index) in playlists" :key="list.id" :class="[rowBaseClass, rowStateClass(list)]"
            :data-playlist-id="list.id" :data-playlist-name="list.name"
            @pointerdown="$emit('pointerDown', $event, index, list)"
            @pointermove="$emit('itemPointerMove', $event, list.id)"
            @click.stop="$emit('playlistClick', $event, list.id)" @contextmenu="$emit('playlistContextMenu', $event, list)">
            <div class="w-9 h-9 shrink-0 rounded border border-gray-100/50 bg-gray-200/50 mr-3 flex items-center justify-center overflow-hidden transition-transform duration-300 group-hover:scale-110">
              <img v-if="coverFor(list.id)" :src="coverFor(list.id)" class="w-full h-full object-cover" alt="Cover" loading="lazy" decoding="async" />
              <svg v-else class="h-5 w-5 text-gray-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" xmlns="http://www.w3.org/2000/svg"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg></div>
            <div class="flex min-w-0 flex-1 flex-col justify-center">
              <span class="text-sm truncate leading-tight mb-0.5">{{ list.name }}</span>
              <span class="text-[10px] text-gray-600 dark:text-gray-300 leading-tight">{{ list.songPaths.length }} 首</span></div>
            <button :class="itemActionClass" title="删除歌单" @click.stop="$emit('deletePlaylist', list.id, list.name)">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button></li>
        </TransitionGroup>
      </ul>
    </Transition>

    <!-- 收藏歌单分组 -->
    <FavoriteCollectionPanel
      v-if="favoriteCollections && favoriteCollections.length > 0"
      v-model:expanded="favGroupExpanded"
      :collections="favoriteCollections"
      :resolve-playlist-cover="coverFor"
      @item-click="$emit('favoriteCollectionClick', $event)"
      @item-remove="$emit('removeFavoriteCollection', $event)"
    />
  </section>
</template>

<style scoped>
/* 条目进出场动画 */
.row-slide-enter-active,
.row-slide-leave-active { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
.row-slide-enter-from,
.row-slide-leave-to { opacity: 0; transform: translateX(-10px); }

/* 分组列表展开收起动画 */
.group-reveal-enter-active,
.group-reveal-leave-active { transition: all 0.3s ease-in-out; max-height: 500px; overflow: hidden; }
.group-reveal-enter-from,
.group-reveal-leave-to { max-height: 0; opacity: 0; }
</style>
