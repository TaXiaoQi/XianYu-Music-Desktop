
export type {
  RecommendStrategyType,
  DailyRecommendStrategy,
  DailyRecommendAlgorithm,
  DailyRecommendItem,
  DailyRecommendResult,
} from './dailyRecommendTypes';
export { DailyRecommendError } from './dailyRecommendTypes';

export { clearDailyRecommendCache } from './dailyRecommendCache';

import { getStoredAuth } from '../auth/authService';
import { executeDailyRecommend, fetchDailyRecommendAlgorithm } from './dailyRecommendCore';
import { loadCache, saveCache, localDateKey, pickBatchItems } from './dailyRecommendCache';
import { DailyRecommendError } from './dailyRecommendTypes';
import type { DailyRecommendResult } from './dailyRecommendTypes';

export async function getDailyRecommendation(refresh = false): Promise<DailyRecommendResult> {
  const auth = getStoredAuth();
  const ciyuanxiId = auth?.user?.ciyuanxi_id?.trim();
  if (!ciyuanxiId) {
    throw new DailyRecommendError('not_logged_in', '请先登录后使用每日推荐');
  }

  const today = localDateKey();
  const cached = loadCache();
  const cacheValid = cached && cached.ciyuanxiId === ciyuanxiId && cached.date === today;

  if (cacheValid && !refresh) {
    const batch = cached.batch;
    const items = pickBatchItems(cached.candidates, cached.algorithm, batch);
    return { algorithm: cached.algorithm, items, batch };
  }

  const algorithm = cacheValid ? cached.algorithm : await fetchDailyRecommendAlgorithm();
  const nextBatch = cacheValid ? cached.batch + 1 : 0;
  const candidates = cacheValid
    ? cached.candidates
    : await executeDailyRecommend(algorithm, nextBatch);

  saveCache({
    ciyuanxiId,
    date: today,
    batch: nextBatch,
    algorithm,
    candidates,
  });

  const items = pickBatchItems(candidates, algorithm, nextBatch);
  return { algorithm, items, batch: nextBatch };
}