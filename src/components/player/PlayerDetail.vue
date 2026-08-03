<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSongDetailCache } from '../../composables/useSongDetailCache';
import { useToast } from '../../composables/toast';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useSettings } from '../../features/settings/useSettings';
import { useSharedTransition } from '../../composables/useSharedTransition';
import { useRenderingPower } from '../../composables/renderingPower';
import type { SongDetail } from '../../types';
import { tauriInvoke } from '../../services/tauri/invoke';
import LyricsView from './LyricsView.vue';
import PlayerDetailBackground from './PlayerDetailBackground.vue';
import PlayerDetailLeft from './PlayerDetailLeft.vue';
import QueueList from './QueueList.vue';
import PlayerDetailContextMenu from '../overlays/PlayerDetailContextMenu.vue';

const {
  showPlayerDetail,
  showQueue,
  currentSong,
  closePlayerDetail,
} = usePlaybackController();

const { settings } = useSettings();

const { isMainWindowLowPower } = useRenderingPower();

// 窗口最小化/隐藏时卸载重型子组件（AmlLyricPlayer 的数百个歌词 DOM 元素、
// PlayerDetailLeft 的封面图、PlayerDetailBackground 的模糊背景），
// 释放 DOM 节点和 GPU 合成层内存。窗口恢复后自动重新挂载。
const shouldRenderHeavyContent = computed(() => showPlayerDetail.value && !isMainWindowLowPower.value);


const { staggerPhase } = useSharedTransition();
const { showToast } = useToast();
const { loadSongDetail, clearSongDetailCache } = useSongDetailCache();

const TOP_CHROME_HIDE_DELAY = 2500;

const isTopChromeVisible = ref(false);
let topChromeHideTimer: ReturnType<typeof setTimeout> | null = null;
const currentSongDetail = ref<SongDetail | null>(null);
let detailRequestId = 0;

const appWindow = getCurrentWindow();

const minimize = () => appWindow.minimize();

// 全屏：调用项目自实现的 Win32 原生命令（绕过 tao，专门处理无边框窗口）
// 该命令用整个显示器矩形铺满窗口并调用 MarkFullscreenWindow 让 shell 隐藏任务栏
const isFullscreen = ref(false);
// 'entering' | 'exiting' | null，控制全屏切换期间的样式（背景色、padding）
const fullscreenAnimState = ref<'entering' | 'exiting' | null>(null);
// 记录进入全屏前窗口是否已最大化，退出全屏后据此决定是否需要 unmaximize
const wasMaximizedBeforeFullscreen = ref(false);

// 沉浸模式下鼠标 2 秒无操作隐藏指针，移动/点击恢复
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
  const result = await tauriInvoke('set_immersive_fullscreen', { enter });
  isFullscreen.value = result;
};

const toggleFullscreen = async () => {
  if (fullscreenAnimState.value) return;

  if (!isFullscreen.value) {
    // === 进入全屏 ===
    // 策略：先执行原生最大化（享受系统自带的最大化动画），再无缝切换为沉浸式全屏。
    // 最大化→全屏的差异仅是任务栏高度 + 边框，同步切换不可察觉。

    // 记录原始最大化状态，退出全屏后据此决定是否还原为普通窗口
    wasMaximizedBeforeFullscreen.value = await appWindow.isMaximized();
    fullscreenAnimState.value = 'entering';
    enableCursorAutoHide();

    // 1. 保存窗口放置信息（在最大化之前，保存原始窗口状态）
    try {
      await tauriInvoke('save_window_placement');
    } catch (error) {
      showToast(`保存窗口状态失败: ${String(error)}`, 'error');
      fullscreenAnimState.value = null;
      return;
    }

    // 2. 如果窗口未最大化，先最大化（享受系统原生最大化动画）
    if (!wasMaximizedBeforeFullscreen.value) {
      await appWindow.maximize();
      // 等待最大化动画完成（Windows 原生动画约 200ms）
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    }

    // 3. 从最大化状态无缝切换为沉浸式全屏（去除边框、覆盖任务栏）
    try {
      await applyImmersiveFullscreen(true);
    } catch (error) {
      // 出错时还原到原始状态
      if (!wasMaximizedBeforeFullscreen.value) {
        await appWindow.unmaximize();
      }
      showToast(`进入全屏失败: ${String(error)}`, 'error');
      fullscreenAnimState.value = null;
      return;
    }

    fullscreenAnimState.value = null;
  } else {
    // === 退出全屏 ===
    // 策略：先从全屏恢复到最大化（平滑过渡），若原始状态非最大化再 unmaximize（原生还原动画）。
    fullscreenAnimState.value = 'exiting';
    disableCursorAutoHide();

    // 1. 退出沉浸式全屏 → 恢复到最大化状态（全屏→最大化仅相差任务栏高度，几乎无感）
    try {
      await applyImmersiveFullscreen(false);
    } catch (error) {
      showToast(`退出全屏失败: ${String(error)}`, 'error');
    }
    isFullscreen.value = false;

    // 2. 如果原始状态不是最大化，调用 unmaximize 还原为普通窗口（享受原生还原动画）
    if (!wasMaximizedBeforeFullscreen.value) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await appWindow.unmaximize();
      // 等待还原动画完成
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    }

    fullscreenAnimState.value = null;
  }
};

