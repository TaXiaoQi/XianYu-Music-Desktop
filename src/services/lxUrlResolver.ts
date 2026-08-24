/**
 * LX（落雪）URL 统一解析器
 *
 * 统一封装"插件优先 + Rust 兜底"的 LX 歌曲直链解析策略，
 * 消除原先散落在 onlinePlaybackResolver / downloadService / lxMusicSdk 的重复逻辑。
 *
 * 核心职责：
 *   1. 解析 lx://source/songmid 协议字符串
 *   2. 构造 LX 插件所需的 songInfo（合并缓存数据）
 *   3. 定位匹配的 LX 插件
 *   4. 按音质候选列表解析直链（插件优先，Rust 兜底）
 *
 * 调用方：
 *   - onlinePlaybackResolver.ts（在线播放）
 *   - downloadService.ts（下载）
 */

import type { QualityKey, Song } from '../types';
import {
  normalizeQualityKey,
  qualityKeyToLxQuality,
  resolveOnlinePlayQuality,
} from '../types';
import type { PluginSource } from '../types';
import { getCachedLxSong } from './lxSongCache';
import type { LxSearchResultItem } from './lxMusicSdk';
import { toUrlSongInfo } from './lxMusicSdk';
import { ensureLxPluginInstance, lxPluginGetMusicUrl } from './lxPluginEngine';
import { isSongLevelError } from './lxPluginEngine';
import { getStoredPlugins } from './pluginEngine';
import { pluginApi } from './tauri/pluginApi';

// ==================== 协议解析 ====================

/** lx:// 协议解析结果 */
export interface LxPathInfo {
  source: string;
  songmid: string;
}

/**
 * 解析 lx://source/songmid 协议字符串
 *
 * songmid 可能包含 '/'（如某些音源的 hash），因此用 split('/') 取首段为 source，
 * 其余部分用 '/' 重新拼接为 songmid。
 *
 * @param path lx:// 协议字符串
 * @returns 解析结果，非 lx:// 协议或格式无效时返回 null
 */
export function parseLxPath(path: string): LxPathInfo | null {
  if (!path || !path.startsWith('lx://')) return null;
  const parts = path.replace('lx://', '').split('/');
  const source = parts[0];
  const songmid = parts.slice(1).join('/');
  if (!source || !songmid) return null;
  return { source, songmid };
}

/** 判断路径是否为 lx:// 协议 */
export function isLxPath(path: string): boolean {
  return !!path && path.startsWith('lx://');
}

// ==================== 插件定位 ====================

/**
 * 定位匹配指定音源的 LX 插件
 *
 * 策略：优先匹配 sources 包含该音源的插件，否则回退到第一个可用的 LX 插件。
 *
 * @param lxSource LX 音源标识（kw/kg/tx/wy 等）
 * @returns 匹配的插件，无可用插件时返回 null
 */
export function findLxPluginForSource(lxSource: string): PluginSource | null {
  const lxPlugins = getStoredPlugins().filter(p => p.enabled && p.format === 'lx');
  if (lxPlugins.length === 0) return null;
  const matched = lxPlugins.find(p => p.sources.includes(lxSource));
  return matched ?? lxPlugins[0];
}

// ==================== songInfo 构造 ====================

/**
 * 从缓存或 song.rawData 中提取 LX 歌曲元信息
 *
 * @param song 当前歌曲
 * @param lxSource LX 音源标识
 * @param songmid 歌曲 ID
 * @returns 缓存的 LxSearchResultItem，未找到时返回 null
 */
export function resolveLxCachedInfo(
  song: Song,
  lxSource: string,
  songmid: string,
): LxSearchResultItem | null {
  const persistedInfo = song.rawData?.source === lxSource ? song.rawData : null;
  const cached = getCachedLxSong(lxSource, songmid) ?? persistedInfo;
  if (cached) return cached;

  // [兜底] 缓存未命中时，从 Song 自定义属性（_hash/_types/_copyrightId 等）合成元信息，
  // 保证从歌单/收藏等非搜索路径进入的歌曲也能拿到完整 songInfo 参与解析。
  const anySong = song as any;
  if (anySong._hash || anySong._types || anySong._copyrightId || anySong._strMediaMid) {
    return {
      name: song.name || '',
      singer: song.artist || '',
      albumName: song.album || '',
      albumId: anySong._albumId,
      albumMid: anySong._albumMid,
      songmid,
      source: lxSource as any,
      interval: '',
      img: null,
      types: [],
      _types: anySong._types,
      hash: anySong._hash,
      copyrightId: anySong._copyrightId,
      strMediaMid: anySong._strMediaMid,
      songId: anySong._songId,
    };
  }
  return null;
}

