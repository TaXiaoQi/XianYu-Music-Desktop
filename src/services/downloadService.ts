/**
 * 在线歌曲下载服务
 *
 * 负责：解析 lx:// 在线歌曲的真实音源直链（按音质映射 + 自动回退）、
 * 计算目标文件路径（扩展名以真实音源为准、命名冲突处理）、
 * 调用 Rust 命令流式下载，并可选下载歌词。
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { DownloadFileNameStyle, DownloadLyricsStyle, DownloadQuality, OnlineQualityFallbackBehavior, Song, QualityKey } from '../types';
import { downloadApi } from './tauri/downloadApi';
import type { EmbedMetadataRequestContract } from './tauri/contracts';
import {
  ALL_QUALITY_KEYS,
  ALL_QUALITY_KEYS_DESC,
  QUALITY_META,
  qualityKeyToBakaLegacyQuality,
  qualityKeyToBakaPluginQuality,
  qualityKeyToMfQuality,
  resolveOnlinePlayQuality,
} from '../types';
import {
  extFromUrl as extFromUrlShared,
  isDegradedLossless,
} from './audioQualityVerify';
import { usePlaybackStore } from '../features/playback/store';
import {
  getStoredPlugins,
  pluginGetCover,
  pluginGetLyric,
  pluginGetMusicInfo,
  pluginGetBakaMusicInfo,
  isBakaPlugin,
} from './pluginEngine';
import { ensureLxPluginInstance, lxPluginGetLyric, lxPluginGetPic } from './lxPluginEngine';
import {
  parseLxPath,
  resolveLxCachedInfo,
  findLxPluginForSource,
  buildLxSongInfo,
  resolveLxUrlForSingleQuality,
  resolveLxUrlViaRust,
} from './lxUrlResolver';
import { sanitizeMediaUrl } from '../utils/mediaUrl';

/** 统一音质档位（兼容 LX / MF）：插件支持多少，就显示多少 */
type LxQuality = QualityKey;

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

/**
 * 从目标音质向下降级，生成候选音质列表（用于自动回退）。
 * 基于 ALL_QUALITY_KEYS_DESC（12 档从高到低），从目标音质位置开始截取下半段。
 * 例：选 'master' → [master, atmos_plus, atmos, dolby, vinyl, hires, flac24bit, flac, 320k, 192k, 128k, mgg]
 *     选 '320k' → [320k, 192k, 128k, mgg]
 *     选 'flac'  → [flac, 320k, 192k, 128k, mgg]
 */
export function qualityToLxCandidates(quality: DownloadQuality): LxQuality[] {
  const q = (quality ?? '320k') as QualityKey;
  const startIdx = ALL_QUALITY_KEYS_DESC.indexOf(q);
  if (startIdx === -1) {
    // 未知音质：从 320k 开始向下降级
    const fallbackIdx = ALL_QUALITY_KEYS_DESC.indexOf('320k');
    return ALL_QUALITY_KEYS_DESC.slice(fallbackIdx);
  }
  return ALL_QUALITY_KEYS_DESC.slice(startIdx);
}

/** 判断是否为可下载的在线歌曲（lx:// 或 plugin:// 协议） */
export function isDownloadableOnlineSong(
  song: { path?: string; source_type?: string } | null | undefined,
): boolean {
  if (!song) return false;
  const path = song.path ?? '';
  return path.startsWith('lx://') || path.startsWith('plugin://');
}

/** 判断歌曲是否走 plugin:// 协议（MusicFree 插件音源） */
function isPluginSong(song: { cue_source_path?: string; path?: string }): boolean {
  const path = song.cue_source_path || song.path || '';
  return path.startsWith('plugin://');
}

/** 清洗文件名中的非法字符（Windows 与跨平台通用）——前端回退实现，权威实现在 Rust */
function sanitizeFileName(name: string): string {
  return name
    // eslint-disable-next-line no-control-regex -- 控制字符在文件名中非法，需主动剔除
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'download';
}

/**
 * 从 URL 推断文件扩展名（含点，如 ".flac"）；失败返回空串。
 * 复用 audioQualityVerify 的实现，与播放侧共用同一套判定。
 */
const extFromUrl = extFromUrlShared;

/** 根据命中的落雪档位推断扩展名兜底 */
function extFromQuality(quality: LxQuality): string {
  return QUALITY_META[quality]?.isLossless ? '.flac' : '.mp3';
}

