import { ref, type Ref } from 'vue';

import type { Playlist } from '../types';

interface UseSidebarPlaylistSelectionOptions {
  playlists: Ref<Playlist[]>;
  currentViewMode: Ref<string>;
  filterCondition: Ref<string>;
  openHomePlaylist: (playlistId: string) => Promise<unknown> | unknown;
}

export function useSidebarPlaylistSelection({
  playlists,
  currentViewMode,
  filterCondition,
  openHomePlaylist,
}: UseSidebarPlaylistSelectionOptions) {
  const selectedPlaylistIds = ref<Set<string>>(new Set());
  const lastSelectedPlaylistId = ref<string | null>(null);

  const selectSinglePlaylist = (id: string) => {
    selectedPlaylistIds.value.clear();
    selectedPlaylistIds.value.add(id);
    lastSelectedPlaylistId.value = id;
  };

  const ensurePlaylistSelected = (id: string) => {
    if (!selectedPlaylistIds.value.has(id)) {
      selectSinglePlaylist(id);
    }
  };

  const handlePlaylistClick = (event: MouseEvent, id: string) => {
    event.stopPropagation();
    void openHomePlaylist(id);

    if (event.shiftKey && lastSelectedPlaylistId.value) {
      const lastIndex = playlists.value.findIndex(
        playlist => playlist.id === lastSelectedPlaylistId.value,
      );
      const currentIndex = playlists.value.findIndex(playlist => playlist.id === id);
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        for (let index = start; index <= end; index += 1) {
          selectedPlaylistIds.value.add(playlists.value[index].id);
        }
      }
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      if (selectedPlaylistIds.value.has(id)) {
        selectedPlaylistIds.value.delete(id);
      } else {
        selectedPlaylistIds.value.add(id);
      }
      lastSelectedPlaylistId.value = id;
      return;
    }

    selectSinglePlaylist(id);
  };

  const handleBackgroundClick = () => {
    if (currentViewMode.value === 'playlist' && filterCondition.value) {
      selectSinglePlaylist(filterCondition.value);
    }
  };

  return {
    selectedPlaylistIds,
    lastSelectedPlaylistId,
    ensurePlaylistSelected,
    handlePlaylistClick,
    handleBackgroundClick,
  };
}
