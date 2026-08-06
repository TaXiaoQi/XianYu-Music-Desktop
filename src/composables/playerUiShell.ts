import { getCurrentWindow } from '@tauri-apps/api/window';
import { storeToRefs } from 'pinia';

import type { Song } from '../types';
import { useCollectionsStore } from '../features/collections/store';
import { useLibraryStore } from '../features/library/store';
import { useNavigationStore } from '../shared/stores/navigation';
import { usePlaybackStore } from '../features/playback/store';
import { useUiStore } from '../shared/stores/ui';

interface CreatePlayerUiShellDeps {
  addFolder: () => void | Promise<void>;
  removeFromHistory: (songPaths: string[]) => Promise<void>;
}

const clampVolumePercent = (volume: number) => Math.max(0, Math.min(100, Math.round(volume)));

export const getNextWheelVolume = (currentVolume: number, deltaY: number) => {
  if (deltaY === 0) {
    return clampVolumePercent(currentVolume);
  }

  return clampVolumePercent(currentVolume + (deltaY < 0 ? 1 : -1));
};

export const createPlayerUiShell = ({
  addFolder,
  removeFromHistory,
}: CreatePlayerUiShellDeps) => {
  const collectionsStore = useCollectionsStore();
  const libraryStore = useLibraryStore();
  const navigationStore = useNavigationStore();
  const playbackStore = usePlaybackStore();
  const uiStore = useUiStore();
  const { currentViewMode } = storeToRefs(navigationStore);
  const { canonicalSongs, sourceSongs } = storeToRefs(libraryStore);
  const { favoritePaths } = storeToRefs(collectionsStore);

  const handleVolume = (event: Event) => {
    const volume = clampVolumePercent(parseInt((event.target as HTMLInputElement).value, 10));
    // [修复音量无反应] 只设置 store，playerPlayback 中的 watch 会自动双路径分流
    // （WASAPI 走 playbackApi.setVolume，HTML5 Audio 走 audio.volume）
    playbackStore.volume = volume;
  };

  const handleVolumeWheel = (event: WheelEvent) => {
    const volume = getNextWheelVolume(playbackStore.volume, event.deltaY);
    if (volume === playbackStore.volume) {
      return;
    }

    playbackStore.volume = volume;
  };

  const toggleMute = () => {
    if (playbackStore.volume > 0) {
      playbackStore.volume = 0;
      return;
    }

    playbackStore.volume = 100;
  };

  const togglePlaylist = () => {
    uiStore.showPlaylist = !uiStore.showPlaylist;
  };

  const toggleMiniPlaylist = () => {
    uiStore.showMiniPlaylist = !uiStore.showMiniPlaylist;
  };

  const closeMiniPlaylist = () => {
    uiStore.showMiniPlaylist = false;
  };

  const handleScan = async () => {
    await addFolder();
  };

  const removeSongFromList = async (song: Song) => {
    if (currentViewMode.value === 'all') {
      canonicalSongs.value = canonicalSongs.value.filter(item => item.path !== song.path);
      sourceSongs.value = sourceSongs.value.filter(item => item.path !== song.path);
      return;
    }

    if (currentViewMode.value === 'favorites') {
      favoritePaths.value = favoritePaths.value.filter(path => path !== song.path);
      return;
    }

    if (currentViewMode.value === 'recent') {
      await removeFromHistory([song.path]);
    }
  };

  const toggleAlwaysOnTop = async (enable: boolean) => {
    try {
      await getCurrentWindow().setAlwaysOnTop(enable);
    } catch (error) {
      console.error('Failed to set always on top:', error);
    }
  };

  const togglePlayerDetail = () => {
    uiStore.showPlayerDetail = !uiStore.showPlayerDetail;
  };

  const toggleQueue = () => {
    uiStore.showQueue = !uiStore.showQueue;
  };

  return {
    handleVolume,
    handleVolumeWheel,
    toggleMute,
    togglePlaylist,
    toggleMiniPlaylist,
    closeMiniPlaylist,
    handleScan,
    removeSongFromList,
    toggleAlwaysOnTop,
    togglePlayerDetail,
    toggleQueue,
  };
};
