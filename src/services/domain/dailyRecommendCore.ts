
import { getStoredPlugins, pluginSearch, canPlayMusic, pluginGetMusicInfo } from './pluginEngine';
import { resolveLxUrlForSingleQuality } from './lxUrlResolver';
import { lxSearch } from './lxMusicSdkSearch';
import type { LxSearchResultItem } from './lxMusicSdkBase';
import type { LxSourceId } from './lxMusicSdkTypes';
import { signedRequest, getStoredAuth } from '../auth/authService';
import type { LibrarySong, PluginSearchResult, PluginSource } from '../../types';
import { cloudProviders } from '../cloud/cloudRegistry';
import { CloudCredentialsStore } from '../cloud/cloudCredentialsStore';
import { parseCloudFileName } from '../cloud/cloudFilename';
import { DailyRecommendError } from './dailyRecommendTypes';
import type { DailyRecommendAlgorithm, DailyRecommendItem, DailyRecommendStrategy } from './dailyRecommendTypes';

const MAX_CANDIDATES = 90;
const SEARCH_LIMIT = 20;
const SEARCH_CONCURRENCY = 4;
const MIN_DURATION_MS = 45_000;
/** 网盘候选全局上限（收集时计数截断） */
const CLOUD_MAX_CANDIDATES = 20;
/** 本地库候选全局上限（与网盘同量级，避免海量本地库挤占候选池） */
const LOCAL_MAX_CANDIDATES = 20;

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
  /** lx 插件按查询轮换内部平台（wy/kg/kw/tx），与 musicfree 单查询单请求次数一致 */
  lxSource?: LxSourceId;
};

function buildSearchTasks(algorithm: DailyRecommendAlgorithm, plugins: PluginSource[]): SearchTask[] {
  const tasks: SearchTask[] = [];
  let slot = 0;
  for (const strategy of algorithm.strategies) {
    const queries = strategy.queries || [];
    for (let qi = 0; qi < queries.length; qi++) {
      const plugin = plugins[(slot + qi) % plugins.length];
      let lxSource: LxSourceId | undefined;
      if (plugin.format === 'lx') {
        const srcs = plugin.sources?.length ? plugin.sources : ['kw'];
        lxSource = srcs[(slot + qi) % srcs.length] as LxSourceId;
      }
      tasks.push({ strategy, query: queries[qi], plugin, lxSource });
    }
    slot += queries.length;
  }
  return tasks;
}

/** lx 搜索条目 → PluginSearchResult 投影；lxItem 保留原始数据供 lx:// 播放链路使用 */
function lxItemToSearchResult(item: LxSearchResultItem): { song: DailyRecommendItem['song']; lxItem: LxSearchResultItem } {
  const [mm, ss] = String(item.interval || '').split(':').map(Number);
  const durationMs = Number.isFinite(mm) && Number.isFinite(ss) ? (mm * 60 + ss) * 1000 : 0;
  return {
    song: {
      id: item.songmid,
      title: item.name,
      artist: item.singer,
      album: item.albumName || '',
      coverUrl: item.img || '',
      duration: durationMs,
      platform: item.source,
      platformId: item.songmid,
      pluginId: '',
      rawData: item,
    },
    lxItem: item,
  };
}

/** 网盘搜索任务：已绑定账号（取首个）× 推荐歌手关键词 */
type CloudSearchTask = {
  provider: (typeof cloudProviders)[number];
  accountId: string;
  cred: Record<string, string>;
  keyword: string;
};

/**
 * 收集网盘候选（与移动端 _collectCloudCandidates 同构）：
 * 推荐歌手名作关键词，对「支持搜索且已绑定」的网盘并发 searchFiles 首页，
 * 文件名解析出歌手/歌名，仅当某段命中关键词才收；异常逐盘捕获记日志，不阻塞整体。
 */
