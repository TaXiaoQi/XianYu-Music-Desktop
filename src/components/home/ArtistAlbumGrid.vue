<script setup lang="ts">
// 首页歌手详情里的专辑网格：封面读取缓存 Map，空态由异步组件兜底。
import { defineAsyncComponent as lazyLoad } from 'vue';

const HomeEmptyState = lazyLoad(() => import('./HomeEmptyState.vue'));

interface AlbumCardItem { key: string; name: string; count: number; artist: string; firstSongPath: string }

interface AlbumGridProps { albums: AlbumCardItem[]; coverCache: Map<string, string>; loadingSet: Set<string> }

const props = defineProps<AlbumGridProps>();

defineEmits<{ (event: 'openAlbum', albumKey: string): void }>();

// 未命中缓存时返回 undefined，与直接读取 Map 的展示行为保持一致。
function coverOf(album: AlbumCardItem) {
  return props.coverCache.get(album.firstSongPath);
}

function isLoading(album: AlbumCardItem) {
  return props.loadingSet.has(album.firstSongPath);
}

function albumInitial(name: string) {
  return name ? name.substring(0, 1).toUpperCase() : 'A';
}
</script>

<template>
  <section class="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 custom-scrollbar relative z-0"><div v-if="albums.length > 0" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-6 gap-y-10">
    <div v-for="album in albums" :key="album.key" @click="$emit('openAlbum', album.key)" class="group cursor-pointer rounded-xl p-2 md:p-3 transition-all duration-300 flex flex-col relative select-none hover:bg-white/40 dark:hover:bg-white/5">
      <div class="relative w-full aspect-square mb-3 mt-4"><div class="absolute inset-x-2 top-0 bottom-1/2 bg-[#1c1c1c] rounded-t-full shadow-inner origin-bottom translate-y-[-10%] group-hover:translate-y-[-24%] transition-transform duration-500 ease-out z-0 flex items-center justify-center overflow-hidden border border-[#333]">
        <div class="absolute inset-0 rounded-t-full border border-white/5 scale-90"></div><div class="absolute inset-0 rounded-t-full border border-white/5 scale-75"></div><div class="absolute inset-0 rounded-t-full border border-white/5 scale-50"></div>
      </div><div class="absolute inset-0 z-10 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-100 dark:border-white/10 p-1 flex items-center justify-center overflow-hidden group-hover:shadow-xl transition-shadow duration-300">
        <div v-if="coverOf(album)" :style="{ backgroundImage: `url(${coverOf(album)})` }" class="w-full h-full bg-cover bg-center rounded-sm"></div>
        <div v-else :class="{ 'animate-pulse': isLoading(album) }" class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-white/5 dark:to-white/10 rounded-sm flex items-center justify-center text-4xl font-bold text-gray-300 dark:text-gray-600 shadow-inner">{{ albumInitial(album.name) }}</div>
      </div></div>
      <div class="flex flex-col items-start px-1 z-20"><h3 class="font-bold text-sm md:text-base text-gray-800 dark:text-gray-200 truncate w-full group-hover:text-[#EC4141] transition-colors leading-tight">{{ album.name }}</h3><p class="text-xs text-gray-500 dark:text-gray-400 truncate w-full mt-1.5 flex items-center gap-1.5 opacity-80"><span class="font-medium">{{ album.count }}</span><span class="w-0.5 h-0.5 rounded-full bg-gray-400"></span><span>{{ album.artist }}</span></p></div>
    </div></div>

    <HomeEmptyState v-else message="No albums found" icon-path="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></section>
</template>
