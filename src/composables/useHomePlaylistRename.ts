import { ref, type Ref } from 'vue';

import type { Playlist } from '../types';

interface UseHomePlaylistRenameOptions {
  currentViewMode: Ref<string>;
  filterCondition: Ref<string>;
  playlists: Ref<Playlist[]>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  setPlaylistCover: (id: string, coverPath: string | null) => boolean;
}

export function useHomePlaylistRename({
  currentViewMode,
  filterCondition,
  playlists,
  showToast,
  setPlaylistCover,
}: UseHomePlaylistRenameOptions) {
  const showRenameModal = ref(false);
  const renameInitialValue = ref('');
  const renameInitialCoverPath = ref<string | undefined>(undefined);
  const editingPlaylistId = ref<string>('');

  const handleRenamePlaylist = () => {
    if (currentViewMode.value !== 'playlist') return;

    const playlist = playlists.value.find(item => item.id === filterCondition.value);
    if (!playlist) return;

    editingPlaylistId.value = playlist.id;
    renameInitialValue.value = playlist.name;
    renameInitialCoverPath.value = playlist.coverPath;
    showRenameModal.value = true;
  };

  const confirmRename = (payload: { name: string; coverPath: string | null }) => {
    if (currentViewMode.value !== 'playlist') return;

    const playlist = playlists.value.find(item => item.id === filterCondition.value);
    if (!playlist) return;

    const newName = payload.name.trim();
    if (!newName) return;

    let changed = false;
    if (newName !== playlist.name) {
      playlist.name = newName;
      changed = true;
    }
    if ((payload.coverPath ?? null) !== (playlist.coverPath ?? null)) {
      setPlaylistCover(playlist.id, payload.coverPath);
      changed = true;
    }

    if (changed) {
      showToast('歌单信息已更新', 'success');
    }
    showRenameModal.value = false;
  };

  return {
    showRenameModal,
    renameInitialValue,
    renameInitialCoverPath,
    editingPlaylistId,
    handleRenamePlaylist,
    confirmRename,
  };
}