async function collectCloudCandidates(
  algorithm: DailyRecommendAlgorithm,
  exclusionSet: Set<string>,
): Promise<Array<{ key: string; item: DailyRecommendItem; score: number }>> {
  const out: Array<{ key: string; item: DailyRecommendItem; score: number }> = [];
  const seen = new Set<string>();

  const artists = (algorithm.profile?.top_artists || [])
    .map(a => normalizeText(a.name))
    .filter(Boolean)
    .slice(0, 3);
  if (artists.length === 0) return out;

  const tasks: CloudSearchTask[] = [];
  for (const provider of cloudProviders) {
    if (!provider.supportsSearch) continue;
    const accounts = await CloudCredentialsStore.instance.accountsFor(provider.id);
    if (accounts.length === 0) continue;
    const account = accounts[0];
    for (const keyword of artists) {
      tasks.push({ provider, accountId: account.accountId, cred: account.cred, keyword });
    }
  }
  if (tasks.length === 0) return out;

  await mapWithLimit(tasks, SEARCH_CONCURRENCY, async (task) => {
    if (out.length >= CLOUD_MAX_CANDIDATES) return;
    try {
      const result = await task.provider.searchFiles(task.cred, task.keyword);
      const files = result?.files || [];
      files.forEach((file, rank) => {
        if (out.length >= CLOUD_MAX_CANDIDATES) return;
        if (file.isDir || !file.isAudio) return;
        const parts = parseCloudFileName(file.name);
        const normTitle = normalizeText(parts.title);
        const normArtist = normalizeText(firstArtist(parts.artist || ''));
        // 仅当歌名或歌手段（取 firstArtist）命中推荐歌手关键词才收
        if (normTitle !== task.keyword && normArtist !== task.keyword) return;
        if (!normTitle) return;
        const key = `${normTitle}|${normArtist}`;
        if (exclusionSet.has(key)) return;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({
          key,
          // 与插件打分同尺度，+0.05 偏置：同 key 竞争时网盘略优先
          score: (1 - rank / Math.max(files.length, 1)) * 0.5 + 0.05,
          item: {
            // 兼容 PluginSearchResult 形状的占位对象：展示走 cloudCtx 载荷
            song: {
              id: file.id,
              title: parts.title,
              name: parts.title,
              artist: parts.artist || task.keyword,
              album: '',
              coverUrl: '',
              duration: 0,
              platform: task.provider.id,
              platformId: file.id,
              pluginId: '',
            },
            reason: `来自${task.provider.displayName}网盘`,
            strategyId: 'cloud',
            pluginName: task.provider.displayName,
            cloudCtx: {
              providerId: task.provider.id,
              accountId: task.accountId,
              providerName: task.provider.displayName,
              fileJson: JSON.stringify(file.toJson()),
            },
          },
        });
      });
    } catch (e) {
      console.warn(`[dailyRecommend] 网盘候选搜索失败（${task.provider.displayName}）:`, e);
    }
  });

  return out;
}

/**
 * 收集本地库候选（与网盘候选同构）：库内歌曲的歌手段或歌名命中推荐歌手才收；
 * 分数与网盘候选同尺度（+0.05 偏置），同 key 竞争时同池优先级一致。
 */
