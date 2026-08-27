/**
 * 插件引擎 · 目录操作共享工具与类型（叶子）。
 *
 * 落雪式增量退避重试（retryOnEmpty）、结果结构描述、歌手简介提取，
 * 以及音乐/歌手/专辑搜索结果类型。仅依赖 pluginResultMappers 与
 * pluginEngineBase(log)，被 pluginCatalogSearch / pluginCatalogDetails 复用。
 */
import type { PluginSearchResult } from '../../types';
import { extractResultList } from './pluginResultMappers';
import { log } from './pluginEngineBase';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const MF_EMPTY_SEARCH_RETRY_DELAY_MS = 450;

/** 目录加载日志（供日志系统记录，便于排查歌单/歌手/专辑间歇加载问题） */
export const catalogLog = (msg: string) => {
  log(msg);
};

/** 汇总一次插件返回的结构，便于日志中人工判断返回了什么 */
export const describeResult = (r: any): string => {
  if (!r || typeof r !== 'object') return `type=${typeof r}`;
  const keys = Object.keys(r).filter(k => k !== 'isEnd').join(',') || '空对象';
  let len = 0;
  try { len = extractResultList(r).length; } catch { /* ignore */ }
  return `keys=[${keys}] extractedLen=${len}`;
};

/**
 * 调用插件方法，若结果为空则等待后重试。
 * 参考落雪(lx) 的加载方式：失败时用增量退避拉长每次间隔，延后放弃，让加载转圈持续更久、命中率更高；
 * 不做短固定间隔的快速重试。delay 可传固定值或返回每次等待时长的函数。
 */
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
  // 所有尝试都用尽且每次结果都判空 → 抛错由调用方决定兜底策略
  if (result === undefined || isEmpty(result as T)) {
    throw lastErr ?? new Error(`${label} 多次尝试后仍为空`);
  }
  return result as T;
}

/** 从歌手条目/详情对象中尽力提取简介，兼容各平台常见字段（含嵌套子对象） */
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

// ==================== 类型 ====================

export type PluginMusicSearchStatus =
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