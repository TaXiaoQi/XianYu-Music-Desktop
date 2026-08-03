<script setup lang="ts">
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onMounted, onUnmounted, ref } from 'vue';

import { getNextWheelVolume } from '../../composables/playerUiShell';
import {
  VOLUME_POPOVER_ACTION_EVENT,
  VOLUME_POPOVER_STATE_EVENT,
  VOLUME_POPOVER_VISIBILITY_EVENT,
  type VolumePopoverAction,
  type VolumePopoverStatePayload,
} from '../../features/miniPlayer/shared';

const appWindow = getCurrentWindow();
const volume = ref(100);
const volumeBarRef = ref<HTMLElement | null>(null);
const isDraggingVolume = ref(false);
let unlistenState: UnlistenFn | null = null;
let unlistenFocus: UnlistenFn | null = null;
let unlistenCloseRequested: UnlistenFn | null = null;

const sendAction = (action: VolumePopoverAction) => {
  void emitTo('mini-player', VOLUME_POPOVER_ACTION_EVENT, action);
};

const setVolume = (nextVolume: number) => {
  const normalizedVolume = Math.max(0, Math.min(100, Math.round(nextVolume)));
  volume.value = normalizedVolume;
  sendAction({ type: 'set-volume', volume: normalizedVolume });
};

const handleVolumeWheel = (event: WheelEvent) => {
  setVolume(getNextWheelVolume(volume.value, event.deltaY));
};

const updateVolume = (clientX: number) => {
  if (!volumeBarRef.value) return;
  const rect = volumeBarRef.value.getBoundingClientRect();
  const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  setVolume(percent * 100);
};

const startVolumeDrag = (event: PointerEvent) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  isDraggingVolume.value = true;
  updateVolume(event.clientX);
};

const onGlobalPointerMove = (event: PointerEvent) => {
  if (isDraggingVolume.value) {
    event.preventDefault();
    updateVolume(event.clientX);
  }
};

const onGlobalPointerEnd = () => {
  if (isDraggingVolume.value) {
    isDraggingVolume.value = false;
  }
};

const hideWindow = () => {
  sendAction({ type: 'close' });
  void appWindow.hide();
  void emitTo('mini-player', VOLUME_POPOVER_VISIBILITY_EVENT, { visible: false });
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    hideWindow();
  }
};

onMounted(async () => {
  try {
    await appWindow.setBackgroundColor([0, 0, 0, 0]);
  } catch (error) {
    console.warn('Failed to force transparent background for volume popover window:', error);
  }

  await appWindow.setAlwaysOnTop(true);

  window.addEventListener('pointermove', onGlobalPointerMove);
  window.addEventListener('pointerup', onGlobalPointerEnd);
  window.addEventListener('pointercancel', onGlobalPointerEnd);
  window.addEventListener('keydown', handleKeydown);

  unlistenState = await listen<VolumePopoverStatePayload>(VOLUME_POPOVER_STATE_EVENT, (event) => {
    if (!isDraggingVolume.value) {
      volume.value = event.payload.volume;
    }
  });

  unlistenFocus = await appWindow.onFocusChanged((event) => {
    if (!event.payload && !isDraggingVolume.value) {
      hideWindow();
    }
  });

  unlistenCloseRequested = await appWindow.onCloseRequested((event) => {
    event.preventDefault();
    hideWindow();
  });
});

onUnmounted(() => {
  window.removeEventListener('pointermove', onGlobalPointerMove);
  window.removeEventListener('pointerup', onGlobalPointerEnd);
  window.removeEventListener('pointercancel', onGlobalPointerEnd);
  window.removeEventListener('keydown', handleKeydown);
  unlistenState?.();
  unlistenFocus?.();
  unlistenCloseRequested?.();
});
</script>

<template>
  <div
    class="w-full h-full flex items-center gap-2 px-3 rounded-[10px]"
    style="background: rgba(26, 26, 26, 0.92); backdrop-filter: blur(18px); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.1);"
    @wheel.prevent.stop="handleVolumeWheel"
  >
    <button
      @click.stop="sendAction({ type: 'toggle-mute' })"
      class="shrink-0 text-white/70 hover:text-white transition-colors"
      title="静音"
    >
      <svg v-if="volume === 0" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
    </button>

    <div
      ref="volumeBarRef"
      class="relative flex-1 h-1.5 bg-white/25 rounded-full cursor-pointer [touch-action:none]"
      @pointerdown.stop="startVolumeDrag"
    >
      <div class="absolute left-0 top-0 h-full bg-white/80 rounded-full" :style="{ width: volume + '%' }"></div>
      <div class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-sm cursor-grab active:cursor-grabbing" :style="{ left: volume + '%' }"></div>
    </div>

    <div class="w-9 text-right text-[11px] text-white/70 font-medium select-none">{{ volume }}%</div>
  </div>
</template>
