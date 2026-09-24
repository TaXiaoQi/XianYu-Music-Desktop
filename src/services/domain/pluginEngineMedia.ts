import type {
  QualityKey,
  OnlineQualityFallbackBehavior,
  PluginSource,
  PluginSearchResult,
  PluginMusicInfo,
} from '../../types';
import { QUALITY_META, qualityKeyToMfQuality } from '../../types';
import {
  buildNativePluginQualityPairs,
  inferActualQualityFromPluginResult,
  isUnsupportedQualityError,
  log,
} from './pluginEngineBase';
import { ensurePluginInstance } from './pluginEngineInstance';
import {
  extractCoverUrl,
  extractDurationMs,
  resetMediaItem,
} from './pluginResultMappers';
import { isSongLevelError } from './lxPluginEngine';
import { buildBakaMfLyricsRaw, pluginLyricLooksEncrypted } from './bakaMfLyricsBuilder';
import { normalizeMediaRequestHeaders, sanitizeMediaUrl } from '../../utils/mediaUrl';
import { BakaPluginManager } from './bakaPluginManager';
import { fetchPlatformMusicComments } from './platformComments';
import { pluginApi } from '../tauri/pluginApi';

// ==================== 获取播放 URL（与 MusicFree PluginMethodsWrapper.getMediaSource 完全一致）====================

// ==================== 同歌并发/连发探测去重 ====================
const GET_MEDIA_SOURCE_DEDUP_WINDOW_MS = 400;
const _dedupGetMediaSource = new Map<
  string,
  { at: number; p: Promise<PluginMusicInfo | null> }
>();

function buildGetMediaSourceDedupKey(
  source: PluginSource,
  item: PluginSearchResult,
  quality: string,
  fallbackBehavior: string,
): string {
  const songId =
    (item?.rawData as any)?.songmid ??
    (item as any)?.songmid ??
    item?.id ??
    (item as any)?.hash ??
    '';
  return `${source.id}\u0001${songId}\u0001${quality}\u0001${fallbackBehavior}`;
}

export async function pluginGetMusicInfo(
  source: PluginSource,
  item: PluginSearchResult,
  quality: QualityKey | 'standard' | 'high' | 'lossless' = '320k',
  fallbackBehavior: OnlineQualityFallbackBehavior = 'lower',
  availableQualities: QualityKey[] | null = null,
): Promise<PluginMusicInfo | null> {
  const dedupKey = buildGetMediaSourceDedupKey(source, item, String(quality), String(fallbackBehavior));
  const now = Date.now();
  const hit = _dedupGetMediaSource.get(dedupKey);
  if (hit && now - hit.at <= GET_MEDIA_SOURCE_DEDUP_WINDOW_MS) {
    log(`[getMediaSource] 同一首歌并发探测去重，复用解析结果: ${dedupKey}`);
    return hit.p;
  }
  if (hit) _dedupGetMediaSource.delete(dedupKey);

  const p = runPluginGetMusicInfo(source, item, quality, fallbackBehavior, availableQualities);
  _dedupGetMediaSource.set(dedupKey, { at: now, p });
  p.then(
    () => {
      setTimeout(() => {
        if (_dedupGetMediaSource.get(dedupKey)?.p === p) _dedupGetMediaSource.delete(dedupKey);
      }, GET_MEDIA_SOURCE_DEDUP_WINDOW_MS);
    },
    () => {
      _dedupGetMediaSource.delete(dedupKey);
    },
  );
  return p;
}

