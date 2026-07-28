/**
 * 在线歌曲下载服务
 *
 * 负责：解析 lx:// 在线歌曲的真实音源直链（按音质映射 + 自动回退）、
 * 计算目标文件路径（扩展名以真实音源为准、命名冲突处理）、
 * 调用 Rust 命令流式下载，并可选下载歌词。
 */
import { invoke } from '@tauri-apps/api/core';

import type { DownloadQuality, Song } from '../types';

/** 落雪音源内部音质档位 */
export type LxQuality = '128k' | '320k' | 'flac' | 'flac24bit';

/**
 * 在 Web Worker 线程里用 fetch 拉取音频数据（模仿 MusicFreeDesktop）。
 * IDM 等下载器对 WebView2 的拦截主要作用于主线程，Worker 线程的请求通常能逃过。
 * 返回音频字节；失败（含被拦截、CORS、网络异常）时抛错，由调用方回退到 Rust 下载。
 */
function fetchViaWorker(
  url: string,
  onProgress?: (percent: number) => void,
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

    worker.postMessage({ url });
  });
}

/**
 * 将 UI 下载音质映射为落雪档位候选列表（按优先级排序）。
 * 首选不可用时自动回退到较低音质，保证能下到文件。
 */
export function qualityToLxCandidates(quality: DownloadQuality): LxQuality[] {
  switch (quality) {
    case 'lossless':
      return ['flac24bit', 'flac', '320k', '128k'];
    case 'high':
      return ['320k', '128k'];
    case 'standard':
      return ['128k', '320k'];
    default:
      return ['320k', '128k'];
  }
}

/** 判断是否为可下载的在线歌曲（lx:// 协议） */
export function isDownloadableOnlineSong(
  song: { path?: string; source_type?: string } | null | undefined,
): boolean {
  if (!song) return false;
  return song.source_type === 'remote' && (song.path?.startsWith('lx://') ?? false);
}

/** 清洗文件名中的非法字符（Windows 与跨平台通用） */
export function sanitizeFileName(name: string): string {
  return name
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
  return quality === 'flac' || quality === 'flac24bit' ? '.flac' : '.mp3';
}

/**
 * 构造下载文件名（不含目录）。
 * keepSourceFilename 为真时使用 URL 原始文件名，否则用 "歌手 - 标题"。
 */
export function buildDownloadFileName(
  song: Song,
  url: string,
  hitQuality: LxQuality,
  keepSourceFilename: boolean,
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

  const title = song.title || song.name || '未知歌曲';
  const artist = song.artist || '';
  const base = artist ? `${artist} - ${title}` : title;
  return sanitizeFileName(base) + ext;
}

/** 解析 lx:// 歌曲的真实音源直链，按音质候选逐个尝试 */
export async function resolveDownloadUrl(
  song: Song,
  quality: DownloadQuality,
): Promise<{ url: string; hitQuality: LxQuality } | null> {
  const path = song.cue_source_path || song.path;
  if (!path || !path.startsWith('lx://')) return null;

  const parts = path.replace('lx://', '').split('/');
  const lxSource = parts[0];
  const songmid = parts.slice(1).join('/');
  if (!lxSource || !songmid) return null;

  const { getStoredPlugins } = await import('./pluginEngine');
  const { lxPluginGetMusicUrl, ensureLxPluginInstance } = await import('./lxPluginEngine');
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

  const errors: string[] = [];
  for (const q of qualityToLxCandidates(quality)) {
    try {
      const result = await lxPluginGetMusicUrl(matchedPlugin, lxSource, baseSongInfo as any, q);
      const url = result?.url;
      if (url && /^https?:/.test(url)) {
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
  if (!path || !path.startsWith('lx://')) return null;

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
      return lyric.replace(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').trim();
    }
    return lyric;
  } catch (e: any) {
    console.warn('[Download] 获取歌词失败:', e?.message);
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
 * 下载在线歌曲主编排：解析直链 → 计算目标路径 → 流式下载 → 可选下载歌词。
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

  const resolved = await resolveDownloadUrl(song, options.quality);
  if (!resolved) {
    throw new Error('无法获取该歌曲的音源，可能无版权或音源暂不可用');
  }

  const fileName = buildDownloadFileName(
    song,
    resolved.url,
    resolved.hitQuality,
    options.keepSourceFilename,
  );
  let destPath = joinPath(options.downloadDir, fileName);
  if (!options.overwriteExisting) {
    destPath = await resolveNonConflictingPath(destPath);
  }

  // 优先在 Web Worker 线程里 fetch 拉取音频（模仿 MusicFree，规避 IDM 对主线程的拦截），
  // 再交给 Rust 写盘。若 Worker 下载失败（被拦截/CORS/网络异常），回退到 Rust reqwest 直接下载
  // （Rust 侧带完整性校验，数据不完整会删除坏文件并报错，避免留下无法播放的残缺文件）。
  let filePath: string;
  try {
    const bytes = await fetchViaWorker(resolved.url, options.onProgress);
    if (bytes.length === 0) {
      throw new Error('下载数据为空');
    }
    filePath = await invoke<string>('save_download_bytes', {
      data: bytes,
      destPath,
    });
    options.onProgress?.(100);
  } catch (workerErr: any) {
    console.warn('[Download] Worker 下载失败，回退到后端下载:', workerErr?.message || workerErr);
    filePath = await invoke<string>('download_online_song', {
      url: resolved.url,
      destPath,
    });
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

  return { filePath, hitQuality: resolved.hitQuality, lyricsSaved };
}
