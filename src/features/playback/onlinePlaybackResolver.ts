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
import { normalizeMediaRequestHeaders } from '../../utils/mediaUrl';

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
  preFetchedUrl,
}: ResolveOnlineAudioOptions): Promise<ResolveOnlineAudioResult> => {
  if (audioFilePath.startsWith('lx://') || audioFilePath.startsWith('plugin://')) {
    try {
      const preResolvedUrls: Partial<Record<QualityKey, string>> | undefined = song.remote_requested_quality === requestedQuality
        && song.remote_fallback_behavior === fallbackBehavior
        && preFetchedUrl
        ? { [requestedQuality]: preFetchedUrl }
        : undefined;
      const resolved = await resolveOnlineQualityUrl(
        song,
        requestedQuality,
        fallbackBehavior,
        null,
        preResolvedUrls,
        { includePlaybackExtras: true },
      );

      if (resolved?.url) {
        return {
          audioFilePath: resolved.url,
          pluginHeaders: normalizeMediaRequestHeaders(resolved.url, resolved.headers ?? null),
          currentPlayingQuality: resolved.quality,
          currentPlayingAudioUrl: resolved.url,
          lyricsRaw: resolved.lyricsRaw,
          coverThumbPath: resolved.coverThumbPath,
          ekey: resolved.ekey,
          cek: resolved.cek,
        };
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
