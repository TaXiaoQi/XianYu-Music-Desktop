<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Maximize2, Minimize2, Minus, Square, X } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { useSongDetailCache } from '../../composables/useSongDetailCache';
import { isFlyingCover } from '../../composables/useFlyingCover';
import { loadLyrics, lyricsSettings, lyricsStatus } from '../../composables/lyrics/state';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useSettings } from '../../features/settings/useSettings';
import { useSharedTransition } from '../../composables/useSharedTransition';
import { useToast } from '../../composables/toast';
import { useBilibiliVideoBackground } from '../../composables/useBilibiliVideoBackground';
import { useUiStore } from '../../shared/stores/ui';
import type { SongDetail } from '../../types';
import { windowApi } from '../../services/tauri/windowApi';
import { preloadAmlLyricPlayer } from './amlLyricPlayerLoader';

const LyricsView = defineAsyncComponent(() => import('./LyricsView.vue'));
const PlayerDetailBackground = defineAsyncComponent(() => import('./PlayerDetailBackground.vue'));
const PlayerDetailMeshBackground = defineAsyncComponent(() => import('./PlayerDetailMeshBackground.vue'));
const PlayerDetailLeft = defineAsyncComponent(() => import('./PlayerDetailLeft.vue'));
const PlayerDetailVinyl = defineAsyncComponent(() => import('./PlayerDetailVinyl.vue'));
const QueueList = defineAsyncComponent(() => import('./QueueList.vue'));
const PlayerDetailContextMenu = defineAsyncComponent(() => import('../overlays/PlayerDetailContextMenu.vue'));
const LyricsReplacementModal = defineAsyncComponent(() => import('../overlays/LyricsReplacementModal.vue'));

const {
  showPlayerDetail,
  showQueue,
  currentSong,
  closePlayerDetail,
} = usePlaybackController();

const { settings, patchTheme } = useSettings();
const { isImmersiveFullscreen, fullscreenAnimState } = storeToRefs(useUiStore());
const { showToast } = useToast();
const {
  requested: videoBackgroundRequested,
  loading: videoBackgroundLoading,
  sourceSongPath: videoBackgroundSongPath,
  videoUrl: backgroundVideoUrl,
  start: startVideoBackground,
  stop: stopVideoBackground,
} = useBilibiliVideoBackground();

const isMovieMode = computed(() => videoBackgroundRequested.value && Boolean(backgroundVideoUrl.value));

const preMovieCoverHidden = ref(false);
const preMovieBackgroundBlur = ref(0);
watch(isMovieMode, (movieMode) => {
  if (movieMode) {
    preMovieCoverHidden.value = coverHidden.value;
    preMovieBackgroundBlur.value = lyricsSettings.backgroundBlur;
    coverHidden.value = true;
    lyricsSettings.backgroundBlur = 0;
  } else {
    coverHidden.value = preMovieCoverHidden.value;
    lyricsSettings.backgroundBlur = preMovieBackgroundBlur.value;
  }
}, { flush: 'post' });

const shouldRenderHeavyContent = ref(false);
let heavyContentFrameId: number | null = null;

const shouldRenderCover = ref(false);
watch(currentSong, (song) => {
  if (!song) return;
  if (shouldRenderCover.value) return;
  if (isFlyingCover.value) {
    const stop = watch(isFlyingCover, (flying) => {
      if (!flying) {
        shouldRenderCover.value = true;
        stop();
      }
    });
    setTimeout(() => {
      if (!shouldRenderCover.value) shouldRenderCover.value = true;
    }, 3000);
  } else {
    shouldRenderCover.value = true;
  }
}, { immediate: true });

watch(() => currentSong.value?.path ?? '', (path) => {
  if (videoBackgroundSongPath.value && videoBackgroundSongPath.value !== path) {
    void stopVideoBackground();
  }
});

const isOnlineSongPath = (path: string) => path.startsWith('lx://') || path.startsWith('plugin://');

const scheduleHeavyContentRender = () => {
  if (shouldRenderHeavyContent.value || heavyContentFrameId !== null) {
    return;
  }

  heavyContentFrameId = requestAnimationFrame(() => {
    heavyContentFrameId = null;
    if (showPlayerDetail.value) {
      shouldRenderHeavyContent.value = true;
    }
  });
};


const { staggerPhase } = useSharedTransition();
const { loadSongDetail, clearSongDetailCache } = useSongDetailCache();

const TOP_CHROME_HIDE_DELAY = 2500;