const toggleMaximize = async () => {
  // 全屏态或全屏动画进行中：不响应最大化
  if (isFullscreen.value || fullscreenAnimState.value) {
    return;
  }

  if (await appWindow.isMaximized()) {
    await appWindow.unmaximize();
  } else {
    await appWindow.maximize();
  }
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
    isTopChromeVisible.value = true;
    scheduleTopChromeHide();
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
  disableCursorAutoHide();
  window.removeEventListener('keydown', handleKeydown);
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

  // 展开时由 CSS animation (detail-enter-*) 控制显隐，这里不设置 opacity/transform 避免覆盖动画
  // 收起时用 inline style + transition 实现淡出
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

// 右键菜单
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);

// 封面隐藏模式（点击封面切换为纯字幕居中）
const coverHidden = ref(false);

const handleToggleCover = () => {
  coverHidden.value = !coverHidden.value;
};

// 退出详情页时重置纯歌词模式。
// 详情页封面与底栏封面是同一个元素（靠 isExpanded 切换位置/大小），
// 若不重置，收起后该元素仍带着 opacity-0，会导致底栏封面也看不见。
watch(showPlayerDetail, (visible) => {
  if (!visible) {
    coverHidden.value = false;
  }
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
</script>

<template>
  <div
    class="fixed inset-x-0 bottom-0 z-[50] flex h-[100vh] flex-col overflow-visible font-sans select-none text-white"
    :class="[
      showPlayerDetail ? 'pointer-events-auto' : 'pointer-events-none',
      isFullscreen || fullscreenAnimState ? 'bg-[#0a0a0a]' : '',
      isCursorHidden ? 'cursor-hidden' : '',
    ]"
    @contextmenu.prevent="handleContextMenu"
  >
    <div
      class="relative flex h-[100vh] w-full flex-col"
      :class="[
        isFullscreen || fullscreenAnimState ? 'pt-0' : 'pt-[calc(100vh-100%)]',
      ]"
    >
      <div
        class="absolute inset-0 transition-all duration-600 ease-[cubic-bezier(0.22,1,0.36,1)]"
        :style="{
          opacity: showPlayerDetail ? 1 : 0,
          transform: showPlayerDetail ? 'translateY(0)' : 'translateY(100%)',
        }"
      >
        <PlayerDetailBackground v-if="shouldRenderHeavyContent" :bgOpacity="1" :active="showPlayerDetail" />
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
            showPlayerDetail ? 'pointer-events-auto' : 'pointer-events-none',
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

          <div class="pointer-events-none flex-1"></div>

          <div class="pointer-events-none relative z-10 flex w-1/4 items-center justify-end gap-2">
            <button
              :title="isFullscreen ? '退出全屏' : '全屏'"
              :aria-label="isFullscreen ? '退出全屏' : '全屏'"
              :aria-pressed="isFullscreen"
              class="pointer-events-auto rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
              @click="toggleFullscreen"
            >
              <svg v-if="isFullscreen" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 3v6H3M21 9h-6V3M3 15h6v6M15 21v-6h6" />
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
              </svg>
            </button>
            <button
              title="最小化"
              aria-label="最小化"
              class="pointer-events-auto rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
              @click="minimize"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14" />
              </svg>
            </button>
            <button class="pointer-events-auto rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white" @click="toggleMaximize">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              </svg>
            </button>
            <button class="pointer-events-auto rounded-lg p-2 text-white/50 transition hover:bg-red-500 hover:text-white" @click="closeApp">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 歌名（始终显示，位于顶部工具栏下方） -->
      <div
        v-if="currentSong"
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

      <PlayerDetailLeft :isExpanded="showPlayerDetail" :coverHidden="coverHidden" @toggle-cover="handleToggleCover" />

      <div v-if="shouldRenderHeavyContent" class="relative z-[75] flex min-h-0 flex-1 pl-8 pr-0 pb-22 pointer-events-none">
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

            <LyricsView v-else :meta-info="metaInfo" class="h-full" />
          </transition>
        </div>
      </div>
    </div>

    <PlayerDetailContextMenu
      :visible="contextMenuVisible"
      :x="contextMenuX"
      :y="contextMenuY"
      :song="currentSong"
      @close="closeContextMenu"
    />
  </div>
</template>

<style scoped>
/* 沉浸模式鼠标静止时隐藏指针，覆盖所有子元素（按钮等自带 cursor 的也要隐藏） */
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

/* 详情页展开进入动画：从左下角方向滑入 + 淡入 */
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

/* 封面隐藏时强制歌词居中 */
.lyrics-force-center :deep(.lyrics-align-left),
.lyrics-force-center :deep(.lyrics-align-right) {
  --lyrics-text-align: center;
  --lyrics-line-transform-origin: 50%;
  --light-align-items: center;
}
</style>
