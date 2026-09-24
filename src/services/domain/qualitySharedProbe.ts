import type { QualityKey, Song } from '../../types';
import { ALL_QUALITY_KEYS, resolveOnlinePlayQuality } from '../../types';
import {
  isDownloadableOnlineSong,
  probeDownloadableQualities,
} from './downloadService';
import { isPluginSong } from './downloadFormat';
import {
  ResolveDownloadContext,
  PluginResolveContext,
  prepareResolveContext,
  preparePluginResolveContext,
  resolveLxAudioForQuality,
  resolvePluginAudioForQuality,
} from './downloadQualityResolver';

export interface SharedQualityProbe {
  songKey: string;
  declaredQualities: QualityKey[] | null;
  resolvedUrls: Partial<Record<QualityKey, string>>;
  done: boolean;
  seeded?: boolean;
  startAt: number;
  failAt: number | null;
  trustedDeclared?: QualityKey[];
  requestedUrls?: Partial<Record<QualityKey, string>>;
  _requestedPending?: Set<QualityKey>;
  _subscribers: Set<() => void>;
  _controller: AbortController;
}

const PROBE_TTL_MS = 60_000;
const PROBE_FAIL_TTL_MS = 3_000;

const _sharedProbes = new Map<string, SharedQualityProbe>();

export function getSongKey(song: Pick<Song, 'cue_source_path' | 'path'>): string {
  return song.cue_source_path || song.path || '';
}

function notifyProbeListeners(probe: SharedQualityProbe): void {
  for (const fn of probe._subscribers) {
    try { fn(); } catch { /* 订阅者异常不影响其他订阅者 */ }
  }
}

function pruneDoneProbes(): void {
  const now = Date.now();
  for (const [key, probe] of _sharedProbes) {
    const failExpired = probe.failAt != null && now - probe.failAt > PROBE_FAIL_TTL_MS;
    const generalExpired = now - probe.startAt > PROBE_TTL_MS;
    if (probe.done && (failExpired || generalExpired)) {
      _sharedProbes.delete(key);
    }
  }
}

function launchProbeRound(
  probe: SharedQualityProbe,
  song: Song,
  declaredQualities: QualityKey[] | null,
): void {
  void (async () => {
    try {
      await probeDownloadableQualities(song, declaredQualities, {
        signal: probe._controller.signal,
        onProgress: (url, quality) => {
          probe.resolvedUrls[quality] = url;
          notifyProbeListeners(probe);
        },
        onTrust: (declared) => {
          probe.trustedDeclared = declared;
          notifyProbeListeners(probe);
        },
      });
    } catch (e: any) {
      console.warn('[SharedProbe] 音质探测失败:', e?.message || e);
    } finally {
      probe.done = true;
      probe.seeded = false;
      if (Object.keys(probe.resolvedUrls).length === 0) {
        probe.failAt = Date.now();
      }
      notifyProbeListeners(probe);
    }
  })();
}

export async function ensureSharedQualityProbe(
  song: Song,
  declaredQualities: QualityKey[] | null,
  opts?: { full?: boolean },
): Promise<SharedQualityProbe | null> {
  const full = opts?.full ?? false;
  if (!isDownloadableOnlineSong(song)) return null;
  const songKey = getSongKey(song);
  if (!songKey) return null;

  pruneDoneProbes();

  const existing = _sharedProbes.get(songKey);
  if (existing) {
    if (!existing.done) return existing;
    if (existing.failAt != null && Date.now() - existing.failAt <= PROBE_FAIL_TTL_MS) {
      return existing;
    }
    if (Object.keys(existing.resolvedUrls).length > 0 && !existing.seeded) return existing;
    if (existing.seeded && Object.keys(existing.resolvedUrls).length > 0) {
      // 非全量调用（播放解析）直接复用种子结果，避免反复全档扫描
      if (!full) return existing;
      existing.seeded = false;
      existing.done = false;
      existing.startAt = Date.now();
      existing.failAt = null;
      launchProbeRound(existing, song, declaredQualities);
      return existing;
    }
    _sharedProbes.delete(songKey);
  }

  // 非全量调用且无现成结果时不发起新扫描，走调用方自身的单档解析兜底
  if (!full) return null;

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
    failAt: null,
    _subscribers: new Set(),
    _controller: new AbortController(),
  };
  _sharedProbes.set(songKey, probe);

  launchProbeRound(probe, song, declaredQualities);

  return probe;
}

export function seedSharedProbeUrl(
  song: Song,
  quality: QualityKey,
  url: string,
): void {
  const songKey = getSongKey(song);
  if (!songKey || !url) return;
  pruneDoneProbes();
  const existing = _sharedProbes.get(songKey);
  if (existing) {
    if (!existing.done || !existing.seeded) return;
    if (!existing.resolvedUrls[quality]) {
      existing.resolvedUrls[quality] = url;
      notifyProbeListeners(existing);
    }
    return;
  }
  _sharedProbes.set(songKey, {
    songKey,
    declaredQualities: null,
    resolvedUrls: { [quality]: url },
    done: true,
    seeded: true,
    startAt: Date.now(),
    failAt: null,
    _subscribers: new Set(),
    _controller: new AbortController(),
  });
}

export function onSharedProbeUpdate(
  probe: SharedQualityProbe,
  fn: () => void,
): () => void {
  probe._subscribers.add(fn);
  return () => { probe._subscribers.delete(fn); };
}

export function sharedProbeAvailable(probe: SharedQualityProbe): QualityKey[] {
  const measured = ALL_QUALITY_KEYS.filter(k => Boolean(probe.resolvedUrls[k]));
  const trusted = probe.trustedDeclared?.length ? probe.trustedDeclared : null;
  if (!trusted) return measured;
  const set = new Set([...measured, ...trusted]);
  return ALL_QUALITY_KEYS.filter(k => set.has(k));
}

export async function ensureProbeRequestedUrls(
  probe: SharedQualityProbe,
  song: Song,
  shown: QualityKey[],
): Promise<void> {
  const pending = probe._requestedPending ?? (probe._requestedPending = new Set());
  const need = shown.filter(q =>
    !probe.resolvedUrls[q]
    && !probe.requestedUrls?.[q]
    && !pending.has(q),
  );
  if (!need.length) return;
  need.forEach(q => pending.add(q));
  try {
    const isPlugin = isPluginSong(song);
    let ctx: ResolveDownloadContext | PluginResolveContext | null = null;
    try {
      ctx = isPlugin
        ? await preparePluginResolveContext(song, '320k')
        : await prepareResolveContext(song, '320k');
    } catch {
      return;
    }
    if (!ctx) return;
    const queue = [...need];
    const concurrency = 2;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      for (;;) {
        const q = queue.shift();
        if (!q) return;
        try {
          const r = isPlugin
            ? await resolvePluginAudioForQuality(ctx as PluginResolveContext, q)
            : await resolveLxAudioForQuality(ctx as ResolveDownloadContext, q);
          if (!r?.url) continue;
          probe.requestedUrls = { ...probe.requestedUrls, [q]: r.url };
          if (!probe.resolvedUrls[r.quality]) {
            probe.resolvedUrls[r.quality] = r.url;
          }
          notifyProbeListeners(probe);
        } catch (e: any) {
          console.warn(`[SharedProbe] 补解析 ${q} 失败:`, e?.message || e);
        }
      }
    }));
  } finally {
    need.forEach(q => pending.delete(q));
  }
}

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
    if (probe.resolvedUrls[top]) { off(); resolve(top); return; }
    if (probe.done) { off(); resolve(findBest()); }
  });
}