const isTopChromeVisible = ref(false);
let topChromeHideTimer: ReturnType<typeof setTimeout> | null = null;
const currentSongDetail = ref<SongDetail | null>(null);
let detailRequestId = 0;

const appWindow = getCurrentWindow();

const minimize = () => appWindow.minimize();

const isFullscreen = isImmersiveFullscreen;
const FS_ANIM_DURATION = 320;

const CURSOR_IDLE_HIDE_DELAY = 2000;
const isCursorHidden = ref(false);
let cursorIdleTimer: ReturnType<typeof setTimeout> | null = null;

const clearCursorIdleTimer = () => {
  if (cursorIdleTimer) {
    clearTimeout(cursorIdleTimer);
    cursorIdleTimer = null;
  }
};

const scheduleCursorHide = () => {
  clearCursorIdleTimer();
  cursorIdleTimer = setTimeout(() => {
    isCursorHidden.value = true;
    cursorIdleTimer = null;
  }, CURSOR_IDLE_HIDE_DELAY);
};

const handleCursorActivity = () => {
  if (isCursorHidden.value) {
    isCursorHidden.value = false;
  }
  scheduleCursorHide();
};

const enableCursorAutoHide = () => {
  window.addEventListener('mousemove', handleCursorActivity);
  window.addEventListener('mousedown', handleCursorActivity);
  scheduleCursorHide();
};

const disableCursorAutoHide = () => {
  window.removeEventListener('mousemove', handleCursorActivity);
  window.removeEventListener('mousedown', handleCursorActivity);
  clearCursorIdleTimer();
  isCursorHidden.value = false;
};

const applyImmersiveFullscreen = async (enter: boolean) => {
  await windowApi.setImmersiveFullscreen(enter);
  isFullscreen.value = enter;
};

const toggleFullscreen = async () => {
  if (fullscreenAnimState.value) return;

  if (!isFullscreen.value) {
    fullscreenAnimState.value = 'entering';
    enableCursorAutoHide();
    await nextTick();
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    try {
      await applyImmersiveFullscreen(true);
    } catch (error) {
      console.error('进入全屏失败:', error);
      disableCursorAutoHide();
      isFullscreen.value = false;
      fullscreenAnimState.value = null;
      return;
    }
    setTimeout(() => {
      fullscreenAnimState.value = null;
    }, FS_ANIM_DURATION);
  } else {
    fullscreenAnimState.value = 'exiting';
    disableCursorAutoHide();
    setTimeout(async () => {
      try {
        await applyImmersiveFullscreen(false);
      } catch (error) {
        console.error('退出全屏失败:', error);
        isFullscreen.value = true;
        enableCursorAutoHide();
        fullscreenAnimState.value = null;
        return;
      }
      fullscreenAnimState.value = null;
    }, FS_ANIM_DURATION);
  }
};

const toggleMaximize = async () => {
  if (isFullscreen.value || fullscreenAnimState.value === 'exiting') {
    return;
  }

  await windowApi.smartToggleMaximize();
};

const closeApp = async () => {
  if (settings.value.closeToTray) {
    await appWindow.hide();
  } else {
    await appWindow.close();
  }
};

const clearTopChromeHideTimer = () => {
  if (topChromeHideTimer) {
    clearTimeout(topChromeHideTimer);
    topChromeHideTimer = null;
  }
};

const scheduleTopChromeHide = () => {
  clearTopChromeHideTimer();
  topChromeHideTimer = setTimeout(() => {
    isTopChromeVisible.value = false;
    topChromeHideTimer = null;
  }, TOP_CHROME_HIDE_DELAY);
};

const showTopChrome = () => {
  clearTopChromeHideTimer();
  isTopChromeVisible.value = true;
};

const handleTopChromeLeave = () => {
  scheduleTopChromeHide();
};

watch(showPlayerDetail, (visible) => {
  clearTopChromeHideTimer();

  if (visible) {
    scheduleHeavyContentRender();
    if (currentSong.value?.path && isOnlineSongPath(currentSong.value.path)) {
      void preloadAmlLyricPlayer().catch(() => {});
    }
    isTopChromeVisible.value = true;
    scheduleTopChromeHide();
    if (isFullscreen.value) {
      enableCursorAutoHide();
    }
    if (currentSong.value?.path && lyricsStatus.value !== 'ready') {
      void loadLyrics();
    }
    return;
  }

  isTopChromeVisible.value = false;
  currentSongDetail.value = null;
  clearSongDetailCache();
  disableCursorAutoHide();
});