/**
 * 构造 LX 插件所需的 songInfo 对象
 *
 * 合并歌曲基本信息和缓存中的音源特定字段（hash/strMediaMid 等）。
 *
 * @param song 当前歌曲
 * @param songmid 歌曲 ID
 * @param lxSource LX 音源标识
 * @param cachedInfo 缓存的完整歌曲元信息（可选）
 */
export function buildLxSongInfo(
  song: Song,
  songmid: string,
  lxSource: string,
  cachedInfo: LxSearchResultItem | null,
): Record<string, unknown> {
  const anySong = song as any;
  const normalizedTypes = normalizeLxTypes(cachedInfo?._types ?? anySong._types ?? anySong.rawData?._types);
  const hash = cachedInfo?.hash || anySong._hash || anySong.hash || anySong.rawData?.hash || (lxSource === 'kg' ? songmid : undefined);

  return {
    songId: songmid,
    name: song.name,
    singer: song.artist,
    albumName: song.album,
    source: lxSource,
    songmid,
    hash,
    copyrightId: cachedInfo?.copyrightId || anySong._copyrightId || anySong.copyrightId || anySong.rawData?.copyrightId,
    strMediaMid: cachedInfo?.strMediaMid || anySong._strMediaMid || anySong.strMediaMid || anySong.rawData?.strMediaMid,
    albumId: cachedInfo?.albumId || anySong._albumId || anySong.albumId || anySong.rawData?.albumId,
    albumMid: cachedInfo?.albumMid || anySong._albumMid || anySong.albumMid || anySong.rawData?.albumMid,
    interval: cachedInfo?.interval || anySong.rawData?.interval,
    _types: normalizedTypes,
    types: cachedInfo?.types || anySong.rawData?.types,
  };
}

function normalizeLxTypes(
  raw: Record<string, { size?: string | null; hash?: string }> | undefined,
): Record<string, { size?: string | null; hash?: string }> | undefined {
  if (!raw || typeof raw !== 'object') return raw;
  const result: Record<string, { size?: string | null; hash?: string }> = { ...raw };
  for (const [key, value] of Object.entries(raw)) {
    const qualityKey = normalizeQualityKey(key);
    if (!qualityKey) continue;
    result[qualityKey] = value;
    result[qualityKeyToLxQuality(qualityKey)] = value;
  }
  return result;
}

// ==================== URL 解析 ====================

/** 单次音质解析结果 */
export interface LxUrlResolveResult {
  /** 解析到的直链 URL */
  url: string;
  /** 实际命中的音质 */
  quality: QualityKey;
  /** 来源：插件或 Rust 后端 */
  source: 'plugin' | 'rust';
}

/**
 * 通过 Rust 后端批量音质回退解析直链
 *
 * 单次 IPC 调用完成多音质回退，避免循环调用。
 * Rust 端会按 qualities 顺序依次尝试，返回第一个可用的 URL。
 *
 * @param cachedInfo 缓存的歌曲元信息
 * @param qualities 音质候选列表（从高到低）
 * @returns 解析结果，失败返回 null
 */
