/**
 * BakaPluginManager —— BakaMusic 系列插件独立管理器
 *
 * 基于 BakaMusic (https://github.com/Zencok/BakaMusic) 的插件系统设计，
 * 将所有 Baka/Toskysun 系列插件的操作独立为一个类，实现前后端机制分离：
 *
 * 架构：
 *   前端 BakaPluginManager (主线程)
 *     ├── 插件检测与生命周期管理
 *     ├── 音质回退映射 (newToLegacyQualityMap)
 *     ├── 歌词格式检测与构建
 *     ├── 评论获取
 *     └── 方法调用委托 → Worker 沙箱 (pluginSandboxManager)
 *
 *   Worker 沙箱 (pluginSandbox.worker.ts)
 *     ├── 插件代码隔离执行
 *     ├── env 环境构造 (getUserVariables, os, appVersion, lang)
 *     └── packages 注入 (axios, cheerio, crypto-js, dayjs 等)
 *
 *   Rust 后端
 *     ├── HTTP 请求代理 (pluginHttpRequest)
 *     ├── QMC2 音频解密 (qmc2.rs)
 *     └── 流式缓存播放 (stream_cache.rs)
 *
 * 支持的 Baka 插件方法（16 个，对齐 BakaMusic IPluginDefine）：
 *   search, getMediaSource, getMusicInfo, getLyric,
 *   getAlbumInfo, getMusicSheetInfo, getArtistWorks,
 *   getArtistInfo, importMusicSheet, importMusicItem,
 *   getTopLists, getTopListDetail, getRecommendSheetTags,
 *   getRecommendSheetsByTag, getMusicComments, getMusicDetailPageUrl
 */

import type {
  PluginSource,
  PluginSearchResult,
  PluginMusicInfo,
  PluginPlaylistSearchResult,
  QualityKey,
} from '../types';
import {
  QUALITY_META,
  ALL_QUALITY_KEYS,
  ALL_QUALITY_KEYS_DESC,
  BAKA_TO_LEGACY_QUALITY_MAP,
  normalizeQualityKey,
  resolveOnlinePlayQuality,
} from '../types';
import type { OnlineQualityFallbackBehavior } from '../types';
import { buildBakaMfLyricsRaw } from './bakaMfLyricsBuilder';
import { callSandboxMethod, isSandboxReady, getSandboxInstance } from './pluginSandboxManager';
import {
  resetMediaItem,
  extractCoverUrl,
  extractArtist,
  stripHtmlTags,
  toPluginSearchResult,
  extractResultList,
  qualityKeyToPluginString,
} from './pluginResultMappers';
import { isSongLevelError } from './lxPluginEngine';

// ==================== 日志 ====================

let _logCallback: ((msg: string) => void) | null = null;

function log(msg: string) {
  console.log(`[BakaPluginManager] ${msg}`);
  try { _logCallback?.(msg); } catch { /* ignore */ }
}

// ==================== 类型定义 ====================

/** Baka 歌词格式（对齐 BakaMusic ILyric.LyricFormat） */
type BakaLyricFormat =
  | 'ttml' | 'lrc' | 'lrc-a2' | 'yrc' | 'qrc'
  | 'eslrc' | 'lyl' | 'lys' | 'lqe' | 'plain';

/** Baka 评论项（对齐 BakaMusic IComment.IComment） */
interface BakaComment {
  id?: string;
  nickName: string;
  avatar?: string;
  comment: string;
  like?: number;
  createAt?: number;
  location?: string;
  replies?: BakaComment[];
}

/** Baka 评论结果（对齐 BakaMusic IGetCommentResult） */
interface BakaCommentResult {
  isEnd?: boolean;
  data?: BakaComment[];
}

/** Baka 插件实例接口（对齐 BakaMusic IPlugin.IPluginInstance） */
interface IBakaPluginInstance {
  platform: string;
  version?: string;
  appVersion?: string;
  srcUrl?: string;
  author?: string;
  description?: string;
  cacheControl?: string;
  primaryKey?: string[];
  defaultSearchType?: string;
  supportedSearchType?: string[];
  userVariables?: any[];
  hints?: Record<string, string[]>;
  /** Baka 系列特有：12 档音质声明 */
  supportedQualities?: string[];

  search?: (query: string, page: number, type: string) => Promise<any>;
  getMediaSource?: (musicItem: any, quality: string) => Promise<any>;
  getMusicInfo?: (musicBase: any) => Promise<any>;
  getLyric?: (musicItem: any) => Promise<any>;
  getAlbumInfo?: (albumItem: any, page: number) => Promise<any>;
  getMusicSheetInfo?: (sheetItem: any, page: number) => Promise<any>;
  getArtistWorks?: (artistItem: any, page: number, type: string) => Promise<any>;
  getArtistInfo?: (artistItem: any) => Promise<any>;
  importMusicSheet?: (urlLike: string) => Promise<any>;
  importMusicItem?: (urlLike: string) => Promise<any>;
  getTopLists?: () => Promise<any>;
  getTopListDetail?: (topListItem: any, page: number) => Promise<any>;
  getRecommendSheetTags?: () => Promise<any>;
  getRecommendSheetsByTag?: (tag: any, page?: number) => Promise<any>;
  getMusicComments?: (musicItem: any, page?: number) => Promise<any>;
  getMusicDetailPageUrl?: (musicItem: any) => Promise<any>;
}

