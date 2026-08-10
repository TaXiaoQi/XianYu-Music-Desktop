import type { QualityKey, Song } from '../../types';
import { QUALITY_META, normalizeQualityKey } from '../../types';
import { extFromUrl, resolveActualQuality } from '../../services/audioQualityVerify';
import {
  getStoredPlugins,
  pluginGetCover,
  pluginGetMusicInfo,
  pluginGetBakaMusicInfo,
  isBakaPlugin,
  pluginGetSupportedQualities,
} from '../../services/pluginEngine';
import {
  parseLxPath,
  resolveLxCachedInfo,
  resolveLxUrl,
} from '../../services/lxUrlResolver';

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

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const canReusePreFetchedPluginUrl = (
  song: Song,
  requestedQuality: QualityKey,
  fallbackBehavior: ResolveOnlineAudioOptions['fallbackBehavior'],
) => (
  song.remote_requested_quality === requestedQuality
  && song.remote_fallback_behavior === fallbackBehavior
);

/**
 * 兜底清洗插件媒体 URL。
 *
 * 部分 Baka 插件会返回被反引号/引号包裹，或尾部带逗号的 URL，例如：
 * `https://example.com/api?level=hires,`
 * 若坏字符串穿透到播放层，startsWith('http') 会失败，最终被误当成本地文件播放。
 */