export async function resolveLxUrlViaRust(
  cachedInfo: LxSearchResultItem,
  qualities: QualityKey[],
): Promise<LxUrlResolveResult | null> {
  try {
    const urlResult = await pluginApi.resolveLxWithQualityFallback(
      toUrlSongInfo(cachedInfo),
      qualities,
    );
    if (urlResult?.url && /^https?:/.test(urlResult.url)) {
      const quality = normalizeQualityKey(urlResult.quality) ?? qualities[0];
      return {
        url: urlResult.url,
        quality,
        source: 'rust',
      };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[LXUrlResolver] Rust 批量音质回退失败: ${msg}`);
  }
  return null;
}

/**
 * 通过 LX 插件按音质候选列表逐档解析直链
 *
 * 遇到 LxSongLevelError（歌曲级别错误，如无版权）时立即停止，
 * 其他错误继续尝试下一档。
 *
 * @param plugin LX 插件
 * @param lxSource LX 音源标识
 * @param songInfo 插件所需的歌曲信息
 * @param qualities 音质候选列表（从高到低）
 * @returns 解析结果，失败返回 null
 */
export async function resolveLxUrlViaPlugin(
  plugin: PluginSource,
  lxSource: string,
  songInfo: Record<string, unknown>,
  qualities: QualityKey[],
): Promise<LxUrlResolveResult | null> {
  await ensureLxPluginInstance(plugin);

  for (const quality of qualities) {
    try {
      const pluginQuality = qualityKeyToLxQuality(quality);
      const urlResult = await lxPluginGetMusicUrl(
        plugin,
        lxSource,
        songInfo,
        pluginQuality,
      );
      const musicUrl = urlResult?.url;
      if (musicUrl && /^https?:/.test(musicUrl)) {
        // 优先采用插件实际报告的音质（type 字段），而不是请求档位。
        // 插件对某首歌可能静默降级（如请求 flac 实际只给 320k），
        // 若不采用其报告的档位，底部栏会显示一个高于实际播放的音质。
        const reported = normalizeQualityKey(urlResult?.type);
        return { url: musicUrl, quality: reported ?? quality, source: 'plugin' };
      }
    } catch (urlErr) {
      // LxSongLevelError 表示歌曲本身不可用（无版权/已下架等），换音质无法解决
      const isSongLevel =
        (urlErr instanceof Error && urlErr.name === 'LxSongLevelError') ||
        isSongLevelError(urlErr instanceof Error ? urlErr.message : String(urlErr));
      if (isSongLevel) {
        const errMsg = urlErr instanceof Error ? urlErr.message : String(urlErr);
        console.warn(`[LXUrlResolver] 歌曲级别错误，跳过剩余音质: ${errMsg}`);
        break;
      }
      // 其他错误继续尝试下一档
    }
  }
  return null;
}

/** 单次音质解析结果（下载场景用） */
export interface LxSingleQualityResolveResult {
  url: string;
  /** 插件实际报告的音质（对应插件返回的 type 字段），无法识别时回退到请求档位 */
  quality: QualityKey;
}

/**
 * 通过 LX 插件解析单个音质的直链（下载场景使用）
 *
 * 与 resolveLxUrlViaPlugin 不同，此函数只解析指定音质，不遍历候选列表。
 * 下载场景需要逐档尝试以便在下载失败时回退到下一档。
 *
 * 返回插件实际报告的音质：插件可能把请求档位静默降级（如请求 flac 实际给 320k），
 * 若不采用其报告的档位，底部栏/命中档位会显示一个高于实际播放的音质。
 *
 * @param plugin LX 插件
 * @param lxSource LX 音源标识
 * @param songInfo 插件所需的歌曲信息
 * @param quality 目标音质
 * @returns 解析结果，失败返回 null
 */
// ==================== 同歌并发/连发探测去重 ====================
// 同一首歌可能被"起播解析 + 音质菜单/下载探测"等多路并发发起 musicUrl 请求，
// 每一档都会触发一次带网络往返的 lxPluginGetMusicUrl。这里对 (插件, 歌曲id, 音质)
// 做窗口内去重，让并发的多路共享同一份解析结果，避免重复请求（与 pluginEngine 的
// MF/Baka 去重策略保持一致）。
const LX_URL_DEDUP_WINDOW_MS = 400;
const _dedupLxUrl = new Map<
  string,
  { at: number; p: Promise<LxSingleQualityResolveResult | null> }
>();

function buildLxUrlDedupKey(
  plugin: PluginSource,
  songInfo: Record<string, unknown>,
  quality: QualityKey,
): string {
  const songId = String(songInfo?.songmid ?? songInfo?.hash ?? '');
  return `${plugin.id}\u0001${songId}\u0001${quality}`;
}

export async function resolveLxUrlForSingleQuality(
  plugin: PluginSource,
  lxSource: string,
  songInfo: Record<string, unknown>,
  quality: QualityKey,
): Promise<LxSingleQualityResolveResult | null> {
  // [同歌去重] 并发/连发的多路请求共享同一份解析结果
  const dedupKey = buildLxUrlDedupKey(plugin, songInfo, quality);
  const now = Date.now();
  const hit = _dedupLxUrl.get(dedupKey);
  if (hit && now - hit.at <= LX_URL_DEDUP_WINDOW_MS) {
    return hit.p;
  }
  if (hit) _dedupLxUrl.delete(dedupKey);

  const p = runResolveLxUrlForSingleQuality(plugin, lxSource, songInfo, quality);
  _dedupLxUrl.set(dedupKey, { at: now, p });
  p.then(
    () => {
      setTimeout(() => {
        if (_dedupLxUrl.get(dedupKey)?.p === p) _dedupLxUrl.delete(dedupKey);
      }, LX_URL_DEDUP_WINDOW_MS);
    },
    () => {
      _dedupLxUrl.delete(dedupKey);
    },
  );
  return p;
}

async function runResolveLxUrlForSingleQuality(
  plugin: PluginSource,
  lxSource: string,
  songInfo: Record<string, unknown>,
  quality: QualityKey,
): Promise<LxSingleQualityResolveResult | null> {
  const urlResult = await lxPluginGetMusicUrl(
    plugin,
    lxSource,
    songInfo,
    qualityKeyToLxQuality(quality),
  );
  const url = urlResult?.url;
  if (!url || !/^https?:/.test(url)) return null;
  const reported = normalizeQualityKey(urlResult?.type);
  return { url, quality: reported ?? quality };
}

/**
 * 统一的 LX URL 解析入口（插件优先 + Rust 兜底）
 *
 * 策略：
 *   1. 定位 LX 插件，无插件时直接走 Rust
 *   2. 有插件时先尝试插件解析（按音质候选列表逐档）
 *   3. 插件解析失败后回退到 Rust 批量音质解析
 *
 * @param song 当前歌曲
 * @param lxSource LX 音源标识
 * @param songmid 歌曲 ID
 * @param requestedQuality 请求音质
 * @param fallbackBehavior 音质回退策略
 * @param availableQualities 可用音质列表
 * @returns 解析结果，失败返回 null
 */
export async function resolveLxUrl(
  song: Song,
  lxSource: string,
  songmid: string,
  requestedQuality: QualityKey,
  fallbackBehavior: 'lower' | 'higher' | 'pause',
  availableQualities: QualityKey[] | null,
): Promise<LxUrlResolveResult | null> {
  const tryQualities = resolveOnlinePlayQuality(
    requestedQuality,
    availableQualities,
    fallbackBehavior,
  );
  if (tryQualities.length === 0) return null;

  const cachedInfo = resolveLxCachedInfo(song, lxSource, songmid);
  const matchedPlugin = findLxPluginForSource(lxSource);

  // 无 LX 插件时，直接走 Rust 批量音质解析
  if (!matchedPlugin) {
    if (!cachedInfo) return null;
    return resolveLxUrlViaRust(cachedInfo, tryQualities);
  }

  // 插件优先
  const songInfo = buildLxSongInfo(song, songmid, lxSource, cachedInfo);
  const pluginResult = await resolveLxUrlViaPlugin(
    matchedPlugin,
    lxSource,
    songInfo,
    tryQualities,
  );
  if (pluginResult) return pluginResult;

  console.warn(
    `[LXUrlResolver] 插件解析失败，回退到 Rust: lx://${lxSource}/${songmid}, tried=${JSON.stringify(tryQualities)}`,
  );

  // Rust 兜底
  if (!cachedInfo) return null;
  const rustResult = await resolveLxUrlViaRust(cachedInfo, tryQualities);
  if (rustResult) {
    return rustResult;
  }

  return null;
}
