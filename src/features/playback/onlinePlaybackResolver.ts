import type { QualityKey, Song } from '../../types';
import { QUALITY_META, normalizeQualityKey } from '../../types';
import {
  getStoredPlugins,
  pluginGetSupportedQualities,
} from '../../services/pluginEngine';
import {
  parseLxPath,
  resolveLxCachedInfo,
} from '../../services/lxUrlResolver';
import { resolveOnlineQualityUrl } from '../../services/downloadService';
import {
  ensureSharedQualityProbe,
  sharedProbeAwaitTop,
} from '../../services/qualitySharedProbe';
import { normalizeMediaRequestHeaders } from '../../utils/mediaUrl';
import { getPluginBilibiliCookies } from '../../services/pluginCookieStore';
import { resolveActualQuality } from '../../services/audioQualityVerify';

export interface ResolveOnlineAudioOptions {
  audioFilePath: string;
  song: Song;
  requestedQuality: QualityKey;
  fallbackBehavior: 'lower' | 'higher' | 'pause';
  availableQualities: QualityKey[] | null;
  preFetchedUrl?: string | null;
}

export interface ResolveOnlineAudioResult {
  audioFilePath: string;
  pluginHeaders: Record<string, string> | null;
  currentPlayingQuality: QualityKey | null;
  currentPlayingAudioUrl: string | null;
  lyricsRaw?: string;
  coverThumbPath?: string;
  /** QMC2 加密密钥（Baka 插件加密音源） */
  ekey?: string;
  /** CENC 内容密钥 */
  cek?: string;
}

const sortQualities = (qualities: QualityKey[]) => (
  qualities.sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank)
);

/** 为 B 站 CDN 取流请求合并会话 Cookie（buvid3/4 · SESSDATA），
 *  避免匿名分流只返回几秒预览流（插件 headers 通常不含 Cookie，需从这里补上） */
const withBilibiliStreamCookie = async (
  url: string,
  headers: Record<string, string> | null,
): Promise<Record<string, string> | null> => {
  if (!headers) {
    return headers;
  }
  const alreadyHasCookie = Object.keys(headers).some((k) => k.toLowerCase() === 'cookie');
  if (alreadyHasCookie) {
    return headers;
  }
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!host.includes('bilivideo') && !host.includes('hdslb') && !host.includes('bilibili')) {
      return headers;
    }
  } catch {
    return headers;
  }
  const biliCookie = await getPluginBilibiliCookies();
  if (biliCookie) {
    headers['Cookie'] = biliCookie;
  }
  return headers;
};

export const getOnlineAvailableQualities = async (
  songPath: string,
  song: Song,
): Promise<QualityKey[] | null> => {
  if (songPath.startsWith('lx://')) {
    const pathInfo = parseLxPath(songPath);
    if (!pathInfo) return null;
    const { source: lxSource, songmid } = pathInfo;

    const cachedInfo = resolveLxCachedInfo(song, lxSource, songmid);
    if (!cachedInfo?._types) {
      return null;
    }

    const lxQualities = Array.from(new Set(
      Object.keys(cachedInfo._types)
        .map(k => normalizeQualityKey(k))
        .filter((q): q is QualityKey => !!q),
    ));
    return lxQualities.length > 0 ? sortQualities(lxQualities) : null;
  }

  if (songPath.startsWith('plugin://')) {
    const pluginSearchResult = song.rawData;
    if (!pluginSearchResult?.pluginId) {
      return null;
    }

    const plugins = getStoredPlugins();
    const pluginSource = plugins.find(p => p.id === pluginSearchResult.pluginId && p.enabled);
    if (!pluginSource) {
      return null;
    }

    const supportedQualities = await pluginGetSupportedQualities(pluginSource);
    return supportedQualities && supportedQualities.length > 0
      ? sortQualities(supportedQualities)
      : null;
  }

  return null;
};

export const resolveOnlineAudio = async ({
  audioFilePath,
  song,
  requestedQuality,
  fallbackBehavior,
  availableQualities,
  preFetchedUrl,
}: ResolveOnlineAudioOptions): Promise<ResolveOnlineAudioResult> => {
  if (audioFilePath.startsWith('lx://') || audioFilePath.startsWith('plugin://')) {
    try {
      // [共享同歌探测 · 起播先行] 起播复用同一轮音质探测已解析的直链，
      // 避免与音质/下载菜单的探测重复请求。等待首选档位解析出来后，以该档位 +
      // 共享探测结果调用 resolveOnlineQualityUrl，直接命中预解析 URL（含封面等播放附加信息）。
      const probe = await ensureSharedQualityProbe(song, availableQualities);
      if (probe) {
        const startQuality = await sharedProbeAwaitTop(
          probe,
          requestedQuality,
          fallbackBehavior,
          availableQualities,
        );
        if (startQuality) {
          const resolved = await resolveOnlineQualityUrl(
            song,
            startQuality,
            fallbackBehavior,
            availableQualities,
            probe.resolvedUrls,
            { includePlaybackExtras: true },
          );
          if (resolved?.url) {
            return buildResolveResult(resolved);
          }
        }
      }

      const preResolvedUrls: Partial<Record<QualityKey, string>> | undefined = song.remote_requested_quality === requestedQuality
        && song.remote_fallback_behavior === fallbackBehavior
        && preFetchedUrl
        ? { [requestedQuality]: preFetchedUrl }
        : undefined;
      const resolved = await resolveOnlineQualityUrl(
        song,
        requestedQuality,
        fallbackBehavior,
        availableQualities,
        preResolvedUrls,
        { includePlaybackExtras: true },
      );

      if (resolved?.url) {
        return buildResolveResult(resolved);
      }
    } catch (error) {
      console.warn('[Audio] 使用下载链路解析在线 URL 失败:', error);
    }
  }

  return {
    audioFilePath,
    pluginHeaders: null,
    currentPlayingQuality: null,
    currentPlayingAudioUrl: null,
  };
};

/** 将由在线解析得到的直链整理成起播所需的统一结果（含 B 站 Cookie 补全） */
const buildResolveResult = async (
  resolved: Awaited<ReturnType<typeof resolveOnlineQualityUrl>> & { url: string },
): Promise<ResolveOnlineAudioResult> => {
  const resolvedHeaders = normalizeMediaRequestHeaders(resolved.url, resolved.headers ?? null);
  return {
    audioFilePath: resolved.url,
    pluginHeaders: await withBilibiliStreamCookie(resolved.url, resolvedHeaders),
    currentPlayingQuality: resolveActualQuality(resolved.quality, resolved.url),
    currentPlayingAudioUrl: resolved.url,
    lyricsRaw: resolved.lyricsRaw,
    coverThumbPath: resolved.coverThumbPath,
    ekey: resolved.ekey,
    cek: resolved.cek,
  };
};
