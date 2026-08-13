import { ref } from 'vue';
import { defineStore } from 'pinia';

export const defaultDominantColors = ['transparent', 'transparent', 'transparent', 'transparent'];

export const useUiStore = defineStore('ui', () => {
  const showPlaylist = ref(false);
  const showMiniPlaylist = ref(false);
  const showPlayerDetail = ref(false);
  const showQueue = ref(false);
  const showComment = ref(false);
  const isMiniMode = ref(false);
  const showVolumePopover = ref(false);
  const showCustomSkinModal = ref(false);
  const mainWindowUiSleepRequested = ref(false);
  const skipNextPageTransition = ref(false);
  const startupCompositionMaskVisible = ref(false);
  const dominantColors = ref<string[]>([...defaultDominantColors]);

  // 沉浸式全屏状态（全局共享）：
  // 由 PlayerDetail 的开关触发，窗口覆盖整个显示器并隐藏任务栏。
  // 歌词页与主页共享此状态——主页在全屏窗口中按默认样式显示，
  // 歌词页在全屏时额外应用黑色背景、鼠标自动隐藏等沉浸效果。
  const isImmersiveFullscreen = ref(false);

  // 沉浸全屏切换动画状态（全局共享）：
  // 'entering' | 'exiting' | null。主页与歌词页共享此状态，
  // 使主页容器与歌词页同步播放 scale 动画，避免退出全屏时主页透出。
  const fullscreenAnimState = ref<'entering' | 'exiting' | null>(null);

  return {
    showPlaylist,
    showMiniPlaylist,
    showPlayerDetail,
    showQueue,
    showComment,
    isMiniMode,
    showVolumePopover,
    showCustomSkinModal,
    mainWindowUiSleepRequested,
    skipNextPageTransition,
    startupCompositionMaskVisible,
    dominantColors,
    isImmersiveFullscreen,
    fullscreenAnimState,
  };
});
