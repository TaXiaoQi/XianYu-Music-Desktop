/**
 * 歌单内单曲删除的同步墓碑状态（localStore 持久化），
 * 与移动端 playlist_song_sync_state.dart 语义一致。
 *
 * 三张墓碑表（均按歌单 cloudId 分组，歌曲以 path 为键）：
 * - cloudKeep「仅删本地」墓碑：歌曲已从本机歌单移除但云端保留，
 *   值为上传载荷 JSON 字符串（本地移除后无法再从曲库收集元数据），
 *   上传时回填进载荷让云端保留；重新添加回本机歌单时清除。
 * - localOnly「仅保留本地」墓碑：歌曲保留本机但已从云端删除，
 *   上传时从载荷剔除并随 deletedSongPaths 上报删除，防止其他端回灌复活；
 *   歌曲从本机歌单移除后自然失效（上传时清理）。
 * - pendingDeleted「待上报删除」墓碑（删除全部）：歌曲已从本机移除，
 *   待上传时随 deletedSongPaths 上报；下载响应确认服务端已记录（或重新添加）后清除。
 *
 * 整个歌单从云端删除时调用 clearPlaylistSongTombstones 清空三张表。
 */

import { localStore } from '../storage/localStore';

const CLOUD_KEEP_KEY = 'xianyumusic.playlistSongCloudKeep';
const LOCAL_ONLY_KEY = 'xianyumusic.playlistSongLocalOnly';
const PENDING_DELETED_KEY = 'xianyumusic.playlistSongPendingDeleted';

/** 「仅删本地」墓碑：cloudId → (path → 上传载荷 JSON 字符串) */
type CloudKeepMap = Record<string, Record<string, string>>;
/** path 集合类墓碑：cloudId → path 列表 */
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

/** 重新添加回本机的 path 清除墓碑（恢复正常同步行为） */
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

/** 歌曲不再保留在本机歌单时清除墓碑（取消「仅保留本地」自然失效） */
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

/** 精确移除指定 path：下载响应确认服务端已记录、或歌曲重新添加回本机时调用 */
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

/** 歌单从云端删除（删除全部/仅保留本地的整单删除）后清空该歌单全部歌曲墓碑 */
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
