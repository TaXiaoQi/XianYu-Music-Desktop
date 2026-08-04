<script setup lang="ts">
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import { getNextWheelVolume } from '../../composables/playerUiShell';
import { applyWindowMaterial, useWindowMaterial, type WindowMaterialMode } from '../../composables/windowMaterial';
import {
  MINI_PLAYER_ACTION_EVENT,
  MINI_PLAYER_BOUNDS_EVENT,
  MINI_PLAYER_READY_EVENT,
  MINI_PLAYER_REQUEST_STATE_EVENT,
  MINI_PLAYER_STATE_APPLIED_EVENT,
  MINI_PLAYER_STATE_EVENT,
  MINI_PLAYER_VISIBILITY_EVENT,
  MINI_PLAYER_WINDOW_BASE_HEIGHT,
  MINI_PLAYER_WINDOW_EXPANDED_HEIGHT,
  MINI_PLAYER_WINDOW_WIDTH,
  VOLUME_POPOVER_ACTION_EVENT,
  VOLUME_POPOVER_STATE_EVENT,
  VOLUME_POPOVER_VISIBILITY_EVENT,
  VOLUME_POPOVER_WINDOW_HEIGHT,
  VOLUME_POPOVER_WINDOW_LABEL,
  VOLUME_POPOVER_WINDOW_WIDTH,
  type MiniPlayerAction,
  type MiniPlayerStatePayload,
  type VolumePopoverAction,
} from '../../features/miniPlayer/shared';
import type { Song } from '../../types';
import { formatDuration } from '../../utils/format';

const appWindow = getCurrentWindow();
const currentSong = ref<Song | null>(null);
const isPlaying = ref(false);
const isDarkTheme = ref(false);
const volume = ref(100);
const queue = ref<Song[]>([]);
const lyricText = ref('');
const localCoverUrl = ref('');
const isWindowVisible = ref(false);
const showMiniPlaylist = ref(false);
const isVolumePopoverVisible = ref(false);
const isHovering = ref(false);
const isDraggingProgress = ref(false);
const windowMaterial = ref<WindowMaterialMode>('none');
const windowBlurTint = ref(50);
const currentTime = ref(0);
const duration = ref(0);
const isFavorite = ref(false);
const playMode = ref(0);
const desktopLyricsEnabled = ref(false);
const volumeButtonRef = ref<HTMLElement | null>(null);
const progressBarRef = ref<HTMLElement | null>(null);
let volumePopoverWindow: WebviewWindow | null = null;
let volumePopoverWindowPromise: Promise<WebviewWindow | null> | null = null;
let unlistenWindowMoved: (() => void) | null = null;
let unlistenCloseRequested: (() => void) | null = null;
let unlistenState: (() => void) | null = null;
let unlistenVisibility: (() => void) | null = null;
let unlistenVolumeAction: (() => void) | null = null;
let unlistenVolumeVisibility: (() => void) | null = null;

useWindowMaterial();

const displayQueue = computed(() => queue.value);

const progressPercent = computed(() => {
  if (!duration.value || duration.value <= 0) return 0;
  return Math.min(100, Math.max(0, (currentTime.value / duration.value) * 100));
});

// 0=顺序播放, 1=单曲循环, 2=随机
const playModeIcon = computed(() => {
  if (playMode.value === 1) return 'repeat-one';
  if (playMode.value === 2) return 'shuffle';
  return 'repeat';
});

const playModeTitle = computed(() => {
  if (playMode.value === 1) return '单曲循环';
  if (playMode.value === 2) return '随机播放';
  return '顺序播放';
});

const sendAction = (action: MiniPlayerAction) => {
  void emitTo('main', MINI_PLAYER_ACTION_EVENT, action);
};

