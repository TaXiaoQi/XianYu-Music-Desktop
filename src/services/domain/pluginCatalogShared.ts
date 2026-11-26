import type { PluginSearchResult } from '../../types';
import { extractResultList } from './pluginResultMappers';
import { log } from './pluginEngineBase';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const MF_EMPTY_SEARCH_RETRY_DELAY_MS = 450;

export const catalogLog = (msg: string) => {
  log(msg);
};

const describeResult = (r: any): string => {
  if (!r || typeof r !== 'object') return `type=${typeof r}`;
  const keys = Object.keys(r).filter(k => k !== 'isEnd').join(',') || '空对象';
  let len = 0;
  try { len = extractResultList(r).length; } catch { /* ignore */ }
  return `keys=[${keys}] extractedLen=${len}`;
};

export async function retryOnEmpty<T>(
  label: string,
  fn: () => Promise<T>,
  isEmpty: (val: T) => boolean,
  delay: number | ((attempt: number) => number) = (i: number) => MF_EMPTY_SEARCH_RETRY_DELAY_MS * 2 * i,
  attempts: number = 6,
): Promise<T> {
  const getDelay = (i: number) => (typeof delay === 'function' ? delay(i) : delay);
  let result: T | undefined;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    const wait = getDelay(i);
    try {
      result = await fn();
      catalogLog(`${label} 第${i}次 → ${describeResult(result)}`);
      if (!isEmpty(result)) return result;
      if (i < attempts) {
        catalogLog(`${label} 第${i}次为空，${wait}ms后重试(共${attempts}次)`);
        await sleep(wait);
      }
    } catch (e: any) {
      lastErr = e;
      catalogLog(`${label} 第${i}次异常: ${e?.message || e}`);
      if (i < attempts) {
        catalogLog(`${label} 异常后 ${wait}ms重试(共${attempts}次)`);
        await sleep(wait);
      }
    }
  }
  if (result === undefined || isEmpty(result as T)) {
    throw lastErr ?? new Error(`${label} 多次尝试后仍为空`);
  }
  return result as T;
}

export function extractArtistDescription(raw: any): string {
  if (!raw || typeof raw !== 'object') return '';
  const candidates = [
    'artistDesc', 'artistIntro', 'artist_intro', 'briefDesc', 'briefdesc',
    'intro', 'desc', 'description', 'profile', 'bio', 'biography',
    'aDesc', 'aDes',
  ];
  for (const key of candidates) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = extractArtistDescription(v);
      if (inner) return inner;
    }
  }
  return '';
}

// MF 插件 tags 出参取默认标签：defaultTag → tags[0]（旧约定）→
// pinned 首个（MusicFree 标准形态 {pinned, data}，酷我[T]/JOOX/网易云/bilibili
// 等社区插件）→ 首分组首标签兜底；标签须原样回传（如酷我 pinned.digest 决定
// 取数端点），无可选标签传 null 交插件自身默认。社区插件普遍未对 null 判空
// （tag.id 直接抛错），绝不能在标签可得时把 null 传下去
export function pickDefaultRecommendTag(tags: any): any {
  if (!tags || typeof tags !== 'object') return null;
  if (tags.defaultTag) return tags.defaultTag;
  if (Array.isArray(tags.tags) && tags.tags.length > 0) return tags.tags[0];
  const candidates: any[] = [
    ...(Array.isArray(tags.pinned) ? tags.pinned : []),
    ...(Array.isArray(tags.data) && tags.data.length > 0 && tags.data[0] && typeof tags.data[0] === 'object'
      ? tags.data[0].data || []
      : []),
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && candidate.id != null) return candidate;
  }
  return null;
}

// ==================== 类型 ====================

type PluginMusicSearchStatus =
  | 'success'
  | 'empty'
  | 'init_failed'
  | 'search_unsupported'
  | 'lyrics_unsupported'
  | 'invalid_response'
  | 'search_failed';

export interface PluginMusicSearchDiagnostics {
  results: PluginSearchResult[];
  status: PluginMusicSearchStatus;
  reason: string;
  searchType?: string;
  supportsLyrics: boolean;
}

export interface PluginArtistResult {
  id: string;
  name: string;
  avatarUrl: string;
  description?: string;
  songCount?: number;
  albumCount?: number;
  platform: string;
  platformId: string;
  pluginId: string;
  rawData?: any;
}

export interface PluginAlbumResult {
  id: string;
  name: string;
  artist: string;
  coverUrl: string;
  description?: string;
  year?: string;
  songCount?: number;
  platform: string;
  platformId: string;
  pluginId: string;
  rawData?: any;
}