async function runPluginGetMusicInfo(
  source: PluginSource,
  item: PluginSearchResult,
  quality: QualityKey | 'standard' | 'high' | 'lossless' = '320k',
  fallbackBehavior: OnlineQualityFallbackBehavior = 'lower',
  availableQualities: QualityKey[] | null = null,
): Promise<PluginMusicInfo | null> {
  (globalThis as any).__lastPluginError = '';
  const inst = await ensurePluginInstance(source);
  if (!inst) return null;

  if (await BakaPluginManager.isBakaPlugin(source)) {
    return BakaPluginManager.getMediaSource(source, item, quality, fallbackBehavior, availableQualities);
  }

  if (typeof inst.instance.getMediaSource !== 'function') {
    log(`[${source.name}] 无 getMediaSource 函数`);
    return null;
  }

  const musicItem = item.rawData
    ? resetMediaItem(item.rawData, source.name)
    : resetMediaItem(item, source.name);

  const isQualityKey = (q: string): q is QualityKey => q in QUALITY_META;

  const MF_QUALITY_ORDER = ['low', 'standard', 'high', 'super'] as const;

  const tryPairs: Array<{ pluginQ: string; qualityKey: QualityKey }> = [];

  const mfAscOrder = (baseMf: string): string[] => {
    const baseIdx = MF_QUALITY_ORDER.indexOf(baseMf as any);
    const order: string[] = [baseMf];
    for (let i = baseIdx + 1; i < MF_QUALITY_ORDER.length; i++) order.push(MF_QUALITY_ORDER[i]);
    for (let i = baseIdx - 1; i >= 0; i--) order.push(MF_QUALITY_ORDER[i]);
    return order;
  };

  if (isQualityKey(quality)) {
    const baseMf = qualityKeyToMfQuality(quality);
    const order = fallbackBehavior === 'pause' ? [baseMf] : mfAscOrder(baseMf);
    const hasAvail = availableQualities && availableQualities.length > 0;
    if (hasAvail) {
      const used = new Set<string>();
      for (const mf of order) {
        if (used.has(mf)) continue;
        let rep: QualityKey | null = null;
        if (qualityKeyToMfQuality(quality) === mf) {
          rep = quality;
        } else {
          rep = availableQualities.find(q => qualityKeyToMfQuality(q) === mf) ?? null;
        }
        if (!rep) continue;
        used.add(mf);
        tryPairs.push({ pluginQ: mf, qualityKey: rep });
      }
      if (tryPairs.length === 0) {
        tryPairs.push({ pluginQ: baseMf, qualityKey: quality });
      }
    } else {
      for (const mf of order) {
        tryPairs.push({ pluginQ: mf, qualityKey: quality });
      }
    }
  } else {
    tryPairs.push({ pluginQ: quality, qualityKey: '320k' });
  }

  const tryQualities = tryPairs.map(p => p.pluginQ);

  log(`[getMediaSource] 调用 ${source.name}, id=${musicItem.id}, platform=${musicItem.platform}, tryQualities=${JSON.stringify(tryQualities)}`);

  let result: any = null;
  let lastError: any = null;
  let successPairIdx = -1;
  let successQualityKey: QualityKey | undefined;
  let songLevelErrorDetected = false;

  for (let pairIdx = 0; pairIdx < tryQualities.length; pairIdx++) {
    const q = tryQualities[pairIdx];
    for (let retry = 0; retry <= 1; retry++) {
      try {
        result = await inst.instance.getMediaSource(musicItem, q);
        if (result?.url) break;
      } catch (e: any) {
        lastError = e;
        const errMsg = e?.message || (typeof e === 'string' ? e : String(e || ''));
        log(`[getMediaSource] quality=${q} 第${retry + 1}次异常: ${errMsg}`);
        if (isSongLevelError(errMsg)) {
          log(`[getMediaSource] 歌曲级错误，跳过剩余音质: ${errMsg}`);
          songLevelErrorDetected = true;
          break;
        }
        if (retry < 1) {
          await new Promise(r => setTimeout(r, 150));
        }
      }
    }
    if (songLevelErrorDetected) break;
    if (result?.url) {
      successPairIdx = pairIdx;
      successQualityKey = tryPairs[pairIdx].qualityKey;
      break;
    }
    log(`[getMediaSource] quality=${q} 未返回有效URL，尝试下一档`);
    result = null;
  }

  const lastErrorMsg = lastError?.message || (typeof lastError === 'string' ? lastError : String(lastError || ''));
  if (!result?.url && !songLevelErrorDetected && lastErrorMsg && isUnsupportedQualityError(lastErrorMsg)) {
    const triedQualities = new Set(tryQualities);
    const nativePairs = buildNativePluginQualityPairs(quality, fallbackBehavior, availableQualities)
      .filter(pair => !triedQualities.has(pair.pluginQ));
    if (nativePairs.length > 0) {
      log(`[getMediaSource] 旧三档音质均不支持，尝试插件原生音质键: ${JSON.stringify(nativePairs.map(p => p.pluginQ))}`);
    }
    for (const pair of nativePairs) {
      try {
        result = await inst.instance.getMediaSource(musicItem, pair.pluginQ);
        if (result?.url) {
          successQualityKey = pair.qualityKey;
          log(`[getMediaSource] 原生音质键 ${pair.pluginQ} 获取成功`);
          break;
        }
        log(`[getMediaSource] 原生音质键 ${pair.pluginQ} 未返回有效URL`);
      } catch (e: any) {
        lastError = e;
        const errMsg = e?.message || (typeof e === 'string' ? e : String(e || ''));
        log(`[getMediaSource] 原生音质键 ${pair.pluginQ} 异常: ${errMsg}`);
        if (isSongLevelError(errMsg)) {
          songLevelErrorDetected = true;
          break;
        }
      }
      result = null;
    }
  }

  if (!result || typeof result !== 'object') {
    const lastErrorText = lastError?.message || (typeof lastError === 'string' ? lastError : String(lastError || ''));
    const errMsg = lastError ? `异常: ${lastErrorText}` : (result === null ? '返回null' : `非对象(${typeof result})`);
    log(`[getMediaSource] ${source.name} 失败: ${errMsg}`);
    (globalThis as any).__lastPluginError = `[${source.name}] ${errMsg}`;
    throw new Error(`[${source.name}] getMediaSource ${errMsg}`);
  }

  const rawUrl = typeof result.url === 'string' ? result.url : '';
  let url = sanitizeMediaUrl(rawUrl);
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    const idx1 = rawUrl.indexOf('https://');
    const idx2 = rawUrl.indexOf('http://');
    const idx = idx1 >= 0 ? idx1 : idx2;
    if (idx >= 0) {
      url = rawUrl.substring(idx);
      while (url.length > 0) {
        const c = url.charCodeAt(url.length - 1);
        if (c === 0x2c || c === 0x3b || c === 0x60 || c === 0x27 || c === 0x22 || c <= 0x20) {
          url = url.substring(0, url.length - 1);
        } else break;
      }
    }
  }
  const headers = normalizeMediaRequestHeaders(url, result.headers || {}) || {};
  const mainLyricRaw = result.lyric || result.rawLrc || result.lrc || '';
  // Baka 系 crypt:1 返回未解密 QRC/e-lrc hex 密文（主文/译文同批加密），
  // 不能当歌词展示——密文置空，走「无歌词」
  const mainEncrypted = pluginLyricLooksEncrypted(mainLyricRaw);
  const lyric = mainEncrypted ? '' : mainLyricRaw;
  const ttml = result.ttml || '';
  const tlyric = mainEncrypted ? '' : (result.tlyric || result.translation || '');
  const lxlyric = result.lxlyric || '';
  const yrc = result.yrc || '';
  const qrc = result.qrc || '';
  const eslrc = result.eslrc || '';
  const coverUrl = result.coverUrl || result.artwork || '';
  if (!url) {
    const resultPreview = JSON.stringify(result)?.substring(0, 200);
    log(`[getMediaSource] ${source.name} 返回空URL, result=${resultPreview}`);
    (globalThis as any).__lastPluginError = `[${source.name}] 返回空URL: ${resultPreview}`;
    throw new Error(`[${source.name}] getMediaSource 返回空URL: ${resultPreview}`);
  }
  if (rawUrl && rawUrl !== url) {
    log(`[getMediaSource] 已清洗异常URL: ${rawUrl.substring(0, 120)} -> ${url.substring(0, 120)}`);
  }

  const requestedSuccessQuality = successQualityKey ?? (successPairIdx >= 0 ? tryPairs[successPairIdx].qualityKey : undefined);
  const actualQuality = inferActualQualityFromPluginResult(result, url, requestedSuccessQuality);

  const lyricsRaw = (ttml || lyric || tlyric || lxlyric || yrc || qrc || eslrc)
    ? buildBakaMfLyricsRaw({ ttml, lyric, tlyric, lxlyric, yrc, qrc, eslrc })
    : '';

  const headerKeys = Object.keys(headers);
  log(`[getMediaSource] 成功: url=${url.substring(0, 100)}, headers=[${headerKeys.join(',')}], lyricLen=${lyric.length}, ttmlLen=${ttml.length}, lxlyricLen=${lxlyric.length}, yrcLen=${yrc.length}, qrcLen=${qrc.length}, eslrcLen=${eslrc.length}, actualQuality=${actualQuality}`);
  return {
    url,
    headers: headers as Record<string, string>,
    lyric,
    ttml: ttml || undefined,
    tlyric,
    lxlyric,
    yrc,
    qrc,
    eslrc,
    lyricsRaw,
    coverUrl,
    actualQuality,
  };
}

