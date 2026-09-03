/**
 * 每日推荐 · 算法核心。
 *
 * 算法本体由服务器基于账号播放历史决策并下发（策略 DSL：类型/权重/查询词/排除项/每日种子），
 * 本模块在本机调用已安装的音源插件执行算法（搜索 → 过滤 → 打分去重 → 按每日种子洗牌），
 * 整理出当日推荐歌曲板块。
 */

import { getStoredPlugins, pluginSearch } from './pluginEngine';
import { signedRequest, getStoredAuth } from '../auth/authService';
import type { PluginSource } from '../../types';
import { DailyRecommendError } from './dailyRecommendTypes';
import type { DailyRecommendAlgorithm, DailyRecommendItem, DailyRecommendStrategy } from './dailyRecommendTypes';

/** 候选池上限（换一批从中重新洗牌取样，控制缓存体积） */
const MAX_CANDIDATES = 90;
/** 每个查询词取的搜索结果数 */
const SEARCH_LIMIT = 20;
/** 并发搜索数上限 */
const SEARCH_CONCURRENCY = 4;
/** 低于该时长（毫秒）的结果视为试听/铃声，过滤 */
const MIN_DURATION_MS = 45_000;

/** mulberry32 确定性伪随机（同一种子同一次序，保证同一天/同批次结果一致） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 归一化标题/歌手：去空白、括号后缀、分隔符，用于排除与去重匹配 */
function normalizeText(input: string): string {
  return (input || '')
    .toLowerCase()
    .replace(/[（(【[][^）)】\]]*[）)】\]]/g, '')
    .replace(/[\s'’`·・~～!！?？.。,，、]/g, '')
    .trim();
}

/** 取第一位歌手（多歌手合唱场景） */
function firstArtist(artist: string): string {
  return (artist || '').split(/[/、,&]/)[0]?.trim() || '';
}

/** 并发受限执行，单项失败静默返回 undefined */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length).fill(undefined);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await fn(items[index]);
      } catch {
        /* 单个搜索失败不影响整体 */
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/** 从服务器获取当日推荐算法（需登录） */
export async function fetchDailyRecommendAlgorithm(): Promise<DailyRecommendAlgorithm> {
  const auth = getStoredAuth();
  const ciyuanxiId = auth?.user?.ciyuanxi_id?.trim();
  if (!ciyuanxiId) {
    throw new DailyRecommendError('not_logged_in', '请先登录后使用每日推荐');
  }
  try {
    const data = await signedRequest<DailyRecommendAlgorithm>(
      'get_daily_recommend',
      { ciyuanxi_id: ciyuanxiId },
      { fetchTimeoutMs: 12_000, timeoutMs: 15_000 },
    );
    if (!data || !Array.isArray(data.strategies) || data.strategies.length === 0) {
      throw new Error('算法数据无效');
    }
    return data;
  } catch (e) {
    if (e instanceof DailyRecommendError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new DailyRecommendError('network', `获取推荐算法失败: ${msg}`);
  }
}

type SearchTask = {
  strategy: DailyRecommendStrategy;
  query: string;
  plugin: PluginSource;
};

/** 组装搜索任务：策略查询词在全部可播放插件间轮询分配（与移动端对齐） */
function buildSearchTasks(algorithm: DailyRecommendAlgorithm, plugins: PluginSource[]): SearchTask[] {
  const tasks: SearchTask[] = [];
  let slot = 0;
  for (const strategy of algorithm.strategies) {
    const queries = strategy.queries || [];
    for (let qi = 0; qi < queries.length; qi++) {
      const plugin = plugins[(slot + qi) % plugins.length];
      tasks.push({ strategy, query: queries[qi], plugin });
    }
    slot += queries.length;
  }
  return tasks;
}

/**
 * 执行推荐算法：插件搜索 → 排除/过滤 → 打分去重 → 每日种子洗牌 → 候选池。
 * 返回按批次种子洗牌并截取到目标数量的推荐列表。
 */
export async function executeDailyRecommend(
  algorithm: DailyRecommendAlgorithm,
  batch = 0,
): Promise<DailyRecommendItem[]> {
  const plugins = getStoredPlugins()
    .filter(p => p.enabled && p.format === 'musicfree')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (plugins.length === 0) {
    return [];
  }

  const exclusionSet = new Set(
    (algorithm.exclusions?.songs || [])
      .filter(s => s.title)
      .map(s => `${normalizeText(s.title)}|${normalizeText(firstArtist(s.artist))}`),
  );

  const tasks = buildSearchTasks(algorithm, plugins);
  const searchResults = await mapWithLimit(tasks, SEARCH_CONCURRENCY, async (task) => {
    const results = await pluginSearch(task.plugin, task.query, 1, SEARCH_LIMIT);
    return { task, results };
  });

  // 打分去重：score = 策略权重 + 搜索排名，同曲多源保留最高分
  const best = new Map<string, { item: DailyRecommendItem; score: number }>();
  for (const entry of searchResults) {
    if (!entry) continue;
    const { task, results } = entry;
    results.forEach((song, rank) => {
      if (!song?.title || !song.artist) return;
      // 过滤试听/铃声与空结果（duration 为 0 的未知时长结果保留，播放时再解析）
      if (song.duration > 0 && song.duration < MIN_DURATION_MS) return;
      const normTitle = normalizeText(song.title);
      const normArtist = normalizeText(firstArtist(song.artist));
      if (!normTitle || !normArtist) return;
      const key = `${normTitle}|${normArtist}`;
      if (exclusionSet.has(key)) return;
      const score = task.strategy.weight * 0.6 + (1 - rank / SEARCH_LIMIT) * 0.4;
      const prev = best.get(key);
      if (!prev || score > prev.score) {
        best.set(key, {
          score,
          item: {
            song,
            reason: task.strategy.reason,
            strategyId: task.strategy.id,
            pluginName: task.plugin.name,
          },
        });
      }
    });
  }

  // 每日种子洗牌（batch 参与种子：换一批时次序与取样不同，同批次结果稳定）
  const seed = algorithm.daily_seed + batch * 7919;
  const rand = mulberry32(seed);
  const candidates = [...best.values()].map(v => v.item);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  return candidates.slice(0, Math.min(MAX_CANDIDATES, candidates.length));
}