/** 按样式拼接文件名主体（不含扩展名）——前端回退实现，权威实现在 Rust */
function buildFileNameBase(song: Song, style: DownloadFileNameStyle): string {
  const title = song.title || song.name || '未知歌曲';
  const artist = song.artist || '';
  const album = song.album || '';

  let parts: string[];
  switch (style) {
    case 'title-artist':
      parts = [title, artist];
      break;
    case 'title-artist-album':
      parts = [title, artist, album];
      break;
    case 'artist-title':
    default:
      parts = [artist, title];
      break;
  }

  const joined = parts.map((p) => p.trim()).filter(Boolean).join(' - ');
  return joined || title;
}

/** 构造下载文件名（不含目录）——前端回退实现，权威实现在 Rust */
function buildDownloadFileName(
  song: Song,
  url: string,
  hitQuality: LxQuality,
  keepSourceFilename: boolean,
  style: DownloadFileNameStyle = 'artist-title',
): string {
  const ext = extFromUrl(url) || extFromQuality(hitQuality);

  if (keepSourceFilename) {
    try {
      const u = new URL(url);
      const base = u.pathname.split('/').pop() || '';
      if (base && base.includes('.')) {
        return sanitizeFileName(decodeURIComponent(base.slice(0, base.lastIndexOf('.')))) + ext;
      }
    } catch {
      // fallthrough
    }
  }

  return sanitizeFileName(buildFileNameBase(song, style)) + ext;
}

/** 解析出的候选音源直链上下文（供逐档位下载回退使用） */
interface ResolveDownloadContext {
  matchedPlugin: any;
  lxSource: string;
  baseSongInfo: any;
  candidates: LxQuality[];
}

/**
 * 准备解析上下文：定位插件、构造 songInfo、按目标音质生成候选档位列表。
 * 真正的直链解析交给 resolveUrlForQuality 逐档位进行，以便下载失败时回退。
 */
async function prepareResolveContext(
  song: Song,
  quality: DownloadQuality,
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
    candidates: qualityToLxCandidates(quality),
  };
}

/**
 * 解析单个落雪档位的真实音源直链；无有效链接返回 null。
 *
 * 额外校验：部分 lx 插件对没有对应版权的歌曲会「静默降级」，例如请求 flac/flac24bit
 * 时直接返回一个 .mp3 直链。若不校验，就会把降级后的 mp3 用 .flac 扩展名保存，
 * 表现为「下载无损却比高品还小」。这里通过 URL 扩展名识别降级并跳过该档位。
 */
async function resolveLxAudioForQuality(
  ctx: ResolveDownloadContext,
  q: LxQuality,
): Promise<ResolvedOnlineQualityUrl | null> {
  const url = await resolveLxUrlForSingleQuality(
    ctx.matchedPlugin,
    ctx.lxSource,
    ctx.baseSongInfo,
    q,
  );
  if (!url) return null;

  if (isDegradedLossless(q, url)) {
    console.warn(`[Download] ${q} 请求被音源降级为 ${extFromUrl(url)}，跳过该档位`);
    return null;
  }
  return { quality: q, url };
}

async function resolveUrlForQuality(
  ctx: ResolveDownloadContext,
  q: LxQuality,
): Promise<string | null> {
  return (await resolveLxAudioForQuality(ctx, q))?.url ?? null;
}

/** plugin:// 协议的解析上下文 */
interface PluginResolveContext {
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
async function preparePluginResolveContext(
  song: Song,
  quality: DownloadQuality,
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
    candidates: qualityToLxCandidates(quality),
    preQualities,
  };
}

/**
 * 解析 plugin:// 协议下单个档位的真实音源直链。
 * 优先用预解析的 qualities 字段（无网络开销），否则调用插件的 getMediaSource。
 * 同样检测 lossless 被降级为 mp3 的情况并跳过该档位。
 */
async function resolvePluginAudioForQuality(
  ctx: PluginResolveContext,
  q: LxQuality,
  includePlaybackExtras = false,
): Promise<ResolvedOnlineQualityUrl | null> {
  const nativeQuality = q;
  const bakaPluginQuality = qualityKeyToBakaPluginQuality(q);
  const bakaLegacyQuality = qualityKeyToBakaLegacyQuality(q);
  const mfLegacyQuality = qualityKeyToMfQuality(q);

  // 1) 优先使用预解析的 qualities 字段：
  //    内部 12 档 → Baka 插件原生键（mgg→96k）→ Baka 旧兼容键 → MF 旧 lossless 键
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
    return { quality: q, url: preUrl };
  }

  // 2) 回退到插件 getMediaSource（传入 QualityKey，内部自动适配）
  //    Baka 插件使用独立的 12 档音质方法，原版 MF 使用三档映射
  const musicInfo = await isBakaPlugin(ctx.pluginSource)
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
      coverThumbPath = await pluginGetCover(ctx.pluginSource, ctx.pluginSearchResult) ?? undefined;
    } catch { /* ignore cover error */ }
  }

  return {
    quality: q,
    url,
    headers: musicInfo?.headers ?? null,
    lyricsRaw: includePlaybackExtras ? musicInfo?.lyricsRaw : undefined,
    coverThumbPath: includePlaybackExtras ? coverThumbPath : undefined,
    ekey: musicInfo?.ekey,
    cek: musicInfo?.cek,
  };
}

