import { ref } from 'vue';
import { defineStore } from 'pinia';

export const defaultDominantColors = ['transparent', 'transparent', 'transparent', 'transparent'];

export const useUiStore = defineStore('ui', () => {
  const showPlaylist = ref(false);
  const showMiniPlaylist = ref(false);
  const showPlayerDetail = ref(false);
  const showQueue = ref(false);
  const isMiniMode = ref(false);
  const showVolumePopover = ref(false);
  const skipNextPageTransition = ref(false);
  const startupCompositionMaskVisible = ref(false);
  const dominantColors = ref<string[]>([...defaultDominantColors]);

  // 沉浸式全屏状态（全局共享）：
  // 由 PlayerDetail 的开关触发，窗口覆盖整个显示器并隐藏任务栏。
  // 歌词页与主页共享此状态——主页在全屏窗口中按默认样式显示，
  // 歌词页在全屏时额外应用黑色背景、鼠标自动隐藏等沉浸效果。
  const isImmersiveFullscreen = ref(false);

  return {
    showPlaylist,
    showMiniPlaylist,
    showPlayerDetail,
    showQueue,
    isMiniMode,
    showVolumePopover,
    skipNextPageTransition,
    startupCompositionMaskVisible,
    dominantColors,
    isImmersiveFullscreen,
  };
});