const applyWindowHeight = async () => {
  const height = showMiniPlaylist.value
    ? MINI_PLAYER_WINDOW_EXPANDED_HEIGHT
    : MINI_PLAYER_WINDOW_BASE_HEIGHT;

  const size = new LogicalSize(MINI_PLAYER_WINDOW_WIDTH, height);
  await appWindow.setMinSize(size);
  await appWindow.setMaxSize(size);
  await appWindow.setSize(size);
};

const setVolume = (nextVolume: number) => {
  const normalizedVolume = Math.max(0, Math.min(100, Math.round(nextVolume)));
  volume.value = normalizedVolume;
  sendAction({ type: 'set-volume', volume: normalizedVolume });
  void emitVolumeState();
};

const handleVolumeWheel = (event: WheelEvent) => {
  setVolume(getNextWheelVolume(volume.value, event.deltaY));
};

const emitVolumeState = async () => {
  const target = await getVolumePopoverWindow();
  if (!target) return;
  await emitTo(VOLUME_POPOVER_WINDOW_LABEL, VOLUME_POPOVER_STATE_EVENT, { volume: volume.value });
};

const getVolumePopoverWindow = async (): Promise<WebviewWindow | null> => {
  return WebviewWindow.getByLabel(VOLUME_POPOVER_WINDOW_LABEL);
};

const ensureVolumePopoverWindow = async (): Promise<WebviewWindow | null> => {
  const existing = await getVolumePopoverWindow();
  if (existing) return existing;

  if (volumePopoverWindowPromise) return volumePopoverWindowPromise;

  volumePopoverWindowPromise = (async () => {
    try {
      const instance = new WebviewWindow(VOLUME_POPOVER_WINDOW_LABEL, {
        url: '/',
        title: 'XY-Music Volume',
        width: VOLUME_POPOVER_WINDOW_WIDTH,
        height: VOLUME_POPOVER_WINDOW_HEIGHT,
        minWidth: VOLUME_POPOVER_WINDOW_WIDTH,
        minHeight: VOLUME_POPOVER_WINDOW_HEIGHT,
        maxWidth: VOLUME_POPOVER_WINDOW_WIDTH,
        maxHeight: VOLUME_POPOVER_WINDOW_HEIGHT,
        visible: false,
        decorations: false,
        transparent: true,
        shadow: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focus: false,
        focusable: true,
        center: false,
      });

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        void instance.once('tauri://created', () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        void instance.once('tauri://error', (event) => {
          if (settled) return;
          settled = true;
          reject(event.payload);
        });
      });

      volumePopoverWindow = instance;
      return instance;
    } catch (error) {
      console.warn('Failed to create volume popover window:', error);
      return null;
    } finally {
      volumePopoverWindowPromise = null;
    }
  })();

  return volumePopoverWindowPromise;
};

const showVolumePopover = async () => {
  const target = await ensureVolumePopoverWindow();
  if (!target) return;

  // 计算位置：在音量按钮上方居中
  const buttonRect = volumeButtonRef.value?.getBoundingClientRect();
  const scaleFactor = await appWindow.scaleFactor();
  const winPos = await appWindow.outerPosition();
  const winX = winPos.x / scaleFactor;
  const winY = winPos.y / scaleFactor;

  let popoverX: number;
  let popoverY: number;
  if (buttonRect) {
    const btnCenterX = winX + buttonRect.left + buttonRect.width / 2;
    popoverX = Math.round(btnCenterX - VOLUME_POPOVER_WINDOW_WIDTH / 2);
    popoverY = Math.round(winY + buttonRect.bottom + 6);
  } else {
    popoverX = Math.round(winX + MINI_PLAYER_WINDOW_WIDTH - VOLUME_POPOVER_WINDOW_WIDTH - 12);
    popoverY = Math.round(winY + MINI_PLAYER_WINDOW_BASE_HEIGHT + 6);
  }

  await target.setAlwaysOnTop(true);
  await target.setPosition(new LogicalPosition(popoverX, popoverY));
  await emitVolumeState();
  await target.show();
  await target.setFocus();
  isVolumePopoverVisible.value = true;
  await emitTo(VOLUME_POPOVER_WINDOW_LABEL, VOLUME_POPOVER_VISIBILITY_EVENT, { visible: true });
};

