import { open } from '@tauri-apps/plugin-dialog';

import { getLibraryAddScanOptions, type ScanLibraryOptions } from './libraryScan';
import { useToast } from '../../composables/toast';
import type { Song } from '../../types';

// 外部路径进入媒体库的两种来源：拖拽放置，或系统"打开方式"。
type ExternalPathOrigin = 'drop' | 'open';

interface ExternalPathsRequest {
  source?: ExternalPathOrigin;
}

// processExternalPaths 处理完一批外部路径后回报的统计信息。
interface ExternalPathsOutcome {
  source: ExternalPathOrigin;
  importedFolderCount: number; skippedFolderCount: number;
  playableSongs: Song[]; ignoredFileCount: number;
}

// 仅带 showToast 开关的文件夹操作配置。
interface FolderNoticeConfig { showToast?: boolean; }

// 在开关基础上附带扫描配置。
interface FolderScanConfig extends FolderNoticeConfig { scanOptions?: ScanLibraryOptions; }

interface LibrarySyncDeps {
  fetchLibraryFolders: () => Promise<unknown>;
  scanLibrary: (settings?: ScanLibraryOptions) => Promise<unknown>;
  refreshFolder: (folderPath: string) => Promise<unknown>;
  refreshAllFolders: () => Promise<unknown>;
  addLibraryFolder?: () => Promise<unknown>;
  addLibraryFolderLinked?: (folderPath: string, config?: FolderScanConfig) => Promise<unknown>;
  removeLibraryFolder?: (folderPath: string) => Promise<unknown>;
  removeLibraryFolderLinked?: (folderPath: string, config?: FolderNoticeConfig) => Promise<unknown>;
  handleExternalPaths?: (paths: string[], request?: ExternalPathsRequest) => Promise<void>;
  addLibraryFolderPath?: (folderPath: string) => Promise<unknown>;
  removeLibraryFolderPath?: (folderPath: string) => Promise<unknown>;
  linkLibraryFolder?: (
    folderPath: string,
    scanSettings?: ScanLibraryOptions,
  ) => Promise<Required<ScanLibraryOptions>>;
  unlinkLibraryFolder?: (folderPath: string) => Promise<unknown>;
  processExternalPaths?: (
    paths: string[],
    request?: ExternalPathsRequest,
  ) => Promise<ExternalPathsOutcome>;
  addLibraryFolderRecord?: (
    folderPath: string,
    scanSettings?: ScanLibraryOptions,
  ) => Promise<unknown>;
  removeLibraryFolderRecord?: (folderPath: string) => Promise<unknown>;
}

const pickSongLabel = (song: Song) => song.title || song.name;

// 统一的失败日志出口，保持各分支的日志措辞一致。
const logFailure = (message: string, cause: unknown) => {
  console.error(message, cause);
};

