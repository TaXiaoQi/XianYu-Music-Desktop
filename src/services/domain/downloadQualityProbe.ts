/**
 * 在线下载服务 · 音质探测（叶子）。
 *
 * 探测歌曲各音质档位是否真实可下载：对每个候选档位调用一次直链解析（复用下载
 * 流程的同一套解析函数，天然继承“无损被静默降级为 mp3 则视为不可用”的校验），
 * 并把能拿到有效 URL 的档位标为可用，同时一并返回已解析直链供下载复用。
 *
 * 依赖 downloadQualityResolver 的上下文准备与逐档解析，无循环依赖。
 */
import type { QualityKey, Song } from '../../types';
import { ALL_QUALITY_KEYS } from '../../types';
import { isBakaPlugin } from './pluginEngine';
import {
  parseLxPath,
  resolveLxCachedInfo,
  resolveLxUrlViaRust,
} from './lxUrlResolver';
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

/** 音质探测结果 */
export interface ProbeQualityResult {
  /** 实测可下载的档位（按 rank 升序，与弹窗展示顺序一致） */
  available: QualityKey[];
  /**
   * 探测过程中已解析出的直链，键为档位。
   * 下载时透传给 downloadSong 的 preResolvedUrls，避免重复请求同一直链。
   */
  resolvedUrls: Partial<Record<QualityKey, string>>;
}

/** 探测选项 */
export interface ProbeQualityOptions {
  /** 中止信号：弹窗关闭或切歌时中止探测 */
  signal?: AbortSignal;
  /** 并发探测数（默认 4），避免 12 档全并发打爆音源 */
  concurrency?: number;
  /** 每档实测完成的增量回调：起播与菜单可实时消费已解析直链，无需等待整轮探测结束 */
  onProgress?: (url: string, quality: QualityKey) => void;
}

/**
 * 探测歌曲各音质档位是否真实可下载。
 *
 * 背景：插件声明的音质列表（lx 的 `_types` / MF 的 `supportedQualities`）
 * 只表示"插件或该音源平台理论上支持这些档位"，不代表当前这首歌真的能解析出直链。
 * 常见表现是弹窗显示 Hi-Res 可选，点下载后所有无损档位返回空链接。
 *
 * @param song 目标歌曲（需为 lx:// 或 plugin:// 在线歌曲）
 * @param declaredQualities 插件声明的档位列表，作为探测上界；为空时不探测，避免展示未声明的无效档位
 * @param options 中止信号与并发度
 */