async function resolvePluginUrlForQuality(
  ctx: PluginResolveContext,
  q: LxQuality,
): Promise<string | null> {
  return (await resolvePluginAudioForQuality(ctx, q))?.url ?? null;
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
      return {
        quality: song.remote_actual_quality ?? q,
        url: preResolved,
        headers: song.remote_headers ?? null,
        ekey: song.remote_ekey,
        cek: song.remote_cek,
      };
    }

    const resolved = isPlugin
      ? await resolvePluginAudioForQuality(ctx as PluginResolveContext, q, options?.includePlaybackExtras)
      : await resolveLxAudioForQuality(ctx as ResolveDownloadContext, q);
    if (resolved?.url) return resolved;
  }

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
 * @param declaredQualities 插件声明的档位列表，作为探测上界；为空时回退全部档位
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
    : [...ALL_QUALITY_KEYS];
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

  const resolveUrl = (q: QualityKey): Promise<string | null> =>
    isPlugin
      ? resolvePluginUrlForQuality(ctx as PluginResolveContext, q)
      : resolveUrlForQuality(ctx as ResolveDownloadContext, q);

  const resolvedUrls: Partial<Record<QualityKey, string>> = {};

  // worker-pool 并发：多个 worker 从共享队列取档位，控制同时在飞的请求数
  const queue = [...targets];
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 4, queue.length));

  const worker = async () => {
    for (;;) {
      if (options?.signal?.aborted) return;
      const q = queue.shift();
      if (!q) return;

      try {
        const url = await resolveUrl(q);
        // 结果回来时可能已中止，丢弃避免污染
        if (options?.signal?.aborted) return;
        if (url) resolvedUrls[q] = url;
      } catch (e: any) {
        // 单档位失败不影响其他档位
        console.warn(`[Probe] ${q} 探测失败:`, e?.message || e);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  if (options?.signal?.aborted) return empty;

  const available = ALL_QUALITY_KEYS.filter(k => Boolean(resolvedUrls[k]));
  console.info(
    `[Probe] 声明 ${targets.length} 档，实测可用 ${available.length} 档:`,
    available.join(', ') || '（无）',
  );

  return { available, resolvedUrls };
}

/** 获取歌词文本（lrc 或纯文本）用于一并下载 */
async function fetchLyricText(
  song: Song,
  format: 'lrc' | 'txt',
  lyricsStyle: DownloadLyricsStyle,
): Promise<string | null> {
  const path = song.cue_source_path || song.path;
  if (!path) return null;

  // plugin:// 协议：通过 MusicFree 插件引擎获取歌词
  if (path.startsWith('plugin://')) {
    return fetchPluginLyricText(song, format, lyricsStyle);
  }

  // lx:// 协议：通过落雪插件引擎获取歌词
  if (!path.startsWith('lx://')) return null;

  const pathInfo = parseLxPath(path);
  if (!pathInfo) return null;
  const { source: lxSource, songmid } = pathInfo;

  try {
    const matchedPlugin = findLxPluginForSource(lxSource);
    if (!matchedPlugin) return null;

    await ensureLxPluginInstance(matchedPlugin);
    const cachedInfo = resolveLxCachedInfo(song, lxSource, songmid);
    const songInfo = buildLxSongInfo(song, songmid, lxSource, cachedInfo);
    const result = await lxPluginGetLyric(matchedPlugin, lxSource, songInfo as any);

    // word-by-word：优先使用逐字歌词（lxlyric），无逐字时回退到逐行（lyric）
    // line-by-line：仅使用逐行歌词（lyric）
    const preferWordByWord = lyricsStyle === 'word-by-word';
    const wordLyric = result?.lxlyric || result?.yrc || result?.qrc;
    const lineLyric = result?.lyric;
    const lyric = (preferWordByWord && wordLyric) ? wordLyric : (lineLyric || wordLyric || '');
    if (!lyric) return null;

    if (format === 'txt') {
      // 去掉时间轴标签（含逐字歌词的 <offset,duration> 标签）
      return lyric
        .replace(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?]/g, '')
        .replace(/<\d+,\d+>/g, '')
        .trim();
    }
    return lyric;
  } catch (e: any) {
    console.warn('[Download] 获取歌词失败:', e?.message);
    return null;
  }
}

/** plugin:// 协议获取歌词：调用 MusicFree 插件的 getLyric 方法 */
async function fetchPluginLyricText(
  song: Song,
  format: 'lrc' | 'txt',
  lyricsStyle: DownloadLyricsStyle,
): Promise<string | null> {
  const pluginSearchResult = song.rawData;
  if (!pluginSearchResult?.pluginId) return null;

  try {
    const plugins = getStoredPlugins();
    const pluginSource = plugins.find(p => p.id === pluginSearchResult.pluginId && p.enabled);
    if (!pluginSource) return null;

    const result = await pluginGetLyric(pluginSource, pluginSearchResult);

    // word-by-word：优先使用 Baka/MF 统一构建的逐字歌词（lyricsRaw），
    // 可覆盖 yrc/qrc/eslrc/lxlyric；无逐字时回退到逐行（lyric）。
    // line-by-line：仅使用逐行歌词（lyric）
    const preferWordByWord = lyricsStyle === 'word-by-word';
    const wordLyric = result?.lyricsRaw || result?.lxlyric;
    const usesLyricsRaw = preferWordByWord && !!result?.lyricsRaw;
    const lineLyric = result?.lyric;
    const lyric = (preferWordByWord && wordLyric) ? wordLyric : (lineLyric || wordLyric || '');
    if (!lyric) return null;

    // 若有翻译歌词，拼接在后面；lyricsRaw 已由插件专用构建器合并过翻译/罗马音轨道，避免重复拼接
    const tlyric = result?.tlyric;
    const combined = tlyric && !usesLyricsRaw ? `${lyric}\n[offset:0]\n${tlyric}` : lyric;

    if (format === 'txt') {
      return combined
        .replace(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?]/g, '')
        .replace(/<\d+,\d+>/g, '')
        .replace(/\[\d+,\d+\]/g, '')
        .trim();
    }
    return combined;
  } catch (e: any) {
    console.warn('[Download][plugin] 获取歌词失败:', e?.message);
    return null;
  }
}

