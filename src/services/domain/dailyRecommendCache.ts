/**
 * 每日推荐 · 当日缓存（同一天免重算，换一批递增批次）。
 */

import { mulberry32 } from './dailyRecommendCore';
import type { DailyRecommendAlgorithm, DailyRecommendItem } from './dailyRecommendTypes';

/** 本地缓存键 */
const CACHE_KEY = 'xy.dailyRecommend.v1';

interface DailyRecommendCache {
  ciyuanxiId: string;
  date: string;
  batch: number;
  algorithm: DailyRecommendAlgorithm;
  /** 洗牌前的候选池（换一批从中重新洗牌取样） */
  candidates: DailyRecommendItem[];
}

export function loadCache(): DailyRecommendCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyRecommendCache;
    if (!parsed?.algorithm?.strategies || !Array.isArray(parsed.candidates)) return null;
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

/** 从候选池按批次种子洗牌并截取目标数量 */
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

/** 退出登录/切换账号时清理每日推荐缓存 */
export function clearDailyRecommendCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* 静默 */
  }
}