// ==================== Baka 插件播放 URL（独立方法，不与 MusicFree 共用）====================

export async function isBakaPlugin(source: PluginSource): Promise<boolean> {
  return BakaPluginManager.isBakaPlugin(source);
}

export async function pluginGetBakaMusicInfo(
  source: PluginSource,
  item: PluginSearchResult,
  quality: QualityKey | 'standard' | 'high' | 'lossless' = '320k',
  fallbackBehavior: OnlineQualityFallbackBehavior = 'lower',
  availableQualities: QualityKey[] | null = null,
): Promise<PluginMusicInfo | null> {
  await ensurePluginInstance(source);
  return BakaPluginManager.getMediaSource(source, item, quality, fallbackBehavior, availableQualities);
}

// ==================== 获取视频源（Baka 扩展 getMvSource，用于背景视频）====================

export interface PluginVideoQuality {
  key: string;
  label?: string;
  height?: number;
  bitrate?: number;
  size?: number;
  codec?: string;
}

export interface PluginVideoSource {
  url: string;
  headers?: Record<string, string>;
  userAgent?: string;
  videoQuality?: string;
  mimeType?: string;
  codec?: string;
  duration?: number;
  width?: number;
  height?: number;
  backupUrls?: string[];
  expiresAt?: number;
  availableVideoQualities?: PluginVideoQuality[];
}