/** 拼接目录与文件名（处理结尾分隔符，兼容 Windows 反斜杠与正斜杠） */
function joinPath(dir: string, fileName: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  const trimmed = dir.replace(/[\\/]+$/, '');
  return `${trimmed}${sep}${fileName}`;
}

/**
 * [项3 下载命名统一] 构建下载文件名并解析非冲突完整路径（单次 IPC）
 *
 * 将文件名计算（清洗 + 扩展名推断 + 命名样式拼接）与路径冲突检测合并到 Rust 侧，
 * 确保命名规则在 Rust 统一实现，前端只传原始参数。
 * IPC 失败时回退到前端本地计算（保持向后兼容）。
 */
async function resolveDownloadFullPath(
  song: Song,
  url: string,
  quality: LxQuality,
  options: Pick<DownloadSongOptions, 'downloadDir' | 'keepSourceFilename' | 'fileNameStyle' | 'overwriteExisting'>,
): Promise<string> {
  try {
    const result = await downloadApi.resolveDownloadFullPath(
      options.downloadDir,
      song.title || song.name || '',
      song.artist || '',
      song.album || '',
      url,
      quality,
      options.keepSourceFilename,
      options.fileNameStyle ?? 'artist-title',
      options.overwriteExisting,
    );
    if (result) return result;
  } catch {
    // IPC 失败，回退到本地计算
  }
  const fileName = buildDownloadFileName(song, url, quality, options.keepSourceFilename, options.fileNameStyle ?? 'artist-title');
  const fullPath = joinPath(options.downloadDir, fileName);
  return resolveNonConflictingPath(fullPath, options.overwriteExisting);
}

/**
 * [项3 下载命名统一] 构建下载附件（歌词/封面）的清洗后基名（单次 IPC）
 *
 * IPC 失败时回退到前端本地计算。
 */
async function resolveDownloadBasename(song: Song, style: DownloadFileNameStyle): Promise<string> {
  try {
    const result = await downloadApi.buildDownloadBasename(
      song.title || song.name || '',
      song.artist || '',
      song.album || '',
      style,
    );
    if (result) return result;
  } catch {
    // IPC 失败，回退到本地计算
  }
  return sanitizeFileName(buildFileNameBase(song, style));
}

