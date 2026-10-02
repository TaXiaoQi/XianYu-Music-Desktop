<script setup lang="ts"> // 实现
import { LogicalSize } from '@tauri-apps/api/dpi';
import { emitTo, listen } from '@tauri-apps/api/event'; // 实现
import { getCurrentWindow } from '@tauri-apps/api/window'; // 实现
import { computed, onMounted, onUnmounted, ref, toRef, watch } from 'vue';

import { getNextWheelVolume } from '../../features/playback';
import { clamp } from '../../utils/math';
import { applyWindowMaterial } from '../../composables/windowMaterial';
import { applyDarkClassWithTransition } from '../../composables/themeTransition';
import {
  MINI_PLAYER_ACTION_EVENT, // 实现
  MINI_PLAYER_BOUNDS_EVENT, // 实现
  MINI_PLAYER_READY_EVENT, // 实现
  MINI_PLAYER_REQUEST_STATE_EVENT, // 实现
  MINI_PLAYER_VISIBILITY_EVENT, // 实现
  MINI_PLAYER_WINDOW_BASE_HEIGHT, // 实现
  MINI_PLAYER_WINDOW_EXPANDED_HEIGHT, // 实现
  MINI_PLAYER_WINDOW_WIDTH, // 实现
  type MiniPlayerAction, // 实现
} from '../../features/miniPlayer/shared'; // 实现
import { formatDuration } from '../../utils/format';

import MiniCoverArt from './miniPlayer/MiniCoverArt.vue';
import MiniQueuePanel from './miniPlayer/MiniQueuePanel.vue';
import MiniTrackCaption from './miniPlayer/MiniTrackCaption.vue';
import MiniTransportCluster from './miniPlayer/MiniTransportCluster.vue';
import { useMiniPlayerFeed } from './miniPlayer/useMiniPlayerFeed';
import { useMiniVolumePopover } from './miniPlayer/useMiniVolumePopover';

const appWindow = getCurrentWindow(); // 实现
const isWindowVisible = ref(false); // 实现
const hovering = ref(false);
const scrubbing = ref(false);
const showPlaylist = ref(false);
const progressBarEl = ref<HTMLElement | null>(null);
const volumeButtonEl = ref<HTMLElement | null>(null);
const releaseHooks: Array<() => void> = [];

const sendAction = (action: MiniPlayerAction) => void emitTo('main', MINI_PLAYER_ACTION_EVENT, action);

const feed = useMiniPlayerFeed({
  isScrubbing: () => scrubbing.value,
  onSnapshotApplied: () => {
    void volumePopover.sync();
  },
});

const volumePopover = useMiniVolumePopover({
  volume: toRef(feed.snapshot, 'volume'),
  anchorElement: () => volumeButtonEl.value,
  emitAction: (action) => sendAction(action),
  collapsePlaylist: () => {
    showPlaylist.value = false;
  },
});

const progressPercent = computed(() => {
  if (!feed.snapshot.length || feed.snapshot.length <= 0) return 0;
  return clamp((feed.snapshot.position / feed.snapshot.length) * 100, 0, 100);
});

const loopGlyph = computed(() => {
  if (feed.snapshot.loopMode === 1) return 'repeat-one';
  if (feed.snapshot.loopMode === 2) return 'shuffle';
  return 'repeat';
});

const loopCaption = computed(() => {
  if (feed.snapshot.loopMode === 1) return '单曲循环';
  if (feed.snapshot.loopMode === 2) return '随机播放';
  return '顺序播放';
});

const scrubTo = (clientX: number) => {
  const bar = progressBarEl.value;
  if (!bar || !feed.snapshot.length) return;
  const bounds = bar.getBoundingClientRect();
  const ratio = clamp((clientX - bounds.left) / bounds.width, 0, 1);
  feed.snapshot.position = ratio * feed.snapshot.length;
};

const startProgressDrag = (event: PointerEvent) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (!feed.snapshot.length) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  scrubbing.value = true;
  scrubTo(event.clientX);
};

const finishScrub = () => {
  if (!scrubbing.value) return;
  scrubbing.value = false;
  sendAction({ type: 'seek', time: feed.snapshot.position });
};

const applyVolume = (candidate: number) => {
  const normalized = clamp(Math.round(candidate), 0, 100);
  feed.snapshot.volume = normalized;
  sendAction({ type: 'set-volume', volume: normalized });
  void volumePopover.sync();
};

const onVolumeWheel = (event: WheelEvent) => {
  applyVolume(getNextWheelVolume(feed.snapshot.volume, event.deltaY));
};

const syncWindowExtent = async () => {
  const extent = showPlaylist.value
    ? MINI_PLAYER_WINDOW_EXPANDED_HEIGHT
    : MINI_PLAYER_WINDOW_BASE_HEIGHT;

  const bounded = new LogicalSize(MINI_PLAYER_WINDOW_WIDTH, extent);
  await appWindow.setMinSize(bounded);
  await appWindow.setMaxSize(bounded);
  await appWindow.setSize(bounded);
};

