import { convertFileSrc } from '@tauri-apps/api/core';
import { reactive } from 'vue';

import { fileApi } from '../services/tauri/fileApi';
import { MemoryCache } from '../utils/MemoryCache';

type CoverKind = 'thumbnail' | 'full';
type PreloadPriority = 'priority' | 'background';

// —— 各类缓存的容量与时效参数（取值即行为规格） ——
const KIND_LIMITS: Record<CoverKind, number> = {
  thumbnail: 64,
  full: 4,
};
const KIND_TTL_MS: Record<CoverKind, number> = {
  thumbnail: 5 * 60 * 1000,
  full: 2 * 60 * 1000,
};
const HIDDEN_THUMBNAIL_LIMIT = 12;
const PRIORITY_PRELOAD_SLOTS = 4;
const BACKGROUND_PRELOAD_SLOTS = 1;
const BACKGROUND_FULL_PRELOAD_SLOTS = 1;
const FAILURE_COOLDOWN_MS = 10_000;

// 缩略图 URL 的内存 LRU（图片文件本身在磁盘上），键为歌曲路径。
const thumbUrlCache = reactive(new Map<string, string>());
const fullUrlCache = reactive(new Map<string, string>());
const thumbSourcePathCache = new Map<string, string>();
const fullSourcePathCache = new Map<string, string>();
const thumbExpiryMap = new Map<string, number>();
const fullExpiryMap = new Map<string, number>();
const activeLoadKeys = reactive(new Set<string>());
const pendingRequests = new Map<string, Promise<string>>();
const failureCooldowns = new MemoryCache<string, true>({
  maxEntries: 256,
  ttlMs: FAILURE_COOLDOWN_MS,
});
const priorityQueue: string[] = [];
const backgroundQueue: string[] = [];
const queuedPriorities = new Map<string, PreloadPriority>();
const fullPreloadQueue: string[] = [];
const queuedFullPreloads = new Set<string>();
let runningFullPreloads = 0;
let backgroundFlushTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundIdleHandle: number | null = null;
let pruneTimer: number | null = null;
let visibilityHookInstalled = false;
// 缓存纪元：失效/清空时递增，用于丢弃旧纪元发出的在途请求结果。
const epochCounters: Record<CoverKind, number> = {
  thumbnail: 0,
  full: 0,
};
const staleRequestKeys = new Set<string>();

const isDocumentHidden = () =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

// —— 按 CoverKind 取对应存储的访问器 ——

const urlCacheOf = (kind: CoverKind) => (kind === 'full' ? fullUrlCache : thumbUrlCache);
const sourcePathCacheOf = (kind: CoverKind) =>
  kind === 'full' ? fullSourcePathCache : thumbSourcePathCache;
const expiryMapOf = (kind: CoverKind) => (kind === 'full' ? fullExpiryMap : thumbExpiryMap);
const limitOf = (kind: CoverKind) => KIND_LIMITS[kind];
const ttlOf = (kind: CoverKind) => KIND_TTL_MS[kind];

const requestKeyOf = (path: string, kind: CoverKind) => `${kind}:${path}`;
const isThumbKey = (requestKey: string) => requestKey.startsWith('thumbnail:');

// —— 单条缓存记录的增删与淘汰 ——

function removeEntry(kind: CoverKind, path: string) {
  urlCacheOf(kind).delete(path);
  expiryMapOf(kind).delete(path);
  sourcePathCacheOf(kind).delete(path);
}

function wipeEntries(kind: CoverKind) {
  urlCacheOf(kind).clear();
  expiryMapOf(kind).clear();
  sourcePathCacheOf(kind).clear();
}

function keepOnlyPaths(kind: CoverKind, survivors: Set<string>) {
  for (const path of Array.from(urlCacheOf(kind).keys())) {
    if (survivors.has(path)) continue;
    removeEntry(kind, path);
  }
}

// 重新插入以刷新 LRU 顺序，并续写过期时间。
function writeEntry(kind: CoverKind, path: string, url: string, rawPath: string) {
  const cache = urlCacheOf(kind);
  if (cache.has(path)) {
    cache.delete(path);
  }
  expiryMapOf(kind).delete(path);
  cache.set(path, url);
  sourcePathCacheOf(kind).set(path, rawPath);
  expiryMapOf(kind).set(path, Date.now() + ttlOf(kind));
}

