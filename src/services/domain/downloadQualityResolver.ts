/**
 * 在线下载服务 · 音质解析层。
 *
 * 汇聚在线直链解析的上下文准备与逐档位解析：统一直链结构、定位插件、
 * 解析候选音质列表、逐档解析直链（含 Baka/旧 MF 键映射与无损降级校验）、
 * 按回退策略命中实际档位、以及多档并发探测。
 *
 * 同时导出被 downloadExecutor（下载编排）复用的上下文/解析函数，
 * 避免执行层重复实现直链获取逻辑。
 */
import type {
  DownloadQuality,
  DownloadQualityFallbackBehavior,
  OnlineQualityFallbackBehavior,
  Song,
  QualityKey,
} from '../../types';
import {
  ALL_QUALITY_KEYS,
  qualityKeyToBakaPluginQuality,
  qualityKeyToBakaLegacyQuality,
  qualityKeyToMfQuality,
  resolveOnlinePlayQuality,
} from '../../types';
import {
  isDegradedLossless,
  resolveActualQuality,
} from './audioQualityVerify';
import {
  getStoredPlugins,
  pluginGetBakaMusicInfo,
  pluginGetCover,
  pluginGetMusicInfo,
  isBakaPlugin,
} from './pluginEngine';
import { ensureLxPluginInstance } from './lxPluginEngine';
import {
  parseLxPath,
  resolveLxCachedInfo,
  findLxPluginForSource,
  buildLxSongInfo,
  resolveLxUrlForSingleQuality,
  resolveLxUrlViaRust,
} from './lxUrlResolver';
import { sanitizeMediaUrl } from '../../utils/mediaUrl';
import {
  type LxQuality,
  qualityToDownloadCandidates,
  isDownloadableOnlineSong,
  isPluginSong,
  extFromUrl,
} from './downloadFormat';

/** 统一在线音频直链解析结果：播放和下载共用同一套单档解析逻辑 */
export interface ResolvedOnlineQualityUrl {
  quality: QualityKey;
  url: string;
  headers?: Record<string, string> | null;
  lyricsRaw?: string;
  coverThumbPath?: string;
  ekey?: string;
  cek?: string;
}

/** 解析出的候选音源直链上下文（供逐档位下载回退使用） */
export interface ResolveDownloadContext {
  matchedPlugin: any;
  lxSource: string;
  baseSongInfo: any;
  candidates: LxQuality[];
}

/**
 * 准备解析上下文：定位插件、构造 songInfo、按目标音质生成候选档位列表。
 * 真正的直链解析交给 resolveLxAudioForQuality 逐档位进行，以便下载失败时回退。
 */
export async function prepareResolveContext(
  song: Song,
  quality: DownloadQuality,
  fallbackBehavior: DownloadQualityFallbackBehavior = 'lower',
): Promise<ResolveDownloadContext | null> {
  const path = song.cue_source_path || song.path;
  const pathInfo = parseLxPath(path || '');
  if (!pathInfo) return null;
  const { source: lxSource, songmid } = pathInfo;

  const matchedPlugin = findLxPluginForSource(lxSource);
  if (!matchedPlugin) {
    throw new Error('未启用任何落雪音源插件，请先在设置中启用');
  }

  await ensureLxPluginInstance(matchedPlugin);
  const cachedInfo = resolveLxCachedInfo(song, lxSource, songmid);
  const baseSongInfo = buildLxSongInfo(song, songmid, lxSource, cachedInfo);

  return {
    matchedPlugin,
    lxSource,
    baseSongInfo,
    candidates: qualityToDownloadCandidates(quality, fallbackBehavior),
  };
}

/**
 * 解析单个落雪档位的真实音源直链；无有效链接返回 null。
 *
 * 额外校验：部分 lx 插件对没有对应版权的歌曲会「静默降级」，例如请求 flac/flac24bit
 * 时直接返回一个 .mp3 直链。若不校验，就会把降级后的 mp3 用 .flac 扩展名保存，
 * 表现为「下载无损却比高品还小」。这里通过 URL 扩展名识别降级并跳过该档位。
 *
 * 音质上报采用插件实际报告的档位（type 字段），而非请求档位：
 * 插件可能把 320k 请求降级为 128k，若不采用其报告档位，底部栏会显示一个高于实际播放的音质。
 */
export async function resolveLxAudioForQuality(
  ctx: ResolveDownloadContext,
  q: LxQuality,
): Promise<ResolvedOnlineQualityUrl | null> {
  const resolved = await resolveLxUrlForSingleQuality(
    ctx.matchedPlugin,
    ctx.lxSource,
    ctx.baseSongInfo,
    q,
  );
  if (!resolved) return null;
  const { url, quality: reportedQuality } = resolved;

  if (isDegradedLossless(q, url)) {
    console.warn(`[Download] ${q} 请求被音源降级为 ${extFromUrl(url)}，跳过该档位`);
    return null;
  }
  return { quality: resolveActualQuality(reportedQuality, url), url };
}

