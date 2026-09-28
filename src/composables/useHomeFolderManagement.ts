import { ref, watch } from 'vue';
import type { Ref } from 'vue';

import type { FolderNode, Song } from '../types';
import { getParentFolderPath, normalizePath } from '../utils/path';
import {
  findDeepestOwningRoot,
  pathUnderRootPrefix,
  pathWithinRootScope,
  toRootPaths,
} from './libraryRootOwnership';
import {
  REFRESH_FAILURE_PREFIX,
  REFRESH_OK_TEXT,
  describeLibraryRefresh,
  resolveFailureDetail,
} from './libraryRefreshFeedback';

type ConfirmRequest = {
  title: string; confirmText: string;
  message: string;
  action: () => void | Promise<void>;
};

interface UseHomeFolderManagementOptions {
  isManagementMode: Ref<boolean>; activeRootPath: Ref<string | null>; currentFolderFilter: Ref<string>;
  libraryHierarchy: Ref<FolderNode[]>; sourceSongs: Ref<Song[]>;
  refreshFolder: (folderPath: string) => Promise<unknown>; fetchFolderTree: () => Promise<unknown>;
  createFolder: (parentPath: string, folderName: string) => Promise<string>;
  deleteFolder: (path: string) => Promise<unknown>; expandFolderPath: (path: string) => Promise<unknown>;
  addLibraryFolder: () => Promise<unknown>; removeLibraryFolderLinked: (path: string) => Promise<unknown>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  openConfirm: (options: ConfirmRequest) => void;
}

const CREATED_FOLDER_PREFIX = '已创建文件夹: ';
const CREATE_FOLDER_FAILURE_PREFIX = '新建文件夹失败: ';
const FOLDER_REMOVED_TOAST = '文件夹已删除';
const DELETE_FOLDER_FAILURE_PREFIX = '删除文件夹失败: ';
const REMOVE_FOLDER_TITLE = '移除文件夹';
const REMOVE_FOLDER_ACTION_TEXT = '移除';

/** 删除动作落地后的关注点：被删的是整个根目录，还是根下某个子目录 */
interface PostRemovalPlan {
  owningRoot: string | null;
  removedWholeRoot: boolean;
  landingPath: string | null;
}

