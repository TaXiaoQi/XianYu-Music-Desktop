
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

export function setSyncedPluginIds(ids: string[]) {
  writeSet(SYNCED_KEY, new Set(ids));
}

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