function evictStale(kind: CoverKind, now: number) {
  for (const [path, expiresAt] of expiryMapOf(kind)) {
    if (expiresAt > now && urlCacheOf(kind).has(path)) continue;
    removeEntry(kind, path);
  }
}

// 先剔除过期项，再按容量上限淘汰最旧的条目，最后重新调度定时清理。
function evictCache(kind: CoverKind, limit: number) {
  evictStale(kind, Date.now());

  const cache = urlCacheOf(kind);
  while (cache.size > limit) {
    const eldest = cache.keys().next().value as string | undefined;
    if (!eldest) break;
    removeEntry(kind, eldest);
  }

  queueTimedPrune();
}

// 计算最近的过期时间点，安排一次到期的批量清理。
function queueTimedPrune() {
  if (pruneTimer) {
    window.clearTimeout(pruneTimer);
    pruneTimer = null;
  }

  if (typeof window === 'undefined') return;

  let soonest: number | null = null;
  const scan = (expiry: Map<string, number>) => {
    for (const expiresAt of expiry.values()) {
      soonest = soonest === null ? expiresAt : Math.min(soonest, expiresAt);
    }
  };
  scan(thumbExpiryMap);
  scan(fullExpiryMap);

  if (soonest === null) return;

  const delay = Math.max(0, soonest - Date.now());
  pruneTimer = window.setTimeout(() => {
    pruneTimer = null;
    evictCache('thumbnail', KIND_LIMITS.thumbnail);
    evictCache('full', KIND_LIMITS.full);
  }, delay);
}

// —— 命中读取（命中即续期） ——

function readCachedUrl(path: string, kind: CoverKind): string | undefined {
  evictCache(kind, limitOf(kind));

  const url = urlCacheOf(kind).get(path);
  if (url === undefined) return undefined;

  const rawPath = sourcePathCacheOf(kind).get(path);
  if (!rawPath) {
    removeEntry(kind, path);
    return undefined;
  }

  writeEntry(kind, path, url, rawPath);
  return url;
}

function readCachedSourcePath(path: string, kind: CoverKind): string | undefined {
  evictCache(kind, limitOf(kind));

  if (!urlCacheOf(kind).has(path)) {
    sourcePathCacheOf(kind).delete(path);
    return undefined;
  }

  return sourcePathCacheOf(kind).get(path);
}

function storeCachedUrl(path: string, kind: CoverKind, url: string, rawPath: string) {
  writeEntry(kind, path, url, rawPath);
  evictCache(kind, limitOf(kind));
}

function inFailureCooldown(path: string, kind: CoverKind) {
  return failureCooldowns.has(requestKeyOf(path, kind));
}

function advanceEpoch(kind?: CoverKind) {
  if (kind) {
    epochCounters[kind] += 1;
    return;
  }
  epochCounters.thumbnail += 1;
  epochCounters.full += 1;
}

function epochOf(kind: CoverKind) {
  return epochCounters[kind];
}

// 文档转入后台时收缩临时状态：保留少量缩略图，清空全尺寸与预加载队列。
function shrinkToHiddenState() {
  advanceEpoch('thumbnail');
  advanceEpoch('full');
  evictCache('thumbnail', HIDDEN_THUMBNAIL_LIMIT);
  wipeEntries('full');
  priorityQueue.length = 0;
  backgroundQueue.length = 0;
  fullPreloadQueue.length = 0;
  queuedPriorities.clear();
  queuedFullPreloads.clear();
  cancelDeferredPreloads();
  failureCooldowns.prune();

  // 全尺寸在途请求不再可信：标记失效并停止 loading 展示。
  for (const requestKey of Array.from(pendingRequests.keys())) {
    if (!isThumbKey(requestKey)) {
      staleRequestKeys.add(requestKey);
      activeLoadKeys.delete(requestKey);
    }
  }
}

function onDocumentVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    shrinkToHiddenState();
  }
}

function uninstallVisibilityHook() {
  if (!visibilityHookInstalled || typeof document === 'undefined') return;

  document.removeEventListener('visibilitychange', onDocumentVisibilityChange);
  visibilityHookInstalled = false;
}

