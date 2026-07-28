<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { loadLyrics } from '../../composables/lyrics';
import { useCoverCache } from '../../composables/useCoverCache';
import { useSongDetailCache } from '../../composables/useSongDetailCache';
import { useToast } from '../../composables/toast';
import { usePlaybackController } from '../../features/playback/usePlaybackController';
import { useSettings } from '../../features/settings/useSettings';
import { useSharedTransition } from '../../composables/useSharedTransition';
import { useLibraryStore } from '../../features/library/store';
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
  currentCover,
  currentCoverFull,
  closePlayerDetail,
} = usePlaybackController();

const { settings } = useSettings();


const { staggerPhase } = useSharedTransition();
const { loadCover, loadFullCover, clearCoverCaches } = useCoverCache();
const { showToast } = useToast();
const libraryStore = useLibraryStore();
const { loadSongDetail, clearSongDetailCache } = useSongDetailCache();

const TOP_CHROME_HIDE_DELAY = 2500;

const isTopChromeVisible = ref(false);
let topChromeHideTimer: ReturnType<typeof setTimeout> | null = null;
const currentSongDetail = ref<SongDetail | null>(null);
let detailRequestId = 0;

const appWindow = getCurrentWindow();

const minimize = () => appWindow.minimize();

// 全屏状态由前端自管理：切换走 Rust 原生 command（绕过 tao 的 placement 机制），
// 因此不能再依赖 appWindow.isFullscreen()（绕过后 tao 内部状态会失真）
const isFullscreen = ref(false);
// 防止过渡进行中重复点击（全屏与最大化共用同一把锁）
let windowTransitioning = false;
// 退出全屏时的内容层收缩动画：无边框窗系统无缩小动画（窗口硬跳回小窗），
// 用内容 scale+淡出的 CSS 过渡盖住硬跳，观感为“画面向内收缩”
const isCollapsing = ref(false);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Rust 原生全屏切换：进全屏借系统最大化动画丝滑放大；退全屏窗口一步硬跳还原
const applyImmersiveFullscreen = async (enter: boolean) => {
  const result = await tauriInvoke('set_immersive_fullscreen', { enter });
  isFullscreen.value = result;
};

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

// 统一过渡编排：仅做防连点
const runWindowTransition = async (action: () => Promise<void>, onError: string) => {
  if (windowTransitioning) {
    return;
  }
  windowTransitioning = true;

  try {
    await action();
  } catch (error) {
    showToast(`${onError}: ${String(error)}`, 'error');
  } finally {
    windowTransitioning = false;
  }
};

const toggleFullscreen = () =>
  runWindowTransition(async () => {
    if (isFullscreen.value) {
      // 退出全屏：先停鼠标自动隐藏，再播内容收缩动画、硬跳回小窗
      disableCursorAutoHide();
      isCollapsing.value = true;
      await sleep(200);
      await applyImmersiveFullscreen(false);
      await sleep(20);
      isCollapsing.value = false;
    } else {
      // 进入全屏：系统最大化动画已丝滑，前端不介入；启用鼠标静止自动隐藏
      await applyImmersiveFullscreen(true);
      enableCursorAutoHide();
    }
  }, '切换全屏失败');