/** 在目标路径已存在时追加 (1)/(2)… 直到不冲突 */
async function resolveNonConflictingPath(fullPath: string, overwriteExisting: boolean = false): Promise<string> {
  // [项4 下载编排] 单次 IPC 调用 Rust 后端完成路径冲突检测与解析，
  // 替代原先逐次调用 file_exists 的 N 次 IPC 往返
  try {
    const dir = fullPath.includes('\\')
      ? fullPath.slice(0, fullPath.lastIndexOf('\\'))
      : fullPath.slice(0, fullPath.lastIndexOf('/'));
    const fileName = fullPath.includes('\\')
      ? fullPath.slice(fullPath.lastIndexOf('\\') + 1)
      : fullPath.slice(fullPath.lastIndexOf('/') + 1);
    return await downloadApi.resolveDownloadPath(dir, fileName, overwriteExisting);
  } catch {
    // 后端调用失败时回退到原始路径
    return fullPath;
  }
}

interface DownloadSongOptions {
  quality: DownloadQuality;
  downloadDir: string;
  keepSourceFilename: boolean;
  /** 文件名样式（keepSourceFilename 为真时不生效） */
  fileNameStyle?: DownloadFileNameStyle;
  overwriteExisting: boolean;
  downloadLyrics: boolean;
  lyricsFormat: 'lrc' | 'txt';
  /** 歌词样式：word-by-word 优先逐字歌词（回退逐行），line-by-line 仅逐行歌词 */
  lyricsStyle: DownloadLyricsStyle;
  /** 是否将元数据写入音频文件 tag */
  embedMetadata: boolean;
  /** 是否将歌词写入音频文件 tag */
  embedLyrics: boolean;
  /** 是否将封面嵌入音频文件 tag */
  embedCover: boolean;
  /** 是否独立保存封面图片文件（与 embedCover 独立，可同时开启） */
  downloadCover: boolean;
  /**
   * 探测阶段已解析出的直链（键为音质档位）。
   *
   * 下载弹窗打开时会调用 probeDownloadableQualities 实际请求各档位直链，
   * 这里透传探测结果：命中的档位跳过重复解析，避免同一直链请求两次。
   */
  preResolvedUrls?: Partial<Record<QualityKey, string>>;
  /** 下载进度回调（0-100）。Worker 下载时逐块回报；Rust 回退时通过事件回报。 */
  onProgress?: (percent: number) => void;
}

interface DownloadSongResult {
  filePath: string;
  hitQuality: LxQuality;
  lyricsSaved: boolean;
  coverSaved: boolean;
  metadataEmbedded: boolean;
}

/**
 * 下载单个直链到目标路径：使用 Rust reqwest 流式下载。
 *
 * Rust 在后台 tokio 线程分块写盘 + 完整性校验 + 502/416/403 回退，
 * 不阻塞 WebView 主线程。reqwest 是原生 HTTP 客户端，IDM 等下载器仅 hook
 * WebView 进程，不会拦截 Rust 的请求。进度通过 `song-download-progress` 事件回报。
 */
async function downloadFromUrl(
  url: string,
  destPath: string,
  onProgress?: (percent: number) => void,
): Promise<string> {
  // 监听 Rust 进度事件，驱动 onProgress 回调
  let unlisten: UnlistenFn | null = null;
  if (onProgress) {
    try {
      unlisten = await listen<{ progress: number }>('song-download-progress', (event) => {
        onProgress(Math.min(99, Math.round(event.payload.progress)));
      });
    } catch { /* 事件监听失败不影响下载 */ }
  }

  try {
    const filePath = await downloadApi.downloadOnlineSong(url, destPath);
    onProgress?.(100);
    return filePath;
  } finally {
    unlisten?.();
  }
}

/**
 * 解析在线歌曲的封面图片 URL。
 * - lx:// 协议：优先取 cover_thumb_path，否则调用 LX 插件 pic action 获取
 * - plugin:// 协议：优先取 cover_thumb_path，否则调用 pluginGetCover 获取
 */
