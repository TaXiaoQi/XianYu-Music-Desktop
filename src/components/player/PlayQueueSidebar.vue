<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { usePlayer } from '../../features/playback';
import { useThemeSettings } from '../../composables/useThemeSettings';
import { useSettings } from '../../features/settings/useSettings';
import { getSongSourceLabel } from '../../utils/remoteSong';
import ModernModal from '../common/ModernModal.vue';

const { settings } = useSettings();
const songClickAction = computed(() => settings.value.songClickAction || 'double');

const {
  playQueue,
  tempQueue,
  currentSong,
  showPlaylist,
  togglePlaylist,
  playSong,
  clearQueue,
  removeSongFromQueue,
} = usePlayer();
const { theme } = useThemeSettings();

const showClearModal = ref(false);

// 合并显示：下一首播放（tempQueue）在前，播放队列（playQueue）在后
const displayQueue = computed(() => [...tempQueue.value, ...playQueue.value]);

const handleClearClick = () => {
  showClearModal.value = true;
};

const confirmClear = () => {
  clearQueue();
  showClearModal.value = false;
};

const handleRemove = (song: any, e: Event) => {
  e.stopPropagation();
  removeSongFromQueue(song);
};

// --- 虚拟滚动 ---
// 播放队列可能包含大量歌曲，全量渲染会导致 DOM 节点过多、内存占用高。
// 使用虚拟滚动只渲染可视区域内的条目（+ overscan 缓冲），大幅降低 DOM 节点数量。
const scrollContainerRef = ref<HTMLElement | null>(null);
const ROW_HEIGHT = 64; // p-2.5(20px) + 两行文本(~36px) + 行间距(4px) + 余量(4px) ≈ 64px

const virtualizer = useVirtualizer({
  get count() { return displayQueue.value.length; },
  getScrollElement: () => scrollContainerRef.value,
  estimateSize: () => ROW_HEIGHT,
  overscan: 6,
});

const virtualItems = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());

// 将 virtualItem 与对应的 song 对象绑定，简化模板访问
const virtualSongs = computed(() =>
  virtualItems.value.map(vItem => ({
    ...vItem,
    song: displayQueue.value[vItem.index],
  }))
);

// 自动滚动到当前播放歌曲
const scrollToCurrentSong = async (behavior: ScrollBehavior = 'auto') => {
  if (!currentSong.value) return;

  await nextTick();

  const currentIndex = displayQueue.value.findIndex(song => song.path === currentSong.value?.path);
  if (currentIndex === -1) return;

  virtualizer.value.scrollToIndex(currentIndex, {
    align: 'center',
    behavior: behavior === 'smooth' ? 'smooth' : 'auto',
  });
};

watch(
  () => showPlaylist.value,
  visible => {
    if (!visible) return;
    void scrollToCurrentSong();
  },
);