export function useLibrarySync(deps: LibrarySyncDeps) {
  const toaster = useToast();

  // 主提示之后按固定顺序补发"忽略文件""重复文件夹"两条次级提示。
  const emitSecondaryNotices = (ignoredCount: number, skippedCount: number) => {
    if (ignoredCount > 0) {
      toaster.showToast(`已忽略 ${ignoredCount} 个不支持的文件`, 'info');
    }
    if (skippedCount > 0) {
      toaster.showToast(`${skippedCount} 个文件夹已在音乐库中，已跳过`, 'info');
    }
  };

  const runAddFolderLinked =
    deps.addLibraryFolderLinked ??
    (async (folderPath: string, config: FolderScanConfig = {}) => {
      if (!deps.linkLibraryFolder) {
        return;
      }

      const scanOptions = await deps.linkLibraryFolder(folderPath, config.scanOptions);

      if (config.showToast) {
        toaster.showToast(
          scanOptions.visibility === 'silent' ? '已将文件夹加入音乐库' : '已添加音乐库文件夹',
          'success',
        );
      }
    });

  const runHandleExternalPaths =
    deps.handleExternalPaths ??
    (async (paths: string[], request: ExternalPathsRequest = {}) => {
      if (!deps.processExternalPaths) {
        return;
      }

      const outcome = await deps.processExternalPaths(paths, request);
      const imported = outcome.importedFolderCount;
      const skipped = outcome.skippedFolderCount;
      const playable = outcome.playableSongs;
      const ignored = outcome.ignoredFileCount;
      const leadingSong = playable[0];

      if (imported > 0) {
        toaster.showToast(
          leadingSong
            ? `已导入 ${imported} 个文件夹，并开始播放 ${pickSongLabel(leadingSong)}`
            : `已导入 ${imported} 个文件夹`,
          'success',
        );
        emitSecondaryNotices(ignored, skipped);
        return;
      }

      if (playable.length > 1) {
        toaster.showToast(`已载入 ${playable.length} 首歌曲并开始播放`, 'success');
        emitSecondaryNotices(ignored, skipped);
        return;
      }

      if (playable.length === 1) {
        toaster.showToast(`正在播放 ${pickSongLabel(leadingSong)}`, 'success');
        if (skipped > 0) {
          toaster.showToast(`${skipped} 个文件夹已在音乐库中，已跳过`, 'info');
        }
        return;
      }

      if (skipped > 0) {
        toaster.showToast(`${skipped} 个文件夹已在音乐库中，未重复导入`, 'info');
        return;
      }

      // 按来源区分空结果的提示措辞。
      const emptyNotices: Record<ExternalPathOrigin, string> = {
        open: '没有找到可导入的音乐文件或文件夹',
        drop: '拖入的内容中没有可导入的音乐文件或文件夹',
      };
      toaster.showToast(emptyNotices[outcome.source], 'error');
    });

  const runRemoveFolderLinked =
    deps.removeLibraryFolderLinked ??
    (async (folderPath: string, config: FolderNoticeConfig = {}) => {
      if (!deps.unlinkLibraryFolder) {
        return;
      }

      await deps.unlinkLibraryFolder(folderPath);

      if (config.showToast !== false) {
        const removalNotice = '已从音乐库移除文件夹';
        toaster.showToast(removalNotice, 'success');
      }
    });

  const openFolderPicker =
    deps.addLibraryFolder ??
    (async () => {
      try {
        const picked = await open({ directory: true, multiple: false, title: '选择音乐文件夹' });
        if (!picked || typeof picked !== 'string') {
          return;
        }

        const scanOptions = getLibraryAddScanOptions(picked);
        await runAddFolderLinked(picked, {
          showToast: scanOptions.visibility === 'silent',
          scanOptions,
        });
      } catch (failure) {
        logFailure('Failed to add library folder:', failure);
        toaster.showToast(`添加音乐文件夹失败: ${failure}`, 'error');
      }
    });

  const addFolderPathRecord =
    deps.addLibraryFolderPath ??
    (async (folderPath: string) => {
      if (!deps.addLibraryFolderRecord) {
        return;
      }

      try {
        await deps.addLibraryFolderRecord(folderPath, getLibraryAddScanOptions(folderPath));
      } catch (failure) {
        logFailure('Failed to add library folder path:', failure);
      }
    });

  const removeFolderPathRecord =
    deps.removeLibraryFolderPath ??
    (async (folderPath: string) => {
      if (!deps.removeLibraryFolderRecord) {
        return;
      }

      try {
        await deps.removeLibraryFolderRecord(folderPath);
      } catch (failure) {
        logFailure('Failed to remove library folder path:', failure);
      }
    });

  const dropFolderFromLibrary =
    deps.removeLibraryFolder ??
    (async (folderPath: string) => {
      try {
        await runRemoveFolderLinked(folderPath);
      } catch (failure) {
        logFailure('Failed to remove library folder:', failure);
      }
    });

  return {
    fetchLibraryFolders: deps.fetchLibraryFolders,
    addLibraryFolder: openFolderPicker,
    addLibraryFolderLinked: runAddFolderLinked,
    removeLibraryFolder: dropFolderFromLibrary,
    removeLibraryFolderLinked: runRemoveFolderLinked,
    handleExternalPaths: runHandleExternalPaths,
    scanLibrary: deps.scanLibrary,
    addLibraryFolderPath: addFolderPathRecord,
    removeLibraryFolderPath: removeFolderPathRecord,
    refreshFolder: deps.refreshFolder,
    refreshAllFolders: deps.refreshAllFolders,
  };
}