const hideVolumePopover = async () => {
  isVolumePopoverVisible.value = false;
  await emitTo(VOLUME_POPOVER_WINDOW_LABEL, VOLUME_POPOVER_VISIBILITY_EVENT, { visible: false });
};

const toggleVolumePopover = () => {
  if (isVolumePopoverVisible.value) {
    void hideVolumePopover();
  } else {
    showMiniPlaylist.value = false;
    void showVolumePopover();
  }
};

const toggleMiniPlaylist = () => {
  showMiniPlaylist.value = !showMiniPlaylist.value;
  if (showMiniPlaylist.value) {
    void hideVolumePopover();
  }
};

// 进度条拖拽
const updateProgress = (clientX: number) => {
  if (!progressBarRef.value || !duration.value) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  currentTime.value = percent * duration.value;
};

const startProgressDrag = (event: PointerEvent) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (!duration.value) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  isDraggingProgress.value = true;
  updateProgress(event.clientX);
};

const commitProgress = () => {
  if (!isDraggingProgress.value) return;
  isDraggingProgress.value = false;
  sendAction({ type: 'seek', time: currentTime.value });
};

const onMouseEnter = () => {
  isHovering.value = true;
};

const onMouseLeave = () => {
  isHovering.value = false;
};

const onGlobalPointerMove = (event: PointerEvent) => {
  if (!isWindowVisible.value) return;
  if (isDraggingProgress.value) {
    event.preventDefault();
    updateProgress(event.clientX);
  }
};

const onGlobalPointerEnd = () => {
  if (isDraggingProgress.value) {
    commitProgress();
  }
};

const onGlobalKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    void hideVolumePopover();
    showMiniPlaylist.value = false;
  }
};

watch([showMiniPlaylist], () => {
  void applyWindowHeight();
});

watch([windowMaterial, windowBlurTint, isDarkTheme], async () => {
  if (isDarkTheme.value) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  try {
    await appWindow.setTheme(isDarkTheme.value ? 'dark' : 'light');
  } catch (error) {
    console.warn('Failed to set mini window theme:', error);
  }

  await applyWindowMaterial(
    windowMaterial.value,
    isDarkTheme.value,
    windowBlurTint.value,
  );
});

