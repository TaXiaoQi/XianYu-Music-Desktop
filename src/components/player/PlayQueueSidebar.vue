<script setup lang="ts"> // 实现
import { computed, nextTick, ref, watch } from 'vue';

import { usePlayer } from '../../features/playback';
import { useThemeSettings as useSurfaceTheme } from '../../composables/useThemeSettings';
import { useSettings } from '../../features/settings/useSettings';
import type { Song } from '../../types';

import QueueDimmer from './queue/QueueDimmer.vue';
import QueuePanelHead from './queue/QueuePanelHead.vue';
import QueueVacantState from './queue/QueueVacantState.vue';
import QueueTrackRow from './queue/QueueTrackRow.vue';
import QueueWipeConfirm from './queue/QueueWipeConfirm.vue';
import { useQueueWindow } from './queue/queueWindowing';

const { settings } = useSettings();
const clickMode = computed(() => settings.value.songClickAction || 'double');

const player = usePlayer();

const settledTracks = player.playQueue;
const introTracks = player.tempQueue;
const playingTrack = player.currentSong;
const panelVisible = player.showPlaylist;
const flipPanel = player.togglePlaylist;
const startPlayback = player.playSong;
const wipeQueue = player.clearQueue;
const dropTrack = player.removeSongFromQueue;

const { theme: surfaceTheme } = useSurfaceTheme();

const wipeDialogShown = ref(false);

/** 临时插队的曲目排在最前，其后是常规播放队列 */
const linedUpTracks = computed<Song[]>(() => [...introTracks.value, ...settledTracks.value]);

const hasContent = computed(() => linedUpTracks.value.length > 0);

// 自定义纯色背景时表面本身不透明，无需毛玻璃
const flatSurface = computed(() => surfaceTheme.value?.dynamicBgType === 'none' && surfaceTheme.value?.mode === 'custom');

const panelTone = computed(() => ({
  'backdrop-blur-2xl': !flatSurface.value,
  'bottom-24': hasContent.value,
  'bottom-5': !hasContent.value,
}));

const panelMetrics = computed(() => ({
  height: hasContent.value ? 'calc(100vh - 180px)' : 'calc(100vh - 40px)',
  'min-height': '200px',
}));

const { viewportEl, renderedRows, contentExtent, placementFor, revealRow } = useQueueWindow<Song>({
  entries: linedUpTracks,
  rowExtent: 64,
  bufferRows: 6,
});

/** 打开面板或切歌时，把正在播放的一行滚回视野中央 */
const centerOnPlaying = (motion: 'auto' | 'smooth') => {
  void nextTick(() => {
    if (!playingTrack.value) return;
    const position = linedUpTracks.value.findIndex(entry => entry.path === playingTrack.value?.path);
    if (position >= 0) revealRow(position, motion);
  });
};

watch(panelVisible, opened => {
  if (!opened) return;
  centerOnPlaying('auto');
});

watch(() => playingTrack.value?.path, () => {
  if (!panelVisible.value) return;
  centerOnPlaying('smooth');
});

const requestWipe = () => {
  wipeDialogShown.value = true;
};

const performWipe = () => {
  wipeQueue();
  wipeDialogShown.value = false;
};

const ejectTrack = (track: Song) => {
  dropTrack(track);
};
</script>

<template>
  <Teleport to="body"> 
    <!-- 点击空白处关闭面板 -->
    <transition name="queue-veil">
      <QueueDimmer v-if="panelVisible" @dismiss="flipPanel" />
    </transition> 

    <transition name="queue-shelf">
      <aside
        v-if="panelVisible"
        v-on:click.stop
        class="fixed right-0 z-[100] flex w-[340px] select-none flex-col overflow-hidden rounded-l-2xl font-sans border-l border-t border-b border-white/70 bg-[#f7f9fc]/90 shadow-[0_18px_50px_rgba(15,23,42,0.22)] ring-1 ring-black/5 transition-all duration-300 dark:border-white/10 dark:bg-[#262626]/90 dark:ring-white/5"
        :class="panelTone"
        :style="panelMetrics"
      >
        <QueuePanelHead :total="linedUpTracks.length" :frosted="!flatSurface" @clear-requested="requestWipe" />

        <div ref="viewportEl" class="custom-scrollbar flex-1 overflow-y-auto bg-[#eef3f8]/45 p-3 dark:bg-[#262626]/35">
          <QueueVacantState v-if="!hasContent" />

          <div v-else class="relative w-full" :style="{ height: `${contentExtent}px` }">
            <div
              v-for="row in renderedRows"
              :key="row.entry.path + row.index"
              :style="placementFor(row)"
            >
              <QueueTrackRow
                :track="row.entry"
                :active="playingTrack?.path === row.entry.path"
                :click-mode="clickMode"
                @activate="startPlayback"
                @eject="ejectTrack"
              />
            </div>
          </div>
        </div>
      </aside>
    </transition> 

    <QueueWipeConfirm v-model:shown="wipeDialogShown" @confirmed="performWipe" />
  </Teleport>
</template>

<style scoped> /* 样式 */
.queue-shelf-enter-active,
.queue-shelf-leave-active {
  transition: all .25s cubic-bezier(.4, 0, .2, 1);
}

.queue-shelf-enter-from,
.queue-shelf-leave-to {
  opacity:0;
  transform: translate3d(100%, 0, 0);
}

.queue-veil-enter-active,
.queue-veil-leave-active {
  transition: opacity .2s ease;
}

.queue-veil-enter-from,
.queue-veil-leave-to {
  opacity:0;
}
</style>
