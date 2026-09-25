import type {
  DownloadQuality,
  DownloadQualityFallbackBehavior,
  OnlineQualityFallbackBehavior,
  Song,
  QualityKey,
  PluginSource,
} from '../../types';
import {
  qualityKeyToBakaPluginQuality,
  qualityKeyToBakaLegacyQuality,
  qualityKeyToMfQuality,
  resolveOnlinePlayQuality,
} from '../../types';
import {
  isDegradedLossless,
  isViperEncodedStream,
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
} from './lxUrlResolver';
import { sanitizeMediaUrl } from '../../utils/mediaUrl';
import { healDanglingPluginId } from './pluginIdHeal';
import {
  type LxQuality,
  qualityToDownloadCandidates,
  isDownloadableOnlineSong,
  isPluginSong,
  extFromUrl,
} from './downloadFormat';

export interface ResolvedOnlineQualityUrl {
  quality: QualityKey;
  url: string;
  headers?: Record<string, string> | null;
  lyricsRaw?: string;
  coverThumbPath?: string;
  ekey?: string;
  cek?: string;
}

export interface ResolveDownloadContext {
  matchedPlugin: any;
  lxSource: string;
  baseSongInfo: any;
  candidates: LxQuality[];
}

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
  if (isViperEncodedStream(url)) {
    console.warn(`[Download] ${q} 命中酷狗蝰蛇音效流（VIPER 编码不可解），跳过该档位`);
    return null;
  }
  return { quality: resolveActualQuality(reportedQuality, url), url };
}

export interface PluginResolveContext {
  pluginSource: any;
  pluginSearchResult: any;
  candidates: LxQuality[];
  preQualities?: Record<string, { url?: string; size?: number | string }>;
}

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
  let pluginSource: PluginSource | null = plugins.find(p => p.id === pluginSearchResult.pluginId && p.enabled) ?? null;
  if (!pluginSource) {
    pluginSource = healDanglingPluginId(song, plugins);
    if (!pluginSource) {
      throw new Error('该歌曲对应的插件未启用或已被移除');
    }
  }

  const musicItem = pluginSearchResult.rawData;
  if (musicItem && typeof musicItem.url === 'string' && musicItem.url.startsWith('http')) {
    delete musicItem.url;
  }

  const preQualities = pluginSearchResult.rawData?.qualities ?? undefined;

  return {
    pluginSource,
    pluginSearchResult,
    candidates: qualityToDownloadCandidates(quality, fallbackBehavior),
    preQualities,
  };
}

export async function resolvePluginAudioForQuality(
  ctx: PluginResolveContext,
  q: LxQuality,
  includePlaybackExtras = false,
): Promise<ResolvedOnlineQualityUrl | null> {
  const nativeQuality = q;
  const bakaPluginQuality = qualityKeyToBakaPluginQuality(q);
  const bakaLegacyQuality = qualityKeyToBakaLegacyQuality(q);
  const mfLegacyQuality = qualityKeyToMfQuality(q);

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
      if (isViperEncodedStream(preUrl)) {
        console.warn(`[Download][plugin] 预解析 ${q}(${key}) 命中酷狗蝰蛇音效流，跳过该档位`);
        return null;
      }
      return { quality: resolveActualQuality(q, preUrl), url: preUrl };
    }
  }

  const musicInfo = isBaka
    ? await pluginGetBakaMusicInfo(ctx.pluginSource, ctx.pluginSearchResult, q)
    : await pluginGetMusicInfo(ctx.pluginSource, ctx.pluginSearchResult, q);
  const url = sanitizeMediaUrl(musicInfo?.url);
  if (!url || !/^https?:/.test(url)) return null;

  if (isDegradedLossless(q, url)) {
    console.warn(`[Download][plugin] ${q} 请求被音源降级为 ${extFromUrl(url)}，跳过该档位`);
    return null;
  }
  if (isViperEncodedStream(url)) {
    console.warn(`[Download][plugin] ${q} 命中酷狗蝰蛇音效流（VIPER 编码不可解），跳过该档位`);
    return null;
  }
  let coverThumbPath = musicInfo?.coverUrl;
  if (includePlaybackExtras && !ctx.pluginSearchResult?.cover_thumb_path && !coverThumbPath) {
    try {
      const coverTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
      coverThumbPath = await Promise.race([
        pluginGetCover(ctx.pluginSource, ctx.pluginSearchResult),
        coverTimeout,
      ]) ?? undefined;
    } catch { /* ignore cover error */ }
  }

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
    if (preResolved && /^https?:/.test(preResolved)
        && !isDegradedLossless(q, preResolved) && !isViperEncodedStream(preResolved)) {
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


  return null;
}