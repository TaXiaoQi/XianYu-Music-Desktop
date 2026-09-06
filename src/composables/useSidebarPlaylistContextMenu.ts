import { computed, ref, type Ref } from 'vue';

import type { Playlist, Song } from '../types';
import type { SyncDeleteScope } from '../components/overlays/SyncDeleteScopeModal.vue';

interface UseSidebarPlaylistContextMenuOptions {
  selectedPlaylistIds: Ref<Set<string>>;
  ensurePlaylistSelected: (id: string) => void;
  getSongsFromPlaylist: (id: string) => Song[];
  addSongsToQueue: (songs: Song[]) => void;
  clearQueue: () => Promise<unknown> | unknown;
  playSong: (song: Song) => Promise<unknown> | unknown;
  openHomePlaylist: (playlistId: string) => Promise<unknown> | unknown;
  deletePlaylist: (id: string) => void;
  /** 歌单是否来自云端（cloudId 或 isCloud 有一即算），决定是否弹删除范围选择 */
  isCloudOrigin: (id: string) => boolean;
  /** 歌单是否持有 cloudId（可真正删云端），决定范围框内云端选项是否可用 */
  hasCloudId: (id: string) => boolean;
  deleteCloudPlaylist: (id: string) => Promise<boolean>;
  clearSelection: () => void;
}

export function useSidebarPlaylistContextMenu({
  selectedPlaylistIds,
  ensurePlaylistSelected,
  getSongsFromPlaylist,
  addSongsToQueue,
  clearQueue,
  playSong,
  openHomePlaylist,
  deletePlaylist,
  isCloudOrigin,
  hasCloudId,
  deleteCloudPlaylist,
  clearSelection,
}: UseSidebarPlaylistContextMenuOptions) {
  const showContextMenu = ref(false);
  const contextMenuX = ref(0);
  const contextMenuY = ref(0);
  const targetPlaylist = ref<Playlist | null>(null);
  const showDeleteModal = ref(false);
  const playlistsToDelete = ref<string[]>([]);
  const deleteModalContent = ref('');
  // 目标歌单中是否至少一个持有 cloudId（可真正删云端）
  const canDeleteCloud = computed(() => deleteScopeIds.value.some(hasCloudId));
  // 已同步歌单：删除范围三选一（本地/全部/仅云端）
  const showDeleteScopeModal = ref(false);
  const deleteScopeIds = ref<string[]>([]);

  const openDeleteScope = (ids: string[]) => {
    deleteScopeIds.value = ids;
    showDeleteScopeModal.value = true;
  };

  const handleDeletePlaylist = (id: string, name: string) => {
    if (isCloudOrigin(id)) {
      openDeleteScope([id]);
      return;
    }
    playlistsToDelete.value = [id];
    deleteModalContent.value = `确定要删除播放列表 "${name}" 吗？`;
    showDeleteModal.value = true;
  };

  const handleDeletePlaylistBatch = (ids: string[], count: number) => {
    if (ids.some(isCloudOrigin)) {
      openDeleteScope(ids);
      return;
    }
    playlistsToDelete.value = ids;
    deleteModalContent.value = `确定要删除 ${count} 个播放列表吗？`;
    showDeleteModal.value = true;
  };

  const confirmDeleteScope = async (scope: SyncDeleteScope) => {
    for (const id of deleteScopeIds.value) {
      const synced = hasCloudId(id);
      if (scope === 'local') {
        deletePlaylist(id);
      } else if (scope === 'all') {
        if (synced) {
          await deleteCloudPlaylist(id);
        }
        deletePlaylist(id);
      } else {
        // 'cloud'：除本机外全删，云端(及其他端)删除，本地保留
        if (synced) {
          await deleteCloudPlaylist(id);
        }
      }
    }
    clearSelection();
    deleteScopeIds.value = [];
    showDeleteScopeModal.value = false;
  };

  const confirmDeletePlaylist = () => {
    playlistsToDelete.value.forEach(id => deletePlaylist(id));
    clearSelection();
    playlistsToDelete.value = [];
    showDeleteModal.value = false;
  };

  const handlePlaylistContextMenu = (event: MouseEvent, playlist: Playlist) => {
    event.preventDefault();
    event.stopPropagation();
    targetPlaylist.value = playlist;

    ensurePlaylistSelected(playlist.id);

    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    showContextMenu.value = true;
  };

  const handleMenuPlay = () => {
    if (!targetPlaylist.value) {
      return;
    }

    const songs = getSongsFromPlaylist(targetPlaylist.value.id);
    if (songs.length > 0) {
      void clearQueue();
      void openHomePlaylist(targetPlaylist.value.id);
      setTimeout(() => {
        void playSong(songs[0]);
      }, 50);
    }
    showContextMenu.value = false;
  };

  const handleMenuAddToQueue = () => {
    if (selectedPlaylistIds.value.size > 1) {
      selectedPlaylistIds.value.forEach(id => {
        addSongsToQueue(getSongsFromPlaylist(id));
      });
    } else if (targetPlaylist.value) {
      addSongsToQueue(getSongsFromPlaylist(targetPlaylist.value.id));
    }
    showContextMenu.value = false;
  };

  const handleMenuDelete = () => {
    if (selectedPlaylistIds.value.size > 0) {
      handleDeletePlaylistBatch(
        Array.from(selectedPlaylistIds.value),
        selectedPlaylistIds.value.size,
      );
    } else if (targetPlaylist.value) {
      handleDeletePlaylist(targetPlaylist.value.id, targetPlaylist.value.name);
    }
    showContextMenu.value = false;
  };

  return {
    showContextMenu,
    contextMenuX,
    contextMenuY,
    targetPlaylist,
    showDeleteModal,
    deleteModalContent,
    showDeleteScopeModal,
    canDeleteCloud,
    confirmDeleteScope,
    handleDeletePlaylist,
    confirmDeletePlaylist,
    handlePlaylistContextMenu,
    handleMenuPlay,
    handleMenuAddToQueue,
    handleMenuDelete,
  };
}