export function useHomeFolderManagement({
  isManagementMode, activeRootPath, currentFolderFilter, libraryHierarchy, sourceSongs,
  refreshFolder, fetchFolderTree, createFolder, deleteFolder, expandFolderPath,
  addLibraryFolder, removeLibraryFolderLinked, showToast, openConfirm,
}: UseHomeFolderManagementOptions) {
  // 新建文件夹对话框三件套
  const creationDialog = {
    visible: ref(false),
    parentPath: ref(''),
    rootAnchor: ref<string | null>(null),
  };
  // 删除确认对话框
  const removalDialog = {
    visible: ref(false),
    targetPath: ref(''),
  };
  /** 程序性改写 activeRootPath 时，跳过一次 watch 的联动 */
  const suppressRootWatch = ref(false);

  const resolveOwningRoot = (candidatePath: string): string | null =>
    findDeepestOwningRoot(toRootPaths(libraryHierarchy.value), candidatePath) ||
    activeRootPath.value ||
    null;

  /** 让指定根目录成为当前激活根，并把目录过滤同步到根路径 */
  const syncRootSelection = (nextRoot: string | null) => {
    activeRootPath.value = nextRoot;
    currentFolderFilter.value = nextRoot || '';
  };

  const handleActiveRootChange = (nextRoot: string | null) => {
    syncRootSelection(nextRoot);
  };

  watch(activeRootPath, (nextRoot, previousRoot) => {
    if (suppressRootWatch.value) {
      suppressRootWatch.value = false;
      return;
    }

    if (!nextRoot || nextRoot === previousRoot) {
      return;
    }

    // 当前子目录仍归属新根时，不打断用户的浏览位置
    if (pathWithinRootScope(currentFolderFilter.value, nextRoot)) {
      return;
    }

    syncRootSelection(nextRoot);
  });

  const requestCreateFolder = (parentPath: string) => {
    if (!isManagementMode.value) {
      return;
    }

    creationDialog.parentPath.value = parentPath;
    creationDialog.rootAnchor.value = resolveOwningRoot(parentPath);
    creationDialog.visible.value = true;
  };

  const closeCreationDialog = () => {
    creationDialog.visible.value = false;
    creationDialog.parentPath.value = '';
    creationDialog.rootAnchor.value = null;
  };

  const confirmCreateFolder = async (folderName: string) => {
    const parentPath = creationDialog.parentPath.value;
    if (!parentPath) {
      return;
    }

    try {
      const createdPath = await createFolder(parentPath, folderName);
      await fetchFolderTree();

      if (creationDialog.rootAnchor.value) {
        suppressRootWatch.value = true;
        activeRootPath.value = creationDialog.rootAnchor.value;
      }

      await expandFolderPath(createdPath);
      currentFolderFilter.value = createdPath;
      showToast(`${CREATED_FOLDER_PREFIX}${folderName}`, 'success');
    } catch (error: unknown) {
      showToast(`${CREATE_FOLDER_FAILURE_PREFIX}${resolveFailureDetail(error)}`, 'error');
    } finally {
      closeCreationDialog();
    }
  };

  const requestDeleteFolder = (folderPath: string) => {
    if (!isManagementMode.value) {
      return;
    }

    removalDialog.targetPath.value = folderPath;
    removalDialog.visible.value = true;
  };

  /** 预先计算删除后的归属根与回退目录 */
  const planAfterRemoval = (removedPath: string): PostRemovalPlan => {
    const owningRoot = resolveOwningRoot(removedPath);
    const removedWholeRoot = !!owningRoot && normalizePath(owningRoot) === normalizePath(removedPath);

    if (removedWholeRoot) {
      return { owningRoot, removedWholeRoot, landingPath: null };
    }

    const parentPath = getParentFolderPath(removedPath);
    const landingPath = owningRoot
      ? pathUnderRootPrefix(parentPath, owningRoot) ? parentPath : owningRoot
      : parentPath;

    return { owningRoot, removedWholeRoot: false, landingPath: landingPath || '' };
  };

  /** 整根被删后：接管剩余的第一个根，根目录清空时同时清掉歌曲列表 */
  const adoptRemainingRootAfterRemoval = () => {
    const nextRoot = libraryHierarchy.value[0]?.path || null;
    if (nextRoot) {
      syncRootSelection(nextRoot);
    } else {
      syncRootSelection(null);
      sourceSongs.value = [];
    }
  };

  const executeDeleteFolder = async () => {
    const removedPath = removalDialog.targetPath.value;
    if (!removedPath) {
      return;
    }

    const plan = planAfterRemoval(removedPath);

    try {
      await deleteFolder(removedPath);
      await fetchFolderTree();

      if (plan.removedWholeRoot) {
        adoptRemainingRootAfterRemoval();
      } else if (plan.landingPath) {
        if (plan.owningRoot) {
          suppressRootWatch.value = true;
          activeRootPath.value = plan.owningRoot;
        }
        await expandFolderPath(plan.landingPath);
        currentFolderFilter.value = plan.landingPath;
      }

      showToast(FOLDER_REMOVED_TOAST, 'success');
    } catch (error: unknown) {
      showToast(`${DELETE_FOLDER_FAILURE_PREFIX}${resolveFailureDetail(error)}`, 'error');
    } finally {
      removalDialog.visible.value = false;
      removalDialog.targetPath.value = '';
    }
  };

  const handleAddFolder = () => addLibraryFolder();

  const handleRootCreateFolderRequest = (path: string) => requestCreateFolder(path);

  const handleRootDeleteFolderRequest = (path: string) => requestDeleteFolder(path);

  const handleRefreshFolder = async () => {
    const targetFolder = currentFolderFilter.value;
    if (!targetFolder) {
      return;
    }

    try {
      showToast(describeLibraryRefresh(await refreshFolder(targetFolder)) ?? REFRESH_OK_TEXT, 'success');
    } catch (error: unknown) {
      showToast(`${REFRESH_FAILURE_PREFIX}${resolveFailureDetail(error)}`, 'error');
    }
  };

  const removalNoticeFor = (folderName?: string) =>
    ['确定要移除', folderName ? `“${folderName}”` : '此文件夹'].join('') +
    '吗？这不会删除本地文件。';

  const handleRemoveFolderWithConfirm = (path: string, name?: string) => {
    openConfirm({
      title: REMOVE_FOLDER_TITLE,
      confirmText: REMOVE_FOLDER_ACTION_TEXT,
      message: removalNoticeFor(name),
      action: async () => {
        const wasActive = activeRootPath.value === path;
        await removeLibraryFolderLinked(path);

        if (wasActive) {
          adoptRemainingRootAfterRemoval();
        }
      },
    });
  };

  return {
    showCreateFolderModal: creationDialog.visible,
    showFolderDeleteConfirm: removalDialog.visible,
    folderToDeletePath: removalDialog.targetPath,
    syncRootSelection,
    handleActiveRootChange,
    requestCreateFolder,
    confirmCreateFolder,
    requestDeleteFolder,
    executeDeleteFolder,
    handleAddFolder,
    handleRootCreateFolderRequest,
    handleRootDeleteFolderRequest,
    handleRefreshFolder,
    handleRemoveFolderWithConfirm,
  };
}
