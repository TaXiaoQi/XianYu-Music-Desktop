/**
 * 共享同歌探测（起播先行 / 菜单后台补齐）
 *
 * 同一首在线歌曲可能被"起播解析 + 音质/下载菜单探测 + 下载弹窗探测"等多路
 * 同时请求各档位直链，每一档都会触发一次带网络往返的解析。这里把对同一首歌
 * 的探测收敛为「一轮」，由模块级缓存持有：
 *   - 起播链路（共享探测里的最高可用档位）→ 起播先行，等同歌探测复用结果
 *   - 音质菜单 / 下载弹窗 → 订阅增量结果 → 后台补齐其它档位
 *
 * probeDownloadableQualities 的 onProgress 回调驱动这里增量累积 resolvedUrls，
 * 无需等整轮探测结束即可消费，从而避免同歌并发重复请求。
 */
import type { QualityKey, Song } from '../types';
import { ALL_QUALITY_KEYS, resolveOnlinePlayQuality } from '../types';
import {
  isDownloadableOnlineSong,
  probeDownloadableQualities,
} from './downloadService';

/** 一轮共享探测的运行时状态 */
export interface SharedQualityProbe {
  /** 歌曲身份键（cue_source_path || path），同一首歌共用同一轮探测 */
  songKey: string;
  /** 探测声明的档位上界 */
  declaredQualities: QualityKey[] | null;
  /** 增量累积的已解析直链（键为实际上报档位），消费者可实时读取 */
  resolvedUrls: Partial<Record<QualityKey, string>>;
  /** 本轮探测是否已结束（无论成功与否） */
  done: boolean;
  /** 探测开始时间，用于过期清理 */
  startAt: number;
  /** 内部：订阅者（增量通知） */
  _subscribers: Set<() => void>;
  /** 内部：本轮探测的中止控制 */
  _controller: AbortController;
}

/** 探测缓存过期时间：过期的已完成探测在 TTL 内复用，过期后清理避免无限增长 */
const PROBE_TTL_MS = 60_000;

const _sharedProbes = new Map<string, SharedQualityProbe>();

/** 歌曲身份键：起播、菜单、下载共用同一套探测 */
export function getSongKey(song: Pick<Song, 'cue_source_path' | 'path'>): string {
  return song.cue_source_path || song.path || '';
}

function notifyProbeListeners(probe: SharedQualityProbe): void {
  for (const fn of probe._subscribers) {
    try { fn(); } catch { /* 订阅者异常不影响其他订阅者 */ }
  }
}

/** 清理过期已完成探测，避免缓存无限增长 */
function pruneDoneProbes(): void {
  const now = Date.now();
  for (const [key, probe] of _sharedProbes) {
    if (probe.done && now - probe.startAt > PROBE_TTL_MS) {
      _sharedProbes.delete(key);
    }
  }
}

/**
 * 确保同一首歌的共享探测在跑（未跑则后台启动），返回共享探测状态。
 * 并发调用（起播 + 菜单 + 下载）会命中同一轮探测，避免重复请求。
 *
 * @param song 目标在线歌曲
 * @param declaredQualities 插件声明的档位列表（探测上界）
 * @returns 共享探测状态；非在线歌曲或无法探测时返回 null
 */
export async function ensureSharedQualityProbe(
  song: Song,
  declaredQualities: QualityKey[] | null,
): Promise<SharedQualityProbe | null> {
  if (!isDownloadableOnlineSong(song)) return null;
  const songKey = getSongKey(song);
  if (!songKey) return null;

  pruneDoneProbes();

  const existing = _sharedProbes.get(songKey);
  if (existing) {
    // 已存在探测时复用其结果，仅当本轮确定结束时才需重启；运行中的直接复用
    if (!existing.done) return existing;
    // 已完成的探测也可复用（避免再次请求），直接返回既成结果
    return existing;
  }

  // 开始新一轮探测前，中止其它仍在跑的旧歌探测，避免多首歌同时在探测
  // （保持与底部栏"切歌即中止上一首探测"一致，收敛带宽占用）。
  for (const [key, probe] of _sharedProbes) {
    if (!probe.done && key !== songKey) {
      probe._controller.abort();
    }
  }

  const probe: SharedQualityProbe = {
    songKey,
    declaredQualities,
    resolvedUrls: {},
    done: false,
    startAt: Date.now(),
    _subscribers: new Set(),
    _controller: new AbortController(),
  };
  _sharedProbes.set(songKey, probe);

  // 后台启动探测：onProgress 驱动增量累积 + 通知，最终置 done
  void (async () => {
    try {
      await probeDownloadableQualities(song, declaredQualities, {
        signal: probe._controller.signal,
        onProgress: (url, quality) => {
          probe.resolvedUrls[quality] = url;
          notifyProbeListeners(probe);
        },
      });
    } catch (e: any) {
      console.warn('[SharedProbe] 音质探测失败:', e?.message || e);
    } finally {
      probe.done = true;
      notifyProbeListeners(probe);
    }
  })();

  return probe;
}

/** 订阅探测增量更新；返回取消订阅函数 */
export function onSharedProbeUpdate(
  probe: SharedQualityProbe,
  fn: () => void,
): () => void {
  probe._subscribers.add(fn);
  return () => { probe._subscribers.delete(fn); };
}

/** 当前已实测可用的档位（按 rank 升序，与菜单展示顺序一致） */
export function sharedProbeAvailable(probe: SharedQualityProbe): QualityKey[] {
  return ALL_QUALITY_KEYS.filter(k => Boolean(probe.resolvedUrls[k]));
}

/**
 * 【起播先行】等待共享探测解析出「首选目标档位」：
 *   - 探测运行期间：只在候选列表首位（最高优先，含回退方向）已解析时才返回，
 *     避免抢先用低档位导致音质虚降；
 *   - 探测结束仍未解析出首选档时：返回候选中实测可用的最高档（与
 *     resolveOnlinePlayQuality 的回退语义一致），否则返回 null 走旧链路兜底。
 */
export function sharedProbeAwaitTop(
  probe: SharedQualityProbe,
  requestedQuality: QualityKey,
  fallbackBehavior: 'lower' | 'higher' | 'pause',
  availableQualities: QualityKey[] | null,
): Promise<QualityKey | null> {
  const candidates = resolveOnlinePlayQuality(requestedQuality, availableQualities, fallbackBehavior);
  const top = candidates[0];
  const findBest = () => candidates.find(q => Boolean(probe.resolvedUrls[q])) ?? null;

  if (!top) return Promise.resolve(null);
  if (probe.resolvedUrls[top]) return Promise.resolve(top);
  if (probe.done) return Promise.resolve(findBest());

  return new Promise((resolve) => {
    const off = onSharedProbeUpdate(probe, () => {
      if (probe.resolvedUrls[top]) { off(); resolve(top); return; }
      if (probe.done) { off(); resolve(findBest()); }
    });
    // 订阅后立刻复查一次，避免竞态漏掉已完成的更新
    if (probe.resolvedUrls[top]) { off(); resolve(top); return; }
    if (probe.done) { off(); resolve(findBest()); }
  });
}