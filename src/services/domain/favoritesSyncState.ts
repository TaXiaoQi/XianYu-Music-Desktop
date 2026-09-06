/**
 * 收藏同步状态（localStore 持久化），与移动端 sync_provider 的 prefs 键语义一致。
 *
 * - syncedPaths「上次已同步」集合：删除跟踪基准（上传时 diff 出本机删除）。
 * - cloudKeepPaths「仅删本地」墓碑：收藏已从本机移除但云端保留，
 *   上传时排除出 delete_paths diff、下载合并时跳过回灌。
 *   重新收藏该 path 时清除（clearFavoriteTombstones）。
 * - localOnlyPaths「仅保留本地」墓碑：收藏保留本机但已从云端删除，
 *   上传时排除出 payload 防复活。取消收藏后自然失效（上传时清理），
 *   重新收藏该 path 时也清除（clearFavoriteTombstones）。
 */

import { localStore } from '../storage/localStore';

const SYNCED_KEY = 'xianyu_synced_favorites_paths';
const CLOUD_KEEP_KEY = 'xianyu_favorites_cloud_keep_paths';
const LOCAL_ONLY_KEY = 'xianyu_favorites_local_only_paths';

function loadSet(key: string): Set<string> {
  return new Set(localStore.getJson<string[]>(key) ?? []);
}

function persistSet(key: string, paths: Set<string>) {
  localStore.setJson(key, Array.from(paths));
}

// ==================== 上次已同步集合 ====================

export function loadSyncedFavoritePaths(): string[] {
  return localStore.getJson<string[]>(SYNCED_KEY) ?? [];
}

export function persistSyncedFavoritePaths(paths: string[]) {
  localStore.setJson(SYNCED_KEY, paths);
}

// ==================== 仅删本地墓碑 ====================

export function getCloudKeepPaths(): Set<string> {
  return loadSet(CLOUD_KEEP_KEY);
}

export function addCloudKeepPaths(paths: string[]) {
  if (paths.length === 0) return;
  const s = loadSet(CLOUD_KEEP_KEY);
  const before = s.size;
  paths.forEach(p => s.add(p));
  if (s.size !== before) persistSet(CLOUD_KEEP_KEY, s);
}

export function removeCloudKeepPaths(paths: Iterable<string>) {
  const s = loadSet(CLOUD_KEEP_KEY);
  let changed = false;
  for (const p of paths) {
    if (s.delete(p)) changed = true;
  }
  if (changed) persistSet(CLOUD_KEEP_KEY, s);
}

// ==================== 仅保留本地墓碑 ====================

export function getLocalOnlyPaths(): Set<string> {
  return loadSet(LOCAL_ONLY_KEY);
}

export function addLocalOnlyPaths(paths: string[]) {
  if (paths.length === 0) return;
  const s = loadSet(LOCAL_ONLY_KEY);
  const before = s.size;
  paths.forEach(p => s.add(p));
  if (s.size !== before) persistSet(LOCAL_ONLY_KEY, s);
}

export function removeLocalOnlyPaths(paths: Iterable<string>) {
  const s = loadSet(LOCAL_ONLY_KEY);
  let changed = false;
  for (const p of paths) {
    if (s.delete(p)) changed = true;
  }
  if (changed) persistSet(LOCAL_ONLY_KEY, s);
}

/**
 * 重新收藏 path：清除该 path 的双向墓碑，恢复正常同步行为
 * （上传 payload 与 delete_paths diff 都重新覆盖它）。
 */
export function clearFavoriteTombstones(paths: string[]) {
  if (paths.length === 0) return;
  removeCloudKeepPaths(paths);
  removeLocalOnlyPaths(paths);
}
