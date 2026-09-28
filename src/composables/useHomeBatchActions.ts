import {
  ref,
  type Ref,
} from 'vue';
import { storeToRefs } from 'pinia';

import { fileApi } from '../services/tauri/fileApi';
import { usePlaybackStore } from '../features/playback/store';
import type { Playlist, Song } from '../types';
import { removeSongPathsFromPlaybackState } from '../features/playback/playbackCleanup';
import { useSettings } from '../features/settings/useSettings';
import { isDownloadableOnlineSong } from '../services/domain/downloadService';
import { downloadToLocal } from './useDownloadToLocal';
import { runBatchTaskPool } from './batchTaskPool';

/** 确认弹窗的一次请求描述 */
interface ConfirmDialogRequest {
  /** 弹窗标题 */
  title: string;
  /** 确认按钮文案 */
  confirmText: string;
  /** 正文提示 */
  message: string;
  /** 确认后执行的动作 */
  action: () => void | Promise<void>;
}

/** 首页批量操作组合函数的入参契约 */
interface HomeBatchActionsContext {
  /** 当前视图模式（all / playlist / folder 等） */
  currentViewMode: Ref<string>;
  /** 批量勾选的歌曲路径集合 */
  selectedPaths: Ref<Set<string>>;
  /** 是否处于批量勾选状态 */
  isBatchMode: Ref<boolean>;
  /** 是否处于管理模式（决定删除是否落盘） */
  isManagementMode: Ref<boolean>;
  /** 曲库主列表 */
  canonicalSongs: Ref<Song[]>;
  /** 曲库源列表 */
  sourceSongs: Ref<Song[]>;
  /** 收藏路径列表 */
  favoritePaths: Ref<string[]>;
  /** 用户歌单列表 */
  playlists: Ref<Playlist[]>;
  /** 将文件移动到目标文件夹，返回成功数 */
  moveFilesToFolder: (paths: string[], targetFolder: string) => Promise<number>;
  /** 将歌曲移出播放历史 */
  removeFromHistory: (songPaths: string[]) => Promise<void>;
  /** 轻提示 */
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  /** 读取当前路由路径 */
  getRoutePath: () => string;
  /** 依据路径解析歌曲实体（缺省时回退到列表查找） */
  resolveSongByPath?: (path: string) => Song | null;
}