function collectLocalCandidates(
  algorithm: DailyRecommendAlgorithm,
  exclusionSet: Set<string>,
  localSongs: LibrarySong[],
): Array<{ key: string; item: DailyRecommendItem; score: number }> {
  const out: Array<{ key: string; item: DailyRecommendItem; score: number }> = [];
  const keywords = (algorithm.profile?.top_artists || [])
    .map(a => normalizeText(a.name))
    .filter(Boolean)
    .slice(0, 3);
  if (keywords.length === 0 || localSongs.length === 0) return out;

  const keywordSet = new Set(keywords);
  const seen = new Set<string>();
  const hits: Array<{ song: LibrarySong; key: string }> = [];
  for (const song of localSongs) {
    if (hits.length >= LOCAL_MAX_CANDIDATES) break;
    if (!song?.path || !song.title) continue;
    const normTitle = normalizeText(song.title);
    if (!normTitle) continue;
    // 与插件候选一致：短于 45s 的曲目不参与
    if (song.duration > 0 && song.duration * 1000 < MIN_DURATION_MS) continue;
    const artistSegs = (song.artist || '')
      .split(/[、,/&]/)
      .map(seg => normalizeText(seg))
      .filter(Boolean);
    if (!artistSegs.some(seg => keywordSet.has(seg)) && !keywordSet.has(normTitle)) {
      continue;
    }
    const key = `${normTitle}|${normalizeText(firstArtist(song.artist || ''))}`;
    if (exclusionSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    hits.push({ song, key });
  }

  hits.forEach(({ song, key }, rank) => {
    out.push({
      key,
      score: (1 - rank / Math.max(hits.length, 1)) * 0.5 + 0.05,
      item: {
        song: {
          id: song.path,
          title: song.title || '',
          name: song.title ?? '',
          artist: song.artist || '未知歌手',
          album: song.album || '',
          coverUrl: song.cover_thumb_path || '',
          duration: song.duration * 1000,
          platform: 'local',
          platformId: song.path,
          pluginId: '',
        },
        reason: '来自本地音乐',
        strategyId: 'local',
        pluginName: '本地音乐',
        localPath: song.path,
      },
    });
  });
  return out;
}

/** 是否存在「支持搜索且已绑定」的网盘（无插件时判断是否仍可生成日推）。 */
export async function anyBoundSearchableDrive(): Promise<boolean> {
  for (const provider of cloudProviders) {
    if (!provider.supportsSearch) continue;
    try {
      if ((await CloudCredentialsStore.instance.accountsFor(provider.id)).length > 0) {
        return true;
      }
    } catch {
      /* 单盘失败不阻塞判断 */
    }
  }
  return false;
}

export async function executeDailyRecommend(
  algorithm: DailyRecommendAlgorithm,
  batch = 0,
  localSongs: LibrarySong[] = [],
): Promise<DailyRecommendItem[]> {
  const enabled = getStoredPlugins()
    .filter(p => p.enabled && (p.format === 'musicfree' || p.format === 'lx'))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const probeKeyword = algorithm.strategies.find(s => s.queries.length > 0)?.queries[0] ?? '热门音乐';
  const alive = await Promise.all(enabled.map(p => probePluginAlive(p, probeKeyword)));
  const plugins: PluginSource[] = enabled.filter((_, i) => alive[i]);

  const exclusionSet = new Set(
    (algorithm.exclusions?.songs || [])
      .filter(s => s.title)
      .map(s => `${normalizeText(s.title)}|${normalizeText(firstArtist(s.artist))}`),
  );

  const tasks = plugins.length > 0 ? buildSearchTasks(algorithm, plugins) : [];
  const searchResults = await mapWithLimit(tasks, SEARCH_CONCURRENCY, async (task) => {
    if (task.plugin.format === 'lx' && task.lxSource) {
      const r = await lxSearch(task.lxSource, task.query, 1, SEARCH_LIMIT);
      return { task, results: r.list.map(lxItemToSearchResult) };
    }
    const results = await pluginSearch(task.plugin, task.query, 1, SEARCH_LIMIT);
    return { task, results: results.map(song => ({ song, lxItem: undefined })) };
  });

  const best = new Map<string, { item: DailyRecommendItem; score: number }>();
  for (const entry of searchResults) {
    if (!entry) continue;
    const { task, results } = entry;
    results.forEach(({ song, lxItem }, rank) => {
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
            lxItem,
          },
        });
      }
    });
  }

  // 插件候选收集完成后收集网盘候选并并入同一候选池（同 key 按分数竞争）；
  // 无可用插件时也可跑网盘收集，仅在两者皆空时提前返回
  const cloudEntries = await collectCloudCandidates(algorithm, exclusionSet);
  for (const entry of cloudEntries) {
    const prev = best.get(entry.key);
    if (!prev || entry.score > prev.score) {
      best.set(entry.key, { score: entry.score, item: entry.item });
    }
  }

  // 本地库候选并入候选池（同 key 按分数竞争）：无插件/网盘时本地兜底
  const localEntries = collectLocalCandidates(algorithm, exclusionSet, localSongs);
  for (const entry of localEntries) {
    const prev = best.get(entry.key);
    if (!prev || entry.score > prev.score) {
      best.set(entry.key, { score: entry.score, item: entry.item });
    }
  }
  if (best.size === 0) {
    return [];
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
    let hits: PluginSearchResult[] = [];
    if (source.format === 'lx') {
      // lx 插件无 JS search 方法，走内置 lx_search 探测
      const lxSource = (source.sources?.[0] ?? 'kw') as LxSourceId;
      const r = await withProbeTimeout(lxSearch(lxSource, keyword, 1, 1), ALIVE_PROBE_TIMEOUT_MS);
      hits = r.list.map(item => lxItemToSearchResult(item).song);
    } else {
      hits = await withProbeTimeout(pluginSearch(source, keyword, 1, 1), ALIVE_PROBE_TIMEOUT_MS);
    }
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