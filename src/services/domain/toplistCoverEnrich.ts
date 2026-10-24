import type { PluginPlaylistSearchResult, PluginSource } from '../../types';
import { pluginGetPlaylistDetail } from './pluginCatalogDetails';

// 榜单封面回填：部分 MF 插件的榜单 API 不返回封面（如 bilibili 每周必看/排行榜
// 只有标题），插件只能给所有条目塞同一张静态图标；App 侧按「榜单第一页首个
// 视频封面」回填，结果持久缓存 7 天（每周必看期号每周轮换，缓存键含期号自然失效）
const CACHE_KEY = 'plugin.toplist_covers.v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_CAP = 12;
const CACHE_LIMIT = 300;

type CoverCache = Record<string, { cover?: string; ts?: number }>;

let coverCache: CoverCache | null = null;
const inflight = new Map<string, Promise<string | null>>();

function loadCache(): CoverCache {
  if (coverCache) return coverCache;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') coverCache = parsed as CoverCache;
    }
  } catch { /* 损坏缓存当作空 */ }
  return (coverCache ??= {});
}

function saveCache(cache: CoverCache) {
  coverCache = cache;
  try {
    const now = Date.now();
    for (const k of Object.keys(cache)) {
      if (now - (cache[k]?.ts ?? 0) >= TTL_MS) delete cache[k];
    }
    const keys = Object.keys(cache);
    if (keys.length > CACHE_LIMIT) {
      keys.sort((a, b) => (cache[a]?.ts ?? 0) - (cache[b]?.ts ?? 0));
      for (const k of keys.slice(0, keys.length - CACHE_LIMIT)) delete cache[k];
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* 写入失败忽略 */ }
}

async function fetchFirstTrackCover(source: PluginSource, sheetItem: any): Promise<string | null> {
  try {
    const songs = await pluginGetPlaylistDetail(source, sheetItem, 1);
    for (const s of songs) {
      const c = (s.coverUrl || '').trim();
      if (c) return c;
    }
  } catch { /* 拉取失败保持静态图标 */ }
  return null;
}

/**
 * 回填榜单真实封面：同 coverUrl 复用 ≥3 次视为插件静态图标（榜单 API 无封面），
 * 取该榜单第一页首个视频封面替代。单次最多 12 条控制成本，持久缓存 7 天；
 * 拉取失败保持原图。仅 MF/anime 源（LX 榜单封面来自真实数据）。
 * 调用方应先渲染原列表、后台调用本方法后再刷新，避免阻塞首屏。
 */
export async function enrichTopListCovers(
  source: PluginSource,
  boards: PluginPlaylistSearchResult[],
): Promise<PluginPlaylistSearchResult[]> {
  if (boards.length === 0 || source.format === 'lx') return boards;
  const counts = new Map<string, number>();
  for (const b of boards) {
    const c = b.coverUrl;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const generic = new Set([...counts.entries()].filter(([, n]) => n >= 3).map(([c]) => c));
  if (generic.size === 0) return boards;

  const cache = loadCache();
  const now = Date.now();
  const targets = boards.filter(b => b.coverUrl && generic.has(b.coverUrl)).slice(0, FETCH_CAP);
  if (targets.length === 0) return boards;

  const resolved = new Map<PluginPlaylistSearchResult, string>();
  await Promise.all(targets.map(async b => {
    const key = `${source.id}|${b.id}`;
    const hit = cache[key];
    if (hit && now - (hit.ts ?? 0) < TTL_MS) {
      if (hit.cover) resolved.set(b, hit.cover);
      return;
    }
    const pending = inflight.get(key) ?? fetchFirstTrackCover(source, b.rawData);
    inflight.set(key, pending);
    try {
      const cover = await pending;
      if (cover) {
        resolved.set(b, cover);
        cache[key] = { cover, ts: now };
      }
    } catch { /* 拉取失败保持静态图标，不缓存失败结果 */ }
    finally {
      if (inflight.get(key) === pending) inflight.delete(key);
    }
  }));
  if (resolved.size === 0) return boards;
  saveCache(cache);
  return boards.map(b => (resolved.has(b) ? { ...b, coverUrl: resolved.get(b)! } : b));
}