/// 最近一次 pluginGetVideoSource 是否因插件异常被吞成 null（区别于插件干净
/// 返回无结果）。供 MV 探测区分「存疑」与「确认无 MV」——JS 单线程内顺序
/// 调用，模块级标记即可（与移动端 _mvResolveAmbiguous 语义一致）。
let lastMvSourceCallFailed = false;

export function clearLastMvSourceCallFailed(): void {
  lastMvSourceCallFailed = false;
}

export function wasLastMvSourceCallFailed(): boolean {
  return lastMvSourceCallFailed;
}

export async function pluginGetVideoSource(
  source: PluginSource,
  item: PluginSearchResult,
  videoQuality?: string,
): Promise<PluginVideoSource | null> {
  const inst = await ensurePluginInstance(source);
  if (!inst || typeof inst.instance.getMvSource !== 'function') {
    return null;
  }

  const musicItem = item.rawData
    ? resetMediaItem(item.rawData, source.name)
    : resetMediaItem(item, source.name);

  try {
    const result = await inst.instance.getMvSource(musicItem, videoQuality);
    if (!result || typeof result !== 'object') return null;

    const url = typeof result.url === 'string' ? result.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) return null;

    const headers = result.headers && typeof result.headers === 'object' && !Array.isArray(result.headers)
      ? Object.fromEntries(
          Object.entries(result.headers)
            .filter(([key, value]) => key.trim() && typeof value === 'string' && value.trim())
            .slice(0, 64),
        ) as Record<string, string>
      : undefined;
    const backupUrls = Array.isArray(result.backupUrls)
      ? result.backupUrls.filter((value: unknown): value is string => (
          typeof value === 'string' && /^https?:\/\//i.test(value)
        )).slice(0, 4)
      : undefined;
    const availableVideoQualities = Array.isArray(result.availableVideoQualities)
      ? result.availableVideoQualities
          .filter((entry: any): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
          .map((entry: Record<string, unknown>) => {
            const key = typeof entry.key === 'string' && entry.key.trim()
              ? entry.key.trim()
              : (typeof entry.quality === 'string' ? entry.quality.trim() : '');
            return {
              key,
              label: typeof entry.label === 'string' ? entry.label : undefined,
              height: Number.isFinite(Number(entry.height)) ? Number(entry.height) : undefined,
              bitrate: Number.isFinite(Number(entry.bitrate)) ? Number(entry.bitrate) : undefined,
              size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : undefined,
              codec: typeof entry.codec === 'string' ? entry.codec : undefined,
            };
          })
          .filter((entry: { key: string }) => entry.key)
          .slice(0, 12)
      : undefined;

    return {
      url,
      headers,
      userAgent: typeof result.userAgent === 'string' ? result.userAgent : undefined,
      videoQuality: typeof result.videoQuality === 'string'
        ? result.videoQuality
        : (typeof result.quality === 'string' ? result.quality : undefined),
      mimeType: typeof result.mimeType === 'string' ? result.mimeType : undefined,
      codec: typeof result.codec === 'string' ? result.codec : undefined,
      duration: Number.isFinite(Number(result.duration)) ? Number(result.duration) : undefined,
      width: Number.isFinite(Number(result.width)) ? Number(result.width) : undefined,
      height: Number.isFinite(Number(result.height)) ? Number(result.height) : undefined,
      backupUrls,
      expiresAt: Number.isFinite(Number(result.expiresAt)) ? Number(result.expiresAt) : undefined,
      availableVideoQualities: availableVideoQualities?.length ? availableVideoQualities : undefined,
    };
  } catch (error) {
    // 标记本次调用因插件异常返回 null（区别于插件干净地返回无结果），
    // 供 MV 探测区分「存疑」与「确认无 MV」。
    lastMvSourceCallFailed = true;
    log(`[getMvSource] ${source.name} 调用失败: ${error}`);
    return null;
  }
}