watch([showPlayerDetail, () => currentSong.value?.path ?? ''], async ([visible, path]) => {
  const requestId = ++detailRequestId;

  if (!visible || !path) {
    currentSongDetail.value = null;
    return;
  }

  if (isOnlineSongPath(path)) {
    currentSongDetail.value = null;
    return;
  }

  try {
    const detail = await loadSongDetail(path);
    if (
      requestId !== detailRequestId
      || !showPlayerDetail.value
      || path !== (currentSong.value?.path ?? '')
    ) {
      return;
    }

    currentSongDetail.value = detail;
  } catch {
    if (
      requestId !== detailRequestId
      || !showPlayerDetail.value
      || path !== (currentSong.value?.path ?? '')
    ) {
      return;
    }

    currentSongDetail.value = null;
  }
}, { immediate: true });

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  clearTopChromeHideTimer();
  if (heavyContentFrameId !== null) {
    cancelAnimationFrame(heavyContentFrameId);
    heavyContentFrameId = null;
  }
  disableCursorAutoHide();
  window.removeEventListener('keydown', handleKeydown);
  void stopVideoBackground();
});

const formatFileSize = (size: number | undefined) => {
  if (!size || size <= 0) {
    return '';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const staggerStyle = (phase: number, translateDir: 'Y' | 'X' = 'Y', distance = 20) => {
  const visible = showPlayerDetail.value || staggerPhase.value >= phase;
  const translate = translateDir === 'Y' ? `translateY(${distance}px)` : `translateX(${distance}px)`;

  if (showPlayerDetail.value) {
    return {};
  }

  return {
    opacity: visible ? 1 : 0,
    transform: visible ? 'translate(0, 0)' : translate,
    transition: `opacity 400ms cubic-bezier(0.22,1,0.36,1) 0ms, transform 400ms cubic-bezier(0.22,1,0.36,1) 0ms`,
  };
};

const handleClose = () => {
  closePlayerDetail();
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  if (isFullscreen.value) {
    void toggleFullscreen();
    return;
  }
  handleClose();
};

const metaInfo = computed(() => {
  if (!currentSong.value) return [];

  const song = currentSong.value;
  const detail = currentSongDetail.value;

  return [
    { label: '歌手', value: song.artist },
    { label: '专辑', value: song.album },
    { label: '音质', value: song.bitrate ? `${song.sample_rate}Hz / ${song.bitrate}kbps` : 'Standard' },
    (detail?.genre || song.genre) ? { label: '风格', value: detail?.genre || song.genre || '' } : null,
    (detail?.year || song.year) ? { label: '年份', value: detail?.year || song.year || '' } : null,
    detail?.file_size ? { label: '大小', value: formatFileSize(detail.file_size) } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item?.value));
});

// 播放详情页皮肤：黑胶唱片（电影模式/背景视频优先级更高，视频模式下不启用黑胶）
const useVinylSkin = computed(() =>
  settings.value.theme.playerDetailStyle === 'vinyl' && !isMovieMode.value,
);

const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const lyricsReplacementVisible = ref(false);

const coverHidden = ref(false);

const handleToggleCover = () => {
  coverHidden.value = !coverHidden.value;
  patchTheme({ lastPlayerDetailCoverVisible: !coverHidden.value });
};

watch(showPlayerDetail, (visible) => {
  if (visible && isMovieMode.value) {
    coverHidden.value = true;
    return;
  }
  if (!visible) {
    coverHidden.value = false;
    return;
  }

  const { playerDetailCoverBehavior, lastPlayerDetailCoverVisible } = settings.value.theme;
  coverHidden.value = playerDetailCoverBehavior === 'hide'
    || (playerDetailCoverBehavior === 'remember' && !lastPlayerDetailCoverVisible);
});

const handleContextMenu = (e: MouseEvent) => {
  if (!currentSong.value || !showPlayerDetail.value) return;
  e.preventDefault();
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  contextMenuVisible.value = true;
};

const closeContextMenu = () => {
  contextMenuVisible.value = false;
};

const openLyricsReplacement = () => {
  contextMenuVisible.value = false;
  lyricsReplacementVisible.value = true;
};

const toggleVideoBackground = async () => {
  const song = currentSong.value;
  contextMenuVisible.value = false;
  if (!song) return;

  if (videoBackgroundRequested.value) {
    await stopVideoBackground();
    showToast('背景视频已关闭，封面与歌词已恢复', 'info');
    return;
  }

  showToast('正在解析并加载背景视频…', 'info');
  try {
    const started = await startVideoBackground(song);
    if (started) {
      showToast('背景视频已开启', 'success');
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : '背景视频加载失败', 'error');
  }
};
</script>

<template>
  <div
    class="fixed inset-x-0 bottom-0 z-[50] flex h-[100vh] flex-col overflow-visible font-sans select-none text-white"
    :class="[
      showPlayerDetail ? 'pointer-events-auto' : 'pointer-events-none',
      // 黑色背景由内层带 opacity 过渡的 div 提供，避免切换时瞬间遮罩主页
      showPlayerDetail && isCursorHidden ? 'cursor-hidden' : '',
    ]"
    @contextmenu.prevent="handleContextMenu"
  >
    <div
      class="relative flex h-[100vh] w-full flex-col"
      :class="[
        showPlayerDetail && (isFullscreen || fullscreenAnimState) ? 'pt-0' : 'pt-[calc(100vh-100%)]',
        fullscreenAnimState === 'entering' ? 'fs-entering' : '',
        fullscreenAnimState === 'exiting' ? 'fs-exiting' : '',
      ]"
    >
      <div
        class="absolute inset-0 transition-all duration-600 ease-[cubic-bezier(0.22,1,0.36,1)]"
        :style="{
          opacity: showPlayerDetail ? 1 : 0,
          transform: showPlayerDetail ? 'translateY(0)' : 'translateY(100%)',
        }"
      >
        <!-- 多边形流光背景（Voronoi 网格，开关开启时替换默认模糊封面背景） -->
        <PlayerDetailMeshBackground
          v-if="shouldRenderHeavyContent && settings.theme.playerDetailMeshBackground && !isMovieMode"
          :active="showPlayerDetail"
        />
        <PlayerDetailBackground
          v-else-if="shouldRenderHeavyContent"
          :bg-opacity="1"
          :active="showPlayerDetail"
        />
        <div class="absolute inset-0 z-[-1] bg-[#0a0a0a]"></div>
      </div>

      <div
        class="relative z-[60] h-16"
        :class="showPlayerDetail ? 'detail-enter-top' : ''"
        :style="staggerStyle(1, 'Y', -10)"
        @mouseenter="showTopChrome"
        @mousemove="showTopChrome"
        @mouseleave="handleTopChromeLeave"
      >
        <div
          class="absolute inset-x-0 top-0 h-16"
          :class="showPlayerDetail ? 'pointer-events-auto' : 'pointer-events-none'"
        ></div>

        <div
          class="relative flex h-14 items-center justify-between px-6 transition-all duration-500 ease-out"
          :class="[
            isTopChromeVisible ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0',
            showPlayerDetail ? 'pointer-events-auto' : 'pointer-events-none invisible',
          ]"
        >
          <div class="absolute inset-0" data-tauri-drag-region></div>

          <div class="pointer-events-none relative z-10 flex w-1/4 items-center">
            <button
              title="收起详情页"
              class="pointer-events-auto rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
              @click="handleClose"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              v-if="coverHidden"
              title="显示封面"
              class="pointer-events-auto ml-1 rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
              @click="handleToggleCover"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </button>
          </div>

          <div
            v-if="isMovieMode && currentSong"
            class="pointer-events-none relative z-10 flex min-w-0 flex-1 items-baseline justify-center gap-2.5 px-6 text-center"
          >
            <span class="truncate text-[clamp(15px,2vh,21px)] font-semibold tracking-wide text-white drop-shadow-md">
              {{ currentSong.title || currentSong.name }}
            </span>
            <span v-if="currentSong.artist" class="truncate text-[clamp(11px,1.4vh,14px)] text-white/60">
              - {{ currentSong.artist }}
            </span>
          </div>
          <div v-else class="pointer-events-none flex-1"></div>

          <div class="pointer-events-none relative z-10 flex w-1/4 items-center justify-end gap-2">
            <button
              :title="isFullscreen ? '退出全屏' : '全屏'"
              :aria-label="isFullscreen ? '退出全屏' : '全屏'"
              :aria-pressed="isFullscreen"
              class="pointer-events-auto rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
              @click="toggleFullscreen"
            >
              <Minimize2 v-if="isFullscreen" :size="16" :stroke-width="2" />
              <Maximize2 v-else :size="16" :stroke-width="2" />
            </button>
            <button
              title="最小化"
              aria-label="最小化"
              class="pointer-events-auto rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
              @click="minimize"
            >
              <Minus :size="16" :stroke-width="2" />
            </button>
            <button class="pointer-events-auto rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white" @click="toggleMaximize">
              <Square :size="16" :stroke-width="2" />
            </button>
            <button class="pointer-events-auto rounded-lg p-2 text-white/50 transition hover:bg-red-500 hover:text-white" @click="closeApp">
              <X :size="16" :stroke-width="2" />
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="currentSong && !isMovieMode"
        class="pointer-events-none relative z-[55] flex min-w-0 items-baseline justify-center gap-3 px-6 pb-[clamp(2px,1vh,16px)] text-center"
        :class="showPlayerDetail ? 'detail-enter-title' : 'opacity-0'"
        :style="staggerStyle(1, 'Y', -6)"
      >
        <span class="truncate text-[clamp(15px,2.2vh,24px)] font-semibold tracking-wide text-white drop-shadow-md">
          {{ currentSong.title || currentSong.name }}
        </span>
        <span v-if="currentSong.artist" class="truncate text-[clamp(11px,1.5vh,16px)] text-white/60">
          - {{ currentSong.artist }}
        </span>
      </div>

      <PlayerDetailLeft
        v-if="!useVinylSkin && (shouldRenderCover || shouldRenderHeavyContent)"
        :isExpanded="showPlayerDetail"
        :coverHidden="coverHidden"
        @toggle-cover="handleToggleCover"
      />
      <PlayerDetailVinyl
        v-else-if="useVinylSkin && (shouldRenderCover || shouldRenderHeavyContent)"
        :isExpanded="showPlayerDetail"
        :coverHidden="coverHidden"
        @toggle-cover="handleToggleCover"
      />

      <div v-if="shouldRenderHeavyContent" v-show="!isMovieMode" class="relative z-[75] flex min-h-0 flex-1 pl-8 pr-0 pb-22 pointer-events-none">
        <div v-if="!coverHidden" class="pointer-events-none h-full w-[40%] min-w-[300px]"></div>

        <div
          class="flex h-full min-h-0 flex-1 flex-col justify-center pt-0 pb-0"
          :class="[
            coverHidden ? 'px-[8%] lyrics-force-center' : 'pl-2 pr-8',
            showPlayerDetail ? 'pointer-events-auto detail-enter-lyrics' : 'pointer-events-none opacity-0',
          ]"
          :style="staggerStyle(2, 'X', 20)"
        >
          <transition name="fade-scale" mode="out-in">
            <QueueList
              v-if="showQueue"
              class="h-full rounded-2xl border border-white/5 bg-black/10 p-4 shadow-xl backdrop-blur-sm"
            />

            <LyricsView v-else :meta-info="metaInfo" :cover-hidden="coverHidden" :disabled="!showPlayerDetail" class="h-full" />
          </transition>
        </div>
      </div>
    </div>

    <PlayerDetailContextMenu
      v-if="contextMenuVisible"
      :visible="contextMenuVisible"
      :x="contextMenuX"
      :y="contextMenuY"
      :song="currentSong"
      :video-background-requested="videoBackgroundRequested"
      :video-background-loading="videoBackgroundLoading"
      @close="closeContextMenu"
      @change-lyrics="openLyricsReplacement"
      @toggle-video-background="toggleVideoBackground"
    />
    <LyricsReplacementModal
      v-if="lyricsReplacementVisible"
      :visible="lyricsReplacementVisible"
      :song="currentSong"
      @close="lyricsReplacementVisible = false"
    />
  </div>
</template>

<style scoped>
.cursor-hidden,
.cursor-hidden :deep(*) {
  cursor: none !important;
}

.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.97) translateY(10px);
}

.text-shadow-sm {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

@keyframes player-detail-enter {
  from {
    opacity: 0;
    transform: translate(-30px, 30px);
  }
  to {
    opacity: 1;
    transform: translate(0, 0);
  }
}


.detail-enter-top {
  animation: player-detail-enter 500ms cubic-bezier(0.22, 1, 0.36, 1) 100ms both;
}

.detail-enter-title {
  animation: player-detail-enter 500ms cubic-bezier(0.22, 1, 0.36, 1) 200ms both;
}

.detail-enter-lyrics {
  animation: player-detail-enter 500ms cubic-bezier(0.22, 1, 0.36, 1) 300ms both;
}

.lyrics-force-center :deep(.lyrics-align-left),
.lyrics-force-center :deep(.lyrics-align-right) {
  --lyrics-text-align: center;
  --lyrics-line-transform-origin: 50%;
  --light-align-items: center;
}
</style>
