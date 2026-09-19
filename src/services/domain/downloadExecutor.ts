import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { DownloadFileNameStyle, DownloadLyricsStyle, DownloadQuality, DownloadQualityFallbackBehavior, Song, QualityKey } from '../../types';
import { downloadApi } from '../tauri/downloadApi';
import type { EmbedMetadataRequestContract } from '../tauri/contracts';
import {
  isDegradedLossless,
} from './audioQualityVerify';
import { usePlaybackStore } from '../../features/playback/store';
import {
  ResolvedOnlineQualityUrl,
  ResolveDownloadContext,
  PluginResolveContext,
  prepareResolveContext,
  preparePluginResolveContext,
  resolveLxAudioForQuality,
  resolvePluginAudioForQuality,
} from './downloadQualityResolver';
import {
  LxQuality,
  isDownloadableOnlineSong,
  isPluginSong,
  buildFileNameBase,
  sanitizeFileName,
  extFromUrl,
} from './downloadFormat';
import {
  fetchLyricText,
  resolveCoverUrl,
} from './downloadExtras';

function baseName(fullPath: string): string {
  const idx = Math.max(fullPath.lastIndexOf('\\'), fullPath.lastIndexOf('/'));
  return idx === -1 ? fullPath : fullPath.slice(idx + 1);
}

async function resolveDownloadFullPath(
  song: Song,
  url: string,
  quality: LxQuality,
  options: Pick<DownloadSongOptions, 'keepSourceFilename' | 'fileNameStyle' | 'overwriteExisting'>,
): Promise<string> {
  return await downloadApi.resolveDownloadFullPath(
    song.title || song.name || '',
    song.artist || '',
    song.album || '',
    url,
    quality,
    options.keepSourceFilename,
    options.fileNameStyle ?? 'artist-title',
    options.overwriteExisting,
  );
}

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

interface DownloadSongOptions {
  quality: DownloadQuality;
  qualityFallbackBehavior?: DownloadQualityFallbackBehavior;
  downloadDir: string;
  keepSourceFilename: boolean;
  fileNameStyle?: DownloadFileNameStyle;
  overwriteExisting: boolean;
  downloadLyrics: boolean;
  lyricsFormat: 'lrc' | 'txt';
  lyricsStyle: DownloadLyricsStyle;
  embedMetadata: boolean;
  embedLyrics: boolean;
  embedCover: boolean;
  downloadCover: boolean;
  preResolvedUrls?: Partial<Record<QualityKey, string>>;
  onProgress?: (percent: number) => void;
}

interface DownloadSongResult {
  filePath: string;
  hitQuality: LxQuality;
  lyricsSaved: boolean;
  coverSaved: boolean;
  metadataEmbedded: boolean;
}

