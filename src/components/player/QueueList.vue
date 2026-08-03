<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useVirtualizer } from '@tanstack/vue-virtual';

import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { usePlaybackStore } from '../../features/playback/store';
import { useLibraryStore } from '../../features/library/store';
import { useSettings } from '../../features/settings/useSettings';

const { settings } = useSettings();
const songClickAction = computed(() => settings.value.songClickAction || 'double');

const libraryStore = useLibraryStore();
const { sourceSongs } = storeToRefs(libraryStore);
const { playQueue, currentSong, playSong, formatDuration } = usePlaybackController();
const playbackStore = usePlaybackStore();
const { tempQueue } = storeToRefs(playbackStore);

// 合并显示：下一首播放（tempQueue）在前，播放队列（playQueue）在后；
// 两者皆空时回退到当前视图歌曲列表
const queue = computed(() => {
  if (playQueue.value.length > 0 || tempQueue.value.length > 0) {
    return [...tempQueue.value, ...playQueue.value];
  }
  return sourceSongs.value;
});

// --- 虚拟滚动 ---
// 待播清单可能包含整个音乐库（数千首），全量渲染会导致 DOM 节点过多、内存占用高。
// 使用虚拟滚动只渲染可视区域内的条目（+ overscan 缓冲），大幅降低 DOM 节点数量。
const scrollContainerRef = ref<HTMLElement | null>(null);
const ROW_HEIGHT = 56; // p-3(24px) + 两行文本(~28px) + 间距 ≈ 56px

const virtualizer = useVirtualizer({
  get count() { return queue.value.length; },
  getScrollElement: () => scrollContainerRef.value,
  estimateSize: () => ROW_HEIGHT,
  overscan: 6,
});

const virtualItems = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());

// 自动滚动到当前播放歌曲
watch(currentSong, async () => {
  await nextTick();
  scrollToCurrent();
}, { immediate: true });

const scrollToCurrent = () => {
  if (!currentSong.value) return;
  const index = queue.value.findIndex(s => s.path === currentSong.value?.path);
  if (index !== -1) {
    virtualizer.value.scrollToIndex(index, { align: 'center', behavior: 'smooth' });
  }
};
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center justify-between mb-4 px-2">
      <h2 class="text-xl font-bold text-white">待播清单</h2>
      <span class="text-sm text-white/40">{{ queue.length }} 首歌曲</span>
    </div>
    
    <div ref="scrollContainerRef" class="flex-1 overflow-y-auto custom-scrollbar -mr-4 pr-4">
      <div v-if="queue.length > 0" :style="{ height: `${totalSize}px`, position: 'relative', width: '100%' }">
        <div
          v-for="vItem in virtualItems"
          :key="queue[vItem.index].path + vItem.index"
          :style="{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: `${vItem.size}px`,
            transform: `translateY(${vItem.start}px)`,
          }"
          class="flex items-center gap-3 p-3 rounded-lg hover:bg-white/10 cursor-pointer group transition-colors duration-200"
          :class="currentSong?.path === queue[vItem.index].path ? 'bg-white/15' : ''"
          @click="songClickAction === 'single' && playSong(queue[vItem.index])"
          @dblclick="songClickAction !== 'single' && playSong(queue[vItem.index])"
        >
          <!-- Playing Indicator or Index -->
          <div class="w-8 flex justify-center text-white/40 text-sm font-medium">
               <div v-if="currentSong?.path === queue[vItem.index].path" class="text-white animate-pulse">
                 <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
               </div>
               <span v-else class="group-hover:hidden">{{ vItem.index + 1 }}</span>
               <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 hidden group-hover:block text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
          
          <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate mb-0.5" :class="currentSong?.path === queue[vItem.index].path ? 'text-white' : 'text-white/90'">{{ queue[vItem.index].title || queue[vItem.index].name }}</div>
              <div class="text-xs truncate" :class="currentSong?.path === queue[vItem.index].path ? 'text-white/60' : 'text-white/40'">{{ queue[vItem.index].artist || 'Unknown' }}</div>
          </div>
          
          <div class="text-xs tabular-nums" :class="currentSong?.path === queue[vItem.index].path ? 'text-white/60' : 'text-white/30'">
              {{ formatDuration(queue[vItem.index].duration) }}
          </div>
       </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: rgba(255, 255, 255, 0.2);
}
</style>