// ==================== 获取歌词（与 MusicFree PluginMethodsWrapper.getLyric 完全一致）====================


export async function pluginGetLyric(
  source: PluginSource,
  item: PluginSearchResult,
): Promise<{ lyric: string; tlyric?: string; lxlyric?: string; yrc?: string; qrc?: string; eslrc?: string; ttml?: string; lyricsRaw?: string } | null> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return null;

  if (await BakaPluginManager.isBakaPlugin(source)) {
    return BakaPluginManager.getLyric(source, item);
  }

  try {
    if (typeof inst.instance.getLyric !== 'function') {
      log(`[getLyric] ${source.name} 插件未实现 getLyric 方法`);
      return null;
    }

    const musicItem = item.rawData
      ? resetMediaItem(item.rawData, source.name)
      : resetMediaItem(item, source.name);

    const lrcSource = (await inst.instance.getLyric(musicItem)?.catch((e: any) => {
      log(`[getLyric] ${source.name} 调用异常: ${e?.message ?? e}`);
      return null;
    })) || null;

    if (!lrcSource) {
      log(`[getLyric] ${source.name} 返回空结果`);
      return null;
    }

    const mainLrcRaw = lrcSource.rawLrc || lrcSource.lyric || lrcSource.lrc || '';
    // Baka 系 crypt:1 返回未解密 QRC/e-lrc hex 密文（主文/译文/罗马音同批加密），
    // 不能当歌词展示——密文置空，空判定自然走「无歌词」返回
    const lrcEncrypted = pluginLyricLooksEncrypted(mainLrcRaw);
    const rawLrc = lrcEncrypted ? '' : mainLrcRaw;
    const ttml = lrcSource.ttml || '';
    const translation = lrcEncrypted
      ? ''
      : (lrcSource.translation || lrcSource.tlyric || lrcSource.translateLyric || '');
    const romanization = lrcEncrypted ? '' : (lrcSource.romanization || lrcSource.rlyric || '');
    // 同 bakaPluginManagerMedia：lxlyric 为空且 lyric 内嵌词级时间戳时，lyric 即逐字内容
    const lxlyric = lrcSource.lxlyric
      || (/<\d{1,3}:\d{2}(?:\.\d{1,3})?>/.test(rawLrc) ? rawLrc : '');
    const yrc = lrcSource.yrc || '';
    const qrc = lrcSource.qrc || '';
    const eslrc = lrcSource.eslrc || '';

    if (!rawLrc && !ttml && !lxlyric && !yrc && !qrc && !eslrc) {
      log(`[getLyric] ${source.name} rawLrc 为空, lrcSource keys: ${Object.keys(lrcSource).join(',')}`);
      return null;
    }
    const lyricsRaw = buildBakaMfLyricsRaw({
      ttml,
      lyric: rawLrc,
      tlyric: translation,
      rlyric: romanization || null,
      lxlyric,
      yrc,
      qrc,
      eslrc,
    });
    log(`[getLyric] ${source.name} 成功, rawLrc长度=${rawLrc.length}, ttml长度=${ttml.length}, lxlyric长度=${lxlyric.length}, yrc长度=${yrc.length}, qrc长度=${qrc.length}, eslrc长度=${eslrc.length}`);

    return { lyric: rawLrc, tlyric: translation, lxlyric, yrc, qrc, eslrc, ttml, lyricsRaw };
  } catch (e) {
    log(`获取歌词失败: ${source.name} ${e}`);
    return null;
  }
}

