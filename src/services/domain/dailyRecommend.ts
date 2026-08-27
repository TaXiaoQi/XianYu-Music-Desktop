/**
 * 每日推荐服务 —— 门面（Facade）。
 *
 * 架构：推荐算法本体由服务器基于账号播放历史决策并下发（策略 DSL：类型/权重/查询词/排除项/每日种子），
 * 客户端在本机调用已安装的音源插件执行算法（搜索 → 过滤 → 打分去重 → 按每日种子洗牌），
 * 整理出当日推荐歌曲板块。同一天内结果稳定，换一批按批次种子重新洗牌。
 *
 * 汇聚 re-export 拆分后的子模块并保留 `getDailyRecommendation` 主编排，保持既有消费者
 * （DailyRecommend.vue）的入口路径不变。已拆分的子模块：
 *   - dailyRecommendTypes   类型 + DailyRecommendError（叶子）
 *   - dailyRecommendCore    算法执行（下发/搜索/过滤/打分去重/洗牌）
 *   - dailyRecommendCache   当日缓存（免重算，换一批递增批次）
 *
 * - POST /api/?action=get_daily_recommend  获取当日推荐算法（需登录）
 * 算法执行失败静默降级（返回空列表由 UI 展示空态），绝不抛错阻塞 UI。
 */

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

/**
 * 获取每日推荐结果（带当日缓存）。
 * - 默认：命中当日缓存直接复用（免重复搜索）
 * - refresh=true：换一批，批次 +1 并按批次种子重新洗牌取样（无缓存/算法失效时先重新拉取算法）
 */
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

  // 换一批：算法当日有效，直接复用；否则重新下发
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