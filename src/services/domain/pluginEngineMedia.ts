/**
 * 插件引擎 · 媒体操作。
 *
 * 播放 URL（getMediaSource + 同歌去重 + Baka 转交）、歌词、封面、视频源、
 * 歌曲评论等「取内容」类插件调用。仅依赖 pluginEngineBase / pluginEngineInstance
 * 与外部工具模块，作为叶子被 pluginEngine 门面消费。
 */
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
import { buildBakaMfLyricsRaw } from './bakaMfLyricsBuilder';
import { normalizeMediaRequestHeaders, sanitizeMediaUrl } from '../../utils/mediaUrl';
import { BakaPluginManager } from './bakaPluginManager';
import { fetchPlatformMusicComments } from './platformComments';
import { pluginApi } from '../tauri/pluginApi';

// ==================== 获取播放 URL（与 MusicFree PluginMethodsWrapper.getMediaSource 完全一致）====================

/**
 * 获取播放 URL
 *
 * MusicFree PluginMethodsWrapper.getMediaSource() 核心逻辑：
 *   const { url, headers } = (await parserPlugin.instance.getMediaSource(musicItem, quality))
 *     ?? { url: musicItem?.qualities?.[quality]?.url };
 *   if (!url) { throw new Error("NOT RETRY"); }
 *   // 重试逻辑：retryCount > 0 && e?.message !== "NOT RETRY" → delay(150) → 递归重试
 *
 * 音质适配策略（兼容 Toskysun 系列插件与原版 MusicFree 插件）：
 *   1. 先用 QualityKey 直接传入（Toskysun 插件原生支持 12 档键值）
 *   2. 若返回空/失败，回退到 standard/high/lossless（原版 MusicFree 插件）
 */