/** plugin:// 协议的解析上下文 */
export interface PluginResolveContext {
  pluginSource: any;
  pluginSearchResult: any;
  candidates: LxQuality[];
  /** 插件 musicItem 已预解析的 qualities 字段（若插件在搜索阶段返回了多音质直链） */
  preQualities?: Record<string, { url?: string; size?: number | string }>;
}

/**
 * 准备 plugin:// 协议的解析上下文：定位 MusicFree 插件、提取预解析的多音质信息。
 *
 * 与 LX 不同，MusicFree 插件搜索结果不强制带 `_types`/多音质元信息，
 * 但部分插件会在 `rawData.qualities` 字段预填各音质直链，此函数会尝试提取以省去探测请求。
 */
export async function preparePluginResolveContext(
  song: Song,
  quality: DownloadQuality,
  fallbackBehavior: DownloadQualityFallbackBehavior = 'lower',
): Promise<PluginResolveContext | null> {
  const path = song.cue_source_path || song.path;
  if (!path || !path.startsWith('plugin://')) return null;

  const pluginSearchResult = song.rawData;
  if (!pluginSearchResult?.pluginId) return null;

  const plugins = getStoredPlugins();
  const pluginSource = plugins.find(p => p.id === pluginSearchResult.pluginId && p.enabled);
  if (!pluginSource) {
    throw new Error('该歌曲对应的插件未启用或已被移除');
  }

  // 部分插件在搜索阶段已填充 qualities 字段。
  // Baka 原生键：{ '320k': {url}, flac: {url}, ... }
  // Baka/MF 兼容键：{ low: {url}, standard: {url}, high: {url}, super: {url} }
  // 旧 MF 键：{ standard: {url}, high: {url}, lossless: {url} }
  const preQualities = pluginSearchResult.rawData?.qualities ?? undefined;

  return {
    pluginSource,
    pluginSearchResult,
    candidates: qualityToDownloadCandidates(quality, fallbackBehavior),
    preQualities,
  };
}

/**
 * 解析 plugin:// 协议下单个档位的真实音源直链。
 * 优先用预解析的 qualities 字段（无网络开销），否则调用插件的 getMediaSource。
 * 同样检测 lossless 被降级为 mp3 的情况并跳过该档位。
 */
export async function resolvePluginAudioForQuality(
  ctx: PluginResolveContext,
  q: LxQuality,
  includePlaybackExtras = false,
): Promise<ResolvedOnlineQualityUrl | null> {
  const nativeQuality = q;
  const bakaPluginQuality = qualityKeyToBakaPluginQuality(q);
  const bakaLegacyQuality = qualityKeyToBakaLegacyQuality(q);
  const mfLegacyQuality = qualityKeyToMfQuality(q);

  // 1) 优先使用预解析的 qualities 字段（仅对非 Baka 插件）：
  //    内部 12 档 → Baka 插件原生键（mgg→96k）→ Baka 旧兼容键 → MF 旧 lossless 键
  //    Baka 插件跳过此优化：预解析 qualities 不含 ekey/cek，加密音源必须走 getMediaSource 获取密钥
  const isBaka = await isBakaPlugin(ctx.pluginSource);
  if (!isBaka) {
    const preKeys = Array.from(new Set([
      nativeQuality,
      bakaPluginQuality,
      bakaLegacyQuality,
      mfLegacyQuality,
    ]));
    for (const key of preKeys) {
      const rawUrl = ctx.preQualities?.[key]?.url;
      const preUrl = sanitizeMediaUrl(rawUrl);
      if (!preUrl || !/^https?:/.test(preUrl)) continue;
      if (isDegradedLossless(q, preUrl)) {
        console.warn(`[Download][plugin] 预解析 ${q}(${key}) 被降级为 ${extFromUrl(preUrl)}，跳过该档位`);
        return null;
      }
      return { quality: resolveActualQuality(q, preUrl), url: preUrl };
    }
  }

  // 2) 调用插件 getMediaSource 获取直链（含 ekey/cek/headers 等加密音源信息）
  //    Baka 插件使用独立的 12 档音质方法，原版 MF 使用三档映射
  const musicInfo = isBaka
    ? await pluginGetBakaMusicInfo(ctx.pluginSource, ctx.pluginSearchResult, q)
    : await pluginGetMusicInfo(ctx.pluginSource, ctx.pluginSearchResult, q);
  const url = sanitizeMediaUrl(musicInfo?.url);
  if (!url || !/^https?:/.test(url)) return null;

  if (isDegradedLossless(q, url)) {
    console.warn(`[Download][plugin] ${q} 请求被音源降级为 ${extFromUrl(url)}，跳过该档位`);
    return null;
  }
  let coverThumbPath = musicInfo?.coverUrl;
  if (includePlaybackExtras && !ctx.pluginSearchResult?.cover_thumb_path && !coverThumbPath) {
    try {
      // 超时保护：封面获取不应阻塞播放起播，3 秒内未返回则放弃
      const coverTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
      coverThumbPath = await Promise.race([
        pluginGetCover(ctx.pluginSource, ctx.pluginSearchResult),
        coverTimeout,
      ]) ?? undefined;
    } catch { /* ignore cover error */ }
  }

  // 使用插件返回的实际音质（actualQuality），而非请求档位 q。
  // Baka 插件（QQ音乐/网易云等）在请求 flac 时可能仅能提供 320k，
  // 插件会在 actualQuality 中报告真实音质；若插件未报告则回退到请求档位。
  // resolveActualQuality 作为最终安全网：即使插件声称无损但 URL 扩展名为有损格式，也会修正。
  const reportedQuality = musicInfo?.actualQuality ?? q;
  const effectiveQuality = resolveActualQuality(reportedQuality, url);

  return {
    quality: effectiveQuality,
    url,
    headers: musicInfo?.headers ?? null,
    lyricsRaw: includePlaybackExtras ? musicInfo?.lyricsRaw : undefined,
    coverThumbPath: includePlaybackExtras ? coverThumbPath : undefined,
    ekey: musicInfo?.ekey,
    cek: musicInfo?.cek,
  };
}

