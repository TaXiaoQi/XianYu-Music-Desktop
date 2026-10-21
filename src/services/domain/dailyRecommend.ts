
export type {
  DailyRecommendAlgorithm,
  DailyRecommendItem,
  DailyRecommendResult,
} from './dailyRecommendTypes';
export { DailyRecommendError } from './dailyRecommendTypes';

export { anyBoundSearchableDrive } from './dailyRecommendCore';

import { getStoredAuth } from '../auth/authService';
import { executeDailyRecommend, fetchDailyRecommendAlgorithm } from './dailyRecommendCore';
import { loadCache, saveCache, localDateKey, pickBatchItems } from './dailyRecommendCache';
import { getStoredPlugins } from './pluginEngineBase';
import { DailyRecommendError } from './dailyRecommendTypes';
import type { DailyRecommendResult } from './dailyRecommendTypes';
import type { LibrarySong } from '../../types';

// 候选池插件指纹：enabled 且 format 为 musicfree/lx 的插件 id 集合（排序后拼接）。
// 插件装/卸/启停都会改变指纹 → 缓存失效重新生成，对齐移动端行为
function pluginFingerprint(): string {
  return getStoredPlugins()
    .filter(p => p.enabled && (p.format === 'musicfree' || p.format === 'lx'))
    .map(p => p.id)
    .sort()
    .join(',');
}

export async function getDailyRecommendation(
  refresh = false,
  localSongs: LibrarySong[] = [],
): Promise<DailyRecommendResult> {
  const auth = getStoredAuth();
  const ciyuanxiId = auth?.user?.ciyuanxi_id?.trim();
  if (!ciyuanxiId) {
    throw new DailyRecommendError('not_logged_in', '请先登录后使用每日推荐');
  }

  const today = localDateKey();
  const fingerprint = pluginFingerprint();
  const cached = loadCache();
  const cacheValid = cached
    && cached.ciyuanxiId === ciyuanxiId
    && cached.date === today
    && cached.pluginFingerprint === fingerprint;

  if (cacheValid && !refresh) {
    const batch = cached.batch;
    const items = pickBatchItems(cached.candidates, cached.algorithm, batch);
    return { algorithm: cached.algorithm, items, batch };
  }

  const algorithm = cacheValid ? cached.algorithm : await fetchDailyRecommendAlgorithm();
  const nextBatch = cacheValid ? cached.batch + 1 : 0;
  const candidates = cacheValid
    ? cached.candidates
    : await executeDailyRecommend(algorithm, nextBatch, localSongs);

  saveCache({
    ciyuanxiId,
    date: today,
    batch: nextBatch,
    pluginFingerprint: fingerprint,
    algorithm,
    candidates,
  });

  const items = pickBatchItems(candidates, algorithm, nextBatch);
  return { algorithm, items, batch: nextBatch };
}