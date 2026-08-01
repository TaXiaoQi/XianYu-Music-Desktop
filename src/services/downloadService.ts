/**
 * 在线歌曲下载服务
 *
 * 负责：解析 lx:// 在线歌曲的真实音源直链（按音质映射 + 自动回退）、
 * 计算目标文件路径（扩展名以真实音源为准、命名冲突处理）、
 * 调用 Rust 命令流式下载，并可选下载歌词。
 */
import { invoke } from '@tauri-apps/api/core';

import type { DownloadFileNameStyle, DownloadQuality, Song, QualityKey } from '../types';
import { ALL_QUALITY_KEYS_DESC, QUALITY_META, qualityKeyToMfQuality } from '../types';

/** 统一音质档位（兼容 LX / MF）：插件支持多少，就显示多少 */
export type LxQuality = QualityKey;

/**
 * 在 Web Worker 线程里用 fetch 拉取音频数据（模仿 MusicFreeDesktop）。
 * IDM 等下载器对 WebView2 的拦截主要作用于主线程，Worker 线程的请求通常能逃过。
 * 返回音频字节；失败（含被拦截、CORS、网络异常）时抛错，由调用方回退到 Rust 下载。
 */
export function fetchViaWorker(
  url: string,
  onProgress?: (percent: number) => void,
  headers?: Record<string, string> | null,
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./downloadWorker.ts', import.meta.url), { type: 'module' });
    } catch (e: any) {
      reject(new Error(`无法创建下载 Worker: ${e?.message || e}`));
      return;
    }

    const cleanup = () => {
      try { worker.terminate(); } catch { /* ignore */ }
    };

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data) return;
      if (data.type === 'progress') {
        if (data.total > 0) {
          onProgress?.(Math.min(99, Math.round((data.received / data.total) * 100)));
        }
      } else if (data.type === 'done') {
        cleanup();
        onProgress?.(100);
        resolve(new Uint8Array(data.buffer as ArrayBuffer));
      } else if (data.type === 'error') {
        cleanup();
        reject(new Error(data.message || 'Worker 下载失败'));
      }
    };

    worker.onerror = (err) => {
      cleanup();
      reject(new Error(`Worker 错误: ${err.message || 'unknown'}`));
    };

    worker.postMessage({ url, headers });
  });
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

/** 清洗文件名中的非法字符（Windows 与跨平台通用） */
export function sanitizeFileName(name: string): string {
  return name
    // eslint-disable-next-line no-control-regex -- 控制字符在文件名中非法，需主动剔除
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'download';
}

/** 从 URL 推断文件扩展名（含点，如 ".flac"）；失败返回空串 */
function extFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    const dot = pathname.lastIndexOf('.');
    if (dot === -1) return '';
    const ext = pathname.slice(dot).toLowerCase();
    // 仅接受常见音频扩展名，避免把 query 里的乱七八糟当扩展名
    if (/^\.(mp3|flac|wav|m4a|aac|ape|ogg|wma)$/.test(ext)) return ext;
    return '';
  } catch {
    return '';
  }
}

/** 根据命中的落雪档位推断扩展名兜底 */
function extFromQuality(quality: LxQuality): string {
  return QUALITY_META[quality]?.isLossless ? '.flac' : '.mp3';
}

/**
 * 按样式拼接文件名主体（不含扩展名）。
 * 缺失的字段（如无专辑信息）会被跳过，避免出现 "歌名 -  - " 这种空段。
 */
