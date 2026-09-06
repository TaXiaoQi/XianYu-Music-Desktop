/**
 * 插件同步状态（localStorage 持久化，独立于 pluginSync 避免循环依赖）
 *
 * - syncedIds「已同步」标记：云端确认存在副本的插件 id 集。
 *   上传成功后整集替换为本次上传成功的 id；下载恢复成功后并集追加。
 *   用于删除时判断是否弹「删除范围」三选一。
 * - downloadSkipIds「仅删本地」墓碑：插件已从本机删除但云端保留，
 *   下载恢复时跳过，防止删除后被同步回流。
 * - uploadSkipIds「仅保留本地」墓碑：插件保留本机但已从云端删除，
 *   上传时跳过，防止本地独占插件被重新推上云端。
 *   重新安装/更新同 id 插件时清除双向墓碑（clearPluginSyncTombstones）。
 */

const SYNCED_KEY = 'plugin_synced_ids';
const DOWNLOAD_SKIP_KEY = 'plugin_sync_download_skip_ids';
const UPLOAD_SKIP_KEY = 'plugin_sync_upload_skip_ids';

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function writeSet(key: string, ids: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch { /* 存储不可用时静默降级：仅影响本次会话外的持久化 */ }
}

// ==================== 已同步标记 ====================

export function getSyncedPluginIds(): Set<string> {
  return readSet(SYNCED_KEY);
}

export function isPluginSynced(id: string): boolean {
  return readSet(SYNCED_KEY).has(id);
}

/** 上传成功后整集替换（本次上传即云端权威副本） */
export function setSyncedPluginIds(ids: string[]) {
  writeSet(SYNCED_KEY, new Set(ids));
}

/** 下载恢复成功后并集追加 */
export function addSyncedPluginIds(ids: string[]) {
  if (ids.length === 0) return;
  const s = readSet(SYNCED_KEY);
  let changed = false;
  for (const id of ids) {
    if (!s.has(id)) {
      s.add(id);
      changed = true;
    }
  }
  if (changed) writeSet(SYNCED_KEY, s);
}

/** 云端删除成功后移除标记 */
export function removeSyncedPluginIds(ids: string[]) {
  if (ids.length === 0) return;
  const s = readSet(SYNCED_KEY);
  let changed = false;
  for (const id of ids) {
    if (s.delete(id)) changed = true;
  }
  if (changed) writeSet(SYNCED_KEY, s);
}

// ==================== 墓碑 ====================

export function getDownloadSkipIds(): Set<string> {
  return readSet(DOWNLOAD_SKIP_KEY);
}

export function addDownloadSkipIds(ids: string[]) {
  if (ids.length === 0) return;
  const s = readSet(DOWNLOAD_SKIP_KEY);
  let changed = false;
  for (const id of ids) {
    if (!s.has(id)) {
      s.add(id);
      changed = true;
    }
  }
  if (changed) writeSet(DOWNLOAD_SKIP_KEY, s);
}

export function removeDownloadSkipIds(ids: string[]) {
  if (ids.length === 0) return;
  const s = readSet(DOWNLOAD_SKIP_KEY);
  let changed = false;
  for (const id of ids) {
    if (s.delete(id)) changed = true;
  }
  if (changed) writeSet(DOWNLOAD_SKIP_KEY, s);
}

export function getUploadSkipIds(): Set<string> {
  return readSet(UPLOAD_SKIP_KEY);
}

export function addUploadSkipIds(ids: string[]) {
  if (ids.length === 0) return;
  const s = readSet(UPLOAD_SKIP_KEY);
  let changed = false;
  for (const id of ids) {
    if (!s.has(id)) {
      s.add(id);
      changed = true;
    }
  }
  if (changed) writeSet(UPLOAD_SKIP_KEY, s);
}

/** 重新安装/更新同 id 插件：清除双向墓碑，恢复正常同步行为 */
export function clearPluginSyncTombstones(ids: string[]) {
  if (ids.length === 0) return;
  removeDownloadSkipIds(ids);
  const s = readSet(UPLOAD_SKIP_KEY);
  let changed = false;
  for (const id of ids) {
    if (s.delete(id)) changed = true;
  }
  if (changed) writeSet(UPLOAD_SKIP_KEY, s);
}
