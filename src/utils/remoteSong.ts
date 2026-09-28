import { LX_SOURCE_NAMES, type LxSourceId } from '../services/domain/lxMusicSdk';
import { getStoredPlugins, pluginsVersion } from '../services/domain/pluginEngine';
import type { PluginSource } from '../types';

export const isRemoteSong = (song: { path?: string; source_type?: string } | null | undefined) =>
  song?.source_type === 'remote' || song?.path?.startsWith('remote://') === true;

export const parseIntervalToSeconds = (interval?: string | null): number => {
  if (!interval) return 0;
  const parts = interval.trim().split(':').map(part => parseInt(part, 10));
  if (parts.length === 0 || parts.some(n => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

let pluginCacheVersion = -1;
let pluginCache = new Map<string, PluginSource>();

function getStoredPluginById(pluginId: string): PluginSource | null {
  if (pluginCacheVersion !== pluginsVersion.value) {
    pluginCacheVersion = pluginsVersion.value;
    pluginCache = new Map();
    for (const p of getStoredPlugins()) {
      pluginCache.set(p.id, p);
    }
  }
  return pluginCache.get(pluginId) ?? null;
}

// —— 付费订阅来源品牌（聆澜/ikun 等）：订阅/插件安装 URL 的 query 带 source=，
// 标签直接显示来源品牌名；仅带 key= 无来源名时回落显示「付费」。
const SUB_SOURCE_BRAND_ALIAS: Record<string, string> = { linglan: '聆澜' };

// 插件名/作者内置品牌词（ikun 插件 URL 只有 key 无 source，靠名称识别）
const SUB_SOURCE_BRAND_KEYWORDS: Array<[string, string]> = [
  ['聆澜', '聆澜'],
  ['ikun', 'ikun'],
];

const brandFromIdentity = (name?: string, author?: string): string | null => {
  const hay = `${(name ?? '').trim()} ${(author ?? '').trim()}`.toLowerCase();
  if (!hay.trim()) return null;
  for (const [kw, brand] of SUB_SOURCE_BRAND_KEYWORDS) {
    if (hay.includes(kw)) return brand;
  }
  return null;
};

const brandFromUrl = (url?: string | null): string | null => {
  if (!url) return null;
  try {
    const v = new URL(url).searchParams.get('source')?.trim();
    if (!v) return null;
    return SUB_SOURCE_BRAND_ALIAS[v.toLowerCase()] ?? v;
  } catch {
    return null;
  }
};

const urlHasKey = (url?: string | null): boolean => {
  if (!url) return false;
  try {
    return !!new URL(url).searchParams.get('key')?.trim();
  } catch {
    return false;
  }
};

const urlHost = (url?: string | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
};

interface PluginSubscriptionLike {
  name?: string;
  url: string;
}

// localStorage 订阅记录按原始串缓存，避免逐行标签重复 JSON.parse
let subCacheRaw: string | null = null;
let subCache: PluginSubscriptionLike[] = [];

const readSubscriptions = (): PluginSubscriptionLike[] => {
  const raw = localStorage.getItem('xianyu_plugin_subscriptions');
  if (raw === subCacheRaw) return subCache;
  let list: PluginSubscriptionLike[] = [];
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    list = [];
  }
  subCacheRaw = raw;
  subCache = list;
  return list;
};

export interface SongSourceTagInfo {
  label: string;
  /** 命中付费订阅来源品牌（或付费标记），标签用金色高亮渲染 */
  brand: boolean;
}

const pluginSubTag = (p: PluginSource): SongSourceTagInfo | null => {
  const own = brandFromUrl(p.filePath);
  if (own) return { label: own, brand: true };
  const named = brandFromIdentity(p.name, p.author);
  if (named) return { label: named, brand: true };
  if (urlHasKey(p.filePath)) return { label: '付费', brand: true };
  const ownHost = urlHost(p.filePath);
  const pname = p.name.trim();
  for (const sub of readSubscriptions()) {
    const subName = sub.name?.trim() ?? '';
    const matched =
      (subName !== '' && subName === pname) ||
      (ownHost !== null && urlHost(sub.url) === ownHost);
    if (!matched) continue;
    const brand = brandFromUrl(sub.url);
    if (brand) return { label: brand, brand: true };
    if (urlHasKey(sub.url)) return { label: '付费', brand: true };
    break;
  }
  return null;
};

// 插件管理页等直接持有 PluginSource 的场景使用
export const getPluginSubTag = (p: PluginSource): SongSourceTagInfo | null =>
  pluginSubTag(p);

export const getSongSourceTag = (
  song: { path?: string; source_type?: string; plugin_id?: string; rawData?: any } | null | undefined,
): SongSourceTagInfo => {
  const path = song?.path;
  if (path?.startsWith('lx://')) {
    const sourceId = path.slice('lx://'.length).split('/')[0] as LxSourceId;
    return { label: LX_SOURCE_NAMES[sourceId] ?? '在线', brand: false };
  }

  if (path?.startsWith('plugin://')) {
    const pluginId = song?.plugin_id || song?.rawData?.pluginId;
    const plugin = pluginId ? getStoredPluginById(pluginId) : null;
    if (plugin) {
      const tag = pluginSubTag(plugin);
      if (tag) return tag;
      return { label: plugin.name, brand: false };
    }
    return { label: '在线', brand: false };
  }

  return { label: '远程', brand: false };
};

export const getSongSourceLabel = (
  song: { path?: string; source_type?: string; plugin_id?: string; rawData?: any } | null | undefined,
): string => getSongSourceTag(song).label;
