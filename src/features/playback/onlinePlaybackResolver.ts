import type { QualityKey, Song } from '../../types';
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
  /** 解析失败时的可读原因（供 UI toast 使用） */
  errorMessage?: string;
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
        // [失败冷却 · 请求收敛] 共享探测已结束且未解析出任何直链（整首全档失败）。
        // 直接按失败返回，不再走下方 fallback 重新逐档请求插件——否则一首不可播的歌
        // 会绕过探针池每轮重复向插件发起 musicUrl 请求（请求风暴）。配合
        // qualitySharedProbe 的失败冷却，失败后在冷却期内一律复用失败结果。
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

      // 解析流程完成但未拿到有效直链：把真实原因带出去，避免 UI 只能显示泛化提示
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
