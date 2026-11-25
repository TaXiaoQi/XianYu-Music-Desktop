import type { FolderNode } from '../types';
import { tauriInvoke } from '../services/tauri/invoke';

/** 从目录树顶层节点收集根路径列表 */
export const toRootPaths = (nodes: FolderNode[]): string[] => nodes.map((node) => node.path);

/** candidate 归一化后与 root 相同，或位于 root 目录内部（后端归一化匹配） */
export const pathWithinRootScope = (candidate: string, root: string): Promise<boolean> =>
  tauriInvoke('path_within_root_scope', { candidate, root });

/** candidate 归一化后以 root 归一化结果为前缀，不要求目录边界（后端归一化匹配） */
export const pathUnderRootPrefix = (candidate: string, root: string): Promise<boolean> =>
  tauriInvoke('path_under_root_prefix', { candidate, root });

/**
 * 在根路径列表中找出包含 targetPath 的最深根目录。
 * 多个根同时命中时取归一化路径最长者；长度并列时保持列表原始顺序。
 * 匹配逻辑由后端统一实现，前端仅转发查询。
 */
export const findDeepestOwningRoot = (
  rootPaths: string[],
  targetPath: string,
): Promise<string | null> =>
  tauriInvoke('find_deepest_owning_root', { rootPaths, targetPath });
