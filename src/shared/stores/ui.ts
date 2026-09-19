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

  const isImmersiveFullscreen = ref(false);

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
