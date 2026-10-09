import { computed, ref, type Ref } from 'vue';

import type { Playlist, Song } from '../types';
import type { SyncDeleteScope } from '../components/overlays/SyncDeleteScopeModal.vue';
import {
  addDownloadSkipPlaylistIds,
  removeDownloadSkipPlaylistIds,
} from '../services/domain/playlistSongSyncState';

export interface UseSidebarPlaylistContextMenuOptions {
  selectedPlaylistIds: Ref<Set<string>>;
  ensurePlaylistSelected: (id: string) => void;
  getSongsFromPlaylist: (id: string) => Song[];
  addSongsToQueue: (songs: Song[]) => void;
  clearQueue: () => Promise<unknown> | unknown;
  playSong: (song: Song) => Promise<unknown> | unknown;
  openHomePlaylist: (playlistId: string) => Promise<unknown> | unknown;
  deletePlaylist: (id: string) => void;
  isCloudOrigin: (id: string) => boolean;
  hasCloudId: (id: string) => boolean;
  getPlaylistCloudId: (id: string) => string;
  deleteCloudPlaylist: (id: string) => Promise<boolean>;
  clearSelection: () => void;
}

/**
 * 侧边栏歌单右键菜单控制器：
 * 管理菜单位置、多选删除确认、云端删除范围选择与菜单三大动作。
 */
export function useSidebarPlaylistContextMenu(options: UseSidebarPlaylistContextMenuOptions) {
  const {
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
    getPlaylistCloudId,
    deleteCloudPlaylist,
    clearSelection,
  } = options;

  const menuVisible = ref(false);
  const menuPosX = ref(0);
  const menuPosY = ref(0);
  const menuTargetPlaylist = ref<Playlist | null>(null);

  const deleteDialogVisible = ref(false);
  const deleteDialogText = ref('');
  const deleteDialogIds = ref<string[]>([]);

  const scopeDialogVisible = ref(false);
  const scopeDialogIds = ref<string[]>([]);
  const cloudRemovable = computed(() => scopeDialogIds.value.some((id) => hasCloudId(id)));

  /** 命中云端歌单时改走删除范围弹窗 */
  const routeToDeleteFlow = (ids: string[], prompt: string) => {
    deleteDialogIds.value = ids;
    deleteDialogText.value = prompt;
    deleteDialogVisible.value = true;
  };

  const openScopeDialog = (ids: string[]) => {
    scopeDialogIds.value = ids;
    scopeDialogVisible.value = true;
  };

  const requestPlaylistDelete = (id: string, name: string) => {
    if (isCloudOrigin(id)) {
      openScopeDialog([id]);
      return;
    }
    routeToDeleteFlow([id], `确定要删除播放列表 "${name}" 吗？`);
  };

  const requestBatchPlaylistDelete = (ids: string[], count: number) => {
    if (ids.some((id) => isCloudOrigin(id))) {
      openScopeDialog(ids);
      return;
    }
    routeToDeleteFlow(ids, `确定要删除 ${count} 个播放列表吗？`);
  };

  /** 云端删除范围确认：local 仅删本地，all 连云端一起删，cloud 仅删云端 */
  const applyDeleteScope = async (scope: SyncDeleteScope) => {
    for (const id of scopeDialogIds.value) {
      const cloudId = getPlaylistCloudId(id);
      const synced = hasCloudId(id);
      if (scope === 'local') {
        // 记录下载跳过，防止下次同步 diff 把云端歌单重新 create 回来
        if (cloudId) addDownloadSkipPlaylistIds([cloudId]);
        deletePlaylist(id);
        continue;
      }
      if (scope === 'all') {
        if (synced) {
          await deleteCloudPlaylist(id);
        }
        if (cloudId) removeDownloadSkipPlaylistIds([cloudId]);
        deletePlaylist(id);
        continue;
      }
      if (synced) {
        await deleteCloudPlaylist(id);
      }
      if (cloudId) removeDownloadSkipPlaylistIds([cloudId]);
    }
    clearSelection();
    scopeDialogIds.value = [];
    scopeDialogVisible.value = false;
  };

  const applyPlaylistDelete = () => {
    deleteDialogIds.value.forEach((id) => deletePlaylist(id));
    clearSelection();
    deleteDialogIds.value = [];
    deleteDialogVisible.value = false;
  };

  const openPlaylistContextMenu = (event: MouseEvent, playlist: Playlist) => {
    event.preventDefault();
    event.stopPropagation();
    menuTargetPlaylist.value = playlist;
    ensurePlaylistSelected(playlist.id);
    menuPosX.value = event.clientX;
    menuPosY.value = event.clientY;
    menuVisible.value = true;
  };

  const runMenuPlay = () => {
    const target = menuTargetPlaylist.value;
    if (!target) {
      return;
    }
    const songs = getSongsFromPlaylist(target.id);
    if (songs.length > 0) {
      void clearQueue();
      void openHomePlaylist(target.id);
      setTimeout(() => {
        void playSong(songs[0]);
      }, 50);
    }
    menuVisible.value = false;
  };

  const runMenuEnqueue = () => {
    if (selectedPlaylistIds.value.size > 1) {
      selectedPlaylistIds.value.forEach((id) => {
        addSongsToQueue(getSongsFromPlaylist(id));
      });
    } else if (menuTargetPlaylist.value) {
      addSongsToQueue(getSongsFromPlaylist(menuTargetPlaylist.value.id));
    }
    menuVisible.value = false;
  };

  const runMenuDelete = () => {
    if (selectedPlaylistIds.value.size > 0) {
      requestBatchPlaylistDelete(
        Array.from(selectedPlaylistIds.value),
        selectedPlaylistIds.value.size,
      );
    } else if (menuTargetPlaylist.value) {
      requestPlaylistDelete(menuTargetPlaylist.value.id, menuTargetPlaylist.value.name);
    }
    menuVisible.value = false;
  };

  return {
    showContextMenu: menuVisible,
    contextMenuX: menuPosX,
    contextMenuY: menuPosY,
    targetPlaylist: menuTargetPlaylist,
    showDeleteModal: deleteDialogVisible,
    deleteModalContent: deleteDialogText,
    showDeleteScopeModal: scopeDialogVisible,
    canDeleteCloud: cloudRemovable,
    confirmDeleteScope: applyDeleteScope,
    handleDeletePlaylist: requestPlaylistDelete,
    confirmDeletePlaylist: applyPlaylistDelete,
    handlePlaylistContextMenu: openPlaylistContextMenu,
    handleMenuPlay: runMenuPlay,
    handleMenuAddToQueue: runMenuEnqueue,
    handleMenuDelete: runMenuDelete,
  };
}
