<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Maximize2, Minimize2, Minus, Square, X } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { useSongDetailCache } from '../../composables/useSongDetailCache';
import { isFlyingCover } from '../../composables/useFlyingCover';
import { loadLyrics, lyricsStatus } from '../../composables/lyrics/state';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useSettings } from '../../features/settings/useSettings';
import { useSharedTransition } from '../../composables/useSharedTransition';
import { useUiStore } from '../../shared/stores/ui';
import type { SongDetail } from '../../types';
import { windowApi } from '../../services/tauri/windowApi';
import { preloadAmlLyricPlayer } from './amlLyricPlayerLoader';

// 详情页内部包含歌词、背景采样、队列与弹窗等较重子树。保持 PlayerDetail 壳组件常驻，
// 但让这些子树按需加载，避免主界面启动时把歌词页依赖一起拉入首屏。
const LyricsView = defineAsyncComponent(() => import('./LyricsView.vue'));
const PlayerDetailBackground = defineAsyncComponent(() => import('./PlayerDetailBackground.vue'));
const PlayerDetailLeft = defineAsyncComponent(() => import('./PlayerDetailLeft.vue'));
const QueueList = defineAsyncComponent(() => import('./QueueList.vue'));
const PlayerDetailContextMenu = defineAsyncComponent(() => import('../overlays/PlayerDetailContextMenu.vue'));
const LyricsReplacementModal = defineAsyncComponent(() => import('../overlays/LyricsReplacementModal.vue'));

const {
  showPlayerDetail,
  showQueue,
  currentSong,
  closePlayerDetail,
} = usePlaybackController();

const { settings } = useSettings();
const { isImmersiveFullscreen, fullscreenAnimState } = storeToRefs(useUiStore());

// 歌词页首次打开时再渲染重型外壳；打开后保持常驻，避免收起再展开时丢封面或歌词状态。
// 真正可释放的 AMLL 动效实例由 LyricsView 在 disabled 时单独卸载。
const shouldRenderHeavyContent = ref(false);
let heavyContentFrameId: number | null = null;

// 封面组件（PlayerDetailLeft）单独提前挂载：有歌曲播放时即渲染，
// 避免第一首歌底栏无封面承接（歌词页打开前 PlayerDetailLeft 未挂载的窗口期）。
// 其他重型内容（LyricsView/QueueList 等）仍受 shouldRenderHeavyContent 延迟加载。
//
// 第一首歌特殊处理：PlayerDetailLeft 尚未挂载，飞行动画飞向固定坐标兜底位置。
// 此时若立即挂载并显示底栏封面，会与飞行中的封面重叠。因此第一首歌等飞行动画
// 结束（isFlyingCover 变 false）后再挂载。后续歌曲 shouldRenderCover 已为 true，
// 不受影响，按正常逻辑立即显示封面。
const shouldRenderCover = ref(false);
watch(currentSong, (song) => {
  if (!song) return;
  if (shouldRenderCover.value) return; // 已挂载，后续歌曲无需等待
  // 第一首歌：等飞行动画结束再挂载底栏封面
  if (isFlyingCover.value) {
    const stop = watch(isFlyingCover, (flying) => {
      if (!flying) {
        shouldRenderCover.value = true;
        stop();
      }
    });
    // 兜底：若飞行动画异常未结束，3 秒后强制挂载
    setTimeout(() => {
      if (!shouldRenderCover.value) shouldRenderCover.value = true;
    }, 3000);
  } else {
    shouldRenderCover.value = true;
  }
}, { immediate: true });

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

// 真全屏：交给 Tauri/tao 切换系统原生全屏，而不是仅把无边框窗口拉伸到显示器大小。
// Windows 下再补一层 shell 全屏标记，确保自动隐藏或置顶任务栏也不会覆盖播放器。
// isImmersiveFullscreen 为全局共享状态（ui store），主页与歌词页均可读取
const isFullscreen = isImmersiveFullscreen;
// fullscreenAnimState 同样为全局共享状态，主页据此同步播放 scale 动画
const FS_ANIM_DURATION = 320;

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
  // 使用自定义 Rust 命令实现沉浸式全屏：
  // - 进入时保存窗口 placement，若未最大化则先最大化（丝滑放大动画），
  //   再清除 WS_MAXIMIZE 等样式位并铺满整屏（含任务栏区域）。
  //   已最大化时直接清除样式位铺满，无"先缩小再放大"的跳变。
  // - 退出时恢复样式和 placement（最大化态直接回最大化，小窗态回原位置）。
  await windowApi.setImmersiveFullscreen(enter);
  isFullscreen.value = enter;
};

const toggleFullscreen = async () => {
  if (fullscreenAnimState.value) return;

  if (!isFullscreen.value) {
    // 进入全屏：系统原生全屏会覆盖整个显示器（包括任务栏区域）。
    fullscreenAnimState.value = 'entering';
    enableCursorAutoHide();
    try {
      await applyImmersiveFullscreen(true);
    } catch (error) {
      console.error('进入全屏失败:', error);
      disableCursorAutoHide();
      isFullscreen.value = false;
      fullscreenAnimState.value = null;
      return;
    }
    // 原生铺满完成后，触发前端放大过渡动画盖住瞬间的尺寸跳变
    setTimeout(() => {
      fullscreenAnimState.value = null;
    }, FS_ANIM_DURATION);
  } else {
    // 退出全屏：先播放前端收缩动画，动画结束后让系统恢复原窗口状态。
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
  // 全屏态或退出动画进行中：不响应最大化
  if (isFullscreen.value || fullscreenAnimState.value === 'exiting') {
    return;
  }

  // 使用 smart_toggle_maximize 命令：用 Win32 IsZoomed 判断窗口状态（不依赖 tao 内部缓存），
  // 还原时若 SAVED_NORMAL_RECT 有值则用 SetWindowPlacement 一步恢复正确小窗尺寸，
  // 避免沉浸式全屏后 tao 内部还原尺寸被污染导致还原到全屏大小。
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
    // 沉浸全屏下重新打开歌词页时，恢复鼠标自动隐藏
    if (isFullscreen.value) {
      enableCursorAutoHide();
    }
    // 重型内容常驻后 LyricsView 不会卸载，歌词状态随模块级 state 保留。
    // 此处仅作为兜底：若歌词未就绪（idle/empty/error）则重新加载。
    if (currentSong.value?.path && lyricsStatus.value !== 'ready') {
      void loadLyrics();
    }
    return;
  }

  isTopChromeVisible.value = false;
  currentSongDetail.value = null;
  clearSongDetailCache();
  // 关闭歌词页时禁用鼠标自动隐藏，主页保持默认显示
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
const lyricsReplacementVisible = ref(false);

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

const openLyricsReplacement = () => {
  contextMenuVisible.value = false;
  lyricsReplacementVisible.value = true;
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

          <div class="pointer-events-none flex-1"></div>

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

      <PlayerDetailLeft
        v-if="shouldRenderCover || shouldRenderHeavyContent"
        :isExpanded="showPlayerDetail"
        :coverHidden="coverHidden"
        @toggle-cover="handleToggleCover"
      />

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
      @close="closeContextMenu"
      @change-lyrics="openLyricsReplacement"
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

/* fs-entering / fs-exiting 动画类与 keyframes 已移至 App.vue 全局样式，
   供 MainShell 主页容器与 PlayerDetail 歌词页共用。 */

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