const flipPlaylist = () => {
  showPlaylist.value = !showPlaylist.value;
  if (showPlaylist.value) {
    void volumePopover.dismiss();
  }
};

const markHover = () => {
  hovering.value = true;
};

const clearHover = () => {
  hovering.value = false;
};

const handlePointerMove = (event: PointerEvent) => {
  if (!isWindowVisible.value) return;
  if (scrubbing.value) {
    event.preventDefault(); // 实现
    scrubTo(event.clientX);
  }
};

const handlePointerRelease = () => {
  if (scrubbing.value) {
    finishScrub();
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') { // 实现
    void volumePopover.dismiss();
    showPlaylist.value = false;
  }
};

watch(showPlaylist, () => {
  void syncWindowExtent();
});

watch([() => feed.snapshot.material, () => feed.snapshot.blurTint, () => feed.snapshot.dark], async () => {
  applyDarkClassWithTransition(feed.snapshot.dark);

  try {
    await appWindow.setTheme(feed.snapshot.dark ? 'dark' : 'light');
  } catch (error) { // 实现
    console.warn('Failed to set mini window theme:', error);
  }

  await applyWindowMaterial(
    feed.snapshot.material,
    feed.snapshot.dark,
    feed.snapshot.blurTint,
  );
});

onMounted(async () => { // 实现
  try {
    await appWindow
      .setBackgroundColor([0, 0, 0, 0]);
  } catch (error) { // 实现
    console.warn('Failed to force transparent background for mini player window:', error); // 实现
  }

  await appWindow.setAlwaysOnTop(true); // 实现
  await syncWindowExtent();

  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerRelease);
  window.addEventListener('pointercancel', handlePointerRelease);
  window.addEventListener('keydown', handleKeydown);

  await feed.start();
  await volumePopover.start();

  releaseHooks.push(await listen<{ visible: boolean }>(MINI_PLAYER_VISIBILITY_EVENT, (event) => {
    isWindowVisible.value = event.payload.visible; // 实现
    if (isWindowVisible.value) { // 实现
      void syncWindowExtent();
      return;
    }

    void volumePopover.dismiss();
    scrubbing.value = false;
  }));

  releaseHooks.push(await appWindow.onMoved(async () => {
    const factor = await appWindow.scaleFactor(); // 实现
    const spot = (await appWindow.outerPosition()).toLogical(factor);
    await emitTo('main', MINI_PLAYER_BOUNDS_EVENT, { // 实现
      x: spot.x,
      y: spot.y,
    });
  }));

  releaseHooks.push(await appWindow.onCloseRequested((request) => {
    request.preventDefault();
    sendAction({ type: 'close' }); // 实现
  }));

  await feed.prefill();
  await feed.startSessionSync();

  await emitTo('main', MINI_PLAYER_READY_EVENT); // 实现
  await emitTo('main', MINI_PLAYER_REQUEST_STATE_EVENT); // 实现
});

onUnmounted(() => { // 实现
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', handlePointerRelease);
  window.removeEventListener('pointercancel', handlePointerRelease);
  window.removeEventListener('keydown', handleKeydown);
  releaseHooks.splice(0).forEach((off) => off());
  feed.stop();
  volumePopover.stop();
});
</script>

