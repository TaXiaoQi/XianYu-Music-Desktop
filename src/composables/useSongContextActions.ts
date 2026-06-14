import { ref, type Ref } from 'vue';

import type { Song } from '../types';

interface UseSongContextActionsOptions {
  isBatchMode: Ref<boolean>;
  deleteFromDisk: (song: Song) => Promise<unknown>;
}

export function useSongContextActions({
  isBatchMode,
  deleteFromDisk,
}: UseSongContextActionsOptions) {
  const showContextMenu = ref(false);
  const contextMenuX = ref(0);
  const contextMenuY = ref(0);
  const contextMenuTargetSong = ref<Song | null>(null);
  const showSongPhysicalDeleteConfirm = ref(false);
  const songToPhysicalDelete = ref<Song | null>(null);

  const handleContextMenu = (event: MouseEvent, song: Song) => {
    if (isBatchMode.value) return;

    contextMenuTargetSong.value = song;
    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    showContextMenu.value = true;
  };

  const handleSongPhysicalDelete = (song: Song) => {
    songToPhysicalDelete.value = song;
    showSongPhysicalDeleteConfirm.value = true;
    showContextMenu.value = false;
  };

  const executeSongPhysicalDelete = async () => {
    if (!songToPhysicalDelete.value) {
      return;
    }

    await deleteFromDisk(songToPhysicalDelete.value);
    showSongPhysicalDeleteConfirm.value = false;
    songToPhysicalDelete.value = null;
  };

  return {
    showContextMenu,
    contextMenuX,
    contextMenuY,
    contextMenuTargetSong,
    showSongPhysicalDeleteConfirm,
    songToPhysicalDelete,
    handleContextMenu,
    handleSongPhysicalDelete,
    executeSongPhysicalDelete,
  };
}
