import { open } from '@tauri-apps/plugin-dialog';
import { storeToRefs } from 'pinia';

import { useLibraryStore } from '../features/library/store';
import { libraryApi } from '../services/tauri/libraryApi';
import type { FolderNode } from '../types';

interface CreatePlayerFolderTreeDeps {
  addLibraryFolderPath: (path: string) => Promise<void>;
  removeLibraryFolderPath: (path: string) => Promise<void>;
  showToast: (message: string, type: 'success' | 'info' | 'error') => void;
}

const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

const isSameOrAncestorPath = (ancestorPath: string, targetPath: string) => {
  const normalizedAncestor = normalizePath(ancestorPath);
  const normalizedTarget = normalizePath(targetPath);
  return (
    normalizedTarget === normalizedAncestor ||
    normalizedTarget.startsWith(`${normalizedAncestor}/`)
  );
};

const collectExpandedPaths = (nodes: FolderNode[], expanded = new Set<string>()) => {
  for (const node of nodes) {
    if (node.is_expanded) {
      expanded.add(node.path);
    }

    if (node.children.length > 0) {
      collectExpandedPaths(node.children, expanded);
    }
  }

  return expanded;
};

const findNode = (nodes: FolderNode[], targetPath: string): FolderNode | null => {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node;
    }

    if (node.children.length > 0) {
      const childNode = findNode(node.children, targetPath);
      if (childNode) {
        return childNode;
      }
    }
  }

  return null;
};

const findOwningRoot = (nodes: FolderNode[], targetPath: string) =>
  nodes.find(node => isSameOrAncestorPath(node.path, targetPath)) ?? null;

const sortPathsByDepth = (paths: Iterable<string>) =>
  [...paths].sort((left, right) => normalizePath(left).length - normalizePath(right).length);

const createNodeMap = (nodes: FolderNode[], map = new Map<string, FolderNode>()) => {
  for (const node of nodes) {
    map.set(node.path, node);
    if (node.children.length > 0) {
      createNodeMap(node.children, map);
    }
  }

  return map;
};

export const createPlayerFolderTree = ({
  addLibraryFolderPath,
  removeLibraryFolderPath,
  showToast,
}: CreatePlayerFolderTreeDeps) => {
  const libraryStore = useLibraryStore();
  const { folderTree } = storeToRefs(libraryStore);

  const ensureFolderChildrenLoaded = async (targetPath: string) => {
    const targetNode = findNode(folderTree.value, targetPath);
    if (!targetNode) {
      return null;
    }

    if (targetNode.children_loaded || targetNode.child_count === 0) {
      return targetNode;
    }

    if (targetNode.is_loading) {
      return targetNode;
    }

    targetNode.is_loading = true;
    try {
      const previousChildren = createNodeMap(targetNode.children);
      const children = await libraryApi.getFolderChildren(targetPath);
      targetNode.children = children.map(child => {
        const previousChild = previousChildren.get(child.path);
        return previousChild ? { ...child, is_expanded: previousChild.is_expanded } : child;
      });
      targetNode.children_loaded = true;
    } finally {
      targetNode.is_loading = false;
    }

    return targetNode;
  };

  const expandFolderPath = async (targetPath: string) => {
    const rootNode = findOwningRoot(folderTree.value, targetPath);
    if (!rootNode) {
      return false;
    }

    if (rootNode.path === targetPath) {
      return true;
    }

    let currentNode = rootNode;

    while (currentNode.path !== targetPath) {
      if (!currentNode.children_loaded && currentNode.child_count > 0) {
        const loadedNode = await ensureFolderChildrenLoaded(currentNode.path);
        if (!loadedNode) {
          return false;
        }
        currentNode = loadedNode;
      }

      const nextNode = currentNode.children.find(child => isSameOrAncestorPath(child.path, targetPath));
      if (!nextNode) {
        return false;
      }

      currentNode.is_expanded = true;
      currentNode = nextNode;
    }

    currentNode.is_expanded = true;
    return true;
  };

  const toggleFolderNode = async (targetPath: string) => {
    const targetNode = findNode(folderTree.value, targetPath);
    if (!targetNode) {
      return;
    }

    if (targetNode.is_expanded) {
      targetNode.is_expanded = false;
      return;
    }

    if (targetNode.child_count > 0) {
      await ensureFolderChildrenLoaded(targetPath);
    }

    targetNode.is_expanded = true;
  };

  const fetchFolderTree = async () => {
    try {
      const expandedPaths = collectExpandedPaths(folderTree.value);
      folderTree.value = await libraryApi.getLibraryHierarchy();

      for (const path of sortPathsByDepth(expandedPaths)) {
        await expandFolderPath(path);
      }
    } catch (error) {
      console.error('Failed to fetch library folder tree:', error);
    }
  };

  const createFolder = async (parentPath: string, folderName: string) =>
    libraryApi.createFolder(parentPath, folderName);

  const addFolderTreeFolderLinked = async (
    path: string,
    options: { showToast?: boolean } = {},
  ) => {
    const { showToast: shouldShowToast = true } = options;
    await addLibraryFolderPath(path);

    if (shouldShowToast) {
      showToast('已将文件夹添加到音乐库', 'success');
    }
  };

  const removeFolderTreeFolderLinked = async (
    path: string,
    options: { showToast?: boolean } = {},
  ) => {
    const { showToast: shouldShowToast = true } = options;
    await removeLibraryFolderPath(path);

    if (shouldShowToast) {
      showToast('已从音乐库移除文件夹', 'success');
    }
  };

  const addFolderTreeFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择要添加到音乐库的文件夹',
      });

      if (!selected || typeof selected !== 'string') {
        return;
      }

      await addLibraryFolderPath(selected);
      showToast('已将文件夹添加到音乐库', 'success');
    } catch (error) {
      console.error('Failed to add library folder from folder tree:', error);
      showToast(`添加失败: ${error}`, 'error');
    }
  };

  const removeFolderTreeFolder = async (path: string) => {
    try {
      await removeLibraryFolderPath(path);
      showToast('已从音乐库移除文件夹', 'success');
    } catch (error) {
      console.error('Failed to remove library folder from folder tree:', error);
    }
  };

  return {
    fetchFolderTree,
    createFolder,
    addFolderTreeFolder,
    removeFolderTreeFolder,
    addFolderTreeFolderLinked,
    removeFolderTreeFolderLinked,
    ensureFolderChildrenLoaded,
    toggleFolderNode,
    expandFolderPath,
  };
};
