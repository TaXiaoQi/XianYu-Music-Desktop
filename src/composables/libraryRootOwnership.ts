import type { FolderNode } from '../types';
import { normalizePath } from '../utils/path';

/** 从目录树顶层节点收集根路径列表 */
export const toRootPaths = (nodes: FolderNode[]): string[] => nodes.map((node) => node.path);

/** candidate 归一化后与 root 相同，或位于 root 目录内部 */
export const pathWithinRootScope = (candidate: string, root: string): boolean => {
  const scopedRoot = normalizePath(root);
  const normalizedCandidate = normalizePath(candidate);
  return normalizedCandidate === scopedRoot || normalizedCandidate.startsWith(`${scopedRoot}/`);
};

/** candidate 归一化后以 root 归一化结果为前缀（不要求目录边界） */
export const pathUnderRootPrefix = (candidate: string, root: string): boolean =>
  normalizePath(candidate).startsWith(normalizePath(root));

/**
 * 在根路径列表中找出包含 targetPath 的最深根目录。
 * 多个根同时命中时取归一化路径最长者；长度并列时保持列表原始顺序。
 */
export const findDeepestOwningRoot = (rootPaths: string[], targetPath: string): string | null => {
  let deepestRoot: string | null = null;
  let deepestLength = -1;

  for (const rootPath of rootPaths) {
    if (!pathWithinRootScope(targetPath, rootPath)) {
      continue;
    }

    const rootLength = normalizePath(rootPath).length;
    if (rootLength > deepestLength) {
      deepestRoot = rootPath;
      deepestLength = rootLength;
    }
  }

  return deepestRoot;
};