watch(
  () => currentSong.value?.path,
  () => {
    if (!showPlaylist.value) return;
    void scrollToCurrentSong('smooth');
  },
);
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div v-if="showPlaylist" class="fixed inset-0 z-[90] bg-black/20 backdrop-blur-[2px]" @click="togglePlaylist"></div>
    </transition>

    <transition name="slide-right">
      <div
        v-if="showPlaylist"
        class="fixed right-0 rounded-l-2xl shadow-[0_18px_50px_rgba(15,23,42,0.22)] border-l border-t border-b border-white/70 dark:border-white/10 z-[100] flex flex-col overflow-hidden font-sans select-none bg-[#f7f9fc]/90 dark:bg-[#262626]/90 transition-all duration-300 ring-1 ring-black/5 dark:ring-white/5"
        :class="[
          (theme.dynamicBgType === 'none' && theme.mode === 'custom') ? '' : 'backdrop-blur-2xl',
          displayQueue.length > 0 ? 'bottom-24 w-[340px]' : 'bottom-5 w-[340px]'
        ]"
        :style="{ height: displayQueue.length > 0 ? 'calc(100vh - 180px)' : 'calc(100vh - 40px)', 'min-height': '200px' }"
        @click.stop
      >
        <div
          class="px-5 py-4 border-b border-[#d9e0ea] dark:border-white/10 flex justify-between items-center bg-[#f8fafc]/95 dark:bg-[#262626]/95 z-10 shadow-sm"
          :class="[(theme.dynamicBgType === 'none' && theme.mode === 'custom') ? '' : 'backdrop-blur-sm']"
        >
          <div class="flex items-center gap-3">
            <h3 class="font-bold text-[#172033] dark:text-white text-lg tracking-tight">播放队列</h3>
            <span class="text-xs text-[#34445c] dark:text-white font-semibold bg-[#e7edf5] dark:bg-white/12 px-2 py-0.5 rounded-full">{{ displayQueue.length }}</span>
          </div>
          <button
            @click="handleClearClick"
            class="text-[#34445c] dark:text-white/90 hover:text-[#EC4141] text-sm hover:bg-[#EC4141]/10 dark:hover:bg-red-500/15 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 active:scale-95"
            title="清空队列"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            <span>清空</span>
          </button>
        </div>

        <div ref="scrollContainerRef" class="flex-1 overflow-y-auto custom-scrollbar p-3 bg-[#eef3f8]/45 dark:bg-[#262626]/35">
          <div v-if="displayQueue.length === 0" class="h-full flex flex-col items-center justify-center text-[#34445c] dark:text-white/90 space-y-4 py-20">
            <div class="w-20 h-20 rounded-full bg-white/70 dark:bg-white/10 flex items-center justify-center shadow-inner">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-[#42526a] dark:text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
            </div>
            <span class="text-sm font-medium">播放队列为空</span>
          </div>

          <div v-else :style="{ height: `${totalSize}px`, position: 'relative', width: '100%' }">
            <div
              v-for="vItem in virtualSongs"
              :key="vItem.song.path + vItem.index"
              :style="{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${vItem.size}px`,
                transform: `translateY(${vItem.start}px)`,
              }"
            >
              <div
                class="group relative p-2.5 rounded-xl flex justify-between items-center cursor-default select-none transition-all duration-200 border border-transparent hover:bg-white/70 dark:hover:bg-white/10 hover:border-white/80 dark:hover:border-white/12"
                @click="songClickAction === 'single' && playSong(vItem.song)"
                @dblclick="songClickAction !== 'single' && playSong(vItem.song)"
              >
                <div class="w-8 flex justify-center items-center shrink-0">
                  <svg v-if="currentSong?.path === vItem.song.path" class="h-[18px] w-[18px] text-[#EC4141]" viewBox="0 0 24 24" fill="currentColor"><path d="M7 18h2V6H7v12zm4 4h2V2h-2v20zm-8-8h2v-4H3v4zm12 4h2V6h-2v12zm4-8v4h2v-4h-2z"/></svg>
                  <svg v-else class="h-[18px] w-[18px] text-[#52647d] dark:text-white/75" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </div>

                <div class="flex-1 min-w-0 pr-4 flex flex-col">
                  <div class="flex min-w-0 items-center gap-1.5">
                    <span class="min-w-0 truncate text-sm leading-tight" :class="currentSong?.path === vItem.song.path ? 'font-bold text-[#EC4141]' : 'font-medium'">{{ vItem.song.title || vItem.song.name.replace(/\.[^/.]+$/, "") }}</span>
                    <span
                      v-if="vItem.song.path?.startsWith('lx://') || vItem.song.path?.startsWith('plugin://') || vItem.song.path?.startsWith('remote://')"
                      class="shrink-0 rounded-full border border-[#EC4141]/20 bg-[#EC4141]/10 px-1.5 py-[1px] text-[10px] font-bold text-[#EC4141]"
                    >{{ getSongSourceLabel(vItem.song) }}</span>
                  </div>
                  <span
                    class="text-[11px] truncate mt-1 font-medium text-[#42526a] dark:text-white/80"
                  >{{ vItem.song.artist || 'Unknown Artist' }}</span>
                </div>

                <div class="flex items-center gap-1 shrink-0">
                  <svg class="h-[18px] w-[18px] text-[#52647d] dark:text-white/75" viewBox="0 0 24 24" fill="currentColor"><path d="M20 9H4v2h16V9zM4 15h16v-2H4v2z"/></svg>
                  <button
                    @click="handleRemove(vItem.song, $event)"
                    class="w-6 h-6 flex items-center justify-center text-[#52647d] dark:text-white/75 hover:text-red-500 transition-colors rounded-full hover:bg-black/5 dark:hover:bg-white/10 active:scale-90"
                    title="移出队列"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <ModernModal
      v-model:visible="showClearModal"
      title="清空播放队列"
      content="确定要清空当前播放队列吗？此操作不会影响本地文件。"
      type="danger"
      confirm-text="清空"
      @confirm="confirmClear"
    />
  </Teleport>
</template>

<style scoped>
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
