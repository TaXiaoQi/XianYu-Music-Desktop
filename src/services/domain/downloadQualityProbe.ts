import type { QualityKey, Song } from '../../types';
import { ALL_QUALITY_KEYS } from '../../types';
import { isBakaPlugin } from './pluginEngine';
import { getLastSandboxError } from './pluginSandboxManager';
import {
  isDownloadableOnlineSong,
  isPluginSong,
} from './downloadFormat';
import {
  ResolveDownloadContext,
  PluginResolveContext,
  prepareResolveContext,
  preparePluginResolveContext,
  resolveLxAudioForQuality,
  resolvePluginAudioForQuality,
} from './downloadQualityResolver';

export interface ProbeQualityResult {
  available: QualityKey[];
  resolvedUrls: Partial<Record<QualityKey, string>>;
}

// 沙箱日志中的鉴权失效特征（API密钥/卡密/401/403/熔断）
const AUTH_FAIL_RE = /API密钥|API\s*key|api[_\s-]?secret|\b40[13]\b|卡密|鉴权失效已临时熔断/i;

export interface ProbeQualityOptions {
  signal?: AbortSignal;
  concurrency?: number;
  onProgress?: (url: string, quality: QualityKey) => void;
  onTrust?: (declared: QualityKey[]) => void;
}

export async function probeDownloadableQualities(
  song: Song,
  declaredQualities: QualityKey[] | null,
  options?: ProbeQualityOptions,
): Promise<ProbeQualityResult> {
  const empty: ProbeQualityResult = { available: [], resolvedUrls: {} };

  if (!isDownloadableOnlineSong(song)) return empty;
  if (options?.signal?.aborted) return empty;

  const targets = (declaredQualities && declaredQualities.length > 0)
    ? ALL_QUALITY_KEYS.filter(k => declaredQualities.includes(k))
    : [];
  if (targets.length === 0) return empty;

  const isPlugin = isPluginSong(song);
  let ctx: ResolveDownloadContext | PluginResolveContext | null;
  try {
    ctx = isPlugin
      ? await preparePluginResolveContext(song, '320k')
      : await prepareResolveContext(song, '320k');
  } catch (e: any) {
    console.warn('[Probe] 构造解析上下文失败:', e?.message || e);
    return empty;
  }
  if (!ctx) return empty;

  if (options?.signal?.aborted) return empty;

  const resolveUrl = async (q: QualityKey): Promise<{ url: string; quality: QualityKey } | null> => {
    if (isPlugin) {
      const r = await resolvePluginAudioForQuality(ctx as PluginResolveContext, q);
      return r?.url ? { url: r.url, quality: r.quality } : null;
    }
    const r = await resolveLxAudioForQuality(ctx as ResolveDownloadContext, q);
    return r?.url ? { url: r.url, quality: r.quality } : null;
  };

  const resolvedUrls: Partial<Record<QualityKey, string>> = {};

  if (isPlugin) {
    const pluginCtx = ctx as PluginResolveContext;
    if (await isBakaPlugin(pluginCtx.pluginSource)) {
      const bakaTopKey = targets.reduce<QualityKey | null>(
        (acc, k) => (acc === null || ALL_QUALITY_KEYS.indexOf(k) > ALL_QUALITY_KEYS.indexOf(acc) ? k : acc),
        null,
      );
      if (bakaTopKey) {
        const topResolved = await resolveUrl(bakaTopKey).catch(() => null);
        if (topResolved?.url) {
          if (topResolved.quality === bakaTopKey) {
            resolvedUrls[topResolved.quality] = topResolved.url;
            options?.onProgress?.(topResolved.url, topResolved.quality);
            options?.onTrust?.(targets);
            return { available: targets, resolvedUrls };
          }
          console.warn(`[Probe] Baka 插件最高档 ${bakaTopKey} 实际返回 ${topResolved.quality}，回退逐档实测`);
        } else {
          console.warn(`[Probe] Baka 插件最高档 ${bakaTopKey} 未解析到直链，回退逐档实测`);
          // 最高档失败且沙箱日志显示鉴权失效时，逐档实测无意义，直接终止
          const topSandboxErr = getLastSandboxError();
          if (topSandboxErr && AUTH_FAIL_RE.test(topSandboxErr)) {
            console.warn(`[Probe] 沙箱日志检测到鉴权失效，跳过逐档实测: ${topSandboxErr}`);
            throw new Error(topSandboxErr);
          }
        }
      } else {
        return { available: targets, resolvedUrls };
      }
    }
  }

  const queue = [...targets];
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 2, queue.length));

  const worker = async () => {
    for (;;) {
      if (options?.signal?.aborted) return;
      const q = queue.shift();
      if (!q) return;

      try {
        const resolved = await resolveUrl(q);
        if (options?.signal?.aborted) return;
        if (resolved?.url) {
          resolvedUrls[resolved.quality] = resolved.url;
          options?.onProgress?.(resolved.url, resolved.quality);
        } else {
          // 插件内部吞掉 401 返回空时，从沙箱日志识别鉴权失效，停止剩余档位探测
          const sandboxErr = getLastSandboxError();
          if (sandboxErr && AUTH_FAIL_RE.test(sandboxErr)) {
            console.warn(`[Probe] 沙箱日志检测到鉴权失效，停止剩余 ${queue.length} 个档位的探测: ${sandboxErr}`);
            queue.length = 0;
            throw new Error(sandboxErr);
          }
        }
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.warn(`[Probe] ${q} 探测失败:`, msg);
        if (/请求过于频繁|rate.?limit|too many requests|频繁|frequent/i.test(msg)) {
          console.warn(`[Probe] 检测到风控，停止剩余 ${queue.length} 个档位的探测`);
          queue.length = 0;
          throw new Error(msg);
        }
        if (AUTH_FAIL_RE.test(msg)) {
          console.warn(`[Probe] 检测到鉴权失效，停止剩余 ${queue.length} 个档位的探测`);
          queue.length = 0;
          throw new Error(msg);
        }
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  if (options?.signal?.aborted) return empty;


  const available = ALL_QUALITY_KEYS.filter(k => Boolean(resolvedUrls[k]));

  return { available, resolvedUrls };
}