// ==================== 同歌并发/连发探测去重 ====================
// 同一首歌在极短时间内可能被"起播解析、音质菜单刷新、切音质"等多路并发发起
// getMediaSource。MF/Baka 插件脚本常在一次调用内部对多档上游 API 逐个请求，
// 每一路都会放大请求次数。这里对 (插件, 歌曲id, 目标音质, 回退方向) 做窗口内去重，
// 让并发的多路共享同一份解析结果，避免重复探测。
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
  // [同歌去重] 并发/连发的多路请求共享同一份解析结果
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
      // 完成后在窗口内保留，供紧接着的连发复用；窗口过后自动回收，避免内存残留
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

  // BakaMusic API 向下兼容 MusicFree，但播放音质应优先使用 Baka 原生键。
  // 即使外层仍调用 MF 入口，也在这里统一转交 BakaPluginManager，
  // 防止 Baka 系插件被传入 standard/high/lossless 后报“不支持音质”。
  if (await BakaPluginManager.isBakaPlugin(source)) {
    return BakaPluginManager.getMediaSource(source, item, quality, fallbackBehavior, availableQualities);
  }

  if (typeof inst.instance.getMediaSource !== 'function') {
    log(`[${source.name}] 无 getMediaSource 函数`);
    return null;
  }

  // 与 MusicFree 完全一致：传入 resetMediaItem 后的对象
  // 搜索时已经对每个 item 调用过 resetMediaItem，rawData 就是那个对象
  const musicItem = item.rawData
    ? resetMediaItem(item.rawData, source.name)
    : resetMediaItem(item, source.name);

  // 构建音质尝试列表（含自动降级/升级）
  // 本函数仅处理原版 MusicFree 插件（standard/high/lossless 三档）
  // Baka/Toskysun 系列插件请使用 pluginGetBakaMusicInfo
  const isQualityKey = (q: string): q is QualityKey => q in QUALITY_META;

  // [MF 四级音质适配] 原版 MusicFree 插件 getMediaSource 的入参是 MusicFree 固有的四级键
  // low / standard / high / super（约相当于 128k / 320k / FLAC / 超高），而非插件在
  // supportedQualities 里声明的字符串。时迁酱等新式 MF 插件同样如此：其内部 QUALITY_MAPPING
  // 只认这 4 个键，声明 '128k'/'320k'/'flac'/'flac24bit' 仅用于展示。若按声明值直传原生键，
  // 128k/flac 等在插件 QUALITY_MAPPING 里查不到映射，会全部回退到默认档（如 320k），
  // 导致音质列表塌缩成只有一档。因此统一用 qualityKeyToMfQuality 把内部 12 档映射到四级键；
  // 个别只认原生键的插件会在四级键报「不支持音质」后由下方兜底逻辑补试原生键。
  const MF_QUALITY_ORDER = ['low', 'standard', 'high', 'super'] as const;

  // [音质解析] 当有可用音质列表时，使用 resolveOnlinePlayQuality 统一解析
  // 原版 MF 插件：多个 QualityKey 映射到同一四级键时去重
  const tryPairs: Array<{ pluginQ: string; qualityKey: QualityKey }> = [];

  // [MF 音质顺序对齐 MusicFree 官方 getQualityOrder]
  // 官方默认 order='asc'：qualityOrder = [首选, ...更高侧, ...更低侧]（先向更高扩展再降到更低），
  // 而非旧的"唯一侧线性 lower/higher"。逐级调用 getMediaSource 直到拿到有效 URL 为止。
  // pause 时仅尝试首选。
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
        // 代表内部档：首选档（映射到该四级键）优先；否则在可用列表里挑映射到该级的档。
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
      // 保底：首选不在可用映射集时也尝试首选一次，交由插件自行回落。
      if (tryPairs.length === 0) {
        tryPairs.push({ pluginQ: baseMf, qualityKey: quality });
      }
    } else {
      // 无可用列表：按官方 asc 顺序遍历四级键，插件内部自行回落。
      for (const mf of order) {
        tryPairs.push({ pluginQ: mf, qualityKey: quality });
      }
    }
  } else {
    // 插件/调用方已直接给出 MF 键（'low'/'standard'/'high'/'super' 或旧 'lossless'）时原样使用
    tryPairs.push({ pluginQ: quality, qualityKey: '320k' });
  }

  const tryQualities = tryPairs.map(p => p.pluginQ);

  log(`[getMediaSource] 调用 ${source.name}, id=${musicItem.id}, platform=${musicItem.platform}, tryQualities=${JSON.stringify(tryQualities)}`);

  let result: any = null;
  let lastError: any = null;
  let successPairIdx = -1;
  let successQualityKey: QualityKey | undefined;
  // [歌曲级错误] 当插件返回"歌曲不存在"等歌曲级错误时，换音质无法解决，
  // 立即跳出音质循环，避免对同一首不可用的歌曲发起多次无意义的请求。
  let songLevelErrorDetected = false;

  for (let pairIdx = 0; pairIdx < tryQualities.length; pairIdx++) {
    const q = tryQualities[pairIdx];
    // 与 MusicFree 第269行一致，带重试
    for (let retry = 0; retry <= 1; retry++) {
      try {
        result = await inst.instance.getMediaSource(musicItem, q);
        if (result?.url) break;
      } catch (e: any) {
        lastError = e;
        const errMsg = e?.message || (typeof e === 'string' ? e : String(e || ''));
        log(`[getMediaSource] quality=${q} 第${retry + 1}次异常: ${errMsg}`);
        // [歌曲级错误] 检测"歌曲不存在"/"版权限制"/"VIP"等错误，换音质无意义，立即停止
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

  // 兼容修复：部分 QQ/MusicFree 插件实际接收 flac/320k/128k/super 等原生键，
  // 但没有被 Baka/Toskysun 检测命中。旧三档 lossless/high/standard 全部报
  // “不支持音质”时，补试原生键，避免可播放歌曲被误判为无法播放。
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
    return null;
  }

  const rawUrl = typeof result.url === 'string' ? result.url : '';
  let url = sanitizeMediaUrl(rawUrl);
  // 兜底：如果 sanitizeMediaUrl 未清除首尾非 URL 字符，用 indexOf 强制提取
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
  // [修复防御]: 提取插件 getMediaSource 返回的歌词和封面
  // 兼容多种字段名：lyric / rawLrc / lrc（不同插件返回字段名可能不同）
  const lyric = result.lyric || result.rawLrc || result.lrc || '';
  const ttml = result.ttml || '';
  const tlyric = result.tlyric || result.translation || '';
  const lxlyric = result.lxlyric || '';
  // 逐字歌词：兼容 yrc（网易云）/ qrc（QQ 音乐，可能为 hex 加密串）/ eslrc（Baka 增强）字段
  // Baka/MF 专用构建器会按优先级 yrc > qrc > eslrc > lxlyric 仅选用一种，避免格式混合导致解析失败
  const yrc = result.yrc || '';
  const qrc = result.qrc || '';
  const eslrc = result.eslrc || '';
  const coverUrl = result.coverUrl || result.artwork || '';
  if (!url) {
    log(`[getMediaSource] ${source.name} 返回空URL, result=${JSON.stringify(result)?.substring(0, 200)}`);
    (globalThis as any).__lastPluginError = `[${source.name}] 返回空URL`;
    return null;
  }
  if (rawUrl && rawUrl !== url) {
    log(`[getMediaSource] 已清洗异常URL: ${rawUrl.substring(0, 120)} -> ${url.substring(0, 120)}`);
  }

  // 实际播放音质（用于底部栏同步显示）
  const requestedSuccessQuality = successQualityKey ?? (successPairIdx >= 0 ? tryPairs[successPairIdx].qualityKey : undefined);
  const actualQuality = inferActualQualityFromPluginResult(result, url, requestedSuccessQuality);

  // 使用 Baka/MF 专用构建器构建歌词文本（优先级：ttml > yrc > qrc > eslrc > lxlyric > lyric）
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

/**
 * 检测插件是否为 Baka/Toskysun 系列。
 *
 * 委托给 BakaPluginManager，支持沙箱和直接执行两种模式的检测。
 */
export async function isBakaPlugin(source: PluginSource): Promise<boolean> {
  return BakaPluginManager.isBakaPlugin(source);
}

/**
 * Baka/Toskysun 系列插件专用播放 URL 获取方法。
 *
 * 委托给 BakaPluginManager.getMediaSource，内置 newToLegacyQualityMap 回退。
 */
export async function pluginGetBakaMusicInfo(
  source: PluginSource,
  item: PluginSearchResult,
  quality: QualityKey | 'standard' | 'high' | 'lossless' = '320k',
  fallbackBehavior: OnlineQualityFallbackBehavior = 'lower',
  availableQualities: QualityKey[] | null = null,
): Promise<PluginMusicInfo | null> {
  // 确保插件实例已加载
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
  /** 插件上报的可用画质列表（getMvSource 扩展；供底栏画质菜单展示） */
  availableVideoQualities?: PluginVideoQuality[];
}

/** 调用插件的视频解析扩展；未实现 getMvSource 的旧插件返回 null，由调用方走兜底解析。 */
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
          .filter((entry: any): entry is Record<string, unknown> => !!entry && typeof entry === 'object'
            && typeof entry.quality === 'string' && entry.quality.trim())
          .map((entry: Record<string, unknown>) => ({
            key: String(entry.quality).trim(),
            label: typeof entry.label === 'string' ? entry.label : undefined,
            height: Number.isFinite(Number(entry.height)) ? Number(entry.height) : undefined,
            bitrate: Number.isFinite(Number(entry.bitrate)) ? Number(entry.bitrate) : undefined,
            size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : undefined,
            codec: typeof entry.codec === 'string' ? entry.codec : undefined,
          }))
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
    log(`[getMvSource] ${source.name} 调用失败: ${error}`);
    return null;
  }
}

