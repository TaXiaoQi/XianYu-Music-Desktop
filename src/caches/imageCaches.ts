import { MemoryCache as LruStore } from '../utils/MemoryCache';

// 视口封面快照的两种形态：纯 url 列表（歌曲表）与 path→url 条目列表（歌手 / 专辑页）
export type ViewportCoverSnapshot = Array<string>;
export type ViewportCoverUrlSnapshotEntry = { path: string; url: string };
export type ViewportCoverUrlSnapshot = Array<ViewportCoverUrlSnapshotEntry>;

// 统一建仓入口：参数依次为容量上限与存活毫秒数
function createCache<K, V>(capacity: number, lifetimeMs: number) {
  return new LruStore<K, V>({ maxEntries: capacity, ttlMs: lifetimeMs });
}

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// 详情页头图：小容量短时效
export const artistHeaderCache = createCache<string, string>(32, TEN_MINUTES_MS);
export const albumHeaderCache = createCache<string, string>(32, TEN_MINUTES_MS);

// 侧栏歌单封面：大容量，按天保留
export const sidebarPlaylistCoverCache = createCache<string, string>(80, ONE_DAY_MS);

// 列表滚动位置记忆（键 → 像素偏移）
export const listScrollCache = createCache<string, number>(30, 30 * 60 * 1000);

// 视口快照：歌手 / 专辑页只留最后一份，歌曲表按视口键保留若干份
export const artistViewportCoverSnapshotCache = createCache<string, ViewportCoverUrlSnapshot>(1, TEN_MINUTES_MS);
export const albumViewportCoverSnapshotCache = createCache<string, ViewportCoverSnapshot>(1, TEN_MINUTES_MS);
export const songTableViewportCoverSnapshotCache = createCache<string, ViewportCoverSnapshot>(12, TEN_MINUTES_MS);

// 全部受管缓存的登记表，供批量清理时遍历
const managedCaches: Array<{ prune(): void; clear(): void }> = [
  artistHeaderCache, albumHeaderCache, sidebarPlaylistCoverCache, listScrollCache,
  artistViewportCoverSnapshotCache, albumViewportCoverSnapshotCache, songTableViewportCoverSnapshotCache,
];

export function pruneImageCaches(): void {
  managedCaches.forEach((cache) => { cache.prune(); });
}

export function clearImageCaches(): void {
  managedCaches.forEach((cache) => { cache.clear(); });
}

// 重型清理：头图与快照直接清空；滚动位置与侧栏封面只做过期修剪
export function clearHeavyImageCaches(): void {
  for (const cache of managedCaches) {
    if (cache === sidebarPlaylistCoverCache || cache === listScrollCache) {
      cache.prune();
    } else {
      cache.clear();
    }
  }
}

// 页面进入后台时修剪一轮，释放过期封面占用的内存
let visibilityHookBound = false;

function handleVisibilityForCaches() {
  if (document.visibilityState === 'hidden') pruneImageCaches();
}

function bindVisibilityHook() {
  if (visibilityHookBound || typeof document === 'undefined') {
    return;
  }
  document.addEventListener('visibilitychange', handleVisibilityForCaches);
  visibilityHookBound = true;
}

function unbindVisibilityHook() {
  if (!visibilityHookBound || typeof document === 'undefined') {
    return;
  }
  document.removeEventListener('visibilitychange', handleVisibilityForCaches);
  visibilityHookBound = false;
}

bindVisibilityHook();

const hmrContext = import.meta.hot;
if (hmrContext) {
  hmrContext.dispose(unbindVisibilityHook);
}