const toggleMaximize = () =>
  runWindowTransition(async () => {
    // 全屏态下点最大化：退出全屏，placement 会一步恢复到进全屏前的状态（通常是最大化）
    if (isFullscreen.value) {
      disableCursorAutoHide();
      await applyImmersiveFullscreen(false);
      return;
    }

    if (await appWindow.isMaximized()) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
  }, '切换窗口大小失败');
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

  return {
    opacity: visible ? 1 : 0,
    transform: visible ? 'translate(0, 0)' : translate,
    transition: `opacity 400ms cubic-bezier(0.22,1,0.36,1) ${showPlayerDetail.value ? phase * 100 : 0}ms, transform 400ms cubic-bezier(0.22,1,0.36,1) ${showPlayerDetail.value ? phase * 100 : 0}ms`,
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
const isCoverUpdating = ref(false);
const isLyricsUpdating = ref(false);

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

const handleMenuAction = (action: 'changeCover' | 'changeLyrics') => {
  if (action === 'changeCover') {
    void handleChangeCover();
  } else if (action === 'changeLyrics') {
    void handleChangeLyrics();
  }
};

const handleChangeCover = async () => {
  const song = currentSong.value;
  const songPath = song?.path;
  if (!song || !songPath || isCoverUpdating.value) return;

  isCoverUpdating.value = true;
  try {
    const selected = await open({
      multiple: false,
      directory: false,
      title: '选择歌曲封面',
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
    });
    if (!selected || Array.isArray(selected)) return;

    // 用现有歌曲信息填充 payload，仅更新 coverPath
    const result = await tauriInvoke('save_song_info', {
      path: songPath,
      payload: {
        title: song.title || song.name,
        artist: song.artist,
        album: song.album,
        trackNumber: song.track_number ?? null,
        discNumber: song.disc_number ?? null,
        year: song.year ?? null,
        coverPath: selected,
      },
    });

    libraryStore.setSongRecord(result.song);

    // 清缓存并刷新当前封面
    await tauriInvoke('clear_cover_cache');
    clearCoverCaches();
    const [thumb, full] = await Promise.all([
      loadCover(songPath),
      loadFullCover(songPath),
    ]);
    currentCover.value = thumb || '';
    currentCoverFull.value = full || '';

    showToast('封面已更新', 'success');
  } catch (error) {
    showToast(`更新封面失败: ${String(error)}`, 'error');
  } finally {
    isCoverUpdating.value = false;
  }
};

const handleChangeLyrics = async () => {
  const song = currentSong.value;
  const songPath = song?.path;
  if (!song || !songPath || isLyricsUpdating.value) return;

  isLyricsUpdating.value = true;
  try {
    const selected = await open({
      multiple: false,
      directory: false,
      title: '选择 LRC 歌词文件',
      filters: [{ name: '歌词', extensions: ['lrc', 'txt'] }],
    });
    if (!selected || Array.isArray(selected)) return;

    // 通过 convertFileSrc 读取本地文本文件
    const url = convertFileSrc(selected);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`无法读取文件 (HTTP ${response.status})`);
    }
    const lyricsText = await response.text();

    await tauriInvoke('save_song_lyrics', {
      path: songPath,
      lyrics: lyricsText,
      source: 'sidecar',
      sourcePath: null,
    });

    // 重新加载歌词
    await loadLyrics();

    showToast('字幕已更新', 'success');
  } catch (error) {
    showToast(`更新字幕失败: ${String(error)}`, 'error');
  } finally {
    isLyricsUpdating.value = false;
  }
};
</script>

<template>
  <div
    class="fixed inset-x-0 bottom-0 z-[50] flex h-[100vh] flex-col overflow-visible font-sans select-none text-white"
    :class="[
      showPlayerDetail ? 'pointer-events-auto' : 'pointer-events-none',
      isCollapsing ? 'bg-[#0a0a0a]' : '',
      isCursorHidden ? 'cursor-hidden' : '',
    ]"
    @contextmenu.prevent="handleContextMenu"
  >
    <div
      class="relative flex h-[100vh] w-full flex-col pt-[calc(100vh-100%)]"
      :class="{ 'fs-collapsing': isCollapsing }"
    >
      <div
        class="absolute inset-0 transition-all duration-600 ease-[cubic-bezier(0.22,1,0.36,1)]"
        :style="{
          opacity: showPlayerDetail ? 1 : 0,
          transform: showPlayerDetail ? 'translateY(0)' : 'translateY(100%)',
        }"
      >
        <PlayerDetailBackground :bgOpacity="1" :active="showPlayerDetail" />
        <div class="absolute inset-0 z-[-1] bg-[#0a0a0a]"></div>
      </div>

      <div
        class="relative z-[60] h-16"
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
        class="pointer-events-none relative z-[55] flex min-w-0 items-baseline justify-center gap-3 px-6 pb-[clamp(2px,1vh,16px)] text-center transition-opacity duration-500"
        :class="showPlayerDetail ? 'opacity-100' : 'opacity-0'"
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

      <div class="relative z-[75] flex min-h-0 flex-1 pl-8 pr-0 pb-22 pointer-events-none">
        <div v-if="!coverHidden" class="pointer-events-none h-full w-[40%] min-w-[300px]"></div>

        <div
          class="flex h-full min-h-0 flex-1 flex-col justify-center pt-0 pb-0"
          :class="[
            coverHidden ? 'px-[8%] lyrics-force-center' : 'pl-2 pr-8',
            showPlayerDetail ? 'pointer-events-auto' : 'pointer-events-none',
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
      @close="closeContextMenu"
      @action="handleMenuAction"
    />
  </div>
</template>

<style scoped>
/* 沉浸模式鼠标静止时隐藏指针，覆盖所有子元素（按钮等自带 cursor 的也要隐藏） */
.cursor-hidden,
.cursor-hidden :deep(*) {
  cursor: none !important;
}

/* 退出全屏时内容向内收缩，盖住无边框窗窗口硬跳缩小的瞬间。
   不使用 opacity（会让详情页半透明、透出底层统计页），改用不透明底色兜住 scale 缩进后露出的边缘 */
.fs-collapsing {
  transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
  transform: scale(0.96);
  transform-origin: center center;
  background-color: #0a0a0a;
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

/* 封面隐藏时强制歌词居中 */
.lyrics-force-center :deep(.lyrics-align-left),
.lyrics-force-center :deep(.lyrics-align-right) {
  --lyrics-text-align: center;
  --lyrics-line-transform-origin: 50%;
  --light-align-items: center;
}
</style>