function installVisibilityHook() {
  if (visibilityHookInstalled || typeof document === 'undefined') return;

  document.addEventListener('visibilitychange', onDocumentVisibilityChange);
  visibilityHookInstalled = true;
}

if (import.meta.hot) {
  import.meta.hot.dispose(uninstallVisibilityHook);
}

// —— 向后端请求封面并写入缓存 ——

function requestCover(path: string, kind: CoverKind): Promise<string> {
  const requestKey = requestKeyOf(path, kind);
  if (inFailureCooldown(path, kind)) {
    return Promise.resolve('');
  }

  const pending = pendingRequests.get(requestKey);
  if (pending) return pending;

  const epochAtStart = epochOf(kind);

  const promise = (async () => {
    activeLoadKeys.add(requestKey);
    try {
      const sourcePath = kind === 'full'
        ? await fileApi.getSongCover(path)
        : await fileApi.getSongCoverThumbnail(path);
      if (epochOf(kind) !== epochAtStart || staleRequestKeys.has(requestKey)) {
        return '';
      }
      const assetUrl = sourcePath ? convertFileSrc(sourcePath) : '';
      failureCooldowns.delete(requestKey);
      if (assetUrl && sourcePath) {
        storeCachedUrl(path, kind, assetUrl, sourcePath);
      }
      return assetUrl;
    } catch {
      if (epochOf(kind) !== epochAtStart || staleRequestKeys.has(requestKey)) {
        return '';
      }
      failureCooldowns.set(requestKey, true);
      return '';
    } finally {
      activeLoadKeys.delete(requestKey);
      pendingRequests.delete(requestKey);
      staleRequestKeys.delete(requestKey);
    }
  })();

  pendingRequests.set(requestKey, promise);
  return promise;
}

function activeThumbLoadCount() {
  let count = 0;
  for (const requestKey of activeLoadKeys) {
    if (isThumbKey(requestKey)) count += 1;
  }
  return count;
}

function cancelDeferredPreloads() {
  if (backgroundFlushTimer) {
    clearTimeout(backgroundFlushTimer);
    backgroundFlushTimer = null;
  }

  if (backgroundIdleHandle !== null && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(backgroundIdleHandle);
    backgroundIdleHandle = null;
  }
}

// —— 缩略图预加载调度：优先队列占满并发槽位，后台队列低频跟进 ——

function takeNextQueuedPath(priority: PreloadPriority) {
  const queue = priority === 'priority' ? priorityQueue : backgroundQueue;

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!candidate) continue;

    // 路径可能已被更高优先级重新排队，过期条目直接跳过。
    if (queuedPriorities.get(candidate) !== priority) continue;

    queuedPriorities.delete(candidate);
    return candidate;
  }

  return undefined;
}

function kickOffThumbnailLoad(path: string) {
  if (thumbUrlCache.has(path) || activeLoadKeys.has(requestKeyOf(path, 'thumbnail'))) {
    return;
  }

  void requestCover(path, 'thumbnail').finally(() => {
    drainPriorityPreloads();
    queueBackgroundPreload();
  });
}

function drainPriorityPreloads() {
  cancelDeferredPreloads();

  while (activeThumbLoadCount() < PRIORITY_PRELOAD_SLOTS) {
    const next = takeNextQueuedPath('priority');
    if (!next) break;

    kickOffThumbnailLoad(next);
  }
}

function flushBackgroundPreloads() {
  backgroundFlushTimer = null;
  backgroundIdleHandle = null;

  if (priorityQueue.length > 0) {
    drainPriorityPreloads();
    return;
  }

  while (activeThumbLoadCount() < BACKGROUND_PRELOAD_SLOTS) {
    const next = takeNextQueuedPath('background');
    if (!next) break;

    kickOffThumbnailLoad(next);
  }

  if (backgroundQueue.length > 0) {
    queueBackgroundPreload();
  }
}