onMounted(async () => {
  try {
    await appWindow.setBackgroundColor([0, 0, 0, 0]);
  } catch (error) {
    console.warn('Failed to force transparent background for mini player window:', error);
  }

  await appWindow.setAlwaysOnTop(true);
  await applyWindowHeight();

  window.addEventListener('pointermove', onGlobalPointerMove);
  window.addEventListener('pointerup', onGlobalPointerEnd);
  window.addEventListener('pointercancel', onGlobalPointerEnd);
  window.addEventListener('keydown', onGlobalKeydown);

  unlistenState = await listen<MiniPlayerStatePayload>(MINI_PLAYER_STATE_EVENT, (event) => {
    currentSong.value = event.payload.currentSong;
    localCoverUrl.value = event.payload.coverUrl;
    isPlaying.value = event.payload.isPlaying;
    isDarkTheme.value = event.payload.isDarkTheme;
    volume.value = event.payload.volume;
    queue.value = event.payload.queue;
    lyricText.value = event.payload.lyricText;
    windowMaterial.value = event.payload.windowMaterial;
    windowBlurTint.value = event.payload.windowBlurTint;
    if (!isDraggingProgress.value) {
      currentTime.value = event.payload.currentTime;
    }
    duration.value = event.payload.duration;
    isFavorite.value = event.payload.isFavorite;
    playMode.value = event.payload.playMode;
    desktopLyricsEnabled.value = event.payload.desktopLyricsEnabled;
    void nextTick(() => emitTo('main', MINI_PLAYER_STATE_APPLIED_EVENT));
    void emitVolumeState();
  });

  unlistenVolumeAction = await listen<VolumePopoverAction>(VOLUME_POPOVER_ACTION_EVENT, (event) => {
    const action = event.payload;
    if (action.type === 'set-volume') {
      volume.value = action.volume;
      sendAction({ type: 'set-volume', volume: action.volume });
    } else if (action.type === 'toggle-mute') {
      sendAction({ type: 'toggle-mute' });
    } else if (action.type === 'close') {
      isVolumePopoverVisible.value = false;
    }
  });

  unlistenVolumeVisibility = await listen<{ visible: boolean }>(VOLUME_POPOVER_VISIBILITY_EVENT, (event) => {
    if (!event.payload.visible) {
      isVolumePopoverVisible.value = false;
    }
  });

  unlistenVisibility = await listen<{ visible: boolean }>(MINI_PLAYER_VISIBILITY_EVENT, (event) => {
    isWindowVisible.value = event.payload.visible;
    if (isWindowVisible.value) {
      void applyWindowHeight();
      return;
    }

    void hideVolumePopover();
    isDraggingProgress.value = false;
  });

  unlistenWindowMoved = await appWindow.onMoved(async () => {
    const factor = await appWindow.scaleFactor();
    const position = (await appWindow.outerPosition()).toLogical(factor);
    await emitTo('main', MINI_PLAYER_BOUNDS_EVENT, {
      x: position.x,
      y: position.y,
    });
  });

  unlistenCloseRequested = await appWindow.onCloseRequested((event) => {
    event.preventDefault();
    sendAction({ type: 'close' });
  });

  await emitTo('main', MINI_PLAYER_READY_EVENT);
  await emitTo('main', MINI_PLAYER_REQUEST_STATE_EVENT);
});

onUnmounted(() => {
  window.removeEventListener('pointermove', onGlobalPointerMove);
  window.removeEventListener('pointerup', onGlobalPointerEnd);
  window.removeEventListener('pointercancel', onGlobalPointerEnd);
  window.removeEventListener('keydown', onGlobalKeydown);
  unlistenWindowMoved?.();
  unlistenCloseRequested?.();
  unlistenState?.();
  unlistenVisibility?.();
  unlistenVolumeAction?.();
  unlistenVolumeVisibility?.();
  volumePopoverWindow?.close().catch(() => {});
});
</script>

