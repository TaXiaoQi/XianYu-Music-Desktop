
import { getStoredPlugins, pluginSearch, canPlayMusic, pluginGetMusicInfo } from './pluginEngine';
import { resolveLxUrlForSingleQuality } from './lxUrlResolver';
import { signedRequest, getStoredAuth } from '../auth/authService';
import type { PluginSource } from '../../types';
import { DailyRecommendError } from './dailyRecommendTypes';
import type { DailyRecommendAlgorithm, DailyRecommendItem, DailyRecommendStrategy } from './dailyRecommendTypes';

const MAX_CANDIDATES = 90;
const SEARCH_LIMIT = 20;
const SEARCH_CONCURRENCY = 4;
const MIN_DURATION_MS = 45_000;

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

function normalizeText(input: string): string {
  return (input || '')
    .toLowerCase()
    .replace(/[（(【[][^）)】\]]*[）)】\]]/g, '')
    .replace(/[\s'’`·・~～!！?？.。,，、]/g, '')
    .trim();
}

function firstArtist(artist: string): string {
  return (artist || '').split(/[/、,&]/)[0]?.trim() || '';
}

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

export async function executeDailyRecommend(
  algorithm: DailyRecommendAlgorithm,
  batch = 0,
): Promise<DailyRecommendItem[]> {
  const enabled = getStoredPlugins()
    .filter(p => p.enabled && p.format === 'musicfree')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const probeKeyword = algorithm.strategies.find(s => s.queries.length > 0)?.queries[0] ?? '热门音乐';
  const alive = await Promise.all(enabled.map(p => probePluginAlive(p, probeKeyword)));
  const plugins: PluginSource[] = enabled.filter((_, i) => alive[i]);
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

  const best = new Map<string, { item: DailyRecommendItem; score: number }>();
  for (const entry of searchResults) {
    if (!entry) continue;
    const { task, results } = entry;
    results.forEach((song, rank) => {
      if (!song?.title || !song.artist) return;
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

  const seed = algorithm.daily_seed + batch * 7919;
  const rand = mulberry32(seed);
  const candidates = [...best.values()].map(v => v.item);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  return candidates.slice(0, Math.min(MAX_CANDIDATES, candidates.length));
}

// ==================== 插件活体探测 ====================

const ALIVE_PROBE_TTL_MS = 15 * 60_000;
const ALIVE_PROBE_TIMEOUT_MS = 4_000;
const _aliveProbes = new Map<string, { alive: boolean; at: number }>();

function withProbeTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('alive probe timeout')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export async function probePluginAlive(source: PluginSource, keyword: string): Promise<boolean> {
  const cached = _aliveProbes.get(source.id);
  if (cached && Date.now() - cached.at < ALIVE_PROBE_TTL_MS) return cached.alive;
  let alive = false;
  try {
    if (!(await canPlayMusic(source))) throw new Error('not playable');
    const hits = await withProbeTimeout(pluginSearch(source, keyword, 1, 1), ALIVE_PROBE_TIMEOUT_MS);
    if (!hits?.length) {
      alive = true;
    } else if (source.format === 'lx') {
      const first = hits[0];
      const lxSource = first.platform || source.sources[0] || 'kw';
      const songInfo = (first.rawData && first.rawData.source === lxSource
        ? first.rawData
        : null) ?? {
        songId: first.id,
        songmid: first.id,
        name: first.title,
        singer: first.artist,
        source: lxSource,
        types: [],
      };
      const r = await withProbeTimeout(
        resolveLxUrlForSingleQuality(source, lxSource, songInfo, '128k'),
        ALIVE_PROBE_TIMEOUT_MS,
      );
      alive = Boolean(r?.url);
    } else {
      const info = await withProbeTimeout(
        pluginGetMusicInfo(source, hits[0], '128k', 'lower'),
        ALIVE_PROBE_TIMEOUT_MS,
      );
      alive = Boolean(info?.url);
    }
  } catch {
    alive = false;
  }
  _aliveProbes.set(source.id, { alive, at: Date.now() });
  return alive;
}