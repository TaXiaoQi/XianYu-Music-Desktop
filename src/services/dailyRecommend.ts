/**
 * 每日推荐服务
 *
 * 架构：推荐算法本体由服务器基于账号播放历史决策并下发（策略 DSL：类型/权重/查询词/排除项/每日种子），
 * 客户端在本机调用已安装的音源插件执行算法（搜索 → 过滤 → 打分去重 → 按每日种子洗牌），
 * 整理出当日推荐歌曲板块。同一天内结果稳定，换一批按批次种子重新洗牌。
 *
 * - POST /api/?action=get_daily_recommend  获取当日推荐算法（需登录）
 * 算法执行失败静默降级（返回空列表由 UI 展示空态），绝不抛错阻塞 UI。
 */

import { getStoredPlugins, pluginSearch } from './pluginEngine';
import { signedRequest, getStoredAuth } from './auth/authService';
import type { PluginSearchResult, PluginSource } from '../types';

// ─── 算法 DSL 类型（与服务端 recommend.rs 对齐） ───────────────

export type RecommendStrategyType = 'artist_search' | 'song_search' | 'keyword_search';

export interface DailyRecommendStrategy {
  id: string;
  type: RecommendStrategyType;
  weight: number;
  queries: string[];
  reason: string;
}

export interface DailyRecommendAlgorithm {
  version: number;
  date: string;
  daily_seed: number;
  target_count: number;
  profile: {
    top_artists: Array<{ name: string; play_count: number }>;
    top_songs: Array<{ name: string; singer: string; play_count: number }>;
    total_plays: number;
    active_days: number;
  };
  strategies: DailyRecommendStrategy[];
  exclusions: {
    match_mode: string;
    songs: Array<{ title: string; artist: string }>;
  };
  shuffle: { algorithm: string; seed: number };
}

export interface DailyRecommendItem {
  song: PluginSearchResult;
  /** 推荐理由（来自命中的策略） */
  reason: string;
  strategyId: string;
  pluginName: string;
}

// ─── 常量 ──────────────────────────────────────────────────────

/** 候选池上限（换一批从中重新洗牌取样，控制缓存体积） */
const MAX_CANDIDATES = 90;
/** 每个查询词取的搜索结果数 */
const SEARCH_LIMIT = 20;
/** 参与搜索的插件数上限（按排序取前 N，控制调用量） */
const MAX_SEARCH_PLUGINS = 3;
/** 并发搜索数上限 */
const SEARCH_CONCURRENCY = 4;
/** 低于该时长（毫秒）的结果视为试听/铃声，过滤 */
const MIN_DURATION_MS = 45_000;
/** 本地缓存键 */
const CACHE_KEY = 'xy.dailyRecommend.v1';

/** 获取每日推荐失败（未登录 / 网络异常等） */
export class DailyRecommendError extends Error {
  readonly kind: 'not_logged_in' | 'network';
  constructor(kind: 'not_logged_in' | 'network', message: string) {
    super(message);
    this.kind = kind;
  }
}

// ─── 工具函数 ──────────────────────────────────────────────────

/** mulberry32 确定性伪随机（同一种子同一次序，保证同一天/同批次结果一致） */
function mulberry32(seed: number): () => number {
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
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '')
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

// ─── 算法下发 ──────────────────────────────────────────────────

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

// ─── 算法执行（调用已安装插件） ────────────────────────────────

type SearchTask = {
  strategy: DailyRecommendStrategy;
  query: string;
  plugin: PluginSource;
};

/** 组装搜索任务：策略查询词在参与插件间轮询分配 */
function buildSearchTasks(algorithm: DailyRecommendAlgorithm, plugins: PluginSource[]): SearchTask[] {
  const activePlugins = plugins.slice(0, MAX_SEARCH_PLUGINS);
  const tasks: SearchTask[] = [];
  let slot = 0;
  for (const strategy of algorithm.strategies) {
    const queries = strategy.queries || [];
    for (let qi = 0; qi < queries.length; qi++) {
      const plugin = activePlugins[(slot + qi) % activePlugins.length];
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

// ─── 每日缓存（同一天免重算，换一批递增批次） ──────────────────

interface DailyRecommendCache {
  ciyuanxiId: string;
  date: string;
  batch: number;
  algorithm: DailyRecommendAlgorithm;
  /** 洗牌前的候选池（换一批从中重新洗牌取样） */
  candidates: DailyRecommendItem[];
}

function loadCache(): DailyRecommendCache | null {
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

function saveCache(cache: DailyRecommendCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* 存储满等异常静默 */
  }
}

function localDateKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export interface DailyRecommendResult {
  algorithm: DailyRecommendAlgorithm;
  items: DailyRecommendItem[];
  batch: number;
}

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

/** 从候选池按批次种子洗牌并截取目标数量 */
function pickBatchItems(
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