<template>
  <div
    class="w-[400px] h-full relative select-none overflow-hidden bg-transparent !border-none !outline-none !ring-0 !shadow-none rounded-[8px] transition-opacity duration-200 ease-out"
    :class="isWindowVisible ? 'opacity-100' : 'opacity-0'"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <!-- 全局背景：暗色遮罩 + 模糊封面 -->
    <div class="absolute inset-0 -z-10" style="background-color: #1a1a1a;"></div>
    <div
      v-if="localCoverUrl"
      class="absolute inset-0 -z-10 bg-cover bg-center opacity-60 transition-all duration-300"
      :style="{ backgroundImage: `url(${localCoverUrl})`, filter: 'blur(15px)' }"
    ></div>

    <!-- 主区域：封面 + 歌名/三大键/进度条（92px） -->
    <div class="h-[92px] w-full flex items-end gap-3 px-5" data-tauri-drag-region>
      <!-- 封面（底部对齐） -->
      <div
        class="w-[64px] h-[64px] shrink-0 relative overflow-hidden rounded-[8px]"
        data-tauri-drag-region
        @dblclick.stop="sendAction({ type: 'restore-main' })"
        title="双击展开主窗口"
      >
        <img v-if="localCoverUrl" :src="localCoverUrl" class="w-full h-full object-cover pointer-events-none" />
        <div v-else class="w-full h-full bg-gray-700 flex items-center justify-center text-white/40 pointer-events-none">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
      </div>

      <!-- 右侧：歌名+三大键并排 / 进度条（紧贴歌手名下方） -->
      <div class="flex-1 min-w-0 flex flex-col justify-end pb-1" data-tauri-drag-region>
        <!-- 歌名 + 歌手-专辑 + 三大键（并排） -->
        <div class="min-w-0 flex items-center gap-2" data-tauri-drag-region>
          <div class="flex-1 min-w-0 flex flex-col gap-0.5" data-tauri-drag-region>
            <div class="text-[14px] font-medium text-white truncate leading-tight">
              {{ currentSong ? (currentSong.title || currentSong.name.replace(/\.[^/.]+$/, '')) : 'XY-Music' }}
            </div>
            <div class="text-[12px] text-white/60 truncate leading-tight">
              <template v-if="currentSong && (currentSong.artist || currentSong.album)">
                {{ currentSong.artist || '未知歌手' }}<span v-if="currentSong.album"> - {{ currentSong.album }}</span>
              </template>
              <template v-else>未知歌曲</template>
            </div>
          </div>

          <!-- 播放三大键 -->
          <div class="shrink-0 flex items-center gap-2 pointer-events-auto -mt-1 mr-1">
            <button @click.stop="sendAction({ type: 'prev-song' })" class="text-white/70 hover:text-white transition-colors" title="上一首">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" /></svg>
            </button>

            <button @click.stop="sendAction({ type: 'toggle-play' })" class="w-10 h-10 rounded-full bg-white/15 backdrop-blur flex items-center justify-center text-white hover:bg-white/25 transition-colors" title="播放/暂停">
              <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 fill-current ml-0.5" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            </button>

            <button @click.stop="sendAction({ type: 'next-song' })" class="text-white/70 hover:text-white transition-colors" title="下一首">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
            </button>
          </div>
        </div>

        <!-- 进度条（紧贴歌手名下方） -->
        <div class="mt-1 flex items-center gap-2" data-tauri-drag-region>
          <span class="text-[10px] text-white/70 tabular-nums select-none w-8 text-right">{{ formatDuration(currentTime) }}</span>
          <div
            ref="progressBarRef"
            class="relative flex-1 h-1.5 bg-white/20 rounded-full cursor-pointer [touch-action:none]"
            @pointerdown.stop="startProgressDrag"
          >
            <div class="absolute left-0 top-0 h-full bg-white/80 rounded-full" :style="{ width: progressPercent + '%' }"></div>
            <div class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-sm opacity-0 transition-opacity" :class="{ 'opacity-100': isHovering || isDraggingProgress }" :style="{ left: progressPercent + '%' }"></div>
          </div>
          <span class="text-[10px] text-white/70 tabular-nums select-none w-8">{{ formatDuration(duration) }}</span>
        </div>
      </div>
    </div>

    <!-- 第三行：底部控件均匀排列（64px） -->
    <div class="h-[64px] w-full flex items-start justify-around px-5 pt-3 pointer-events-auto">
      <!-- 收藏 -->
      <button @click.stop="sendAction({ type: 'toggle-favorite' })" class="flex items-center justify-center w-7 h-7 rounded transition-colors" :class="isFavorite ? 'text-[#EC4141]' : 'text-white/70 hover:text-white'" title="收藏">
        <svg v-if="isFavorite" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
      </button>

      <!-- 播放循环 -->
      <button @click.stop="sendAction({ type: 'cycle-play-mode' })" class="flex items-center justify-center w-7 h-7 rounded transition-colors" :class="playMode !== 0 ? 'text-[#EC4141]' : 'text-white/70 hover:text-white'" :title="playModeTitle">
        <svg v-if="playModeIcon === 'repeat'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        <svg v-else-if="playModeIcon === 'repeat-one'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /><text x="12" y="14" text-anchor="middle" font-size="8" fill="currentColor" stroke="none">1</text></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
      </button>

      <!-- 桌面歌词 -->
      <button @click.stop="sendAction({ type: 'toggle-desktop-lyrics' })" class="flex items-center justify-center w-7 h-7 rounded transition-colors" :class="desktopLyricsEnabled ? 'text-[#EC4141]' : 'text-white/70 hover:text-white'" title="桌面歌词">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>
      </button>

      <!-- 音量 -->
      <button
        ref="volumeButtonRef"
        @click.stop="toggleVolumePopover"
        @wheel.prevent.stop="handleVolumeWheel"
        class="flex items-center justify-center w-7 h-7 rounded transition-colors text-white/70 hover:text-white"
        title="音量"
      >
        <svg v-if="volume === 0" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
      </button>

      <!-- 播放列表 -->
      <button @click.stop="toggleMiniPlaylist" class="flex items-center justify-center w-7 h-7 rounded transition-colors" :class="showMiniPlaylist ? 'text-[#EC4141]' : 'text-white/70 hover:text-white'" title="播放列表">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h10m-10 4h6" /></svg>
      </button>

      <!-- 展开主窗口 -->
      <button @click.stop="sendAction({ type: 'restore-main' })" class="flex items-center justify-center w-7 h-7 rounded transition-colors text-white/70 hover:text-white" title="展开主窗口">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
      </button>

      <!-- 关闭 -->
      <button @click.stop="sendAction({ type: 'close' })" class="flex items-center justify-center w-7 h-7 rounded transition-colors text-white/70 hover:text-white hover:bg-[#EC4141]" title="关闭">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>

    <!-- 播放列表展开区域（独立背景，不共享 mini 窗口材质） -->
    <transition name="mini-queue">
      <div
        v-if="showMiniPlaylist"
        class="absolute left-0 right-0 top-[156px] bottom-0 z-30"
        style="background-color: rgba(20, 20, 22, 0.96); backdrop-filter: blur(12px);"
      >
        <div class="h-full overflow-y-auto custom-scrollbar px-1.5 pt-0 pb-1.5">
          <div v-if="displayQueue.length === 0" class="h-full flex items-center justify-center text-xs text-gray-400 dark:text-white/30">
            暂无歌曲
          </div>

          <button
            v-for="(song, index) in displayQueue"
            :key="song.path + index"
            @click="sendAction({ type: 'play-song', song })"
            class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors"
            :class="currentSong?.path === song.path ? 'bg-[#EC4141]/10 text-[#EC4141]' : 'text-gray-700 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/5'"
          >
            <div class="w-5 shrink-0 text-[10px] text-center" :class="currentSong?.path === song.path ? 'text-[#EC4141]' : 'text-gray-400 dark:text-white/30'">
              <svg v-if="currentSong?.path === song.path" xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mx-auto" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
              <span v-else>{{ index + 1 }}</span>
            </div>

            <div class="min-w-0 flex-1">
              <div class="text-xs truncate font-medium">{{ song.title || song.name.replace(/\.[^/.]+$/, '') }}</div>
              <div class="text-[10px] truncate" :class="currentSong?.path === song.path ? 'text-[#EC4141]/70' : 'text-gray-400 dark:text-white/30'">{{ song.artist || 'Unknown Artist' }}</div>
            </div>

            <div class="text-[10px] shrink-0" :class="currentSong?.path === song.path ? 'text-[#EC4141]/70' : 'text-gray-400 dark:text-white/30'">
              {{ formatDuration(song.duration) }}
            </div>
          </button>
        </div>
      </div>
    </transition>

  </div>
</template>

<style scoped>
.mini-queue-enter-active,
.mini-queue-leave-active {
  transition: all 0.25s ease;
}

.mini-queue-enter-from,
.mini-queue-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 5px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(148, 163, 184, 0.35);
  border-radius: 3px;
}
</style>