const sanitizeResolvedMediaUrl = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  const stripEdgeJunk = (value: string) => {
    let current = value.trim();
    let previous = '';
    while (current && current !== previous) {
      previous = current;
      current = current
        .replace(/^[`'"\u2018\u2019\u201c\u201d\u00b4\uff02\uff07\s]+/g, '')
        .replace(/[,，;；`'"\u2018\u2019\u201c\u201d\u00b4\uff02\uff07\s]+$/g, '');
    }
    return current;
  };
  const stripped = stripEdgeJunk(raw);
  const match = stripped.match(/https?:\/\/[^\s`'"<>]+/i);
  const candidate = stripEdgeJunk(match?.[0] || stripped);
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    let changed = false;
    const pathname = url.pathname.replace(/[,，;；`'"\u2018\u2019\u201c\u201d\u00b4\uff02\uff07\s]+$/g, '');
    if (pathname !== url.pathname) {
      url.pathname = pathname;
      changed = true;
    }
    for (const [key, value] of Array.from(url.searchParams.entries())) {
      const cleaned = stripEdgeJunk(value);
      if (cleaned !== value) {
        url.searchParams.set(key, cleaned);
        changed = true;
      }
    }
    return stripEdgeJunk(changed ? url.toString() : candidate);
  } catch {
    return candidate;
  }
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
  if (audioFilePath.startsWith('lx://')) {
    return resolveLxAudioUrl({
      audioFilePath,
      song,
      requestedQuality,
      fallbackBehavior,
      availableQualities,
    });
  }

  if (audioFilePath.startsWith('plugin://')) {
    return resolvePluginAudioUrl({
      audioFilePath,
      song,
      requestedQuality,
      fallbackBehavior,
      availableQualities,
      preFetchedUrl,
    });
  }

  return {
    audioFilePath,
    pluginHeaders: null,
    currentPlayingQuality: null,
    currentPlayingAudioUrl: null,
  };
};

const resolveLxAudioUrl = async ({
  audioFilePath,
  song,
  requestedQuality,
  fallbackBehavior,
  availableQualities,
}: ResolveOnlineAudioOptions): Promise<ResolveOnlineAudioResult> => {
  const pathInfo = parseLxPath(audioFilePath);
  if (!pathInfo) {
    return {
      audioFilePath,
      pluginHeaders: null,
      currentPlayingQuality: null,
      currentPlayingAudioUrl: null,
    };
  }
  const { source: lxSource, songmid } = pathInfo;

  try {
    const result = await resolveLxUrl(
      song,
      lxSource,
      songmid,
      requestedQuality,
      fallbackBehavior,
      availableQualities,
    );
    if (result?.url && /^https?:/.test(result.url)) {
      // 音源可能对无版权歌曲静默降级（声称 flac 实返 mp3）。
      // 直接采信 result.quality 会让 UI 显示 SQ/HR 而用户实听有损，
      // 因此按直链真实格式修正后再上报给 UI。
      const actualQuality = resolveActualQuality(result.quality, result.url);
      if (actualQuality !== result.quality) {
        console.warn(
          `[Audio] 音源将 ${result.quality} 降级为 ${extFromUrl(result.url)}，`
          + `实际播放音质按 ${actualQuality} 显示`,
        );
      }
      return {
        audioFilePath: result.url,
        pluginHeaders: null,
        currentPlayingQuality: actualQuality,
        currentPlayingAudioUrl: result.url,
      };
    }
  } catch (error) {
    console.warn(`[Audio] Failed to resolve lx:// URL: ${getErrorMessage(error)}`);
  }

  return {
    audioFilePath,
    pluginHeaders: null,
    currentPlayingQuality: null,
    currentPlayingAudioUrl: null,
  };
};

const resolvePluginAudioUrl = async ({
  audioFilePath,
  song,
  requestedQuality,
  fallbackBehavior,
  availableQualities,
  preFetchedUrl,
}: ResolveOnlineAudioOptions): Promise<ResolveOnlineAudioResult> => {
  const cleanedPreFetchedUrl = sanitizeResolvedMediaUrl(preFetchedUrl);
  if (
    cleanedPreFetchedUrl
    && /^https?:/.test(cleanedPreFetchedUrl)
    && canReusePreFetchedPluginUrl(song, requestedQuality, fallbackBehavior)
  ) {
    if (preFetchedUrl && cleanedPreFetchedUrl !== preFetchedUrl) {
      console.warn('[Audio] 已清洗预获取插件 URL:', {
        before: String(preFetchedUrl).slice(0, 120),
        after: cleanedPreFetchedUrl.slice(0, 120),
      });
    }
    return {
      audioFilePath: cleanedPreFetchedUrl,
      pluginHeaders: song.remote_headers ?? null,
      currentPlayingQuality: song.remote_actual_quality ?? song.remote_requested_quality ?? null,
      currentPlayingAudioUrl: cleanedPreFetchedUrl,
      ekey: song.remote_ekey,
      cek: song.remote_cek,
    };
  }
  if (cleanedPreFetchedUrl && /^https?:/.test(cleanedPreFetchedUrl)) {
    console.log('[Audio] 预获取插件 URL 与当前播放设置不一致，重新按设置解析:', {
      requestedQuality,
      fallbackBehavior,
      preFetchedQuality: song.remote_requested_quality ?? null,
      preFetchedFallback: song.remote_fallback_behavior ?? null,
    });
  }

  const pluginSearchResult = song.rawData;
  if (!pluginSearchResult?.pluginId) {
    return {
      audioFilePath,
      pluginHeaders: null,
      currentPlayingQuality: null,
      currentPlayingAudioUrl: null,
    };
  }

  try {
    const plugins = getStoredPlugins();
    const pluginSource = plugins.find(p => p.id === pluginSearchResult.pluginId && p.enabled);
    if (!pluginSource) {
      console.warn(`[Audio] No enabled plugin found for pluginId=${pluginSearchResult.pluginId}`);
      return {
        audioFilePath,
        pluginHeaders: null,
        currentPlayingQuality: null,
        currentPlayingAudioUrl: null,
      };
    }

    // Baka/Toskysun 系列插件使用独立的播放方法（12 档原生音质），
    // 原版 MusicFree 插件使用 pluginGetMusicInfo（standard/high/lossless 三档）
    const useBaka = await isBakaPlugin(pluginSource);
    const musicInfo = useBaka
      ? await pluginGetBakaMusicInfo(
          pluginSource,
          pluginSearchResult,
          requestedQuality,
          fallbackBehavior,
          availableQualities,
        )
      : await pluginGetMusicInfo(
          pluginSource,
          pluginSearchResult,
          requestedQuality,
          fallbackBehavior,
          availableQualities,
        );
    const cleanedMusicUrl = sanitizeResolvedMediaUrl(musicInfo?.url);
    if (musicInfo?.url && cleanedMusicUrl !== musicInfo.url) {
      console.warn('[Audio] 已清洗插件 URL:', {
        before: musicInfo.url.slice(0, 120),
        after: cleanedMusicUrl.slice(0, 120),
      });
    }
    if (!cleanedMusicUrl || !/^https?:/.test(cleanedMusicUrl)) {
      console.warn(`[Audio] pluginGetMusicInfo returned empty/invalid URL for plugin://${pluginSearchResult.pluginId}/${pluginSearchResult.id}`);
      return {
        audioFilePath,
        pluginHeaders: null,
        currentPlayingQuality: null,
        currentPlayingAudioUrl: null,
      };
    }

    let coverThumbPath = musicInfo.coverUrl;
    if (!song.cover_thumb_path && !coverThumbPath) {
      try {
        coverThumbPath = await pluginGetCover(pluginSource, pluginSearchResult) ?? undefined;
      } catch { /* ignore cover error */ }
    }

    // 同 lx:// 路径：按直链真实格式修正插件声称的档位，
    // 避免音源静默降级时 UI 仍显示 SQ/HR。
    const claimedQuality = musicInfo.actualQuality ?? null;
    const verifiedQuality = claimedQuality
      ? resolveActualQuality(claimedQuality, cleanedMusicUrl)
      : null;
    if (claimedQuality && verifiedQuality !== claimedQuality) {
      console.warn(
        `[Audio] 插件将 ${claimedQuality} 降级为 ${extFromUrl(cleanedMusicUrl)}，`
        + `实际播放音质按 ${verifiedQuality} 显示`,
      );
    }

    return {
      audioFilePath: cleanedMusicUrl,
      pluginHeaders: musicInfo.headers && Object.keys(musicInfo.headers).length > 0
        ? musicInfo.headers
        : null,
      currentPlayingQuality: verifiedQuality,
      currentPlayingAudioUrl: cleanedMusicUrl,
      lyricsRaw: musicInfo.lyricsRaw,
      coverThumbPath,
      ekey: musicInfo.ekey,
      cek: musicInfo.cek,
    };
  } catch (error) {
    console.warn(`[Audio] Failed to resolve plugin:// URL: ${getErrorMessage(error)}`);
    return {
      audioFilePath,
      pluginHeaders: null,
      currentPlayingQuality: null,
      currentPlayingAudioUrl: null,
    };
  }
};
