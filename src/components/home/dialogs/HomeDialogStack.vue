<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';

import type { Song } from '../../../types';

type DialogAction = (...args: any[]) => void;

const ModernModal = defineAsyncComponent(() => import('../../common/ModernModal.vue'));
const ModernInputModal = defineAsyncComponent(() => import('../../common/ModernInputModal.vue'));
const MoveToFolderModal = defineAsyncComponent(() => import('../../overlays/MoveToFolderModal.vue'));
const PlaylistEditInfoModal = defineAsyncComponent(() => import('../../overlays/PlaylistEditInfoModal.vue'));
const SongContextMenu = defineAsyncComponent(() => import('../../overlays/SongContextMenu.vue'));

interface HomeDialogProps {
  isEnglish: boolean;

  moveModalVisible: boolean;
  moveCandidateCount: number;
  closeMoveModal: DialogAction;
  applyMoveSelection: DialogAction;

  songMenuVisible: boolean;
  songMenuX: number;
  songMenuY: number;
  songMenuTarget: Song | null;
  songMenuPlaylistView: boolean;
  songMenuFolderView: boolean;
  songMenuManageMode: boolean;
  songMenuOnlineSearch: boolean;
  songMenuResolvedPath: string | undefined;
  closeSongMenu: DialogAction;
  menuAddToPlaylist: DialogAction;
  menuDeleteOnDisk: DialogAction;
  menuViewOnlineArtist: DialogAction;
  menuViewOnlineAlbum: DialogAction;

  confirmVisible: boolean;
  confirmHeading: string;
  confirmBody: string;
  confirmLabel: string;
  runConfirm: DialogAction;
  cancelConfirm: DialogAction;

  songDeleteVisible: boolean;
  songDeleteTarget: Song | null;
  syncSongDeleteVisible: DialogAction;
  runSongDiskDelete: DialogAction;

  folderDeleteVisible: boolean;
  folderDeletePath: string;
  syncFolderDeleteVisible: DialogAction;
  runFolderDelete: DialogAction;

  createFolderVisible: boolean;
  cancelCreateFolder: DialogAction;
  runCreateFolder: DialogAction;

  renameVisible: boolean;
  renameTargetId: string;
  renameSeedName: string;
  renameSeedCover: string | undefined;
  cancelRename: DialogAction;
  runRename: DialogAction;
}

const props = defineProps<HomeDialogProps>();

const songDiskDeleteVisible = computed<boolean>({
  get() {
    return props.songDeleteVisible;
  },
  set(next) {
    props.syncSongDeleteVisible(next);
  },
});

const folderRemovalVisible = computed<boolean>({
  get() {
    return props.folderDeleteVisible;
  },
  set(next) {
    props.syncFolderDeleteVisible(next);
  },
});
</script>

<template>
  <MoveToFolderModal
    v-if="props.moveModalVisible"
    :visible="props.moveModalVisible"
    :selectedCount="props.moveCandidateCount"
    @close="props.closeMoveModal()"
    @confirm="props.applyMoveSelection"
  />

  <SongContextMenu
    v-if="props.songMenuVisible"
    :visible="props.songMenuVisible"
    :x="props.songMenuX"
    :y="props.songMenuY"
    :song="props.songMenuTarget"
    :is-playlist-view="props.songMenuPlaylistView"
    :is-folder-view="props.songMenuFolderView"
    :isManagementMode="props.songMenuManageMode"
    :is-online-search="props.songMenuOnlineSearch"
    :resolved-file-path="props.songMenuResolvedPath"
    @close="props.closeSongMenu()"
    @add-to-playlist="props.menuAddToPlaylist"
    @delete-disk="props.menuDeleteOnDisk"
    @view-online-artist="props.menuViewOnlineArtist"
    @view-online-album="props.menuViewOnlineAlbum"
  />

  <ModernModal
    v-if="props.confirmVisible"
    :visible="props.confirmVisible"
    :title="props.confirmHeading"
    :content="props.confirmBody"
    type="danger"
    :confirm-text="props.confirmLabel"
    @confirm="props.runConfirm"
    @cancel="props.cancelConfirm()"
  />

  <ModernModal
    v-if="props.songDeleteVisible"
    v-model:visible="songDiskDeleteVisible"
    :title="props.isEnglish ? 'Permanently Delete File' : '永久删除文件'"
    :content="props.isEnglish ? `Permanently delete '${props.songDeleteTarget?.title}' from disk? This cannot be undone.` : `确定要从磁盘中永久删除歌曲 '${props.songDeleteTarget?.title}' 吗？此操作不可逆！`"
    type="danger"
    :confirm-text="props.isEnglish ? 'Delete Permanently' : '永久删除'"
    @confirm="props.runSongDiskDelete"
  />

  <ModernModal
    v-if="props.folderDeleteVisible"
    v-model:visible="folderRemovalVisible"
    :title="props.isEnglish ? 'Delete Folder' : '删除文件夹'"
    :content="props.isEnglish ? `Delete the folder '${props.folderDeletePath}'? Its local files will also be removed from the library.` : `确定要删除文件夹 '${props.folderDeletePath}' 吗？这也将移除其中的本地文件。`"
    type="danger"
    :confirm-text="props.isEnglish ? 'Delete Folder' : '删除文件夹'"
    @confirm="props.runFolderDelete"
  />

  <ModernInputModal
    v-if="props.createFolderVisible"
    :visible="props.createFolderVisible"
    :title="props.isEnglish ? 'New Folder' : '新建文件夹'"
    :placeholder="props.isEnglish ? 'Enter a folder name' : '请输入文件夹名称'"
    :confirm-text="props.isEnglish ? 'Create' : '创建'"
    @cancel="props.cancelCreateFolder()"
    @confirm="props.runCreateFolder"
  />

  <PlaylistEditInfoModal
    v-if="props.renameVisible"
    :visible="props.renameVisible"
    :playlist-id="props.renameTargetId"
    :initial-name="props.renameSeedName"
    :initial-cover-path="props.renameSeedCover"
    @cancel="props.cancelRename()"
    @confirm="props.runRename"
  />
</template>