<template>
  <div
    class="w-[400px] h-full relative select-none overflow-hidden bg-transparent !border-none !outline-none !ring-0 !shadow-none rounded-[8px] transition-opacity duration-200 ease-out"
    :class="isWindowVisible ? 'opacity-100' : 'opacity-0'"
    @mouseenter="markHover"
    @mouseleave="clearHover"
  >
    <div class="absolute inset-0 -z-10" style="background-color: #262626;"></div>
    <div
      v-if="feed.snapshot.coverUrl"
      class="absolute inset-0 -z-10 bg-cover bg-center opacity-60 transition-all duration-300"
      :style="{ backgroundImage: `url(${feed.snapshot.coverUrl})`, filter: 'blur(15px)' }"
    ></div>

    <div class="h-[92px] w-full flex items-end gap-3 px-5 -mt-1" data-tauri-drag-region>
      <MiniCoverArt :cover="feed.snapshot.coverUrl" @restore="sendAction({ type: 'restore-main' })" />

      <div class="flex-1 min-w-0 flex flex-col justify-end pb-1" data-tauri-drag-region>
        <div class="min-w-0 flex items-center gap-2" data-tauri-drag-region>
          <MiniTrackCaption :track="feed.snapshot.track" />

          <MiniTransportCluster
            :playing="feed.snapshot.playing"
            @previous="sendAction({ type: 'prev-song' })"
            @toggle="sendAction({ type: 'toggle-play' })"
            @advance="sendAction({ type: 'next-song' })"
          />
        </div>

        <div class="mt-1 flex items-center gap-2" data-tauri-drag-region>
          <span class="text-[10px] text-white/70 tabular-nums select-none w-8 text-right">{{ formatDuration(feed.snapshot.position) }}</span>
          <div
            ref="progressBarEl"
            class="relative flex-1 h-1.5 bg-white/20 rounded-full cursor-pointer [touch-action:none]"
            @pointerdown.stop="startProgressDrag"
          >
            <div class="absolute left-0 top-0 h-full bg-white/80 rounded-full" :style="{ width: progressPercent + '%' }"></div>
            <div
              class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-sm opacity-0 transition-opacity"
              :class="{ 'opacity-100': hovering || scrubbing }"
              :style="{ left: progressPercent + '%' }"
            ></div>
          </div>
          <span class="text-[10px] text-white/70 tabular-nums select-none w-8">{{ formatDuration(feed.snapshot.length) }}</span>
        </div>
      </div>
    </div>

    <div class="h-[44px] w-full flex items-center justify-center gap-5 px-6 pointer-events-auto">
      <button
        class="shrink-0 flex items-center justify-center w-8 h-8 rounded-full transition-colors active:scale-95"
        :class="feed.snapshot.favorite ? 'text-[color:var(--favorite-color)]' : 'text-white/80 hover:text-white hover:bg-white/10'"
        :title="feed.snapshot.favorite ? '取消收藏' : '添加到收藏'"
        @click.stop="sendAction({ type: 'toggle-favorite' })"
      >
        <svg v-if="feed.snapshot.favorite" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
          />
        </svg>
      </button>

      <button
        class="transition-colors hover:scale-110 transform duration-200 flex items-center justify-center shrink-0 w-8 h-8 rounded-full"
        :class="feed.snapshot.loopMode !== 0 ? 'text-[#EC4141]' : 'text-white/80 hover:text-white'"
        :title="loopCaption"
        @click.stop="sendAction({ type: 'cycle-play-mode' })"
      >
        <svg v-if="loopGlyph === 'repeat'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="m17 2 4 4-4 4" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <path stroke-linecap="round" stroke-linejoin="round" d="m7 22-4-4 4-4" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 13v1a4 4 0 0 1-4 4H3" />
        </svg>
        <svg v-else-if="loopGlyph === 'repeat-one'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="m17 2 4 4-4 4" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <path stroke-linecap="round" stroke-linejoin="round" d="m7 22-4-4 4-4" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 13v1a4 4 0 0 1-4 4H3" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M11 10h1v4" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
        </svg>
      </button>

      <button
        class="transition-colors hover:scale-110 transform duration-200 flex items-center justify-center shrink-0 w-8 h-8 rounded-full text-[14px] font-bold"
        :class="feed.snapshot.lyricsOn ? 'text-[#EC4141] bg-[#EC4141]/10' : 'text-white/80 hover:text-white hover:bg-white/10'"
        title="桌面歌词"
        @click.stop="sendAction({ type: 'toggle-desktop-lyrics' })"
      >
        词
      </button>

      <button
        ref="volumeButtonEl"
        class="transition-colors flex items-center justify-center shrink-0 w-8 h-8 rounded-full text-white/80 hover:text-white hover:bg-white/10"
        title="音量"
        @click.stop="volumePopover.flip()"
        @wheel.prevent.stop="onVolumeWheel"
      >
        <svg v-if="feed.snapshot.volume === 0" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
        <svg v-else-if="feed.snapshot.volume < 30" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        </svg>
        <svg v-else-if="feed.snapshot.volume < 70" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      </button>

      <button
        class="transition-colors hover:scale-110 transform duration-200 flex items-center justify-center shrink-0 w-8 h-8 rounded-full"
        :class="showPlaylist ? 'text-[#EC4141] bg-[#EC4141]/10' : 'text-white/80 hover:text-white hover:bg-white/10'"
        title="播放列表"
        @click.stop="flipPlaylist"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>

      <button
        class="transition-colors hover:scale-110 transform duration-200 flex items-center justify-center shrink-0 w-8 h-8 rounded-full text-white/80 hover:text-white hover:bg-white/10"
        title="展开主窗口"
        @click.stop="sendAction({ type: 'restore-main' })"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
      </button>

      <button
        class="transition-colors hover:scale-110 transform duration-200 flex items-center justify-center shrink-0 w-8 h-8 rounded-full text-white/80 hover:text-white hover:bg-[#EC4141]"
        title="关闭"
        @click.stop="sendAction({ type: 'close' })"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <transition name="mini-queue"> 
      <MiniQueuePanel
        v-if="showPlaylist"
        :queue="feed.snapshot.queue"
        :active-path="feed.snapshot.track?.path ?? null"
        @play="sendAction({ type: 'play-song', song: $event })"
      />
    </transition> 

  </div>
</template>

<style scoped> /* 样式 */
.mini-queue-enter-active, .mini-queue-leave-active { transition: all 0.25s ease; }
.mini-queue-enter-from, .mini-queue-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