async function resolveCoverUrl(song: Song): Promise<string | null> {
  // cover_thumb_path 已是远程 URL 时直接使用
  const thumb = song.cover_thumb_path;
  if (thumb && /^https?:\/\//.test(thumb)) return thumb;

  const path = song.cue_source_path || song.path;
  const lxPathInfo = parseLxPath(path || '');
  if (lxPathInfo) {
    const { source: lxSource, songmid } = lxPathInfo;
    try {
      const matchedPlugin = findLxPluginForSource(lxSource);
      if (!matchedPlugin) return null;

      await ensureLxPluginInstance(matchedPlugin);
      const cachedInfo = resolveLxCachedInfo(song, lxSource, songmid);
      const songInfo = buildLxSongInfo(song, songmid, lxSource, cachedInfo);
      const cover = await lxPluginGetPic(matchedPlugin, lxSource, songInfo as any);
      return cover && /^https?:\/\//.test(cover) ? cover : null;
    } catch {
      return null;
    }
  }

  if (!path.startsWith('plugin://')) return null;

  // plugin:// 歌曲：通过插件引擎获取封面
  const rawData = song.rawData;
  if (!rawData?.pluginId) return null;
  try {
    const plugins = getStoredPlugins();
    const pluginSource = plugins.find(p => p.id === rawData.pluginId && p.enabled);
    if (!pluginSource) return null;
    const cover = await pluginGetCover(pluginSource, rawData);
    return cover && /^https?:\/\//.test(cover) ? cover : null;
  } catch {
    return null;
  }
}

/**
 * 下载在线歌曲主编排：逐音质档位解析直链 → 计算目标路径 → 流式下载 → 可选下载独立歌词/嵌入元数据。
 * 同时支持 lx://（落雪）和 plugin://（MusicFree）协议，根据 path 前缀自动路由。
 * 下载进度通过 Rust 事件 `song-download-progress` 回报，由调用方监听。
 */
export async function downloadSong(
  song: Song,
  options: DownloadSongOptions,
): Promise<DownloadSongResult> {
  if (!isDownloadableOnlineSong(song)) {
    throw new Error('该歌曲不是可下载的在线歌曲');
  }
  if (!options.downloadDir) {
    throw new Error('未设置下载目录');
  }

  // 根据 path 协议前缀路由到对应的解析上下文
  const isPlugin = isPluginSong(song);
  const ctx = isPlugin
    ? await preparePluginResolveContext(song, options.quality)
    : await prepareResolveContext(song, options.quality);
  if (!ctx) {
    throw new Error('无法解析该歌曲的音源信息');
  }

  /** 在当前协议下解析某个档位的直链 */
  const resolveUrl = (q: LxQuality): Promise<string | null> =>
    isPlugin
      ? resolvePluginUrlForQuality(ctx as PluginResolveContext, q)
      : resolveUrlForQuality(ctx as ResolveDownloadContext, q);

  const candidates = ctx.candidates;

  // 按音质候选逐档位「解析直链 → 尝试下载」：
  // 某档位解析失败或下载失败（例如音源网关返回 502）时自动回退到下一档位，
  // 避免高品直链临时不可用就整体下载失败。
  let filePath: string | null = null;
  let hitQuality: LxQuality | null = null;
  const errors: string[] = [];

  for (const q of candidates) {
    // [缓存复用] 若当前正在播放同一首歌，且播放实际命中的音质与候选档位一致，
    // 且该 URL 的播放缓存已下载完成，则直接复制缓存文件，跳过重复下载与直链解析。
    // 这样用户"听过→想下载"时可零成本复用播放缓存，无需再次请求音源。
    const playbackStore = usePlaybackStore();
    const playingUrl = playbackStore.currentPlayingAudioUrl;
    const playingQuality = playbackStore.currentPlayingQuality;
    const currentSongPath = playbackStore.currentSong?.path;
    if (
      playingUrl
      && playingQuality === q
      && currentSongPath === song.path
    ) {
      // 校验：若目标是无损档位但播放 URL 为有损格式，说明播放时已被音源降级，
      // 跳过缓存复用，走正常下载流程以获取真正的无损音源。
      if (isDegradedLossless(q, playingUrl)) {
        console.warn(`[Download] 缓存复用跳过：${q} 目标为无损但播放缓存为 ${extFromUrl(playingUrl)}`);
      } else {
        try {
          const cached = await downloadApi.isStreamCached(playingUrl);
          if (cached) {
            const destPath = await resolveDownloadFullPath(song, playingUrl, q, options);
            try {
              await downloadApi.copyStreamCache(playingUrl, destPath);
              options.onProgress?.(100);
              filePath = destPath;
              hitQuality = q;
              console.info(`[Download] 命中播放缓存，直接复制：${q}`);
              break;
            } catch (e: any) {
              console.warn(`[Download] 复制缓存失败，回退到正常下载:`, e?.message || e);
              options.onProgress?.(0);
            }
          }
        } catch (e: any) {
          console.warn('[Download] 缓存复用探测失败，回退到正常下载:', e?.message || e);
        }
      }
    }

    let url: string;
    try {
      // 探测阶段已解析出该档位直链时直接复用，省掉一次插件请求。
      // 探测与下载间隔通常只有几秒，直链仍在有效期内；
      // 若已失效，下方 downloadFromUrl 会失败并自动回退到下一档位。
      const preResolved = options.preResolvedUrls?.[q];
      const resolvedUrl = preResolved ?? await resolveUrl(q);
      if (!resolvedUrl) {
        errors.push(`${q}: 返回空链接`);
        continue;
      }
      url = resolvedUrl;
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : (e?.message || String(e));
      errors.push(`${q}: 解析失败 ${msg}`);
      console.warn(`[Download] 获取 ${q} 音源失败:`, msg);
      continue;
    }

    const destPath = await resolveDownloadFullPath(song, url, q, options);

    try {
      filePath = await downloadFromUrl(url, destPath, options.onProgress);
      hitQuality = q;
      break;
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : (e?.message || String(e));
      errors.push(`${q}: 下载失败 ${msg}`);
      console.warn(`[Download] ${q} 档位下载失败，尝试回退更低音质:`, msg);
      options.onProgress?.(0);
    }
  }

  // [Rust 兜底] 所有插件档位均失败时，回退到 Rust 后端批量音质解析。
  // 与播放路径（resolveLxUrl）保持一致：插件解析失败不代表歌曲不可下载，
  // Rust 侧走独立的音源实现，往往能解析出插件拿不到的直链。
  if ((!filePath || !hitQuality) && !isPlugin) {
    const lxCtx = ctx as ResolveDownloadContext;
    const path = song.cue_source_path || song.path;
    const pathInfo = parseLxPath(path || '');
    if (pathInfo) {
      const cachedInfo = resolveLxCachedInfo(song, pathInfo.source, pathInfo.songmid);
      if (cachedInfo) {
        console.info('[Download] 插件解析全部失败，尝试 Rust 兜底');
        const rustResult = await resolveLxUrlViaRust(cachedInfo, lxCtx.candidates);
        if (rustResult) {
          const q = rustResult.quality;
          const destPath = await resolveDownloadFullPath(song, rustResult.url, q, options);
          try {
            filePath = await downloadFromUrl(rustResult.url, destPath, options.onProgress);
            hitQuality = q;
            console.info(`[Download] Rust 兜底成功：${q}`);
          } catch (e: any) {
            const msg = typeof e === 'string' ? e : (e?.message || String(e));
            errors.push(`Rust 兜底(${q}): 下载失败 ${msg}`);
            console.warn('[Download] Rust 兜底下载失败:', msg);
            options.onProgress?.(0);
          }
        } else {
          errors.push('Rust 兜底: 无可用直链');
        }
      }
    }
  }

  if (!filePath || !hitQuality) {
    console.warn('[Download] 所有音质档位均失败:', errors);
    throw new Error(
      errors.length > 0
        ? `下载失败：${errors.join('；')}`
        : '无法获取该歌曲的音源，可能无版权或音源暂不可用',
    );
  }

  // [项4 下载编排] 收尾编排：歌词保存 + 封面下载保存 + 元数据嵌入
  // 原先分 3-4 次独立 IPC 调用，现合并为单次 finalize_download_extras 调用。
  // 歌词文本和封面 URL 仍在前端解析（依赖 JS 插件引擎），文件 I/O 全部交给 Rust。

  // 1. 获取歌词文本（前端 JS 插件引擎）
  let savedLyricText: string | null = null;
  if (options.downloadLyrics || options.embedLyrics) {
    savedLyricText = await fetchLyricText(song, options.lyricsFormat, options.lyricsStyle);
  }

  // 2. 获取封面 URL（前端 JS 插件引擎）
  let coverUrl: string | null = null;
  if (options.downloadCover || options.embedCover) {
    coverUrl = await resolveCoverUrl(song);
  }

  // 3. 计算歌词/封面保存路径
  const dot = filePath.lastIndexOf('.');
  const fileBase = dot === -1 ? filePath : filePath.slice(0, dot);

  const lyricsPath = (options.downloadLyrics && savedLyricText)
    ? `${fileBase}.${options.lyricsFormat}`
    : null;

  let coverPath: string | null = null;
  if (options.downloadCover && coverUrl) {
    // 扩展名由 Rust 下载后根据 MIME 确定，这里先用 .jpg 占位
    // Rust 的 finalize_download_extras 会用实际 MIME 覆盖
    coverPath = `${fileBase}.jpg`;
  }

  // 4. 构造元数据嵌入请求
  const needMetadata = options.embedMetadata || options.embedLyrics || options.embedCover;
  const metadataRequest: EmbedMetadataRequestContract | null = needMetadata ? {
    filePath,
    title: options.embedMetadata ? (song.title || song.name || undefined) : undefined,
    artist: options.embedMetadata ? (song.artist || undefined) : undefined,
    album: options.embedMetadata ? (song.album || undefined) : undefined,
    albumArtist: options.embedMetadata ? (song.album_artist || undefined) : undefined,
    year: options.embedMetadata ? (song.year?.toString() || undefined) : undefined,
    trackNumber: options.embedMetadata ? (song.track_number?.toString() || undefined) : undefined,
    discNumber: options.embedMetadata ? (song.disc_number?.toString() || undefined) : undefined,
    lyrics: options.embedLyrics ? (savedLyricText || undefined) : undefined,
    // 封面数据由 Rust 在 finalize_download_extras 中根据 embed_cover 标志自动填充
    coverData: undefined,
    coverMime: undefined,
  } : null;

  // 5. 单次 IPC 调用完成所有收尾工作
  let lyricsSaved = false;
  let coverSaved = false;
  let metadataEmbedded = false;

  if (lyricsPath || coverUrl || metadataRequest) {
    try {
      const result = await downloadApi.finalizeDownloadExtras({
        lyricsText: lyricsPath ? savedLyricText : null,
        lyricsPath,
        // 只要需要封面（独立保存或嵌入元数据）就传 URL，Rust 会下载并按需使用
        coverUrl,
        coverPath,
        metadata: metadataRequest,
        embedCover: options.embedCover,
      });
      lyricsSaved = result.lyrics_saved;
      coverSaved = result.cover_saved;
      metadataEmbedded = result.metadata_embedded;
      if (!metadataEmbedded && result.metadata_error) {
        console.warn('[Download] 元数据嵌入失败:', result.metadata_error);
      }
    } catch (e: any) {
      console.warn('[Download] 收尾编排失败:', e?.message);
    }
  }

  return { filePath, hitQuality, lyricsSaved, coverSaved, metadataEmbedded };
}

interface DownloadExtrasOptions {
  downloadDir: string;
  fileNameStyle: DownloadFileNameStyle;
  downloadLyrics: boolean;
  lyricsFormat: 'lrc' | 'txt';
  lyricsStyle: DownloadLyricsStyle;
  downloadCover: boolean;
}

interface DownloadExtrasResult {
  lyricsSaved: boolean;
  coverSaved: boolean;
}

/**
 * 仅下载歌词和封面文件（不下载音频）。
 *
 * 当用户在下载弹窗中取消勾选「歌曲」但仍需歌词/封面时使用。
 * 文件名基于 fileNameStyle 拼接，与音频文件命名规则一致。
 * [项4 下载编排] 歌词+封面合并为单次 finalize_download_extras IPC 调用。
 */
export async function downloadSongExtras(
  song: Song,
  options: DownloadExtrasOptions,
): Promise<DownloadExtrasResult> {
  if (!isDownloadableOnlineSong(song)) {
    throw new Error('该歌曲不是可下载的在线歌曲');
  }
  if (!options.downloadDir) {
    throw new Error('未设置下载目录');
  }

  const base = await resolveDownloadBasename(song, options.fileNameStyle);

  // 前端解析歌词文本和封面 URL（依赖 JS 插件引擎）
  let lyricsText: string | null = null;
  if (options.downloadLyrics) {
    lyricsText = await fetchLyricText(song, options.lyricsFormat, options.lyricsStyle);
  }

  let coverUrl: string | null = null;
  if (options.downloadCover) {
    coverUrl = await resolveCoverUrl(song);
  }

  const lyricsPath = (options.downloadLyrics && lyricsText)
    ? `${options.downloadDir}/${base}.${options.lyricsFormat}`
    : null;
  const coverPath = (options.downloadCover && coverUrl)
    ? `${options.downloadDir}/${base}.jpg`
    : null;

  if (!lyricsPath && !coverPath) {
    return { lyricsSaved: false, coverSaved: false };
  }

  try {
    const result = await downloadApi.finalizeDownloadExtras({
      lyricsText: lyricsPath ? lyricsText : null,
      lyricsPath,
      coverUrl,
      coverPath,
      metadata: null,
      embedCover: false,
    });
    return { lyricsSaved: result.lyrics_saved, coverSaved: result.cover_saved };
  } catch (e: any) {
    console.warn('[Download] 收尾编排失败:', e?.message);
    return { lyricsSaved: false, coverSaved: false };
  }
}
