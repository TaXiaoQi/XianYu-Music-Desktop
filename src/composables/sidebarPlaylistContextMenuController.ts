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

  // —— 删除气泡确认（Popconfirm）状态 ——
  const deleteConfirmVisible = ref(false);
  const deleteConfirmText = ref('');
  const deleteConfirmIds = ref<string[]>([]);
  // 锚点：行内删除按钮传触发事件（停靠按钮弹出）；右键菜单路径无元素，
  // 用菜单位置做坐标兜底
  const deleteAnchorEl = ref<HTMLElement | null>(null);
  const deleteAnchorX = ref(0);
  const deleteAnchorY = ref(0);

  const scopeDialogVisible = ref(false);
  const scopeDialogIds = ref<string[]>([]);
  const cloudRemovable = computed(() => scopeDialogIds.value.some((id) => hasCloudId(id)));

  /** 命中云端歌单时改走删除范围弹窗 */
  const routeToDeleteFlow = (
    ids: string[],
    prompt: string,
    anchor?: MouseEvent | null,
  ) => {
    deleteConfirmIds.value = ids;
    deleteConfirmText.value = prompt;
    deleteAnchorEl.value =
      anchor?.currentTarget instanceof HTMLElement ? anchor.currentTarget : null;
    deleteAnchorX.value = anchor?.clientX ?? menuPosX.value;
    deleteAnchorY.value = anchor?.clientY ?? menuPosY.value;
    deleteConfirmVisible.value = true;
  };

  const openScopeDialog = (ids: string[]) => {
    scopeDialogIds.value = ids;
    scopeDialogVisible.value = true;
  };

  const cancelDeleteConfirm = () => {
    deleteConfirmVisible.value = false;
    deleteConfirmIds.value = [];
  };

  const requestPlaylistDelete = (id: string, name: string, anchor?: MouseEvent | null) => {
    if (isCloudOrigin(id)) {
      openScopeDialog([id]);
      return;
    }
    routeToDeleteFlow([id], `确定要删除播放列表 "${name}" 吗？`, anchor);
  };

  const requestBatchPlaylistDelete = (
    ids: string[],
    count: number,
    anchor?: MouseEvent | null,
  ) => {
    if (ids.some((id) => isCloudOrigin(id))) {
      openScopeDialog(ids);
      return;
    }
    routeToDeleteFlow(ids, `确定要删除 ${count} 个播放列表吗？`, anchor);
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
    deleteConfirmIds.value.forEach((id) => deletePlaylist(id));
    clearSelection();
    cancelDeleteConfirm();
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
    showDeleteConfirm: deleteConfirmVisible,
    deleteConfirmText,
    deleteConfirmAnchorEl: deleteAnchorEl,
    deleteConfirmAnchorX: deleteAnchorX,
    deleteConfirmAnchorY: deleteAnchorY,
    showDeleteScopeModal: scopeDialogVisible,
    canDeleteCloud: cloudRemovable,
    confirmDeleteScope: applyDeleteScope,
    handleDeletePlaylist: requestPlaylistDelete,
    confirmDeletePlaylist: applyPlaylistDelete,
    cancelDeleteConfirm,
    handlePlaylistContextMenu: openPlaylistContextMenu,
    handleMenuPlay: runMenuPlay,
    handleMenuAddToQueue: runMenuEnqueue,
    handleMenuDelete: runMenuDelete,
  };
}
