import type { QualityKey, Song, PluginSource } from '../../types';
import { QUALITY_META, normalizeQualityKey } from '../../types';
import {
  getStoredPlugins,
  pluginGetSupportedQualities,
} from '../../services/domain/pluginEngine';
import {
  parseLxPath,
  resolveLxCachedInfo,
} from '../../services/domain/lxUrlResolver';
import { resolveOnlineQualityUrl } from '../../services/domain/downloadService';
import {
  ensureSharedQualityProbe,
  sharedProbeAwaitTop,
} from '../../services/domain/qualitySharedProbe';
import { normalizeMediaRequestHeaders } from '../../utils/mediaUrl';
import { getPluginBilibiliCookies } from '../../services/domain/pluginCookieStore';
import { resolveActualQuality } from '../../services/domain/audioQualityVerify';
import { healDanglingPluginId } from '../../services/domain/pluginIdHeal';
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
  ekey?: string;
  cek?: string;
  errorMessage?: string;
}

const sortQualities = (qualities: QualityKey[]) => (
  qualities.sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank)
);

export const withBilibiliStreamCookie = async (
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
    let pluginSource: PluginSource | null = plugins.find(p => p.id === pluginSearchResult.pluginId && p.enabled) ?? null;
    if (!pluginSource) {
      pluginSource = healDanglingPluginId(song, plugins);
    }
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

const resolveErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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
        if (probe.done && Object.keys(probe.resolvedUrls).length === 0) {
          return {
            audioFilePath,
            pluginHeaders: null,
            currentPlayingQuality: null,
            currentPlayingAudioUrl: null,
          };
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

      return {
        audioFilePath,
        pluginHeaders: null,
        currentPlayingQuality: null,
        currentPlayingAudioUrl: null,
        errorMessage: '未能从音源解析到有效的播放链接',
      };
    } catch (error) {
      console.warn('[Audio] 使用下载链路解析在线 URL 失败:', error);
      return {
        audioFilePath,
        pluginHeaders: null,
        currentPlayingQuality: null,
        currentPlayingAudioUrl: null,
        errorMessage: resolveErrorMessage(error),
      };
    }
  }

  return {
    audioFilePath,
    pluginHeaders: null,
    currentPlayingQuality: null,
    currentPlayingAudioUrl: null,
  };
};

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