function queueBackgroundPreload() {
  const blocked = backgroundFlushTimer !== null
    || backgroundIdleHandle !== null
    || priorityQueue.length > 0
    || backgroundQueue.length === 0
    || activeThumbLoadCount() >= BACKGROUND_PRELOAD_SLOTS;
  if (blocked) return;

  if ('requestIdleCallback' in window) {
    backgroundIdleHandle = window.requestIdleCallback(flushBackgroundPreloads, { timeout: 300 });
    return;
  }

  backgroundFlushTimer = setTimeout(flushBackgroundPreloads, 160);
}

function enqueueThumbnailPreload(path: string, priority: PreloadPriority) {
  if (!path || thumbUrlCache.has(path) || activeLoadKeys.has(requestKeyOf(path, 'thumbnail'))) {
    return;
  }

  const currentPriority = queuedPriorities.get(path);
  if (currentPriority === 'priority') return;

  if (priority === 'priority') {
    queuedPriorities.set(path, 'priority');
    priorityQueue.push(path);
    return;
  }

  if (!currentPriority) {
    queuedPriorities.set(path, 'background');
    backgroundQueue.push(path);
  }
}

// —— 全尺寸封面的后台串行预加载 ——

function drainFullCoverPreloads() {
  if (isDocumentHidden()) {
    fullPreloadQueue.length = 0;
    queuedFullPreloads.clear();
    return;
  }

  while (
    runningFullPreloads < BACKGROUND_FULL_PRELOAD_SLOTS
    && fullPreloadQueue.length > 0
  ) {
    const path = fullPreloadQueue.shift();
    if (!path) continue;

    queuedFullPreloads.delete(path);

    if (
      fullUrlCache.has(path)
      || activeLoadKeys.has(requestKeyOf(path, 'full'))
      || inFailureCooldown(path, 'full')
    ) {
      continue;
    }

    runningFullPreloads += 1;
    void requestCover(path, 'full').finally(() => {
      runningFullPreloads = Math.max(0, runningFullPreloads - 1);
      drainFullCoverPreloads();
    });
  }
}

function enqueueFullCoverPreload(path: string) {
  if (
    !path
    || isDocumentHidden()
    || fullUrlCache.has(path)
    || activeLoadKeys.has(requestKeyOf(path, 'full'))
    || queuedFullPreloads.has(path)
    || inFailureCooldown(path, 'full')
  ) {
    return;
  }

  queuedFullPreloads.add(path);
  fullPreloadQueue.push(path);
}

