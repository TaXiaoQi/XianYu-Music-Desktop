import { ref, type Ref } from 'vue';

import type { Playlist } from '../types';

interface UseHomePlaylistRenameOptions {
  currentViewMode: Ref<string>;
  filterCondition: Ref<string>;
  playlists: Ref<Playlist[]>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function useHomePlaylistRename({
  currentViewMode,
  filterCondition,
  playlists,
  showToast,
}: UseHomePlaylistRenameOptions) {
  const showRenameModal = ref(false);
  const renameInitialValue = ref('');

  const handleRenamePlaylist = () => {
    if (currentViewMode.value !== 'playlist') return;

    const playlist = playlists.value.find(item => item.id === filterCondition.value);
    if (!playlist) return;

    renameInitialValue.value = playlist.name;
    showRenameModal.value = true;
  };

  const confirmRename = (newName: string) => {
    if (currentViewMode.value !== 'playlist') return;

    const playlist = playlists.value.find(item => item.id === filterCondition.value);
    if (!playlist || !newName.trim()) return;

    playlist.name = newName.trim();
    showToast('Playlist renamed', 'success');
    showRenameModal.value = false;
  };

  return {
    showRenameModal,
    renameInitialValue,
    handleRenamePlaylist,
    confirmRename,
  };
}
