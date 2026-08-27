/**
 * 在线下载服务 · 执行编排层。
 *
 * 汇聚歌词/封面解析（fetchLyricText / resolveCoverUrl）、下载路径计算与冲突解析、
 * Rust 流式下载（downloadFromUrl）与主编排（downloadSong / downloadSongExtras）。
 *
 * 依赖 downloadQualityResolver 的直链解析、downloadFormat 的格式化纯函数，
 * 不直接接触插件沙箱细节。
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { DownloadFileNameStyle, DownloadLyricsStyle, DownloadQuality, DownloadQualityFallbackBehavior, Song, QualityKey } from '../../types';
import { downloadApi } from '../tauri/downloadApi';
import type { EmbedMetadataRequestContract } from '../tauri/contracts';
import {
  isDegradedLossless,
} from './audioQualityVerify';
import { usePlaybackStore } from '../../features/playback/store';
import {
  getStoredPlugins,
  pluginGetCover,
  pluginGetLyric,
} from './pluginEngine';
import { ensureLxPluginInstance, lxPluginGetLyric, lxPluginGetPic } from './lxPluginEngine';
import {
  parseLxPath,
  resolveLxCachedInfo,
  findLxPluginForSource,
  buildLxSongInfo,
  resolveLxUrlViaRust,
} from './lxUrlResolver';
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
  buildDownloadFileName,
  buildFileNameBase,
  sanitizeFileName,
  extFromUrl,
} from './downloadFormat';

/** 获取歌词文本（lrc 或纯文本）用于一并下载 */
export async function fetchLyricText(
  song: Song,
  format: 'lrc' | 'txt',
  lyricsStyle: DownloadLyricsStyle,
): Promise<string | null> {
  const path = song.cue_source_path || song.path;

  // 尝试从歌曲对象或当前播放器 state 中提取已有的歌词文本作为兜底
  const playbackStore = usePlaybackStore();
  const playingSong = playbackStore.currentSong;
  const existingLyric = (song as any).lyrics
    || (song as any).lyric
    || (song as any).lyrics_raw
    || (playingSong?.path === path ? ((playingSong as any).lyrics || (playingSong as any).lyrics_raw) : null)
    || null;

  const processFormat = (lyricText: string): string => {
    if (format === 'txt') {
      return lyricText
        .replace(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?]/g, '')
        .replace(/<\d+,\d+>/g, '')
        .replace(/\[\d+,\d+\]/g, '')
        .trim();
    }
    return lyricText.trim();
  };

  let fetched: string | null = null;

  // plugin:// 协议：通过 MusicFree 插件引擎获取歌词
  if (path?.startsWith('plugin://')) {
    fetched = await fetchPluginLyricText(song, format, lyricsStyle);
  } else if (path?.startsWith('lx://')) {
    // lx:// 协议：通过落雪插件引擎获取歌词
    const pathInfo = parseLxPath(path);
    if (pathInfo) {
      const { source: lxSource, songmid } = pathInfo;
      try {
        const matchedPlugin = findLxPluginForSource(lxSource);
        if (matchedPlugin) {
          await ensureLxPluginInstance(matchedPlugin);
          const cachedInfo = resolveLxCachedInfo(song, lxSource, songmid);
          const songInfo = buildLxSongInfo(song, songmid, lxSource, cachedInfo);
          const result = await lxPluginGetLyric(matchedPlugin, lxSource, songInfo as any);

          const preferWordByWord = lyricsStyle === 'word-by-word';
          const wordLyric = result?.lxlyric || result?.yrc || result?.qrc;
          const lineLyric = result?.lyric;
          const lyric = (preferWordByWord && wordLyric) ? wordLyric : (lineLyric || wordLyric || '');
          if (lyric) {
            fetched = processFormat(lyric);
          }
        }
      } catch (e: any) {
        console.warn('[Download] 获取歌词失败:', e?.message);
      }
    }
  }

  if (fetched && fetched.trim().length > 0) {
    return fetched;
  }

  // 兜底：若网络请求未获取到，但歌曲原本带有一份歌词文本，使用原歌词
  if (existingLyric && typeof existingLyric === 'string' && existingLyric.trim().length > 0) {
    return processFormat(existingLyric);
  }

  return null;
}

/** plugin:// 协议获取歌词：调用 MusicFree 插件的 getLyric 方法 */
async function fetchPluginLyricText(
  song: Song,
  format: 'lrc' | 'txt',
  lyricsStyle: DownloadLyricsStyle,
): Promise<string | null> {
  const pluginId = song.plugin_id || song.rawData?.pluginId;
  if (!pluginId) return null;
  const pluginSearchResult = song.rawData || { ...song, pluginId };

  try {
    const plugins = getStoredPlugins();
    const pluginSource = plugins.find(p => p.id === pluginId && p.enabled);
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
  qualityFallbackBehavior?: DownloadQualityFallbackBehavior;
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
  ekey?: string | null,
  headers?: Record<string, string> | null,
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
    const filePath = await downloadApi.downloadOnlineSong(url, destPath, ekey, headers);
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
    ? await preparePluginResolveContext(song, options.quality, options.qualityFallbackBehavior)
    : await prepareResolveContext(song, options.quality, options.qualityFallbackBehavior);
  if (!ctx) {
    throw new Error('无法解析该歌曲的音源信息');
  }

  /** 在当前协议下解析某个档位的完整音源信息（含 ekey/headers） */
  const resolveAudio = (q: LxQuality): Promise<ResolvedOnlineQualityUrl | null> =>
    isPlugin
      ? resolvePluginAudioForQuality(ctx as PluginResolveContext, q)
      : resolveLxAudioForQuality(ctx as ResolveDownloadContext, q);

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
              // 缓存文件可能为 QMC2 加密数据（播放时由 QmcDecryptReader 流式解密，
              // 缓存文件本身保持加密），复制后需原地解密才能正常播放/读取标签。
              // song.remote_ekey 在搜索/详情页阶段已填充；若未填充则由 Rust 侧尝试从文件 footer 提取。
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
      // 探测阶段已解析出该档位直链时直接复用，省掉一次插件请求。
      // 但 plugin:// 协议的 Baka 插件加密音源需要 ekey，preResolvedUrls 只有 URL 不含 ekey，
      // 必须重新解析获取完整结果。LX 协议无加密，可直接复用 preResolvedUrls。
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

    // 使用 resolved.quality（已修正为实际音质）而非请求档位 q，
    // 确保文件扩展名和下载记录与真实音频格式一致。
    const destPath = await resolveDownloadFullPath(song, resolved.url, resolved.quality, options);

    try {
      filePath = await downloadFromUrl(resolved.url, destPath, options.onProgress, resolved.ekey, resolved.headers);
      hitQuality = resolved.quality;
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
        const rustResult = await resolveLxUrlViaRust(cachedInfo, lxCtx.candidates);
        if (rustResult) {
          const q = rustResult.quality;
          const destPath = await resolveDownloadFullPath(song, rustResult.url, q, options);
          try {
            filePath = await downloadFromUrl(rustResult.url, destPath, options.onProgress);
            hitQuality = q;
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

  // [QQ/网易云插件原生适配] 插件全档位下载失败时不借用 LX 音源兜底：
  // 如实失败并透出插件错误，避免音质与音源来源不一致。

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