/** 首页批量操作：勾选歌曲的删除 / 移动 / 下载等动作集合 */
export function useHomeBatchActions(input: HomeBatchActionsContext) {
  const {
    currentViewMode: activeViewMode,
    selectedPaths: pickedPaths,
    isBatchMode: batchModeOn,
    isManagementMode: manageModeOn,
    canonicalSongs: masterSongList,
    sourceSongs: rawSongList,
    favoritePaths: lovedPaths,
    playlists: userPlaylists,
    moveFilesToFolder: relocateFiles,
    removeFromHistory: dropFromHistory,
    showToast: notify,
    getRoutePath: readRoutePath,
    resolveSongByPath: findSongByPath,
  } = input;

  const isMoveDialogShown = ref(false);
  const isConfirmShown = ref(false);
  const confirmHeading = ref('移除歌曲');
  const confirmLabel = ref('移除');
  const confirmBodyText = ref('');
  const pendingAction = ref<() => void | Promise<void>>(() => {});

  const playbackStore = usePlaybackStore();
  const { playQueue, tempQueue, currentSong } = storeToRefs(playbackStore);
  const { settings } = useSettings();

  /** 退出批量态：清空勾选集合 */
  function clearPickedState() {
    pickedPaths.value.clear();
    batchModeOn.value = false;
  }

  /** 收起确认弹窗 */
  function dismissConfirm() {
    isConfirmShown.value = false;
  }

  /** 弹出确认框并暂存待执行动作 */
  const openConfirm = ({ title, confirmText, message, action }: ConfirmDialogRequest) => {
    confirmHeading.value = title;
    confirmLabel.value = confirmText;
    confirmBodyText.value = message;
    pendingAction.value = action;
    isConfirmShown.value = true;
  };

  /** 从歌曲列表中剔除被勾选路径 */
  const withoutPicked = (songs: Song[], banned: Set<string>) =>
    songs.filter((song) => !banned.has(song.path));

  /** 执行"仅移出列表"式删除：曲库根目录清两份列表，收藏页只清收藏路径 */
  function applyLibraryRemoval() {
    const banned = new Set(pickedPaths.value);

    if (activeViewMode.value === 'all' && readRoutePath() === '/') {
      masterSongList.value = withoutPicked(masterSongList.value, banned);
      rawSongList.value = withoutPicked(rawSongList.value, banned);
    } else if (readRoutePath() === '/favorites') {
      lovedPaths.value = lovedPaths.value.filter((path) => !banned.has(path));
    }

    clearPickedState();
    dismissConfirm();
  }

  /** 从磁盘删除单个文件；失败时记录日志并返回 false */
  async function removeFromDisk(path: string): Promise<boolean> {
    try {
      await fileApi.deleteMusicFile(path);
      return true;
    } catch (error) {
      console.error('Failed to delete song from disk:', path, error);
      return false;
    }
  }

  /** 执行磁盘删除，并同步清理曲库 / 收藏 / 播放态 / 歌单 / 历史中的引用 */
  async function applyDiskRemoval() {
    const pendingPaths = Array.from(pickedPaths.value);
    if (pendingPaths.length === 0) {
      return;
    }

    const removedPaths = new Set<string>();
    for (const path of pendingPaths) {
      if (await removeFromDisk(path)) {
        removedPaths.add(path);
      }
    }

    if (removedPaths.size > 0) {
      masterSongList.value = withoutPicked(masterSongList.value, removedPaths);
      rawSongList.value = withoutPicked(rawSongList.value, removedPaths);
      lovedPaths.value = lovedPaths.value.filter((path) => !removedPaths.has(path));
      removeSongPathsFromPlaybackState({ playQueue, tempQueue, currentSong }, removedPaths);
      await dropFromHistory([...removedPaths]);
      userPlaylists.value.forEach((collection) => {
        collection.songPaths = collection.songPaths.filter((path) => !removedPaths.has(path));
      });

      notify(`已删除 ${removedPaths.size} 首本地歌曲`, 'success');
    }

    const failedTally = pendingPaths.length - removedPaths.size;
    if (failedTally > 0) {
      notify(`${failedTally} 首歌曲删除失败`, 'error');
    }

    clearPickedState();
    dismissConfirm();
  }

  /** 请求移出所选歌曲（先经确认弹窗） */
  function openRemovalDialog() {
    if (pickedPaths.value.size === 0) {
      return;
    }

    const pickedTally = pickedPaths.value.size;
    openConfirm({
      title: '移除歌曲', confirmText: '移除',
      message: `确定要移除选中的 ${pickedTally} 首歌曲吗？`,
      action: applyLibraryRemoval,
    });
  }

  /** 请求删除所选本地歌曲的磁盘文件（先经强确认弹窗） */
  function openDiskRemovalDialog() {
    if (pickedPaths.value.size === 0) {
      return;
    }

    const pickedTally = pickedPaths.value.size;
    openConfirm({
      title: '删除本地歌曲', confirmText: '删除',
      message: `确定要删除选中的 ${pickedTally} 首本地歌曲吗？此操作会删除磁盘上的真实文件，且不可恢复。`,
      action: applyDiskRemoval,
    });
  }

  /** 依据是否处于管理模式分流删除方式 */
  function dispatchFolderRemoval() {
    if (manageModeOn.value) {
      openDiskRemovalDialog();
      return;
    }

    openRemovalDialog();
  }

  /** 执行确认弹窗暂存的动作，结束后收起弹窗 */
  async function runConfirmedAction() {
    await pendingAction.value();
    dismissConfirm();
  }

  /** 存在勾选时打开"移动到文件夹"弹窗 */
  function openMoveDialog() {
    if (pickedPaths.value.size > 0) {
      isMoveDialogShown.value = true;
    }
  }

  /** 按路径定位歌曲实体：外部解析器优先，其次源列表、曲库列表 */
  function locatePickedSong(path: string): Song | null {
    const viaResolver = findSongByPath?.(path);
    if (viaResolver) {
      return viaResolver;
    }

    return (
      rawSongList.value.find((song) => song.path === path)
      ?? masterSongList.value.find((song) => song.path === path)
      ?? null
    );
  }

  /** 批量下载所选在线歌曲：跳过缺失 / 本地项，按并发上限执行 */
  async function startBatchDownload() {
    const pickedList = [...pickedPaths.value];
    if (pickedList.length === 0) {
      return;
    }

    const pickedSongs = pickedList
      .map((path) => locatePickedSong(path))
      .filter((song): song is Song => song !== null);
    const unresolvedTally = pickedList.length - pickedSongs.length;
    const downloadableSongs = pickedSongs.filter(isDownloadableOnlineSong);
    const localSkippedTally = pickedSongs.length - downloadableSongs.length;

    if (unresolvedTally > 0) {
      notify(`${unresolvedTally} 首歌曲信息缺失，已跳过`, 'error');
    }
    if (localSkippedTally > 0) {
      notify(`已跳过 ${localSkippedTally} 首本地歌曲`, 'info');
    }
    if (downloadableSongs.length === 0) {
      notify('没有可下载的在线歌曲', 'info');
      return;
    }

    const plannedLanes = settings.value.download.batchDownloadLimit ?? 2;
    const laneTotal = Math.min(5, Math.max(1, Math.round(plannedLanes)));
    notify(`开始批量下载 ${downloadableSongs.length} 首歌曲（同时 ${laneTotal} 首）`, 'info');

    const fulfilledTally = await runBatchTaskPool(
      downloadableSongs.map((song) => () => downloadToLocal(song)),
      laneTotal,
    );
    const failedTally = downloadableSongs.length - fulfilledTally;

    notify(
      failedTally > 0
        ? `批量下载完成：成功 ${fulfilledTally} 首，失败 ${failedTally} 首`
        : `批量下载完成：成功 ${fulfilledTally} 首`,
      failedTally > 0 ? 'info' : 'success',
    );

    clearPickedState();
  }

  /** 确认移动：把勾选歌曲迁入目标文件夹 */
  async function applyBatchMove(targetFolder: string, folderName: string) {
    try {
      const movedTally = await relocateFiles([...pickedPaths.value], targetFolder);
      notify(`已成功移动 ${movedTally} 首歌曲到 "${folderName}"`, 'success');
      isMoveDialogShown.value = false;
      clearPickedState();
    } catch (error: any) {
      notify(`移动失败: ${error?.message || error}`, 'error');
    }
  }

  return {
    showMoveToFolderModal: isMoveDialogShown,
    showConfirm: isConfirmShown,
    confirmTitle: confirmHeading,
    confirmButtonText: confirmLabel,
    confirmMessage: confirmBodyText,
    requestBatchDelete: openRemovalDialog,
    handleFolderBatchDelete: dispatchFolderRemoval,
    executeConfirmAction: runConfirmedAction,
    handleBatchMove: openMoveDialog,
    handleBatchDownload: startBatchDownload,
    confirmBatchMove: applyBatchMove,
    openConfirm,
  };
}
