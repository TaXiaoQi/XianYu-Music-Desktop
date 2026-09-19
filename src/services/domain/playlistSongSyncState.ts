
import { localStore } from '../storage/localStore';

const CLOUD_KEEP_KEY = 'xianyumusic.playlistSongCloudKeep';
const LOCAL_ONLY_KEY = 'xianyumusic.playlistSongLocalOnly';
const PENDING_DELETED_KEY = 'xianyumusic.playlistSongPendingDeleted';

type CloudKeepMap = Record<string, Record<string, string>>;
type PathListMap = Record<string, string[]>;

function loadJson<T>(key: string, fallback: T): T {
  const v = localStore.getJson<T>(key);
  return v && typeof v === 'object' ? v : fallback;
}

function persistJson(key: string, value: unknown) {
  localStore.setJson(key, value);
}

// ==================== 仅删本地墓碑（cloudKeep） ====================

export function getCloudKeepSongs(cloudId: string): Record<string, string> {
  if (!cloudId) return {};
  return loadJson<CloudKeepMap>(CLOUD_KEEP_KEY, {})[cloudId] ?? {};
}

export function addCloudKeepSongs(
  cloudId: string,
  entries: Array<{ path: string; payloadJson: string }>,
) {
  if (!cloudId || entries.length === 0) return;
  const map = loadJson<CloudKeepMap>(CLOUD_KEEP_KEY, {});
  const bucket = map[cloudId] ?? {};
  for (const e of entries) {
    if (e.path) bucket[e.path] = e.payloadJson;
  }
  map[cloudId] = bucket;
  persistJson(CLOUD_KEEP_KEY, map);
}

export function pruneCloudKeepSongs(cloudId: string, localPaths: Set<string>) {
  if (!cloudId) return;
  const map = loadJson<CloudKeepMap>(CLOUD_KEEP_KEY, {});
  const bucket = map[cloudId];
  if (!bucket) return;
  let changed = false;
  for (const p of Object.keys(bucket)) {
    if (localPaths.has(p)) {
      delete bucket[p];
      changed = true;
    }
  }
  if (changed) {
    if (Object.keys(bucket).length === 0) delete map[cloudId];
    persistJson(CLOUD_KEEP_KEY, map);
  }
}

// ==================== 仅保留本地墓碑（localOnly） ====================

export function getLocalOnlySongs(cloudId: string): Set<string> {
  if (!cloudId) return new Set();
  return new Set(loadJson<PathListMap>(LOCAL_ONLY_KEY, {})[cloudId] ?? []);
}

export function addLocalOnlySongs(cloudId: string, paths: Iterable<string>) {
  if (!cloudId) return;
  const map = loadJson<PathListMap>(LOCAL_ONLY_KEY, {});
  const set = new Set(map[cloudId] ?? []);
  const before = set.size;
  for (const p of paths) if (p) set.add(p);
  if (set.size === before) return;
  map[cloudId] = Array.from(set);
  persistJson(LOCAL_ONLY_KEY, map);
}

export function pruneLocalOnlySongs(cloudId: string, localPaths: Set<string>) {
  if (!cloudId) return;
  const map = loadJson<PathListMap>(LOCAL_ONLY_KEY, {});
  const list = map[cloudId];
  if (!list?.length) return;
  const next = list.filter(p => localPaths.has(p));
  if (next.length !== list.length) {
    if (next.length === 0) delete map[cloudId];
    else map[cloudId] = next;
    persistJson(LOCAL_ONLY_KEY, map);
  }
}

// ==================== 待上报删除墓碑（pendingDeleted） ====================

export function getPendingDeletedSongs(cloudId: string): Set<string> {
  if (!cloudId) return new Set();
  return new Set(loadJson<PathListMap>(PENDING_DELETED_KEY, {})[cloudId] ?? []);
}

export function addPendingDeletedSongs(cloudId: string, paths: Iterable<string>) {
  if (!cloudId) return;
  const map = loadJson<PathListMap>(PENDING_DELETED_KEY, {});
  const set = new Set(map[cloudId] ?? []);
  const before = set.size;
  for (const p of paths) if (p) set.add(p);
  if (set.size === before) return;
  map[cloudId] = Array.from(set);
  persistJson(PENDING_DELETED_KEY, map);
}

export function prunePendingDeletedSongs(cloudId: string, paths: Iterable<string>) {
  if (!cloudId) return;
  const map = loadJson<PathListMap>(PENDING_DELETED_KEY, {});
  const list = map[cloudId];
  if (!list?.length) return;
  const remove = new Set(paths);
  const next = list.filter(p => !remove.has(p));
  if (next.length !== list.length) {
    if (next.length === 0) delete map[cloudId];
    else map[cloudId] = next;
    persistJson(PENDING_DELETED_KEY, map);
  }
}

// ==================== 整单清理 ====================

export function clearPlaylistSongTombstones(cloudId: string) {
  if (!cloudId) return;
  persistJson(CLOUD_KEEP_KEY, (() => {
    const map = loadJson<CloudKeepMap>(CLOUD_KEEP_KEY, {});
    delete map[cloudId];
    return map;
  })());
  persistJson(LOCAL_ONLY_KEY, (() => {
    const map = loadJson<PathListMap>(LOCAL_ONLY_KEY, {});
    delete map[cloudId];
    return map;
  })());
  persistJson(PENDING_DELETED_KEY, (() => {
    const map = loadJson<PathListMap>(PENDING_DELETED_KEY, {});
    delete map[cloudId];
    return map;
  })());
}