/** 使用下载链路解析在线音频直链，并按播放回退策略返回实际命中的档位 */
export async function resolveOnlineQualityUrl(
  song: Song,
  requestedQuality: QualityKey,
  fallbackBehavior: OnlineQualityFallbackBehavior,
  availableQualities: QualityKey[] | null,
  preResolvedUrls?: Partial<Record<QualityKey, string>>,
  options?: { includePlaybackExtras?: boolean },
): Promise<ResolvedOnlineQualityUrl | null> {
  if (!isDownloadableOnlineSong(song)) return null;

  const isPlugin = isPluginSong(song);
  const ctx = isPlugin
    ? await preparePluginResolveContext(song, requestedQuality)
    : await prepareResolveContext(song, requestedQuality);
  if (!ctx) return null;

  const candidates = resolveOnlinePlayQuality(requestedQuality, availableQualities, fallbackBehavior);

  for (const q of candidates) {
    const preResolved = sanitizeMediaUrl(preResolvedUrls?.[q]);
    if (preResolved && /^https?:/.test(preResolved) && !isDegradedLossless(q, preResolved)) {
      // 命中预解析 URL 时，若需要播放附加信息且歌曲缺封面，补获封面。
      // 否则预解析路径跳过了 getMediaSource，封面永远拿不到，导致播放详情页无封面/背景。
      let coverThumbPath: string | undefined;
      if (options?.includePlaybackExtras && isPlugin && !song.cover_thumb_path) {
        const pluginCtx = ctx as PluginResolveContext;
        try {
          const coverTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
          coverThumbPath = await Promise.race([
            pluginGetCover(pluginCtx.pluginSource, pluginCtx.pluginSearchResult),
            coverTimeout,
          ]) ?? undefined;
        } catch { /* ignore cover error */ }
      }
      return {
        quality: resolveActualQuality(song.remote_actual_quality ?? q, preResolved),
        url: preResolved,
        headers: song.remote_headers ?? null,
        ekey: song.remote_ekey,
        cek: song.remote_cek,
        coverThumbPath,
      };
    }

    const resolved = isPlugin
      ? await resolvePluginAudioForQuality(ctx as PluginResolveContext, q, options?.includePlaybackExtras)
      : await resolveLxAudioForQuality(ctx as ResolveDownloadContext, q);
    if (resolved?.url) return resolved;
  }

  // [LX 播放兜底] 插件解析全部失败时回退到 Rust 后端批量音质解析。
  // 播放链路此前只走插件，插件沙箱/直链解析失败会导致整首歌无法播放；
  // Rust 侧走独立的音源实现，往往能解析出插件拿不到的直链。
  if (!isPlugin && ctx) {
    const path = song.cue_source_path || song.path;
    const pathInfo = parseLxPath(path || '');
    const cachedInfo = pathInfo ? resolveLxCachedInfo(song, pathInfo.source, pathInfo.songmid) : null;
    if (cachedInfo) {
      const rustResult = await resolveLxUrlViaRust(cachedInfo, candidates);
      if (rustResult?.url) {
        return {
          quality: rustResult.quality,
          url: rustResult.url,
          headers: null,
          ekey: undefined,
          cek: undefined,
        };
      }
    }
  }

  // [QQ/网易云插件原生适配] 不再借用 LX 音源兜底：插件自身的 getMediaSource
  // 解析失败（试听链/外链不可用等）时如实失败并透出插件错误，由起播失败行为
  // （跳过/停止）与 toast 处理，避免音质与音源来源不一致。

  return null;
}

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
 * 本函数对每个候选档位实际调用一次直链解析（复用下载流程的同一套解析函数，
 * 因此天然继承"无损被静默降级为 mp3 则视为不可用"的校验），
 * 只把真正拿到有效 URL 的档位标为可用。
 *
 * 解析出的直链一并返回，下载时可直接复用 —— 探测并非纯额外开销，
 * 而是把原本下载时才发的请求提前了。
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
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 4, queue.length));

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
        // 单档位失败不影响其他档位
        console.warn(`[Probe] ${q} 探测失败:`, e?.message || e);
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