/** Baka 插件方法名列表（16 个，对齐 BakaMusic pluginMethodNames） */
const BAKA_PLUGIN_METHODS = [
  'search', 'getMediaSource', 'getMusicInfo', 'getLyric',
  'getAlbumInfo', 'getMusicSheetInfo', 'getArtistWorks',
  'getArtistInfo', 'importMusicSheet', 'importMusicItem',
  'getTopLists', 'getTopListDetail', 'getRecommendSheetTags',
  'getRecommendSheetsByTag', 'getMusicComments', 'getMusicDetailPageUrl',
] as const;

// ==================== 音质回退映射（对齐 BakaMusic newToLegacyQualityMap）====================

/**
 * 新音质键 → 旧插件兼容音质键映射
 *
 * Baka 插件可能使用 12 档新音质键（如 '320k', 'flac'），
 * 也可能使用旧版 MusicFree 的 4 档键（low/standard/high/super）。
 * 当新键请求失败时，回退到旧键重试。
 */
const newToLegacyQualityMap: Record<string, string> = BAKA_TO_LEGACY_QUALITY_MAP;

/**
 * 清洗插件返回的媒体 URL。
 *
 * 部分 Baka/MF 插件会把音质参数拼成 `level=hires,` 这类尾随逗号形式，
 * 也可能把 URL 用反引号/引号包起来（例如 `https://...level=standard,`）。
 * 浏览器或后端播放器会把这些符号当成 URL 内容，导致请求到 JSON/错误页而不是音频。
 * 这里仅清理 URL 首尾包裹符号和尾随逗号/空白，不改动正常 URL。
 */
function sanitizeMediaUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';

  const stripUrlEdgeJunk = (value: string): string => {
    let current = value.trim();
    let previous = '';
    while (current && current !== previous) {
      previous = current;
      current = current
        .replace(/^[`'"\s]+/g, '')
        .replace(/[,`'"\s]+$/g, '');
    }
    return current;
  };

  const cleanedRaw = stripUrlEdgeJunk(raw);
  if (!cleanedRaw) return '';

  try {
    const url = new URL(cleanedRaw);
    let changed = false;
    for (const [key, value] of Array.from(url.searchParams.entries())) {
      const cleaned = stripUrlEdgeJunk(value);
      if (cleaned !== value) {
        url.searchParams.set(key, cleaned);
        changed = true;
      }
    }
    return changed ? url.toString() : cleanedRaw;
  } catch {
    return cleanedRaw;
  }
}

/**
 * 从插件返回的媒体 URL 参数中推断实际播放音质。
 *
 * 有些 Baka/MF 插件在请求高音质（如 master）时，会在插件内部自动降级，
 * 但仍返回一个可播放 URL，例如 `level=standard`。这种情况下不能继续把
 * 底部栏显示为 master，应以 URL 中的实际 level/quality 参数为准。
 */
function inferActualQualityFromMediaUrl(urlLike: string, fallback?: QualityKey): QualityKey | undefined {
  const legacyToQuality: Record<string, QualityKey> = {
    low: '128k',
    standard: '128k',
    high: '320k',
    exhigh: '320k',
    super: 'flac',
    lossless: 'flac',
  };

  try {
    const url = new URL(urlLike);
    const candidates = ['quality', 'level', 'br', 'bitrate', 'rate']
      .map(key => url.searchParams.get(key))
      .filter((value): value is string => !!value);

    for (const raw of candidates) {
      const cleaned = raw.trim().replace(/[,`'"\s]+$/g, '');
      const normalized = normalizeQualityKey(cleaned);
      if (normalized) return normalized;

      const legacy = legacyToQuality[cleaned.toLowerCase()];
      if (legacy) return legacy;
    }
  } catch {
    // ignore invalid URL
  }

  return fallback;
}

function isKugouLikeSource(source: PluginSource, mediaItem: any): boolean {
  const text = [
    source.name,
    source.id,
    mediaItem?.platform,
    mediaItem?.source,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return text.includes('酷狗') || text.includes('kugou') || /\bkg\b/.test(text);
}

function readQualityHash(mediaItem: any, qualityKey: QualityKey): string {
  const qualities = mediaItem?.qualities;
  const fromQuality = qualities?.[qualityKey]?.hash;
  if (typeof fromQuality === 'string' && fromQuality.trim()) return fromQuality.trim();

  switch (qualityKey) {
    case '320k':
      return String(mediaItem?.['320hash'] || '').trim();
    case 'flac':
      return String(mediaItem?.sqhash || mediaItem?.SQFileHash || '').trim();
    case 'flac24bit':
    case 'hires':
    case 'master':
    case 'vinyl':
    case 'dolby':
    case 'atmos':
    case 'atmos_plus':
      return String(
        mediaItem?.ResFileHash ||
        mediaItem?.origin_hash ||
        mediaItem?.sqhash ||
        mediaItem?.SQFileHash ||
        '',
      ).trim();
    default:
      return '';
  }
}

function adaptKugouMediaItemForQuality(mediaItem: any, qualityKey: QualityKey): any {
  const selectedHash = readQualityHash(mediaItem, qualityKey);
  if (!selectedHash) {
    return mediaItem;
  }

  const adapted = { ...mediaItem };

  if (qualityKey === '128k' || qualityKey === '192k' || qualityKey === 'mgg') {
    adapted.id = selectedHash;
    adapted.hash = adapted.id;
    adapted.sqhash = undefined;
    adapted.ResFileHash = undefined;
    return adapted;
  }

  if (qualityKey === '320k') {
    adapted.id = selectedHash;
    adapted.hash = selectedHash;
    adapted['320hash'] = selectedHash;
    adapted.sqhash = undefined;
    adapted.ResFileHash = undefined;
    return adapted;
  }

  adapted.id = selectedHash;
  adapted.hash = selectedHash;
  if (qualityKey === 'flac') {
    adapted.sqhash = selectedHash;
  } else {
    adapted.ResFileHash = selectedHash;
    adapted.sqhash = selectedHash;
  }
  return adapted;
}

function adaptMediaItemForPluginQuality(
  source: PluginSource,
  mediaItem: any,
  qualityKey: QualityKey,
): any {
  if (isKugouLikeSource(source, mediaItem)) {
    return adaptKugouMediaItemForQuality(mediaItem, qualityKey);
  }

  return mediaItem;
}

/**
 * Baka/Toskysun 插件的稳定识别锚点：声明 Baka 新音质能力。
 *
 * BakaMusic 插件 API 向下兼容 MusicFree，但 `supportedQualities` 使用
 * 96k/128k/320k/flac/hires/master 等原生音质键。不能要求插件一次声明完整
 * 12 档，否则只声明部分档位的 Baka 系插件会被误判成 MF，进而被传入
 * standard/high/lossless 导致“不支持音质”。
 */
const isBakaSupportedQualities = (raw: unknown): raw is string[] => {
  if (!Array.isArray(raw)) return false;

  const normalized = new Set(
    raw
      .map(q => normalizeQualityKey(q))
      .filter((q): q is QualityKey => !!q),
  );

  return ALL_QUALITY_KEYS.some(q => normalized.has(q));
};

// ==================== 歌词格式检测 ====================

/**
 * 根据歌词内容检测格式（对齐 BakaMusic getLyricFormat）
 *
 * Baka 插件可能返回多种歌词格式，优先级：
 * ttml > yrc > qrc > eslrc > lrc-a2 > lyl > lys > lqe > lrc > plain
 */
function detectLyricFormat(content: string): BakaLyricFormat {
  const trimmed = content.trim();
  if (!trimmed) return 'plain';

  // TTML: XML 格式
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<tt') || trimmed.includes('<tt ')) {
    return 'ttml';
  }

  // YRC: 网易云逐字格式，以 [开头的 JSON-like 结构
  if (trimmed.startsWith('{') && trimmed.includes('"content"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.lyric?.length || parsed?.content?.length) return 'yrc';
    } catch { /* not JSON */ }
  }

  // QRC: QQ 音乐逐字格式，包含 [ti:] 等标签 + 逐字时间戳
  if (/^\[(?:ti|ar|al|by|offset):/.test(trimmed) && /\[\d+,\d+\]/.test(trimmed)) {
    return 'qrc';
  }

  // ESLRC: 增强型 LRC 逐字格式
  if (/\[\d+:\d+\.\d+\]<\d+:\d+\.\d+>/.test(trimmed)) {
    return 'eslrc';
  }

  // LRC-A2 (ALRC): 高级 LRC 格式
  if (trimmed.includes('[ti:') && trimmed.includes('[al:')) {
    return 'lrc-a2';
  }

  // LYL: 自定义逐字格式
  if (/<\d+>/.test(trimmed) && /\[\d+:\d+\.\d+\]/.test(trimmed)) {
    return 'lyl';
  }

  // LYS: 另一种逐字格式
  if (/^\{.*"startTime".*"endTime".*\}/m.test(trimmed)) {
    return 'lys';
  }

  // LQE: 歌词质量增强格式
  if (trimmed.startsWith('[lqe:') || trimmed.includes('[lqe:')) {
    return 'lqe';
  }

  // 标准 LRC
  if (/\[\d+:\d+\.\d+\]/.test(trimmed) || /\[\d+:\d+\]/.test(trimmed)) {
    return 'lrc';
  }

  return 'plain';
}

// ==================== BakaPluginManager 类 ====================

/**
 * Baka 插件管理器（单例）
 *
 * 职责：
 *   1. 检测 Baka 插件（通过 supportedQualities 字段）
 *   2. 管理音质回退（newToLegacyQualityMap）
 *   3. 获取播放 URL（getMediaSource，带新→旧音质回退）
 *   4. 获取歌词（getLyric，支持所有 Baka 歌词格式）
 *   5. 获取评论（getMusicComments）
 *   6. 获取音乐信息（getMusicInfo）
 *   7. 搜索（search，支持 music/album/artist/sheet 类型）
 *   8. 其他 Baka 插件方法（getAlbumInfo, getArtistWorks 等）
 *
 * 所有方法调用通过 pluginSandboxManager 的 RPC 机制委托到 Worker 沙箱执行，
 * 主线程只负责编排逻辑和结果映射。
 */
class BakaPluginManagerClass {
  /** 已检测的 Baka 插件 ID 缓存 */
  private _bakaPluginCache = new Map<string, boolean>();

  // ==================== 插件检测 ====================

  /**
   * 检测插件是否为 Baka/Toskysun 系列
   *
   * Baka 插件在实例上声明 `supportedQualities` 数组字段（可为完整或部分新音质键）。
   * 原版 MusicFree 插件无此字段，或仅走 standard/high/lossless。
   */
  async isBakaPlugin(source: PluginSource): Promise<boolean> {
    const cached = this._bakaPluginCache.get(source.id);
    // true 可以稳定缓存；false 可能是插件尚未加载完成时的临时误判，
    // 因此在沙箱就绪后允许重新检测一次，避免 Baka/Toskysun 插件误走 MF 三档兼容路径。
    if (cached === true) return true;
    if (cached === false && !isSandboxReady(source.id)) return false;

    const result = await this._detectBakaPlugin(source);
    this._bakaPluginCache.set(source.id, result);
    return result;
  }

  private async _detectBakaPlugin(source: PluginSource): Promise<boolean> {
    // 优先从沙箱元数据检测
    if (isSandboxReady(source.id)) {
      const meta = getSandboxInstance(source.id);
      if (isBakaSupportedQualities(meta?.supportedQualities)) {
        return true;
      }
    }
    // 从全局实例缓存检测
    const _globalThis = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
    const instances = _globalThis.__pluginInstances as Map<string, any> | undefined;
    if (instances) {
      const inst = instances.get(source.id);
      if (isBakaSupportedQualities(inst?.instance?.supportedQualities)) {
        return true;
      }
    }
    return false;
  }

  /** 清除插件检测缓存（插件更新/卸载时调用） */
  clearCache(pluginId?: string): void {
    if (pluginId) {
      this._bakaPluginCache.delete(pluginId);
    } else {
      this._bakaPluginCache.clear();
    }
  }

  // ==================== 音质管理 ====================

  /**
   * 获取插件声明的支持音质列表
   *
   * Baka 插件使用 12 档新键值（如 '320k'、'flac'、'master'）。
   * 映射 '96k' → 'mgg' 以对齐本项目的 QualityKey 枚举。
   */
  async getSupportedQualities(source: PluginSource): Promise<QualityKey[] | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    const raw = inst.supportedQualities;
    if (Array.isArray(raw)) {
      const supported = raw
        .map(q => normalizeQualityKey(q))
        .filter((q): q is QualityKey => !!q);
      if (supported.length > 0) {
        return supported;
      }
    }
    return ['128k', '320k', 'flac'];
  }

  // ==================== 播放 URL 获取（核心方法）====================

  /**
   * 获取 Baka 插件播放 URL
   *
   * 与 MusicFree 插件完全分离，使用 12 档原生音质键值。
   * 内置 newToLegacyQualityMap 回退：新键失败时自动回退到旧键。
   *
   * @param source 插件源
   * @param item 搜索结果项
   * @param quality 目标音质
   * @param fallbackBehavior 回退行为
   * @param availableQualities 可用音质列表
   */
  async getMediaSource(
    source: PluginSource,
    item: PluginSearchResult,
    quality: QualityKey | 'standard' | 'high' | 'lossless' = '320k',
    fallbackBehavior: OnlineQualityFallbackBehavior = 'lower',
    availableQualities: QualityKey[] | null = null,
  ): Promise<PluginMusicInfo | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    if (typeof inst.getMediaSource !== 'function') {
      log(`[${source.name}] 无 getMediaSource 函数`);
      return null;
    }

    const musicItem = item.rawData
      ? resetMediaItem(item.rawData, source.name)
      : resetMediaItem(item, source.name);

    const isQualityKey = (q: string): q is QualityKey => q in QUALITY_META;

    // 构建音质尝试列表：始终使用 12 档原生键值
    const tryPairs: Array<{ pluginQ: string; qualityKey: QualityKey }> = [];

    if (isQualityKey(quality) && availableQualities && availableQualities.length > 0) {
      const resolvedKeys = resolveOnlinePlayQuality(quality, availableQualities, fallbackBehavior);
      for (const q of resolvedKeys) {
        tryPairs.push({ pluginQ: qualityKeyToPluginString(q), qualityKey: q });
      }
    } else if (isQualityKey(quality)) {
      if (fallbackBehavior === 'pause') {
        tryPairs.push({ pluginQ: qualityKeyToPluginString(quality), qualityKey: quality });
      } else if (fallbackBehavior === 'higher') {
        const startIdx = ALL_QUALITY_KEYS.indexOf(quality);
        if (startIdx !== -1) {
          for (let i = startIdx; i < ALL_QUALITY_KEYS.length; i++) {
            tryPairs.push({ pluginQ: qualityKeyToPluginString(ALL_QUALITY_KEYS[i]), qualityKey: ALL_QUALITY_KEYS[i] });
          }
        } else {
          tryPairs.push({ pluginQ: qualityKeyToPluginString(quality), qualityKey: quality });
        }
      } else {
        const startIdx = ALL_QUALITY_KEYS_DESC.indexOf(quality);
        if (startIdx !== -1) {
          for (let i = startIdx; i < ALL_QUALITY_KEYS_DESC.length; i++) {
            tryPairs.push({ pluginQ: qualityKeyToPluginString(ALL_QUALITY_KEYS_DESC[i]), qualityKey: ALL_QUALITY_KEYS_DESC[i] });
          }
        } else {
          tryPairs.push({ pluginQ: qualityKeyToPluginString(quality), qualityKey: quality });
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
    let songLevelErrorDetected = false;

    for (let pairIdx = 0; pairIdx < tryQualities.length; pairIdx++) {
      const q = tryQualities[pairIdx];
      const attemptMusicItem = adaptMediaItemForPluginQuality(source, musicItem, tryPairs[pairIdx].qualityKey);
      for (let retry = 0; retry <= 1; retry++) {
        try {
          result = await inst.getMediaSource(attemptMusicItem, q);
          if (result?.url) break;

          // 新键无结果，尝试旧键回退（对齐 BakaMusic newToLegacyQualityMap）
          if (!result?.url) {
            const legacyQ = newToLegacyQualityMap[q];
            if (legacyQ && legacyQ !== q) {
              log(`[getMediaSource] quality=${q} 无结果，回退到旧键: ${legacyQ}`);
              result = await inst.getMediaSource(attemptMusicItem, legacyQ);
              if (result?.url) break;
            }
          }
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
        break;
      }
      log(`[getMediaSource] quality=${q} 未返回有效URL，尝试下一档`);
      result = null;
    }

    if (!result || typeof result !== 'object') {
      const errMsg = lastError ? `异常: ${lastError.message}` : (result === null ? '返回null' : `非对象(${typeof result})`);
      log(`[getMediaSource] ${source.name} 失败: ${errMsg}`);
      (globalThis as any).__lastPluginError = `[${source.name}] ${errMsg}`;
      return null;
    }

    const rawUrl = typeof result.url === 'string' ? result.url : '';
    const url = sanitizeMediaUrl(rawUrl);
    const headers = result.headers || {};
    const ekey = result.ekey || '';
    const cek = result.cek || '';
    const lyric = result.lyric || result.rawLrc || result.lrc || '';
    const tlyric = result.tlyric || result.translation || '';
    const lxlyric = result.lxlyric || '';
    const yrc = result.yrc || '';
    const qrc = result.qrc || '';
    const eslrc = result.eslrc || '';
    const coverUrl = extractCoverUrl(result) || result.coverUrl || result.artwork || '';

    if (!url) {
      log(`[getMediaSource] ${source.name} 返回空URL, result=${JSON.stringify(result)?.substring(0, 200)}`);
      (globalThis as any).__lastPluginError = `[${source.name}] 返回空URL`;
      return null;
    }
    if (rawUrl && rawUrl !== url) {
      log(`[getMediaSource] 已清洗异常URL: ${rawUrl.substring(0, 120)} -> ${url.substring(0, 120)}`);
    }

    const requestedSuccessQuality = successPairIdx >= 0 ? tryPairs[successPairIdx].qualityKey : undefined;
    const resultQuality = normalizeQualityKey(result.quality);
    const actualQuality = resultQuality ?? inferActualQualityFromMediaUrl(url, requestedSuccessQuality);
    const lyricsRaw = (lyric || tlyric || lxlyric || yrc || qrc || eslrc)
      ? buildBakaMfLyricsRaw({ lyric, tlyric, lxlyric, yrc, qrc, eslrc })
      : '';

    const headerKeys = Object.keys(headers);
    log(`[getMediaSource] 成功: url=${url.substring(0, 100)}, headers=[${headerKeys.join(',')}], ekey=${ekey ? '有' : '无'}, cek=${cek ? '有' : '无'}, lyricLen=${lyric.length}, actualQuality=${actualQuality}`);
    return {
      url,
      headers: headers as Record<string, string>,
      ekey: ekey || undefined,
      cek: cek || undefined,
      lyric,
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

  // ==================== 歌词获取 ====================

  /**
   * 获取歌词（支持所有 Baka 歌词格式）
   *
   * Baka 插件 getLyric 返回 ILyricSource 对象，可能包含：
   *   - rawLrc / lrc / lyric: 标准歌词文本
   *   - translation / tlyric: 翻译歌词
   *   - romanization: 罗马音歌词
   *   - format: 歌词格式标识
   *   - yrc / qrc / lxlyric / eslrc: 逐字歌词
   *
   * 使用 Baka/MF 专用构建器构建 lyricsRaw 文本（优先级：yrc > qrc > eslrc > lxlyric > lyric）
   */
  async getLyric(
    source: PluginSource,
    item: PluginSearchResult,
  ): Promise<{ lyric: string; tlyric?: string; lxlyric?: string; yrc?: string; qrc?: string; eslrc?: string; lyricsRaw?: string; format?: BakaLyricFormat } | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getLyric !== 'function') {
        log(`[getLyric] ${source.name} 插件未实现 getLyric 方法`);
        return null;
      }

      const musicItem = item.rawData
        ? resetMediaItem(item.rawData, source.name)
        : resetMediaItem(item, source.name);

      const lrcSource = (await inst.getLyric(musicItem)?.catch((e: any) => {
        log(`[getLyric] ${source.name} 调用异常: ${e?.message ?? e}`);
        return null;
      })) || null;

      if (!lrcSource) {
        log(`[getLyric] ${source.name} 返回空结果`);
        return null;
      }

      // 兼容多种字段名
      const rawLrc = lrcSource.rawLrc || lrcSource.lyric || lrcSource.lrc || '';
      const translation = lrcSource.translation || lrcSource.tlyric || lrcSource.translateLyric || '';
      const romanization = lrcSource.romanization || lrcSource.rlyric || '';
      const lxlyric = lrcSource.lxlyric || '';
      const yrc = lrcSource.yrc || '';
      const qrc = lrcSource.qrc || '';
      const eslrc = lrcSource.eslrc || '';

      // [诊断] 输出完整的歌词数据信息，帮助定位逐字歌词缺失问题
      log(`[getLyric] ${source.name} 原始返回字段: keys=[${Object.keys(lrcSource).join(',')}], format=${lrcSource.format ?? '(none)'}, rawLrcLen=${rawLrc.length}, lxlyricLen=${lxlyric.length}, yrcLen=${yrc.length}, qrcLen=${qrc.length}, eslrcLen=${eslrc.length}`);
      if (rawLrc) log(`[getLyric] rawLrc 预览: ${rawLrc.substring(0, 200)}`);
      if (lxlyric) log(`[getLyric] lxlyric 预览: ${lxlyric.substring(0, 200)}`);
      if (yrc) log(`[getLyric] yrc 预览: ${yrc.substring(0, 200)}`);
      if (qrc) log(`[getLyric] qrc 预览: ${qrc.substring(0, 200)}`);
      if (eslrc) log(`[getLyric] eslrc 预览: ${eslrc.substring(0, 200)}`);

      // 检测歌词格式
      let format: BakaLyricFormat | undefined;
      if (lrcSource.format) {
        format = lrcSource.format as BakaLyricFormat;
      } else if (yrc) {
        format = 'yrc';
      } else if (qrc) {
        format = 'qrc';
      } else if (eslrc) {
        format = 'eslrc';
      } else if (lxlyric) {
        format = 'lrc-a2';
      } else if (rawLrc) {
        format = detectLyricFormat(rawLrc);
      }

      if (!rawLrc && !lxlyric && !yrc && !qrc && !eslrc) {
        log(`[getLyric] ${source.name} rawLrc 为空, lrcSource keys: ${Object.keys(lrcSource).join(',')}`);
        return null;
      }

      const lyricsRaw = buildBakaMfLyricsRaw({
        lyric: rawLrc,
        tlyric: translation,
        rlyric: romanization,
        lxlyric,
        yrc,
        qrc,
        eslrc,
      });
      log(`[getLyric] ${source.name} 成功, rawLrc长度=${rawLrc.length}, lxlyric长度=${lxlyric.length}, yrc长度=${yrc.length}, qrc长度=${qrc.length}, format=${format}`);
      return { lyric: rawLrc, tlyric: translation, lxlyric, yrc, qrc, eslrc, lyricsRaw, format };
    } catch (e) {
      log(`获取歌词失败: ${source.name} ${e}`);
      return null;
    }
  }

  // ==================== 评论获取 ====================

  /**
   * 获取歌曲评论（对齐 BakaMusic getMusicComments）
   *
   * @param source 插件源
   * @param item 搜索结果项
   * @param page 页码（从 1 开始）
   * @returns 评论列表
   */
  async getMusicComments(
    source: PluginSource,
    item: PluginSearchResult,
    page: number = 1,
  ): Promise<BakaCommentResult | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getMusicComments !== 'function') {
        log(`[getMusicComments] ${source.name} 插件未实现 getMusicComments 方法`);
        return null;
      }

      const musicItem = item.rawData
        ? resetMediaItem(item.rawData, source.name)
        : resetMediaItem(item, source.name);

      const result = (await inst.getMusicComments(musicItem, page)?.catch((e: any) => {
        log(`[getMusicComments] ${source.name} 调用异常: ${e?.message ?? e}`);
        return null;
      })) || null;

      if (!result) return null;

      // 兼容多种返回格式
      const comments: BakaComment[] = Array.isArray(result.data) ? result.data : (Array.isArray(result) ? result : []);
      const isEnd = result.isEnd ?? (comments.length === 0);

      log(`[getMusicComments] ${source.name} 成功, 获取 ${comments.length} 条评论, isEnd=${isEnd}`);
      return { isEnd, data: comments };
    } catch (e) {
      log(`获取评论失败: ${source.name} ${e}`);
      return null;
    }
  }

  // ==================== 获取封面 ====================

  async getCover(source: PluginSource, item: PluginSearchResult): Promise<string | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getMusicInfo === 'function') {
        const musicItem = item.rawData
          ? resetMediaItem(item.rawData, source.name)
          : resetMediaItem(item, source.name);
        const result = await inst.getMusicInfo(musicItem);
        const coverUrl = extractCoverUrl(result);
        if (coverUrl) return coverUrl;
      }
      return item.coverUrl || null;
    } catch {
      return item.coverUrl || null;
    }
  }

  // ==================== 获取歌曲详情页 URL ====================

  /**
   * 获取歌曲分享/详情页 URL（对齐 BakaMusic getMusicDetailPageUrl）
   */
  async getMusicDetailPageUrl(source: PluginSource, item: PluginSearchResult): Promise<string | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getMusicDetailPageUrl !== 'function') return null;
      const musicItem = item.rawData
        ? resetMediaItem(item.rawData, source.name)
        : resetMediaItem(item, source.name);
      const result = await inst.getMusicDetailPageUrl(musicItem);
      return typeof result === 'string' ? result : (result?.url || null);
    } catch {
      return null;
    }
  }

  // ==================== 搜索 ====================

  /**
   * 搜索音乐（Baka 插件可能未声明 'music' 但实际支持）
   */
  async searchMusic(
    source: PluginSource,
    keyword: string,
    page: number,
  ): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.search !== 'function') return [];

      const result = (await inst.search(keyword, page, 'music')) ?? {};
      const list = extractResultList(result);
      if (list.length === 0) return [];

      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return toPluginSearchResult(item, source);
      });
    } catch (e: any) {
      log(`[searchMusic] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  /** 搜索歌手 */
  async searchArtists(
    source: PluginSource,
    keyword: string,
    page: number,
  ): Promise<any[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.search !== 'function') return [];

      const result = (await inst.search(keyword, page, 'artist')) ?? {};
      const list = extractResultList(result);
      if (list.length === 0) return [];

      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return {
          id: item.id || item.artistId || item.singerId || '',
          name: stripHtmlTags(item.name || item.title || item.artist || ''),
          avatarUrl: extractCoverUrl(item) || item.avatar || '',
          description: item.description || item.desc || '',
          songCount: item.songCount || item.musicCount || undefined,
          albumCount: item.albumCount || undefined,
          platform: item.platform || source.name,
          platformId: item.id || item.artistId || item.singerId || '',
          pluginId: source.id,
          rawData: item,
        };
      });
    } catch (e: any) {
      log(`[searchArtists] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  /** 搜索专辑 */
  async searchAlbums(
    source: PluginSource,
    keyword: string,
    page: number,
  ): Promise<any[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.search !== 'function') return [];

      const result = (await inst.search(keyword, page, 'album')) ?? {};
      const list = extractResultList(result);
      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return {
          id: item.id || item.albumId || '',
          name: stripHtmlTags(item.title || item.name || item.album || ''),
          artist: extractArtist(item),
          coverUrl: extractCoverUrl(item),
          description: item.description || item.desc || '',
          year: item.year || item.publishTime || undefined,
          songCount: item.songCount || item.musicCount || undefined,
          platform: item.platform || source.name,
          platformId: item.id || item.albumId || '',
          pluginId: source.id,
          rawData: item,
        };
      });
    } catch (e: any) {
      log(`[searchAlbums] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  /** 搜索歌单 */
  async searchPlaylists(
    source: PluginSource,
    keyword: string,
    page: number,
  ): Promise<PluginPlaylistSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.search !== 'function') return [];

      const result = (await inst.search(keyword, page, 'sheet')) ?? {};
      const list = extractResultList(result);
      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return {
          id: String(item.id || item.sheetId || ''),
          title: stripHtmlTags(item.title || item.name || ''),
          coverUrl: extractCoverUrl(item) || '',
          playCount: item.playCount || item.playcount || undefined,
          trackCount: item.trackCount || item.musicCount || undefined,
          artist: extractArtist(item),
          platform: item.platform || source.name,
          platformId: String(item.id || item.sheetId || ''),
          pluginId: source.id,
          rawData: item,
        };
      });
    } catch (e: any) {
      log(`[searchPlaylists] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  // ==================== 专辑/歌单/歌手详情 ====================

  /** 获取专辑歌曲 */
  async getAlbumSongs(source: PluginSource, albumItem: any, page: number = 1): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      // 优先使用 getAlbumInfo
      if (typeof inst.getAlbumInfo === 'function') {
        const result = (await inst.getAlbumInfo(albumItem, page)) ?? {};
        const list = result?.musicList || result?.data || result?.list || [];
        if (Array.isArray(list) && list.length > 0) {
          return list.map((item: any) => {
            resetMediaItem(item, source.name);
            return toPluginSearchResult(item, source);
          });
        }
      }
      // 回退到搜索
      if (page === 1) {
        const albumName = albumItem.title || albumItem.name || albumItem.album || '';
        if (albumName) {
          return this.searchMusic(source, albumName, 1);
        }
      }
      return [];
    } catch (e: any) {
      log(`[getAlbumSongs] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  /** 获取歌单详情 */
  async getPlaylistDetail(source: PluginSource, sheetItem: any, page: number = 1): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.getMusicSheetInfo === 'function') {
        const result = (await inst.getMusicSheetInfo(sheetItem, page)) ?? {};
        const list = result?.musicList || result?.data || result?.list || [];
        if (Array.isArray(list) && list.length > 0) {
          return list.map((item: any) => {
            resetMediaItem(item, source.name);
            return toPluginSearchResult(item, source);
          });
        }
      }
      // 回退到搜索
      if (page === 1) {
        const sheetName = sheetItem.title || sheetItem.name || '';
        if (sheetName) {
          return this.searchMusic(source, sheetName, 1);
        }
      }
      return [];
    } catch (e: any) {
      log(`[getPlaylistDetail] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  /** 获取歌手作品 */
  async getArtistWorks(source: PluginSource, artistItem: any, page: number = 1, type: string = 'music'): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.getArtistWorks === 'function') {
        const result = (await inst.getArtistWorks(artistItem, page, type)) ?? {};
        const list = extractResultList(result);
        if (list.length > 0) {
          return list.map((item: any) => {
            resetMediaItem(item, source.name);
            return toPluginSearchResult(item, source);
          });
        }
      }
      // 回退到搜索
      if (page === 1) {
        const artistName = artistItem.name || artistItem.artist || '';
        if (artistName) {
          return this.searchMusic(source, artistName, 1);
        }
      }
      return [];
    } catch (e: any) {
      log(`[getArtistWorks] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  /** 获取歌手详情 */
  async getArtistInfo(source: PluginSource, artistItem: any): Promise<any | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getArtistInfo !== 'function') return null;
      return (await inst.getArtistInfo(artistItem)?.catch(() => null)) || null;
    } catch {
      return null;
    }
  }

  // ==================== 榜单 ====================

  async getTopLists(source: PluginSource): Promise<any[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.getTopLists !== 'function') return [];
      const result = (await inst.getTopLists()) ?? [];
      return Array.isArray(result) ? result : (result?.data || []);
    } catch (e: any) {
      log(`[getTopLists] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  async getTopListDetail(source: PluginSource, topListItem: any, page: number = 1): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.getTopListDetail !== 'function') return [];
      const result = (await inst.getTopListDetail(topListItem, page)) ?? {};
      const list = result?.musicList || result?.data || result?.list || [];
      if (Array.isArray(list) && list.length > 0) {
        return list.map((item: any) => {
          resetMediaItem(item, source.name);
          return toPluginSearchResult(item, source);
        });
      }
      return [];
    } catch (e: any) {
      log(`[getTopListDetail] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  // ==================== 推荐歌单 ====================

  async getRecommendSheetTags(source: PluginSource): Promise<any | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.getRecommendSheetTags !== 'function') return null;
      return (await inst.getRecommendSheetTags()?.catch(() => null)) || null;
    } catch {
      return null;
    }
  }

  async getRecommendSheetsByTag(source: PluginSource, tag: any, page: number = 1): Promise<PluginPlaylistSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.getRecommendSheetsByTag !== 'function') return [];
      const result = (await inst.getRecommendSheetsByTag(tag, page)) ?? {};
      const list = extractResultList(result);
      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return {
          id: String(item.id || item.sheetId || ''),
          title: stripHtmlTags(item.title || item.name || ''),
          coverUrl: extractCoverUrl(item) || '',
          playCount: item.playCount || undefined,
          trackCount: item.trackCount || undefined,
          platform: item.platform || source.name,
          platformId: String(item.id || item.sheetId || ''),
          pluginId: source.id,
          rawData: item,
        };
      });
    } catch (e: any) {
      log(`[getRecommendSheetsByTag] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  // ==================== 导入 ====================

  async importMusicSheet(source: PluginSource, urlLike: string): Promise<PluginSearchResult[]> {
    const inst = await this._ensureInstance(source);
    if (!inst) return [];

    try {
      if (typeof inst.importMusicSheet !== 'function') return [];
      const result = (await inst.importMusicSheet(urlLike)) ?? [];
      const list = Array.isArray(result) ? result : (result?.data || []);
      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        return toPluginSearchResult(item, source);
      });
    } catch (e: any) {
      log(`[importMusicSheet] ${source.name} 失败: ${e?.message || e}`);
      return [];
    }
  }

  async importMusicItem(source: PluginSource, urlLike: string): Promise<PluginSearchResult | null> {
    const inst = await this._ensureInstance(source);
    if (!inst) return null;

    try {
      if (typeof inst.importMusicItem !== 'function') return null;
      const result = (await inst.importMusicItem(urlLike)) ?? null;
      if (!result) return null;
      resetMediaItem(result, source.name);
      return toPluginSearchResult(result, source);
    } catch (e: any) {
      log(`[importMusicItem] ${source.name} 失败: ${e?.message || e}`);
      return null;
    }
  }

  // ==================== 内部工具 ====================

  /**
   * 确保插件实例已加载，返回 Baka 插件实例接口
   *
   * 优先从沙箱获取（通过 RPC 代理），回退到全局实例缓存。
   */
  private async _ensureInstance(source: PluginSource): Promise<IBakaPluginInstance | null> {
    // 尝试从沙箱获取代理实例
    if (isSandboxReady(source.id)) {
      return this._createSandboxProxy(source.id);
    }

    // 回退到全局实例缓存（直接执行模式）
    const _globalThis = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
    const instances = _globalThis.__pluginInstances as Map<string, { source: PluginSource; instance: any; script: string }> | undefined;
    if (instances) {
      const inst = instances.get(source.id);
      if (inst?.instance) {
        return inst.instance as IBakaPluginInstance;
      }
    }

    // 触发重新加载（通过 pluginEngine 的 ensurePluginInstance）
    log(`插件实例未缓存，需要重新加载: ${source.name} (${source.filePath})`);
    return null;
  }

  /**
   * 创建沙箱代理实例
   *
   * 当插件在沙箱中运行时，通过 RPC 调用方法。
   * 代理对象包含所有 Baka 插件方法（16 个），
   * 只为实际实现的方法创建代理函数。
   */
  private _createSandboxProxy(pluginId: string): IBakaPluginInstance {
    const meta = getSandboxInstance(pluginId) || {};

    // Worker 返回的 _availableMethods 包含插件实际实现的方法名列表
    const availableMethods: string[] = Array.isArray(meta._availableMethods)
      ? meta._availableMethods
      : [...BAKA_PLUGIN_METHODS];

    const proxy: any = {
      platform: meta.platform,
      version: meta.version,
      appVersion: meta.appVersion,
      srcUrl: meta.srcUrl,
      author: meta.author,
      description: meta.description,
      cacheControl: meta.cacheControl,
      primaryKey: meta.primaryKey,
      defaultSearchType: meta.defaultSearchType,
      supportedSearchType: meta.supportedSearchType,
      userVariables: meta.userVariables,
      hints: meta.hints,
      supportedQualities: meta.supportedQualities,
    };

    // 为所有 Baka 插件方法创建代理
    for (const method of BAKA_PLUGIN_METHODS) {
      if (availableMethods.includes(method)) {
        proxy[method] = async (...args: any[]) => {
          return callSandboxMethod(pluginId, method, args);
        };
      }
    }

    return proxy as IBakaPluginInstance;
  }
}

// ==================== 单例导出 ====================

export const BakaPluginManager = new BakaPluginManagerClass();