async function downloadFromUrl(
  url: string,
  destPath: string,
  onProgress?: (percent: number) => void,
  ekey?: string | null,
  headers?: Record<string, string> | null,
): Promise<string> {
  let unlisten: UnlistenFn | null = null;
  if (onProgress) {
    try {
      unlisten = await listen<{ progress: number }>('song-download-progress', (event) => {
        onProgress(Math.min(99, Math.round(event.payload.progress)));
      });
    } catch { /* 事件监听失败不影响下载 */ }
  }

  try {
    const filePath = await downloadApi.downloadOnlineSong(url, destPath, ekey, headers);
    onProgress?.(100);
    return filePath;
  } finally {
    unlisten?.();
  }
}

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

  const isPlugin = isPluginSong(song);
  const ctx = isPlugin
    ? await preparePluginResolveContext(song, options.quality, options.qualityFallbackBehavior)
    : await prepareResolveContext(song, options.quality, options.qualityFallbackBehavior);
  if (!ctx) {
    throw new Error('无法解析该歌曲的音源信息');
  }

  const resolveAudio = (q: LxQuality): Promise<ResolvedOnlineQualityUrl | null> =>
    isPlugin
      ? resolvePluginAudioForQuality(ctx as PluginResolveContext, q)
      : resolveLxAudioForQuality(ctx as ResolveDownloadContext, q);

  const candidates = ctx.candidates;

  let filePath: string | null = null;
  let hitQuality: LxQuality | null = null;
  const errors: string[] = [];

  for (const q of candidates) {
    const playbackStore = usePlaybackStore();
    const playingUrl = playbackStore.currentPlayingAudioUrl;
    const playingQuality = playbackStore.currentPlayingQuality;
    const currentSongPath = playbackStore.currentSong?.path;
    if (
      playingUrl
      && playingQuality === q
      && currentSongPath === song.path
    ) {
      if (isDegradedLossless(q, playingUrl)) {
        console.warn(`[Download] 缓存复用跳过：${q} 目标为无损但播放缓存为 ${extFromUrl(playingUrl)}`);
      } else {
        try {
          const cached = await downloadApi.isStreamCached(playingUrl);
          if (cached) {
            const destPath = await resolveDownloadFullPath(song, playingUrl, q, options);
            try {
              await downloadApi.copyStreamCache(playingUrl, baseName(destPath));
              try {
                await downloadApi.decryptQmcFile(destPath, song.remote_ekey);
              } catch (decryptErr: any) {
                console.warn(`[Download] 缓存文件解密失败:`, decryptErr?.message || decryptErr);
              }
              options.onProgress?.(100);
              filePath = destPath;
              hitQuality = q;
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

    let resolved: ResolvedOnlineQualityUrl | null;
    try {
      const preResolved = options.preResolvedUrls?.[q];
      if (preResolved && !isPlugin) {
        resolved = { quality: q, url: preResolved };
      } else {
        resolved = await resolveAudio(q);
      }
      if (!resolved?.url) {
        errors.push(`${q}: 返回空链接`);
        continue;
      }
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : (e?.message || String(e));
      errors.push(`${q}: 解析失败 ${msg}`);
      console.warn(`[Download] 获取 ${q} 音源失败:`, msg);
      continue;
    }

    const destPath = await resolveDownloadFullPath(song, resolved.url, resolved.quality, options);

    try {
      filePath = await downloadFromUrl(resolved.url, baseName(destPath), options.onProgress, resolved.ekey, resolved.headers);
      hitQuality = resolved.quality;
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


  let savedLyricText: string | null = null;
  if (options.downloadLyrics || options.embedLyrics) {
    savedLyricText = await fetchLyricText(song, options.lyricsFormat, options.lyricsStyle);
  }

  let coverUrl: string | null = null;
  if (options.downloadCover || options.embedCover) {
    coverUrl = await resolveCoverUrl(song);
  }

  const savedBase = baseName(filePath);
  const dot = savedBase.lastIndexOf('.');
  const fileBase = dot === -1 ? savedBase : savedBase.slice(0, dot);

  const lyricsPath = (options.downloadLyrics && savedLyricText)
    ? `${fileBase}.${options.lyricsFormat}`
    : null;

  let coverPath: string | null = null;
  if (options.downloadCover && coverUrl) {
    coverPath = `${fileBase}.jpg`;
  }

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
    coverData: undefined,
    coverMime: undefined,
  } : null;

  let lyricsSaved = false;
  let coverSaved = false;
  let metadataEmbedded = false;

  if (lyricsPath || coverUrl || metadataRequest) {
    try {
      const result = await downloadApi.finalizeDownloadExtras({
        lyricsText: lyricsPath ? savedLyricText : null,
        lyricsPath,
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

  let lyricsText: string | null = null;
  if (options.downloadLyrics) {
    lyricsText = await fetchLyricText(song, options.lyricsFormat, options.lyricsStyle);
  }

  let coverUrl: string | null = null;
  if (options.downloadCover) {
    coverUrl = await resolveCoverUrl(song);
  }

  const lyricsPath = (options.downloadLyrics && lyricsText)
    ? `${base}.${options.lyricsFormat}`
    : null;
  const coverPath = (options.downloadCover && coverUrl)
    ? `${base}.jpg`
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