export function useCoverCache() {
  installVisibilityHook();

  const pruneFor = (kind: CoverKind) => {
    evictCache(kind, limitOf(kind));
  };

  const peekCachedUrl = (path: string | undefined, kind: CoverKind = 'thumbnail') => {
    if (!path) return '';

    pruneFor(kind);
    return urlCacheOf(kind).get(path) ?? '';
  };

  const peekCachedPath = (path: string | undefined, kind: CoverKind = 'thumbnail') => {
    if (!path) return '';

    pruneFor(kind);
    return sourcePathCacheOf(kind).get(path) ?? '';
  };

  const touchCachedPaths = (paths: string[], kind: CoverKind = 'thumbnail') => {
    for (const path of paths) {
      if (!path) continue;

      const url = urlCacheOf(kind).get(path);
      if (url === undefined) continue;

      const rawPath = sourcePathCacheOf(kind).get(path);
      if (!rawPath) {
        removeEntry(kind, path);
        continue;
      }

      writeEntry(kind, path, url, rawPath);
    }

    pruneFor(kind);
  };

  const checkCoverLoading = (path: string | undefined, kind: CoverKind = 'thumbnail') => {
    if (!path) return false;

    return activeLoadKeys.has(requestKeyOf(path, kind));
  };

  const loadThumbnailCover = async (path: string | undefined): Promise<string | undefined> => {
    if (!path) return undefined;

    const cached = readCachedUrl(path, 'thumbnail');
    if (cached !== undefined) return cached;

    return requestCover(path, 'thumbnail');
  };

  const loadLargeCover = async (path: string | undefined): Promise<string | undefined> => {
    if (!path) return undefined;

    const cached = readCachedUrl(path, 'full');
    if (cached !== undefined) return cached;

    return requestCover(path, 'full');
  };

  const loadThumbnailCoverPath = async (path: string | undefined): Promise<string | undefined> => {
    if (!path) return undefined;

    const cached = readCachedSourcePath(path, 'thumbnail');
    if (cached !== undefined) return cached;

    await requestCover(path, 'thumbnail');
    return readCachedSourcePath(path, 'thumbnail');
  };

  // 预置封面路径（如来自扫描结果）：网络地址直接使用，本地路径转 asset 协议。
  const primeCachedPath = (path: string | undefined, rawPath: string | undefined | null) => {
    if (!path || !rawPath) return '';

    const cached = readCachedUrl(path, 'thumbnail');
    if (cached !== undefined) return cached;

    const isRemoteUrl = /^https?:\/\//i.test(rawPath);
    const assetUrl = isRemoteUrl ? rawPath : convertFileSrc(rawPath);
    storeCachedUrl(path, 'thumbnail', assetUrl, rawPath);
    return assetUrl;
  };

  const queuePreloads = (paths: string[], priority: PreloadPriority = 'background') => {
    for (const path of paths) {
      enqueueThumbnailPreload(path, priority);
    }

    if (priority === 'priority') {
      drainPriorityPreloads();
      return;
    }

    queueBackgroundPreload();
  };

  const queueFullPreloads = (paths: string[]) => {
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
    for (const path of uniquePaths) {
      enqueueFullCoverPreload(path);
    }
    drainFullCoverPreloads();
  };

  // 仅保留指定路径的全尺寸封面，其余缓存与在途/排队请求一并失效。
  const retainLargeCoverPaths = (fullPaths: string[]) => {
    const survivors = new Set(fullPaths.filter(Boolean));
    keepOnlyPaths('full', survivors);

    for (const requestKey of Array.from(pendingRequests.keys())) {
      if (isThumbKey(requestKey)) continue;

      const requestPath = requestKey.slice(requestKey.indexOf(':') + 1);
      if (survivors.has(requestPath)) continue;

      staleRequestKeys.add(requestKey);
      pendingRequests.delete(requestKey);
      activeLoadKeys.delete(requestKey);
    }

    for (const [path, priority] of Array.from(queuedPriorities.entries())) {
      if (priority === 'priority' || priority === 'background') continue;
      if (survivors.has(path)) continue;

      queuedPriorities.delete(path);
    }

    for (const path of Array.from(queuedFullPreloads)) {
      if (survivors.has(path)) continue;

      queuedFullPreloads.delete(path);
    }

    fullPreloadQueue.splice(
      0,
      fullPreloadQueue.length,
      ...fullPreloadQueue.filter((path) => survivors.has(path)),
    );

    evictCache('full', Math.max(1, survivors.size));
  };

  const resetCoverCaches = () => {
    advanceEpoch();
    wipeEntries('thumbnail');
    wipeEntries('full');
    activeLoadKeys.clear();
    pendingRequests.clear();
    failureCooldowns.clear();
    staleRequestKeys.clear();
    priorityQueue.length = 0;
    backgroundQueue.length = 0;
    fullPreloadQueue.length = 0;
    queuedPriorities.clear();
    queuedFullPreloads.clear();
    runningFullPreloads = 0;
    cancelDeferredPreloads();
    if (pruneTimer) {
      window.clearTimeout(pruneTimer);
      pruneTimer = null;
    }
  };

  return {
    coverCache: thumbUrlCache,
    fullCoverCache: fullUrlCache,
    loadingSet: activeLoadKeys,
    peekCoverUrl: peekCachedUrl,
    peekCoverPath: peekCachedPath,
    getFullCoverUrl: (path: string | undefined) => peekCachedUrl(path, 'full'),
    touchCoverPaths: touchCachedPaths,
    isCoverLoading: checkCoverLoading,
    loadCover: loadThumbnailCover,
    loadCoverPath: loadThumbnailCoverPath,
    primeCoverPath: primeCachedPath,
    loadFullCover: loadLargeCover,
    preloadCovers: queuePreloads,
    preloadPriorityCovers: (paths: string[]) => queuePreloads(paths, 'priority'),
    preloadFullCovers: queueFullPreloads,
    retainFullCoverPaths: retainLargeCoverPaths,
    clearCoverCaches: resetCoverCaches,
  };
}