export async function probeDownloadableQualities(
  song: Song,
  declaredQualities: QualityKey[] | null,
  options?: ProbeQualityOptions,
): Promise<ProbeQualityResult> {
  const empty: ProbeQualityResult = { available: [], resolvedUrls: {} };

  if (!isDownloadableOnlineSong(song)) return empty;
  if (options?.signal?.aborted) return empty;

  // 探测范围：插件声明之外的档位无需探测，插件根本不支持
  const targets = (declaredQualities && declaredQualities.length > 0)
    ? ALL_QUALITY_KEYS.filter(k => declaredQualities.includes(k))
    : [];
  if (targets.length === 0) return empty;

  // 构造一次解析上下文并在所有档位间复用，避免重复定位插件 / 重建 songInfo。
  // quality 参数只用于生成候选列表，这里探测自带完整档位列表，传任意值即可。
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
      // 用完整解析拿插件上报的实际音质（actualQuality），而不是只取 URL。
      // 否则咪咕等音源把 hires/flac24bit 等高请求档实际返回 320k/mp3 时，
      // 探测会仍以请求档 q 登记为可用，导致音质菜单显示高档位、实际却是低档。
      const r = await resolvePluginAudioForQuality(ctx as PluginResolveContext, q);
      return r?.url ? { url: r.url, quality: r.quality } : null;
    }
    const r = await resolveLxAudioForQuality(ctx as ResolveDownloadContext, q);
    return r?.url ? { url: r.url, quality: r.quality } : null;
  };

  const resolvedUrls: Partial<Record<QualityKey, string>> = {};

  // [Baka 插件音质信任模式] 直接信任插件声明的档位（baka 行为），省去逐档 track_v2
  // 网络请求：只实测其中最高档一次，供起播/下载预解析复用；其余档位按声明直接列为可用。
  // 最高档实测失败时回退到逐档实测，避免音质菜单虚高档位。
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
          // 最高档实际返回的档位与请求档一致（未降级）时才信任声明档位；
          // 若最高档被降级（如咪咕把 hires/atmos/atmos_plus 全部降为 flac24bit），
          // 直接信任声明会造成档位虚高，回退逐档实测让各档塌缩到真实档位。
          if (topResolved.quality === bakaTopKey) {
            resolvedUrls[topResolved.quality] = topResolved.url;
            options?.onProgress?.(topResolved.url, topResolved.quality);
            return { available: targets, resolvedUrls };
          }
          console.warn(`[Probe] Baka 插件最高档 ${bakaTopKey} 实际返回 ${topResolved.quality}，回退逐档实测`);
        } else {
          console.warn(`[Probe] Baka 插件最高档 ${bakaTopKey} 未解析到直链，回退逐档实测`);
        }
      } else {
        return { available: targets, resolvedUrls };
      }
    }
  }

  // worker-pool 并发：多个 worker 从共享队列取档位，控制同时在飞的请求数
  const queue = [...targets];
  // 默认并发度降为 2：在线音源普遍有频率限制，4 并发容易触发风控（如酷狗"请求过于频繁"）。
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 2, queue.length));

  const worker = async () => {
    for (;;) {
      if (options?.signal?.aborted) return;
      const q = queue.shift();
      if (!q) return;

      try {
        // 返回 { url, quality }，其中 quality 为插件/落雪实际报告的档位（可能低于请求档 q）
        const resolved = await resolveUrl(q);
        // 结果回来时可能已中止，丢弃避免污染
        if (options?.signal?.aborted) return;
        // 以实际返回的档位登记，而非请求档 q：咪咕把 hires/atmos/atmos_plus 等高请求
        // 实际降级为同一档（如 flac24bit）时，多个请求档会塌缩到同一实际档，
        // 音质菜单只显示真实可得的档位，杜绝档位虚高与体积重复（多个档位共用同一 URL）。
        if (resolved?.url) {
          resolvedUrls[resolved.quality] = resolved.url;
          options?.onProgress?.(resolved.url, resolved.quality);
        }
      } catch (e: any) {
        const msg = e?.message || String(e);
        // 单档位失败不影响其他档位
        console.warn(`[Probe] ${q} 探测失败:`, msg);
        // 若触发全局风控（请求过于频繁），停止后续档位探测，避免进一步封禁
        if (/请求过于频繁|rate.?limit|too many requests|频繁|frequent/i.test(msg)) {
          console.warn(`[Probe] 检测到风控，停止剩余 ${queue.length} 个档位的探测`);
          queue.length = 0;
          throw new Error(msg);
        }
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  if (options?.signal?.aborted) return empty;

  // [lx:// 协议 Rust 兜底] LX 协议歌曲单档解析全部失败时，回退到 Rust 后端
  // 批量音质解析，避免 JS 引擎异常导致探测显示 0 档可用。
  if (!isPlugin && Object.keys(resolvedUrls).length === 0) {
    const path = song.cue_source_path || song.path;
    const pathInfo = parseLxPath(path || '');
    const cachedInfo = pathInfo ? resolveLxCachedInfo(song, pathInfo.source, pathInfo.songmid) : null;
    if (cachedInfo) {
      const rustResult = await resolveLxUrlViaRust(cachedInfo, targets);
      if (rustResult?.url) {
        resolvedUrls[rustResult.quality] = rustResult.url;
        options?.onProgress?.(rustResult.url, rustResult.quality);
      }
    }
  }

  // [QQ/网易云插件原生适配] 插件全部档位解析失败时不借用 LX 音源兜底：
  // 探测结果如实反映插件自身能力，解析失败原因由插件错误透出。

  const available = ALL_QUALITY_KEYS.filter(k => Boolean(resolvedUrls[k]));

  return { available, resolvedUrls };
}