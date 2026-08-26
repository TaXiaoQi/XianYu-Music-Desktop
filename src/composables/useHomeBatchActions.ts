import { ref, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { fileApi } from '../services/tauri/fileApi';
import { usePlaybackStore } from '../features/playback/store';
import type { Playlist, Song } from '../types';
import { removeSongPathsFromPlaybackState } from '../features/playback/playbackCleanup';
import { useSettings } from '../features/settings/useSettings';
import { downloadToLocal } from './useDownloadToLocal';
import { isDownloadableOnlineSong } from '../services/domain/downloadService';

interface ConfirmOptions {
  title: string;
  confirmText: string;
  message: string;
  action: () => void | Promise<void>;
}

interface UseHomeBatchActionsOptions {
  currentViewMode: Ref<string>;
  selectedPaths: Ref<Set<string>>;
  isBatchMode: Ref<boolean>;
  isManagementMode: Ref<boolean>;
  canonicalSongs: Ref<Song[]>;
  sourceSongs: Ref<Song[]>;
  favoritePaths: Ref<string[]>;
  playlists: Ref<Playlist[]>;
  moveFilesToFolder: (paths: string[], targetFolder: string) => Promise<number>;
  removeFromHistory: (songPaths: string[]) => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  getRoutePath: () => string;
  resolveSongByPath?: (path: string) => Song | null;
}

export function useHomeBatchActions({
  currentViewMode,
  selectedPaths,
  isBatchMode,
  isManagementMode,
  canonicalSongs,
  sourceSongs,
  favoritePaths,
  playlists,
  moveFilesToFolder,
  removeFromHistory,
  showToast,
  getRoutePath,
  resolveSongByPath,
}: UseHomeBatchActionsOptions) {
  const showMoveToFolderModal = ref(false);
  const showConfirm = ref(false);
  const confirmTitle = ref('移除歌曲');
  const confirmButtonText = ref('移除');
  const confirmMessage = ref('');
  const confirmAction = ref<() => void | Promise<void>>(() => {});
  const playbackStore = usePlaybackStore();
  const { playQueue, tempQueue, currentSong } = storeToRefs(playbackStore);
  const { settings } = useSettings();

  const resetSelection = () => {
    selectedPaths.value.clear();
    isBatchMode.value = false;
  };

  const openConfirm = ({ title, confirmText, message, action }: ConfirmOptions) => {
    confirmTitle.value = title;
    confirmButtonText.value = confirmText;
    confirmMessage.value = message;
    confirmAction.value = action;
    showConfirm.value = true;
  };

  const executeBatchDelete = () => {
    if (currentViewMode.value === 'all' && getRoutePath() === '/') {
      const selected = new Set(selectedPaths.value);
      canonicalSongs.value = canonicalSongs.value.filter((song) => !selected.has(song.path));
      sourceSongs.value = sourceSongs.value.filter((song) => !selected.has(song.path));
    } else if (getRoutePath() === '/favorites') {
      const selected = new Set(selectedPaths.value);
      favoritePaths.value = favoritePaths.value.filter((path) => !selected.has(path));
    }

    resetSelection();
    showConfirm.value = false;
  };

  const executeBatchPhysicalDelete = async () => {
    const paths = Array.from(selectedPaths.value);
    if (paths.length === 0) {
      return;
    }

    const deletedPaths = new Set<string>();

    for (const path of paths) {
      try {
        await fileApi.deleteMusicFile(path);
        deletedPaths.add(path);
      } catch (error) {
        console.error('Failed to delete song from disk:', path, error);
      }
    }

    if (deletedPaths.size > 0) {
      canonicalSongs.value = canonicalSongs.value.filter((song) => !deletedPaths.has(song.path));
      sourceSongs.value = sourceSongs.value.filter((song) => !deletedPaths.has(song.path));
      favoritePaths.value = favoritePaths.value.filter((path) => !deletedPaths.has(path));
      removeSongPathsFromPlaybackState({ playQueue, tempQueue, currentSong }, deletedPaths);
      await removeFromHistory(Array.from(deletedPaths));
      playlists.value.forEach((playlist) => {
        playlist.songPaths = playlist.songPaths.filter((path) => !deletedPaths.has(path));
      });

      showToast(`已删除 ${deletedPaths.size} 首本地歌曲`, 'success');
    }

    const failedCount = paths.length - deletedPaths.size;
    if (failedCount > 0) {
      showToast(`${failedCount} 首歌曲删除失败`, 'error');
    }

    resetSelection();
    showConfirm.value = false;
  };

  const requestBatchDelete = () => {
    if (selectedPaths.value.size === 0) return;

    openConfirm({
      title: '移除歌曲',
      confirmText: '移除',
      message: `确定要移除选中的 ${selectedPaths.value.size} 首歌曲吗？`,
      action: executeBatchDelete,
    });
  };

  const requestBatchPhysicalDelete = () => {
    if (selectedPaths.value.size === 0) return;

    openConfirm({
      title: '删除本地歌曲',
      confirmText: '删除',
      message: `确定要删除选中的 ${selectedPaths.value.size} 首本地歌曲吗？此操作会删除磁盘上的真实文件，且不可恢复。`,
      action: executeBatchPhysicalDelete,
    });
  };

  const handleFolderBatchDelete = () => {
    if (isManagementMode.value) {
      requestBatchPhysicalDelete();
      return;
    }

    requestBatchDelete();
  };

  const executeConfirmAction = async () => {
    await confirmAction.value();
    showConfirm.value = false;
  };

  const handleBatchMove = () => {
    if (selectedPaths.value.size > 0) {
      showMoveToFolderModal.value = true;
    }
  };

  const resolveSelectedSong = (path: string): Song | null => {
    return resolveSongByPath?.(path)
      ?? sourceSongs.value.find(song => song.path === path)
      ?? canonicalSongs.value.find(song => song.path === path)
      ?? null;
  };

  const runWithConcurrency = async (
    tasks: Array<() => Promise<boolean>>,
    limit: number,
  ): Promise<number> => {
    let nextIndex = 0;
    let successCount = 0;
    const workerCount = Math.min(limit, tasks.length);

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < tasks.length) {
        const task = tasks[nextIndex++];
        if (await task()) {
          successCount++;
        }
      }
    }));

    return successCount;
  };

  const handleBatchDownload = async () => {
    const paths = Array.from(selectedPaths.value);
    if (paths.length === 0) return;

    const selectedSongs = paths
      .map(resolveSelectedSong)
      .filter((song): song is Song => Boolean(song));
    const missingCount = paths.length - selectedSongs.length;
    const downloadableSongs = selectedSongs.filter(isDownloadableOnlineSong);
    const skippedLocalCount = selectedSongs.length - downloadableSongs.length;

    if (missingCount > 0) {
      showToast(`${missingCount} 首歌曲信息缺失，已跳过`, 'error');
    }
    if (skippedLocalCount > 0) {
      showToast(`已跳过 ${skippedLocalCount} 首本地歌曲`, 'info');
    }
    if (downloadableSongs.length === 0) {
      showToast('没有可下载的在线歌曲', 'info');
      return;
    }

    const concurrency = Math.min(5, Math.max(1, Math.round(settings.value.download.batchDownloadLimit ?? 2)));
    showToast(`开始批量下载 ${downloadableSongs.length} 首歌曲（同时 ${concurrency} 首）`, 'info');

    const tasks = downloadableSongs.map(song => async () => downloadToLocal(song));
    const successCount = await runWithConcurrency(tasks, concurrency);
    const failedCount = downloadableSongs.length - successCount;

    showToast(
      failedCount > 0
        ? `批量下载完成：成功 ${successCount} 首，失败 ${failedCount} 首`
        : `批量下载完成：成功 ${successCount} 首`,
      failedCount > 0 ? 'info' : 'success',
    );

    resetSelection();
  };

  const confirmBatchMove = async (targetFolder: string, folderName: string) => {
    try {
      const paths = Array.from(selectedPaths.value);
      const count = await moveFilesToFolder(paths, targetFolder);
      showToast(`已成功移动 ${count} 首歌曲到 "${folderName}"`, 'success');
      showMoveToFolderModal.value = false;
      resetSelection();
    } catch (error: any) {
      showToast(`移动失败: ${error?.message || error}`, 'error');
    }
  };

  return {
    showMoveToFolderModal,
    showConfirm,
    confirmTitle,
    confirmButtonText,
    confirmMessage,
    requestBatchDelete,
    handleFolderBatchDelete,
    executeConfirmAction,
    handleBatchMove,
    handleBatchDownload,
    confirmBatchMove,
    openConfirm,
  };
}
