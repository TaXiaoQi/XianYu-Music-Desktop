
import { mulberry32 } from './dailyRecommendCore';
import type { DailyRecommendAlgorithm, DailyRecommendItem } from './dailyRecommendTypes';

// v3：新增 pluginFingerprint 插件指纹（v2 无该字段，直接换 key 作废旧缓存）：
// 装/启用插件后日推候选池会变，指纹不匹配即重新生成，避免旧缓存长期命中
const CACHE_KEY = 'xy.dailyRecommend.v3';

interface DailyRecommendCache {
  ciyuanxiId: string;
  date: string;
  batch: number;
  pluginFingerprint: string;
  algorithm: DailyRecommendAlgorithm;
  candidates: DailyRecommendItem[];
}

export function loadCache(): DailyRecommendCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyRecommendCache;
    if (!parsed?.algorithm?.strategies || !Array.isArray(parsed.candidates)) return null;
    if (typeof parsed.pluginFingerprint !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCache(cache: DailyRecommendCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* 存储满等异常静默 */
  }
}

export function localDateKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function pickBatchItems(
  candidates: DailyRecommendItem[],
  algorithm: DailyRecommendAlgorithm,
  batch: number,
): DailyRecommendItem[] {
  const seed = algorithm.daily_seed + batch * 7919;
  const rand = mulberry32(seed);
  const pool = [...candidates];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(1, algorithm.target_count || 30));
}