// ==================== 获取歌词（与 MusicFree PluginMethodsWrapper.getLyric 完全一致）====================

/**
 * 获取歌词
 *
 * MusicFree PluginMethodsWrapper.getLyric() 核心逻辑：
 *   lrcSource = (await this.plugin.instance?.getLyric?.(resetMediaItem(musicItem, undefined, true))?.catch(() => null)) || null;
 *   rawLrc = lrcSource?.rawLrc || rawLrc;
 *   translation = lrcSource?.translation || null;
 *
 * Toskysun 系列插件扩展返回 lxlyric（逐字歌词字段）。
 * 原版 MF 插件（如 Baka 插件）可能返回 yrc（网易云）/ qrc（QQ 音乐）字段。
 * Baka 插件还可能返回 eslrc（增强型逐字歌词）和 romanization（罗马音）。
 * 使用 Baka/MF 专用构建器构建为 lyricsRaw 文本（优先级：yrc > qrc > eslrc > lxlyric > lyric）。
 * Baka/MF 不再调用 LX 后端歌词接口补逐字，避免歌词链路串线。
 */

export async function pluginGetLyric(
  source: PluginSource,
  item: PluginSearchResult,
): Promise<{ lyric: string; tlyric?: string; lxlyric?: string; yrc?: string; qrc?: string; eslrc?: string; ttml?: string; lyricsRaw?: string } | null> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return null;

  // Baka 插件支持 yrc/qrc/eslrc/lxlyric/ttml 等逐字歌词扩展，
  // 优先交给 BakaPluginManager 构建 lyricsRaw，再回退到原 MF 字段兼容逻辑。
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

    // 与 MusicFree 第465~467行一致
    const lrcSource = (await inst.instance.getLyric(musicItem)?.catch((e: any) => {
      log(`[getLyric] ${source.name} 调用异常: ${e?.message ?? e}`);
      return null;
    })) || null;

    if (!lrcSource) {
      log(`[getLyric] ${source.name} 返回空结果`);
      return null;
    }

    // 兼容多种字段名：rawLrc / lyric / lrc（标准 MF 返回 rawLrc，部分插件返回 lyric 或 lrc）
    const rawLrc = lrcSource.rawLrc || lrcSource.lyric || lrcSource.lrc || '';
    const ttml = lrcSource.ttml || '';
    // 兼容多种翻译字段名：translation / tlyric / translateLyric
    const translation = lrcSource.translation || lrcSource.tlyric || lrcSource.translateLyric || '';
    // 罗马音字段（Baka 插件扩展）
    const romanization = lrcSource.romanization || lrcSource.rlyric || '';
    // 逐字歌词字段：lxlyric（Toskysun 系列）/ yrc（网易云）/ qrc（QQ 音乐，可能为 hex 加密串）
    // eslrc（Baka 增强型逐字歌词）
    const lxlyric = lrcSource.lxlyric || '';
    const yrc = lrcSource.yrc || '';
    const qrc = lrcSource.qrc || '';
    const eslrc = lrcSource.eslrc || '';

    if (!rawLrc && !ttml && !lxlyric && !yrc && !qrc && !eslrc) {
      log(`[getLyric] ${source.name} rawLrc 为空, lrcSource keys: ${Object.keys(lrcSource).join(',')}`);
      return null;
    }
    // 使用 Baka/MF 专用构建器构建歌词文本（优先级：ttml > yrc > qrc > eslrc > lxlyric > lyric）
    // 罗马音作为附加轨道（与翻译一样由后端按时间戳聚类）
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
  // Baka 插件：先确保实例加载，再委托给 BakaPluginManager
  if (await BakaPluginManager.isBakaPlugin(source)) {
    await ensurePluginInstance(source);
    return BakaPluginManager.getCover(source, item);
  }

  const inst = await ensurePluginInstance(source);
  if (!inst) return null;

  const rawItem = item.rawData || item;
  // 网易云检测：音源标识、插件名，或 rawData 携带网易云专属的 al 专辑结构
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
      // 升级 https：避免 http 封面被 WebView2 混合内容拦截、或被前端 needsProxy 误判走后端代理而失败
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
      // getMusicInfo 返回的时长补全到 item（搜索结果常缺 duration）
      if (result && !item.duration) {
        const dur = extractDurationMs(result);
        if (dur) item.duration = dur;
      }
      // 兼容多种封面字段名（不同插件返回的字段名可能不同）
      const coverUrl = extractCoverUrl(result);
      if (coverUrl) return coverUrl;
      // getMusicInfo 无封面时，网易云走专辑接口兜底（song/detail 常被限流）
      const albumCover = await tryNeteaseAlbumCover();
      if (albumCover) return albumCover;
      return item.coverUrl || null;
    }
    // 插件未提供 getMusicInfo 时，网易云同样走专辑接口兜底
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

/**
 * 获取歌曲评论（Baka 插件扩展方法）
 *
 * 优先委托给 BakaPluginManager.getMusicComments（插件自实现评论 API）；
 * 插件未实现或调用失败时（getMusicComments 是 BakaMusic 扩展，原版
 * MusicFree 插件没有），按歌曲平台走宿主直连评论接口兜底——歌曲 id
 * 全平台通用，评论区对 MF 插件歌曲同样可用。
 */
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