// ==================== 获取封面 ====================

export async function pluginGetCover(
  source: PluginSource,
  item: PluginSearchResult,
): Promise<string | null> {
  if (await BakaPluginManager.isBakaPlugin(source)) {
    await ensurePluginInstance(source);
    return BakaPluginManager.getCover(source, item);
  }

  const inst = await ensurePluginInstance(source);
  if (!inst) return null;

  const rawItem = item.rawData || item;
  const neteaseSource =
    (source.sources && source.sources.includes('wy')) ||
    /网易云|netease/i.test(source.name || '') ||
    !!rawItem?.al?.id ||
    !!rawItem?.al?.picId_str ||
    !!rawItem?.al?.pic;
  const tryNeteaseAlbumCover = async (): Promise<string | null> => {
    if (!neteaseSource) return null;
    const raw = item.rawData || item;
    const albumId = raw?.al?.id ?? raw?.album?.id ?? raw?.albumId;
    const songmid = String(item.platformId || item.id || raw?.id || raw?.songmid || '');
    if (!songmid) return null;
    try {
      const cover = await pluginApi.getLxCover({
        songmid,
        source: 'wy',
        albumId: albumId ? String(albumId) : '',
        name: item.title,
        singer: item.artist,
        albumName: item.album,
      });
      return (cover && String(cover).replace(/^http:\/\//i, 'https://')) || null;
    } catch {
      return null;
    }
  };

  try {
    if (typeof inst.instance.getMusicInfo === 'function') {
      const musicItem = item.rawData
        ? resetMediaItem(item.rawData, source.name)
        : resetMediaItem(item, source.name);
      const result = await inst.instance.getMusicInfo(musicItem);
      if (result && !item.duration) {
        const dur = extractDurationMs(result);
        if (dur) item.duration = dur;
      }
      const coverUrl = extractCoverUrl(result);
      if (coverUrl) return coverUrl;
      const albumCover = await tryNeteaseAlbumCover();
      if (albumCover) return albumCover;
      return item.coverUrl || null;
    }
    const albumCover = await tryNeteaseAlbumCover();
    if (albumCover) return albumCover;
    return item.coverUrl || null;
  } catch {
    const albumCover = await tryNeteaseAlbumCover();
    if (albumCover) return albumCover;
    return item.coverUrl || null;
  }
}

// ==================== Baka 扩展：歌曲评论 ====================

export async function pluginGetMusicComments(
  source: PluginSource,
  item: PluginSearchResult,
  page: number = 1,
): Promise<{ isEnd?: boolean; data?: any[] } | null> {
  await ensurePluginInstance(source);
  const result = await BakaPluginManager.getMusicComments(source, item, page);
  if (result) return result;
  return fetchPlatformMusicComments(source, item, page);
}