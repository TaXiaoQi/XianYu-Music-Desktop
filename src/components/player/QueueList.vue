<script setup lang="ts"> // 实现
import { computed, nextTick, watch } from 'vue';
import { storeToRefs as toRefsOf } from 'pinia';

import {
  usePlaybackController,
} from '../../features/playback/usePlaybackController';
import { usePlaybackStore as useQueueStore } from '../../features/playback/store';
import { useLibraryStore as useLibraryVault } from '../../features/library/store';
import { useSettings as useAppSettings } from '../../features/settings/useSettings';
import type { Song } from '../../types';

import PendingRowCard from './queue/PendingRowCard.vue';
import { useQueueWindow } from './queue/queueWindowing';

const { settings } = useAppSettings();
const clickMode = computed(() => settings.value.songClickAction || 'double');

const queueStore = useQueueStore();
const { tempQueue } = toRefsOf(queueStore);

const libraryVault = useLibraryVault();
const { sourceSongs } = toRefsOf(libraryVault);

const { playQueue, currentSong, playSong: startPlayback } = usePlaybackController();

/** 有排片时展示插队 + 主队列，否则回退为整库曲目列表 */
const pendingTracks = computed<Song[]>(() => {
  const linedUp = [...tempQueue.value, ...playQueue.value];
  return linedUp.length > 0 ? linedUp : sourceSongs.value;
});

const { viewportEl, renderedRows, contentExtent, placementFor, revealRow } = useQueueWindow<Song>({
  entries: pendingTracks,
  rowExtent: 56,
  bufferRows: 6,
});

/** 正在播放的曲目变化时，把对应行滚到视野中央 */
const followPlaying = () => {
  void nextTick(() => {
    const trackNow = currentSong.value;
    if (!trackNow) return;
    const position = pendingTracks.value.findIndex(entry => entry.path === trackNow.path);
    if (position !== -1) revealRow(position, 'smooth');
  });
};

watch(currentSong, followPlaying, { immediate: true });
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="mb-4 flex items-center justify-between px-2">
      <h2 class="font-bold text-xl text-white">待播清单</h2>
      <span class="text-white/40 text-sm">{{ pendingTracks.length }} 首歌曲</span>
    </header>

    <div ref="viewportEl" class="queue-scroll -mr-4 flex-1 overflow-y-auto pr-4">
      <div v-if="pendingTracks.length > 0" class="relative w-full" :style="{ height: `${contentExtent}px` }">
        <PendingRowCard
          v-for="row in renderedRows"
          :key="row.entry.path + row.index"
          :style="placementFor(row)"
          :entry="row.entry"
          :ordinal="row.index"
          :active="currentSong?.path === row.entry.path"
          :click-mode="clickMode"
          @activate="startPlayback"
        />
      </div>
    </div>
  </div>
</template>

<style scoped> /* 样式 */
.queue-scroll::-webkit-scrollbar { width: 6px; }
.queue-scroll::-webkit-scrollbar-track { background: transparent; }
.queue-scroll::-webkit-scrollbar-thumb { border-radius: 3px; background-color: rgba(255, 255, 255, .1); }
.queue-scroll::-webkit-scrollbar-thumb:hover { background-color: rgba(255, 255, 255, .2); }
</style>