export function buildFileNameBase(song: Song, style: DownloadFileNameStyle): string {
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

/**
 * 构造下载文件名（不含目录）。
 * keepSourceFilename 为真时使用 URL 原始文件名，否则按 style 拼接歌名/歌手/专辑。
 */
export function buildDownloadFileName(
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
  if (!path || !path.startsWith('lx://')) return null;

  const parts = path.replace('lx://', '').split('/');
  const lxSource = parts[0];
  const songmid = parts.slice(1).join('/');
  if (!lxSource || !songmid) return null;

  const { getStoredPlugins } = await import('./pluginEngine');
  const { ensureLxPluginInstance } = await import('./lxPluginEngine');
  const { getCachedLxSong } = await import('./lxSongCache');

  const lxPlugins = getStoredPlugins().filter((p) => p.enabled && p.format === 'lx');
  if (lxPlugins.length === 0) {
    throw new Error('未启用任何落雪音源插件，请先在设置中启用');
  }
  let matchedPlugin = lxPlugins.find((p) => p.sources.includes(lxSource));
  if (!matchedPlugin) matchedPlugin = lxPlugins[0];

  await ensureLxPluginInstance(matchedPlugin);
  const cachedInfo = getCachedLxSong(lxSource, songmid);

  const baseSongInfo = {
    songId: songmid,
    name: song.name,
    singer: song.artist,
    albumName: song.album,
    source: lxSource,
    songmid,
    hash: cachedInfo?.hash,
    copyrightId: cachedInfo?.copyrightId,
    strMediaMid: cachedInfo?.strMediaMid,
    albumId: cachedInfo?.albumId,
    albumMid: cachedInfo?.albumMid,
    interval: cachedInfo?.interval,
    _types: cachedInfo?._types,
    types: cachedInfo?.types,
  };

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
async function resolveUrlForQuality(
  ctx: ResolveDownloadContext,
  q: LxQuality,
): Promise<string | null> {
  const { lxPluginGetMusicUrl } = await import('./lxPluginEngine');
  const result = await lxPluginGetMusicUrl(ctx.matchedPlugin, ctx.lxSource, ctx.baseSongInfo as any, q);
  const url = result?.url;
  if (!url || !/^https?:/.test(url)) return null;

  if (QUALITY_META[q]?.isLossless) {
    const ext = extFromUrl(url);
    if (ext === '.mp3' || ext === '.m4a' || ext === '.aac') {
      console.warn(`[Download] ${q} 请求被音源降级为 ${ext}，跳过该档位`);
      return null;
    }
  }
  return url;
}

/** MusicFree 插件音质枚举 */
type PluginQuality = 'standard' | 'high' | 'lossless';

/** 将 LX 档位映射到 MusicFree 插件音质枚举（复用 types 中统一的映射函数） */
function lxQualityToPluginQuality(q: LxQuality): PluginQuality {
  return qualityKeyToMfQuality(q);
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

  const { getStoredPlugins } = await import('./pluginEngine');
  const plugins = getStoredPlugins();
  const pluginSource = plugins.find(p => p.id === pluginSearchResult.pluginId && p.enabled);
  if (!pluginSource) {
    throw new Error('该歌曲对应的插件未启用或已被移除');
  }

  // 部分插件在搜索阶段已填充 qualities 字段（{ standard: {url, size}, high: {...}, lossless: {...} }）
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
async function resolvePluginUrlForQuality(
  ctx: PluginResolveContext,
  q: LxQuality,
): Promise<string | null> {
  // 映射到旧版三档（用于 preQualities 查找兼容）
  const legacyQuality = lxQualityToPluginQuality(q);
  // Toskysun 插件用的新键值（mgg→96k）
  const newQuality = q === 'mgg' ? '96k' : q;

  // 1) 优先使用预解析的 qualities 字段（先尝试新键值，再尝试旧三档）
  const preNew = ctx.preQualities?.[newQuality];
  if (preNew?.url && /^https?:/.test(preNew.url)) {
    if (QUALITY_META[q]?.isLossless) {
      const ext = extFromUrl(preNew.url);
      if (ext === '.mp3' || ext === '.m4a' || ext === '.aac') {
        console.warn(`[Download][plugin] 预解析 ${q} 被降级为 ${ext}，跳过该档位`);
        return null;
      }
    }
    return preNew.url;
  }
  const preLegacy = ctx.preQualities?.[legacyQuality];
  if (preLegacy?.url && /^https?:/.test(preLegacy.url)) {
    if (QUALITY_META[q]?.isLossless) {
      const ext = extFromUrl(preLegacy.url);
      if (ext === '.mp3' || ext === '.m4a' || ext === '.aac') {
        console.warn(`[Download][plugin] 预解析 ${q}(${legacyQuality}) 被降级为 ${ext}，跳过该档位`);
        return null;
      }
    }
    return preLegacy.url;
  }

  // 2) 回退到插件 getMediaSource（传入 QualityKey，内部自动适配）
  const { pluginGetMusicInfo } = await import('./pluginEngine');
  const musicInfo = await pluginGetMusicInfo(ctx.pluginSource, ctx.pluginSearchResult, q);
  const url = musicInfo?.url;
  if (!url || !/^https?:/.test(url)) return null;

  if (QUALITY_META[q]?.isLossless) {
    const ext = extFromUrl(url);
    if (ext === '.mp3' || ext === '.m4a' || ext === '.aac') {
      console.warn(`[Download][plugin] ${q} 请求被音源降级为 ${ext}，跳过该档位`);
      return null;
    }
  }
  return url;
}

/** 探测到的单档位信息，供下载对话框展示 */
export interface ProbedQuality {
  quality: LxQuality;
  /** 音源直链 */
  url: string;
  /** 供 UI 直接展示的大小字符串（如 "10.5 MB"）；空串表示未知 */
  sizeText: string;
  /** 文件扩展名，含点，如 ".flac" ".mp3" */
  ext: string;
}

/** 字节数格式化：>= 1MB 用 MB，>= 1KB 用 KB */
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

/**
 * 归一化 lx `_types[q].size`：
 * 插件返回的可能是 "10.5MB" / "550KB" / "3.2M" / "1234567"（字节）等，
 * 统一格式化成 UI 友好字符串。
 */
function normalizeLxSize(raw: string | null | undefined): string {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';

  const m = /^(\d+(?:\.\d+)?)\s*([KMG]?B?)$/i.exec(s.replace(/\s+/g, ''));
  if (m) {
    const value = parseFloat(m[1]);
    const unit = m[2].toUpperCase();
    if (!isFinite(value) || value <= 0) return '';
    if (unit === 'B' || unit === '') return formatBytes(value);
    if (unit === 'K' || unit === 'KB') return formatBytes(value * 1024);
    if (unit === 'M' || unit === 'MB') return formatBytes(value * 1024 * 1024);
    if (unit === 'G' || unit === 'GB') return formatBytes(value * 1024 * 1024 * 1024);
  }

  const asNum = Number(s);
  if (isFinite(asNum) && asNum > 0) return formatBytes(asNum);
  return '';
}

/** 将 sizeText 显示为友好文案；空串显示占位符 */
export function formatFileSize(sizeText: string): string {
  return sizeText || '大小未知';
}

/**
 * 探测一首歌当前音源实际能下载的所有音质档位（含大小与扩展名）。
 *
 * LX 路径：大小优先读 lx 搜索结果里已缓存的 `_types[q].size`（搜索阶段就带了，免网络请求）；
 * Plugin 路径：优先读 `rawData.qualities[q].size`；无则统一回退到 Rust `probe_url_size`
 * 用 `Range: bytes=0-0` 探 Content-Length。
 *
 * 返回按品质由高到低排序的可用档位列表。
 */
export async function probeAvailableQualities(song: Song): Promise<ProbedQuality[]> {
  // plugin:// 协议走 MusicFree 插件探测路径
  if (isPluginSong(song)) {
    return probePluginAvailableQualities(song);
  }

  const ctx = await prepareResolveContext(song, 'master');
  if (!ctx) return [];

  const _types: Record<string, { size: string | null; hash?: string }> | undefined =
    ctx.baseSongInfo?._types;

  const ALL: LxQuality[] = ALL_QUALITY_KEYS_DESC;
  const probed = await Promise.all(
    ALL.map(async (q): Promise<ProbedQuality | null> => {
      let url: string | null;
      try {
        url = await resolveUrlForQuality(ctx, q);
      } catch {
        return null;
      }
      if (!url) return null;

      let sizeText = normalizeLxSize(_types?.[q]?.size);

      if (!sizeText) {
        try {
          const info = await invoke<{ url: string; size: number; error?: string }>(
            'probe_url_size',
            { url },
          );
          if (info?.size > 0) sizeText = formatBytes(Number(info.size));
        } catch (e) {
          console.warn(`[Download] 探测 ${q} 大小失败:`, e);
        }
      }

      const ext = extFromUrl(url) || extFromQuality(q);
      return { quality: q, url, sizeText, ext };
    }),
  );
  return probed.filter((p): p is ProbedQuality => p !== null);
}

/**
 * 探测 plugin:// 协议歌曲的可用音质。
 *
 * 优化：若插件声明了 `supportedQualities`（Toskysun 系列），仅探测声明的音质档位，
 * 避免对 12 档全部发起 getMediaSource 网络请求。否则回退到全量探测。
 */
async function probePluginAvailableQualities(song: Song): Promise<ProbedQuality[]> {
  const ctx = await preparePluginResolveContext(song, 'master');
  if (!ctx) return [];

  // 尝试从插件实例获取声明的支持音质列表
  let candidateQualities: LxQuality[] = ALL_QUALITY_KEYS_DESC;
  try {
    const { pluginGetSupportedQualities } = await import('./pluginEngine');
    const supported = await pluginGetSupportedQualities(ctx.pluginSource);
    if (supported && supported.length > 0) {
      // 按品质从高到低排序
      candidateQualities = supported.sort((a, b) => QUALITY_META[b].rank - QUALITY_META[a].rank);
      console.log(`[Download][plugin] 插件声明支持音质: ${candidateQualities.join(', ')}`);
    }
  } catch { /* ignore, fall back to full probe */ }

  const results: ProbedQuality[] = [];

  // 串行探测
  for (const q of candidateQualities) {
    let url: string | null;
    try {
      url = await resolvePluginUrlForQuality(ctx, q);
    } catch (e: any) {
      console.warn(`[Download][plugin] 探测 ${q} 失败:`, e?.message);
      // 单档位异常不中断整体探测，继续尝试更低音质
      continue;
    }
    if (!url) continue;

    // 优先用预解析 qualities 里的 size（先尝试新键值，再尝试旧三档）
    const newQ = q === 'mgg' ? '96k' : q;
    const legacyQ = lxQualityToPluginQuality(q);
    let sizeText = '';
    const preSize = ctx.preQualities?.[newQ]?.size ?? ctx.preQualities?.[legacyQ]?.size;
    if (typeof preSize === 'number') {
      sizeText = formatBytes(preSize);
    } else if (typeof preSize === 'string') {
      sizeText = normalizeLxSize(preSize);
    }

    if (!sizeText) {
      try {
        const info = await invoke<{ url: string; size: number; error?: string }>(
          'probe_url_size',
          { url },
        );
        if (info?.size > 0) sizeText = formatBytes(Number(info.size));
      } catch (e) {
        console.warn(`[Download][plugin] 探测 ${q} 大小失败:`, e);
      }
    }

    const ext = extFromUrl(url) || extFromQuality(q);
    results.push({ quality: q, url, sizeText, ext });
  }

  return results;
}

/**
 * 解析在线歌曲（lx:// 或 plugin://）的真实音源直链，按音质候选逐个尝试。
 * 注意：这里只要拿到首个格式合法的直链即返回，不校验该链接实际能否下载；
 * 下载阶段（downloadSong）会在下载失败时按候选档位继续回退。
 */
export async function resolveDownloadUrl(
  song: Song,
  quality: DownloadQuality,
): Promise<{ url: string; hitQuality: LxQuality } | null> {
  const isPlugin = isPluginSong(song);
  const ctx = isPlugin
    ? await preparePluginResolveContext(song, quality)
    : await prepareResolveContext(song, quality);
  if (!ctx) return null;

  const resolveUrl = (q: LxQuality): Promise<string | null> =>
    isPlugin
      ? resolvePluginUrlForQuality(ctx as PluginResolveContext, q)
      : resolveUrlForQuality(ctx as ResolveDownloadContext, q);

  const errors: string[] = [];
  for (const q of ctx.candidates) {
    try {
      const url = await resolveUrl(q);
      if (url) {
        return { url, hitQuality: q };
      }
      errors.push(`${q}: 返回空链接`);
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : (e?.message || String(e));
      errors.push(`${q}: ${msg}`);
      console.warn(`[Download] 获取 ${q} 音源失败:`, msg);
    }
  }

  console.warn('[Download] 所有音质档位均失败:', errors);
  return null;
}

/** 获取歌词文本（lrc 或纯文本）用于一并下载 */
async function fetchLyricText(song: Song, format: 'lrc' | 'txt'): Promise<string | null> {
  const path = song.cue_source_path || song.path;
  if (!path) return null;

  // plugin:// 协议：通过 MusicFree 插件引擎获取歌词
  if (path.startsWith('plugin://')) {
    return fetchPluginLyricText(song, format);
  }

  // lx:// 协议：通过落雪插件引擎获取歌词
  if (!path.startsWith('lx://')) return null;

  const parts = path.replace('lx://', '').split('/');
  const lxSource = parts[0];
  const songmid = parts.slice(1).join('/');
  if (!lxSource || !songmid) return null;

  try {
    const { getStoredPlugins } = await import('./pluginEngine');
    const { lxPluginGetLyric, ensureLxPluginInstance } = await import('./lxPluginEngine');
    const { getCachedLxSong } = await import('./lxSongCache');

    const lxPlugins = getStoredPlugins().filter((p) => p.enabled && p.format === 'lx');
    let matchedPlugin = lxPlugins.find((p) => p.sources.includes(lxSource));
    if (!matchedPlugin && lxPlugins.length > 0) matchedPlugin = lxPlugins[0];
    if (!matchedPlugin) return null;

    await ensureLxPluginInstance(matchedPlugin);
    const cachedInfo = getCachedLxSong(lxSource, songmid);
    const result = await lxPluginGetLyric(matchedPlugin, lxSource, {
      songId: songmid,
      name: song.name,
      singer: song.artist,
      albumName: song.album,
      source: lxSource,
      songmid,
      hash: cachedInfo?.hash,
      copyrightId: cachedInfo?.copyrightId,
      strMediaMid: cachedInfo?.strMediaMid,
      _types: cachedInfo?._types,
      types: cachedInfo?.types,
    } as any);

    const lyric = result?.lyric;
    if (!lyric) return null;

    if (format === 'txt') {
      // 去掉时间轴标签
      return lyric.replace(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?]/g, '').trim();
    }
    return lyric;
  } catch (e: any) {
    console.warn('[Download] 获取歌词失败:', e?.message);
    return null;
  }
}

/** plugin:// 协议获取歌词：调用 MusicFree 插件的 getLyric 方法 */
async function fetchPluginLyricText(song: Song, format: 'lrc' | 'txt'): Promise<string | null> {
  const pluginSearchResult = song.rawData;
  if (!pluginSearchResult?.pluginId) return null;

  try {
    const { getStoredPlugins, pluginGetLyric } = await import('./pluginEngine');
    const plugins = getStoredPlugins();
    const pluginSource = plugins.find(p => p.id === pluginSearchResult.pluginId && p.enabled);
    if (!pluginSource) return null;

    const result = await pluginGetLyric(pluginSource, pluginSearchResult);
    const lyric = result?.lyric;
    if (!lyric) return null;

    // 若有翻译歌词，拼接在后面
    const combined = result.tlyric ? `${lyric}\n[offset:0]\n${result.tlyric}` : lyric;

    if (format === 'txt') {
      return combined.replace(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?]/g, '').trim();
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

/** 在目标路径已存在时追加 (1)/(2)… 直到不冲突 */
async function resolveNonConflictingPath(fullPath: string): Promise<string> {
  const exists = async (p: string) => {
    try {
      return await invoke<boolean>('file_exists', { path: p });
    } catch {
      return false;
    }
  };

  if (!(await exists(fullPath))) return fullPath;

  const dot = fullPath.lastIndexOf('.');
  const base = dot === -1 ? fullPath : fullPath.slice(0, dot);
  const ext = dot === -1 ? '' : fullPath.slice(dot);

  for (let i = 1; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  return fullPath;
}

export interface DownloadSongOptions {
  quality: DownloadQuality;
  downloadDir: string;
  keepSourceFilename: boolean;
  /** 文件名样式（keepSourceFilename 为真时不生效） */
  fileNameStyle?: DownloadFileNameStyle;
  overwriteExisting: boolean;
  downloadLyrics: boolean;
  lyricsFormat: 'lrc' | 'txt';
  /** 下载进度回调（0-100）。Worker 下载时逐块回报；Rust 回退时通过事件回报。 */
  onProgress?: (percent: number) => void;
}

export interface DownloadSongResult {
  filePath: string;
  hitQuality: LxQuality;
  lyricsSaved: boolean;
}

/**
 * 下载单个直链到目标路径：优先 Worker fetch，失败回退到 Rust reqwest。
 * 任一路径成功即返回文件路径；两者都失败则抛错，交由上层按音质候选回退。
 */
async function downloadFromUrl(
  url: string,
  destPath: string,
  onProgress?: (percent: number) => void,
): Promise<string> {
  // 优先在 Web Worker 线程里 fetch 拉取音频（模仿 MusicFree，规避 IDM 对主线程的拦截），
  // 再交给 Rust 写盘。若 Worker 下载失败（被拦截/CORS/网络异常/HTTP 错误），
  // 回退到 Rust request 直接下载（Rust 侧带完整性校验，数据不完整会删除坏文件并报错）。
  try {
    const bytes = await fetchViaWorker(url, onProgress);
    if (bytes.length === 0) {
      throw new Error('下载数据为空');
    }
    const filePath = await invoke<string>('save_download_bytes', {
      data: bytes,
      destPath,
    });
    onProgress?.(100);
    return filePath;
  } catch (workerErr: any) {
    console.warn('[Download] Worker 下载失败，回退到后端下载:', workerErr?.message || workerErr);
    return invoke<string>('download_online_song', {
      url,
      destPath,
    });
  }
}

/**
 * 下载在线歌曲主编排：逐音质档位解析直链 → 计算目标路径 → 流式下载 → 可选下载歌词。
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
    let url: string;
    try {
      const resolvedUrl = await resolveUrl(q);
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

    const fileName = buildDownloadFileName(
      song,
      url,
      q,
      options.keepSourceFilename,
      options.fileNameStyle ?? 'artist-title',
    );
    let destPath = joinPath(options.downloadDir, fileName);
    if (!options.overwriteExisting) {
      destPath = await resolveNonConflictingPath(destPath);
    }

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

  if (!filePath || !hitQuality) {
    console.warn('[Download] 所有音质档位均失败:', errors);
    throw new Error(
      errors.length > 0
        ? `下载失败：${errors.join('；')}`
        : '无法获取该歌曲的音源，可能无版权或音源暂不可用',
    );
  }

  let lyricsSaved = false;
  if (options.downloadLyrics) {
    const lyricText = await fetchLyricText(song, options.lyricsFormat);
    if (lyricText) {
      const dot = filePath.lastIndexOf('.');
      const lyricBase = dot === -1 ? filePath : filePath.slice(0, dot);
      const lyricPath = `${lyricBase}.${options.lyricsFormat}`;
      try {
        await invoke<string>('save_download_lyrics', {
          content: lyricText,
          destPath: lyricPath,
        });
        lyricsSaved = true;
      } catch (e: any) {
        console.warn('[Download] 保存歌词失败:', e?.message);
      }
    }
  }

  return { filePath, hitQuality, lyricsSaved };
}
