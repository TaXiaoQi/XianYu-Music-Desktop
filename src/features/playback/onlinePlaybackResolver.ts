import type { QualityKey, Song } from '../../types';
import { QUALITY_META, resolveOnlinePlayQuality } from '../../types';
import { getCachedLxSong } from '../../services/lxSongCache';
import {
  getStoredPlugins,
  pluginGetCover,
  pluginGetMusicInfo,
  pluginGetBakaMusicInfo,
  isBakaPlugin,
  pluginGetSupportedQualities,
} from '../../services/pluginEngine';
import { ensureLxPluginInstance, lxPluginGetMusicUrl } from '../../services/lxPluginEngine';
import { toUrlSongInfo } from '../../services/lxMusicSdk';
import { tauriInvoke } from '../../services/tauri/invoke';

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

const isNamedError = (error: unknown, name: string): error is Error =>
  error instanceof Error && error.name === name;

export const getOnlineAvailableQualities = async (
  songPath: string,
  song: Song,
): Promise<QualityKey[] | null> => {
  if (songPath.startsWith('lx://')) {
    const parts = songPath.replace('lx://', '').split('/');
    const lxSource = parts[0];
    const songmid = parts.slice(1).join('/');
    if (!lxSource || !songmid) {
      return null;
    }

    const persistedInfo = song.rawData?.source === lxSource ? song.rawData : null;
    const cachedInfo = getCachedLxSong(lxSource, songmid) ?? persistedInfo;
    if (!cachedInfo?._types) {
      return null;
    }

    const lxQualities = Object.keys(cachedInfo._types)
      .filter(k => k in QUALITY_META) as QualityKey[];
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
  const parts = audioFilePath.replace('lx://', '').split('/');
  const lxSource = parts[0];
  const songmid = parts.slice(1).join('/');
  if (!lxSource || !songmid) {
    return {
      audioFilePath,
      pluginHeaders: null,
      currentPlayingQuality: null,
      currentPlayingAudioUrl: null,
    };
  }

  try {
    const persistedInfo = song.rawData?.source === lxSource ? song.rawData : null;
    const cachedInfo = getCachedLxSong(lxSource, songmid) ?? persistedInfo;
    const tryQualities = resolveOnlinePlayQuality(
      requestedQuality,
      availableQualities,
      fallbackBehavior,
    );

    const lxPlugins = getStoredPlugins().filter(p => p.enabled && p.format === 'lx');
    let matchedPlugin = lxPlugins.find(p => p.sources.includes(lxSource));
    if (!matchedPlugin && lxPlugins.length > 0) matchedPlugin = lxPlugins[0];

    if (!matchedPlugin) {
      // 无 LX 插件时，通过 Rust 后端批量音质解析（带缓存）
      // 单次 IPC 调用完成多音质回退，避免循环调用
      if (cachedInfo) {
        try {
          const urlResult = await tauriInvoke(
            'resolve_lx_with_quality_fallback',
            {
              songInfo: toUrlSongInfo(cachedInfo),
              qualities: tryQualities,
            },
          );
          if (urlResult?.url && /^https?:/.test(urlResult.url)) {
            return {
              audioFilePath: urlResult.url,
              pluginHeaders: null,
              currentPlayingQuality: urlResult.quality as QualityKey,
              currentPlayingAudioUrl: urlResult.url,
            };
          }
        } catch (error) {
          console.warn(`[Audio] Rust batch quality fallback failed: ${getErrorMessage(error)}`);
        }
      }
      return {
        audioFilePath,
        pluginHeaders: null,
        currentPlayingQuality: null,
        currentPlayingAudioUrl: null,
      };
    }

    await ensureLxPluginInstance(matchedPlugin);

    for (const quality of tryQualities) {
      try {
        const urlResult = await lxPluginGetMusicUrl(matchedPlugin, lxSource, {
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
        }, quality);
        const musicUrl = urlResult?.url;
        if (musicUrl && /^https?:/.test(musicUrl)) {
          return {
            audioFilePath: musicUrl,
            pluginHeaders: null,
            currentPlayingQuality: quality,
            currentPlayingAudioUrl: musicUrl,
          };
        }
      } catch (urlErr) {
        if (isNamedError(urlErr, 'LxSongLevelError')) {
          console.warn(`[Audio] Song-level error, skipping remaining qualities: ${urlErr.message}`);
          break;
        }
      }
    }

    console.warn(`[Audio] lxPluginGetMusicUrl returned empty/invalid URL for lx://${lxSource}/${songmid}, tried=${JSON.stringify(tryQualities)}`);

    // [后备] LX 插件解析失败时，通过 Rust 后端批量音质解析（带缓存）
    // 单次 IPC 调用完成多音质回退，避免循环调用
    if (cachedInfo) {
      try {
        const urlResult = await tauriInvoke(
          'resolve_lx_with_quality_fallback',
          {
            songInfo: toUrlSongInfo(cachedInfo),
            qualities: tryQualities,
          },
        );
        if (urlResult?.url && /^https?:/.test(urlResult.url)) {
          console.log(`[Audio] Rust batch fallback resolved URL for lx://${lxSource}/${songmid} quality=${urlResult.quality}`);
          return {
            audioFilePath: urlResult.url,
            pluginHeaders: null,
            currentPlayingQuality: urlResult.quality as QualityKey,
            currentPlayingAudioUrl: urlResult.url,
          };
        }
      } catch (error) {
        console.warn(`[Audio] Rust batch fallback failed: ${getErrorMessage(error)}`);
      }
    }
  } catch (error) {
    console.warn(`[Audio] Failed to resolve lx:// URL via plugin: ${getErrorMessage(error)}`);
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
  if (preFetchedUrl && /^https?:/.test(preFetchedUrl)) {
    return {
      audioFilePath: preFetchedUrl,
      pluginHeaders: song.remote_headers ?? null,
      currentPlayingQuality: null,
      currentPlayingAudioUrl: preFetchedUrl,
      ekey: song.remote_ekey,
      cek: song.remote_cek,
    };
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
    if (!musicInfo?.url || !/^https?:/.test(musicInfo.url)) {
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

    return {
      audioFilePath: musicInfo.url,
      pluginHeaders: musicInfo.headers && Object.keys(musicInfo.headers).length > 0
        ? musicInfo.headers
        : null,
      currentPlayingQuality: musicInfo.actualQuality ?? null,
      currentPlayingAudioUrl: musicInfo.url,
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
