/**
 * 外部歌单导入服务
 *
 * 完全移植自 yyy 项目中的 LxSdkSongList.kt 和 LinkParser.kt
 * 支持从网易云(小芸)、QQ音乐(小秋)、酷我(小枸)、酷狗(小蜗)导入歌单
 *
 * 加密逻辑：
 * - 网易云：linuxapi (AES-ECB)
 * - 酷狗：signatureParams (MD5 签名)
 * - QQ音乐/酷我：直接 HTTP 请求
 */

import { pluginApi } from './tauri/pluginApi';
import { hostKugouRequestKey, hostKugouSign, hostLinuxapiEncrypt, hostWeapiEncrypt } from './tauri/hostCryptoApi';
import { decodeName, formatSingerName } from '../utils/musicFormat';
import { getStoredPlugins, pluginGetPlaylistDetailWithEnd, pluginPlaylistSearch, pluginImportMusicSheet } from './pluginEngine';
import { LX_SOURCE_NAMES, type LxSourceId } from './lxMusicSdk';
import type { PluginSearchResult, PluginSource } from '../types';

// ==================== 音源定义 ====================

export interface PlaylistSource {
  key: string;       // "wy" | "tx" | "kw" | "kg" | "auto" | "mf_<pluginId>"
  name: string;      // 显示名称
  platform: string;  // 平台中文名
  /** 来源类型：LX 直连导入 / MusicFree 插件导入 / 收藏夹导入 */
  type: 'lx' | 'musicfree' | 'favorites';
  /** MusicFree 插件源（仅 type='musicfree' 时有值），用于调用插件 API */
  pluginSource?: PluginSource;
}

/** importPlaylist 支持的 LX 源 key 集合 */
const SUPPORTED_IMPORT_SOURCES: ReadonlySet<string> = new Set(['wy', 'tx', 'kw', 'kg']);

/** 平台中文名映射 */
const SOURCE_PLATFORM_NAMES: Record<string, string> = {
  wy: '网易云',
  tx: 'QQ音乐',
  kw: '酷我',
  kg: '酷狗',
  mg: '咪咕',
};

/**
 * 从已安装的插件中读取支持歌单导入的音源列表
 * 参考 Search.vue 的 refreshPluginSourceList 逻辑：
 * - LX 插件多平台时拆分为独立条目，使用平台名显示
 * - LX 插件单平台时以插件名显示
 * - MusicFree 插件（如 BakaMusic）直接以插件名显示，key 带 mf_ 前缀
 * - 始终在首位包含"自动识别"
 */
export function getImportSourcesFromPlugins(): PlaylistSource[] {
  const sources: PlaylistSource[] = [
    { key: 'auto', name: '自动识别', platform: '', type: 'lx' },
  ];

  const raw = getStoredPlugins();
  const plugins = raw
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => p.enabled)
    .sort((a, b) => {
      const sa = a.p.sortOrder ?? 0;
      const sb = b.p.sortOrder ?? 0;
      if (sa !== sb) return sa - sb;
      return a.idx - b.idx;
    })
    .map(({ p }) => p);

  const seenKeys = new Set<string>();

  for (const p of plugins) {
    if (p.format === 'lx' && p.sources.length > 0) {
      const lxSources = p.sources.filter(s => SUPPORTED_IMPORT_SOURCES.has(s)) as LxSourceId[];
      if (lxSources.length === 0) continue;

      if (lxSources.length === 1) {
        const key = lxSources[0];
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        sources.push({
          key,
          name: p.name,
          platform: SOURCE_PLATFORM_NAMES[key] || '',
          type: 'lx',
        });
      } else {
        for (const sourceId of lxSources) {
          if (seenKeys.has(sourceId)) continue;
          seenKeys.add(sourceId);
          sources.push({
            key: sourceId,
            name: LX_SOURCE_NAMES[sourceId],
            platform: SOURCE_PLATFORM_NAMES[sourceId] || '',
            type: 'lx',
          });
        }
      }
    } else if (p.format === 'musicfree') {
      // MusicFree 插件（如 BakaMusic）：以插件名显示，key 带 mf_ 前缀避免与 LX 源冲突
      const key = `mf_${p.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      sources.push({
        key,
        name: p.name,
        platform: p.name,
        type: 'musicfree',
        pluginSource: p,
      });

      // 哔哩哔哩插件：额外添加收藏夹导入入口
      if (p.sources.some(s => s.toLowerCase() === 'bilibili')) {
        const favKey = `fav_${p.id}`;
        if (!seenKeys.has(favKey)) {
          seenKeys.add(favKey);
          sources.push({
            key: favKey,
            name: '哔哩哔哩收藏夹',
            platform: p.name,
            type: 'favorites',
            pluginSource: p,
          });
        }
      }
    }
  }

  return sources;
}

/** 歌单详情信息 */
export interface PlaylistInfo {
  name: string;
  img: string;
  desc: string;
  author: string;
  playCount: string;
}

/** 导入结果 */
export interface PlaylistImportResult {
  source: string;
  songs: PluginSearchResult[];
  total: number;
  info: PlaylistInfo;
}

function log(_msg: string) {
}

// ==================== 工具函数 ====================

/** 格式化播放时间（与 LxSdk.formatPlayTime 一致） */
function formatPlayTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '--/--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;
}

// ==================== 加密工具（Rust host_crypto 计算） ====================

/**
 * 网易云 linuxapi 加密（与 LxSdkSongList.linuxapiEncrypt 一致）
 * AES-ECB-128 (PKCS7Padding) + hex 大写
 */
function linuxapiEncrypt(obj: object): Promise<string> {
  return hostLinuxapiEncrypt(JSON.stringify(obj));
}

// ---- 酷狗签名 ----

/**
 * 酷狗签名参数（与 LxSdkSongList.signatureParamsKg 一致）
 * sign = md5(keyparam + sortedParams + body + keyparam)
 */
function signatureParamsKg(params: string, platform: string, body: string): Promise<string> {
  return hostKugouSign(params, platform, body);
}

// ==================== HTTP 请求 ====================

/**
 * HTTP 请求（直接使用 Tauri 后端 pluginHttpRequest，绕过 CORS）
 * 与 yyy 项目 LxSdk.httpFetch 行为完全一致：
 * - 默认 User-Agent + Accept: application/json
 * - 自定义 headers 覆盖默认
 * - form → application/x-www-form-urlencoded
 * - body → 原始字符串（Content-Type 由调用方指定）
 * - 自动 JSON 解析响应体
 *
 * @param url 完整 URL
 * @param method GET / POST
 * @param headers 请求头
 * @param body 请求体（字符串）
 * @param form 表单数据（自动 urlencoded）
 * @returns { status, body, headers }
 */
async function httpFetch(
  url: string,
  method: 'GET' | 'POST' = 'GET',
  headers: Record<string, string> = {},
  body?: string,
  form?: Record<string, string>,
): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  const finalHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
    'Accept': 'application/json',
    ...headers,
  };

  let requestBody: string | undefined;

  if (method === 'POST') {
    if (form) {
      const formStr = Object.entries(form)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
      finalHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      requestBody = formStr;
    } else if (body) {
      if (!finalHeaders['Content-Type']) {
        finalHeaders['Content-Type'] = 'application/json';
      }
      requestBody = body;
    }
  }

  log(`[httpFetch] ${method} ${url.substring(0, 150)}`);

  const response = await pluginApi.pluginHttpRequest(
    method,
    url,
    finalHeaders,
    requestBody,
  );

  const text = response.body || '';

  // 错误时打印响应体前 500 字符，方便调试
  if (response.status >= 400) {
    log(`[httpFetch] ERROR body: ${text.substring(0, 500)}`);
  }

  // 自动 JSON 解析
  let parsedBody: any = text;
  try {
    parsedBody = JSON.parse(text);
  } catch { /* 保持字符串 */ }

  return { status: response.status, body: parsedBody, headers: response.headers || {} };
}

// ==================== LinkParser（移植自 LinkParser.kt）====================

export interface ParsedLink {
  source: string;      // "wy" | "tx" | "kw" | "kg"
  playlistId: string;
}

const URL_EXTRACTOR = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

/** 从用户输入文本中解析歌单链接 */
export function parseLink(input: string): ParsedLink | null {
  if (!input || !input.trim()) return null;

  // 先尝试直接匹配整段文本
  const direct = matchPlatform(input);
  if (direct) return direct;

  // 从文本中提取所有 URL，逐个尝试匹配
  const urls = input.match(URL_EXTRACTOR);
  if (urls) {
    for (const url of urls) {
      const parsed = matchPlatform(url);
      if (parsed) return parsed;
    }
  }

  return null;
}

function matchPlatform(text: string): ParsedLink | null {
  if (text.includes('music.163.com') || text.includes('163cn.tv') || text.includes('y.music.163.com')) {
    return matchWy(text);
  }
  if (text.includes('y.qq.com') || text.includes('i.y.qq.com') || text.includes('c.y.qq.com')) {
    return matchTx(text);
  }
  if (text.includes('kuwo.cn')) {
    return matchKw(text);
  }
  if (text.includes('kugou.com')) {
    return matchKg(text);
  }
  return null;
}

// 网易云正则
const wyRegex1 = /^.+[?&]id=(\d+)(?:&.*$|#.*$|$)/;
const wyRegex2 = /^.+\/playlist\/(\d+)\/\d+\/.+$/;

function matchWy(text: string): ParsedLink | null {
  let m = text.match(wyRegex1);
  if (m) return { source: 'wy', playlistId: m[1] };
  m = text.match(wyRegex2);
  if (m) return { source: 'wy', playlistId: m[1] };
  return null;
}

// QQ音乐正则
const txRegex1 = /\/playlist\/(\d+)/;
const txRegex2 = /id=(\d+)/;
const txRegex3 = /\/playsquare\/(\d+)/;

function matchTx(text: string): ParsedLink | null {
  let m = text.match(txRegex1);
  if (m) return { source: 'tx', playlistId: m[1] };
  m = text.match(txRegex2);
  if (m) return { source: 'tx', playlistId: m[1] };
  m = text.match(txRegex3);
  if (m) return { source: 'tx', playlistId: m[1] };
  return null;
}

// 酷我正则
const kwRegex1 = /\/playlists?(?:_detail)?\/(\d+)/;
const kwRegex2 = /playlistId=(\d+)/;

function matchKw(text: string): ParsedLink | null {
  let m = text.match(kwRegex1);
  if (m) return { source: 'kw', playlistId: m[1] };
  m = text.match(kwRegex2);
  if (m) return { source: 'kw', playlistId: m[1] };
  return null;
}

// 酷狗正则
const kgRegex1 = /\/(\d+)\.html(?:\?.*|&.*$|#.*$|$)/;
const kgRegex2 = /\/special\/(?:single\/)?(\d+)/;

// 酷狗 gcid_ 分享链接正则
const kgGcidRegex = /gcid_(\w+)/;

function matchKg(text: string): ParsedLink | null {
  // 优先匹配 gcid_ 分享链接（返回完整 URL，由 getListDetailKg 处理）
  if (kgGcidRegex.test(text)) {
    return { source: 'kg', playlistId: text };
  }
  let m = text.match(kgRegex1);
  if (m) return { source: 'kg', playlistId: m[1] };
  m = text.match(kgRegex2);
  if (m) return { source: 'kg', playlistId: m[1] };
  // 兜底：包含 global_collection_id 参数的 URL
  if (text.includes('global_collection_id')) {
    return { source: 'kg', playlistId: text };
  }
  return null;
}

// ==================== 歌单 ID 提取（各平台 URL → id）====================

function getWyListId(rawId: string): string | null {
  let id = rawId;
  if (id.includes('###')) id = id.split('###')[0];
  if (/[?&:/]/.test(id)) {
    let m = id.match(wyRegex1);
    if (m) return m[1];
    m = id.match(wyRegex2);
    if (m) return m[1];
    return null;
  }
  return id;
}

function getTxListId(rawId: string): string | null {
  const id = rawId;
  if (/[?&:/]/.test(id)) {
    let m = id.match(txRegex1);
    if (m) return m[1];
    m = id.match(txRegex2);
    if (m) return m[1];
    m = id.match(txRegex3);
    if (m) return m[1];
    return null;
  }
  return id;
}

function getKwListId(rawId: string): string | null {
  const id = rawId;
  if (/[?&:/]/.test(id)) {
    let m = id.match(kwRegex1);
    if (m) return m[1];
    m = id.match(kwRegex2);
    if (m) return m[1];
    return null;
  }
  if (id.startsWith('digest-')) {
    const parts = id.split('__');
    if (parts.length >= 2) return parts[1];
  }
  return id;
}

function getKgListId(rawId: string): string | null {
  const id = rawId;
  if (id.includes('.html')) {
    const m = id.match(kgRegex1);
    if (m) return m[1];
  }
  if (id.includes('special/')) {
    const m = id.match(kgRegex2);
    if (m) return m[1];
  }
  if (/[?&:/]/.test(id)) {
    const m = id.match(kgRegex2);
    if (m) return m[1];
    return null;
  }
  if (id.startsWith('id_')) return id.substring(3);
  if (/^\d+$/.test(id)) return id;
  return null;
}

// ==================== 歌曲转换 ====================

function createSearchResult(params: {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;   // 毫秒
  platform: string;   // 平台中文名
  sourceKey: string;  // "wy" | "tx" | "kw" | "kg"
  rawData: object;
}): PluginSearchResult {
  return {
    id: params.id,
    title: params.title,
    artist: params.artist,
    album: params.album,
    coverUrl: params.coverUrl,
    duration: params.duration,
    platform: params.platform,
    platformId: params.id,
    pluginId: params.sourceKey,
    rawData: params.rawData,
  };
}

// ==================== 网易云歌单详情 ====================

async function getListDetailWy(rawId: string): Promise<PlaylistImportResult> {
  const id = getWyListId(rawId);
  if (!id) return { source: 'wy', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };

  // linuxapi 加密 POST /api/linux/forward
  const params = {
    method: 'POST',
    url: 'https://music.163.com/api/v3/playlist/detail',
    params: { id, n: 100000, s: 8 },
  };
  const eparams = await linuxapiEncrypt(params);

  const resp = await httpFetch(
    'https://music.163.com/api/linux/forward',
    'POST',
    {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
      'Cookie': 'MUSIC_U=',
    },
    undefined,
    { eparams },
  );

  const body = resp.body;
  if (typeof body !== 'object' || body === null || body.code !== 200) {
    throw new Error(`网易云歌单获取失败: code=${body?.code ?? 'unknown'}`);
  }

  const playlist = body.playlist;
  if (!playlist) return { source: 'wy', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };

  const trackIds = playlist.trackIds || [];
  const tracks = playlist.tracks || [];
  const total = trackIds.length;

  log(`getListDetailWy: trackIds=${total}, tracks=${tracks.length}`);

  const songs: PluginSearchResult[] = [];
  const fetchedIds = new Set<string>();

  // 1. 解析已有的 tracks
  for (const track of tracks) {
    const parsed = parseWyTrack(track);
    if (parsed) {
      songs.push(parsed);
      fetchedIds.add(parsed.id);
    }
  }

  // 2. 收集尚未获取详情的 trackIds
  const remainingIds: string[] = [];
  for (const tid of trackIds) {
    const songId = String(tid.id ?? '');
    if (songId && !fetchedIds.has(songId)) {
      remainingIds.push(songId);
    }
  }

  log(`getListDetailWy: already fetched=${fetchedIds.size}, remaining=${remainingIds.length}`);

  // 3. 分批获取剩余歌曲详情（每批最多 1000 首）
  if (remainingIds.length > 0) {
    const batchSize = 1000;
    let processed = 0;
    while (processed < remainingIds.length) {
      const end = Math.min(processed + batchSize, remainingIds.length);
      const batch = remainingIds.slice(processed, end);
      const batchResult = await fetchWyMusicDetailList(batch);
      songs.push(...batchResult);
      processed = end;
    }
  }

  const info: PlaylistInfo = {
    name: decodeName(playlist.name || ''),
    img: playlist.coverImgUrl || '',
    desc: decodeName(playlist.description || ''),
    author: decodeName(playlist.creator?.nickname || ''),
    playCount: String(playlist.playCount || 0),
  };

  return { source: 'wy', songs, total, info };
}

/**
 * weapi 加密（Rust host_crypto 计算，与 lx-music-desktop 一致）
 * AES-CBC 双重加密 + RSA 加密随机密钥
 */
function weapiEncrypt(object: Record<string, any>): Promise<{ params: string; encSecKey: string }> {
  return hostWeapiEncrypt(JSON.stringify(object));
}

/**
 * 网易云批量获取歌曲详情（完全对齐 YinDongMusic 的实现）
 * 使用 weapi POST 到 /weapi/v3/song/detail，避免 GET URL 过长导致 400 错误
 * 每批最多 1000 首，失败自动重试 2 次
 */
async function fetchWyMusicDetailList(ids: string[]): Promise<PluginSearchResult[]> {
  if (ids.length === 0) return [];

  const MAX_RETRY = 2;
  let lastError: any = null;

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const encrypted = await weapiEncrypt({
        c: '[' + ids.map(id => `{"id":${id}}`).join(',') + ']',
        ids: '[' + ids.join(',') + ']',
      });

      const resp = await httpFetch(
        'https://music.163.com/weapi/v3/song/detail',
        'POST',
        {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
          'Origin': 'https://music.163.com',
          'Referer': 'https://music.163.com/',
        },
        `params=${encodeURIComponent(encrypted.params)}&encSecKey=${encodeURIComponent(encrypted.encSecKey)}`,
      );

      const body = resp.body;
      if (typeof body === 'object' && body !== null && body.code === 200) {
        const songs = body.songs || [];
        const list: PluginSearchResult[] = [];
        for (const track of songs) {
          const parsed = parseWyTrack(track);
          if (parsed) list.push(parsed);
        }
        log(`fetchWyMusicDetailList: requested=${ids.length}, parsed=${list.length}, attempt=${attempt + 1}`);
        return list;
      }

      log(`fetchWyMusicDetailList: attempt=${attempt + 1} code=${body?.code}, body=${typeof body === 'string' ? body.substring(0, 200) : JSON.stringify(body).substring(0, 200)}`);
      lastError = new Error(`code=${body?.code ?? 'unknown'}`);
    } catch (e: any) {
      log(`fetchWyMusicDetailList: attempt=${attempt + 1} exception: ${e?.message}`);
      lastError = e;
    }

    if (attempt < MAX_RETRY) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  throw new Error(`网易云歌曲详情获取失败: ${lastError?.message || 'unknown'}`);
}

/** 网易云歌曲元信息补全结果：封面 URL 与时长（毫秒） */
export interface WyTrackMetaPatch {
  coverUrl: string;
  durationMs: number;
}

/**
 * 按网易云歌曲 ID 批量补全封面与时长。
 *
 * 部分第三方 MusicFree 网易云插件（如时迁酱 v7）在 search 结果里既不返回可用的
 * artwork（album.picUrl 在 weapi/search 响应中不存在），也完全不返回 duration/dt
 * 字段。这里直接用官方 weapi 的 song/detail 批量补全，绕过插件实现差异。
 *
 * @param ids 网易云歌曲 ID 列表（纯数字 ID）
 * @returns songId -> { coverUrl, durationMs } 映射；失败时返回空 Map
 */
export async function fetchWyTrackMetaByIds(
  ids: string[],
): Promise<Map<string, WyTrackMetaPatch>> {
  const patches = new Map<string, WyTrackMetaPatch>();
  const validIds = ids.filter(id => /^\d+$/.test(id));
  if (validIds.length === 0) return patches;

  try {
    // 每批最多 1000 首，与 fetchWyMusicDetailList 的上游限制一致
    const BATCH_SIZE = 1000;
    for (let offset = 0; offset < validIds.length; offset += BATCH_SIZE) {
      const batch = validIds.slice(offset, offset + BATCH_SIZE);
      const details = await fetchWyMusicDetailList(batch);
      for (const detail of details) {
        patches.set(String(detail.id), {
          coverUrl: detail.coverUrl || '',
          durationMs: detail.duration || 0,
        });
      }
    }
  } catch (e: any) {
    log(`fetchWyTrackMetaByIds failed: ${e?.message || e}`);
  }

  return patches;
}

/**
 * 按 QQ 音乐 songmid 批量补全封面与时长。
 *
 * v8/fcg-bin/fcg_play_single_song.fcg 是无需登录的经典开放接口（搜索/详情接口
 * musicu.fcg DoSearchForQQMusicDesktop 已要求登录），支持逗号分隔批量 songmid，
 * 返回 interval（秒）与 album.mid（可拼官方 y.gtimg.cn 封面）。
 */
export async function fetchQqTrackMetaByIds(
  mids: string[],
): Promise<Map<string, WyTrackMetaPatch>> {
  const patches = new Map<string, WyTrackMetaPatch>();
  const validMids = mids.filter(mid => /^[0-9A-Za-z]{6,32}$/.test(mid));
  if (validMids.length === 0) return patches;

  const BATCH_SIZE = 60;
  for (let offset = 0; offset < validMids.length; offset += BATCH_SIZE) {
    const batch = validMids.slice(offset, offset + BATCH_SIZE);
    try {
      const resp = await httpFetch(
        `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid=${batch.join(',')}&format=json`,
        'GET',
        {
          Origin: 'https://y.qq.com',
          Referer: 'https://y.qq.com/',
        },
      );
      const body = resp.body;
      const list = Array.isArray(body?.data) ? body.data : [];
      for (const track of list) {
        const mid = String(track?.mid || '');
        if (!mid) continue;
        const intervalSec = Number(track?.interval) || 0;
        const albumMid = String(track?.album?.mid || '');
        patches.set(mid, {
          coverUrl: albumMid
            ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
            : '',
          durationMs: intervalSec > 0 ? intervalSec * 1000 : 0,
        });
      }
    } catch (e: any) {
      log(`fetchQqTrackMetaByIds batch failed: ${e?.message || e}`);
    }
  }

  return patches;
}

/**
 * 按酷狗歌曲标识补全时长（专辑页优先整张专辑一次拉全，精确 hash 匹配）。
 *
 * 时迁酱系酷狗插件的 getAlbumInfo 结果不带时长。mobilecdn v3 album/song 按专辑 ID
 * 返回全量曲目（字段小写：hash/duration 秒/filename），一次请求即可补完整页；
 * 无专辑 ID（歌手页等）或未命中时回退 song_search_v2 按歌名搜索，hash 精确匹配。
 */
export async function fetchKgTrackMetaByIds(
  items: { id: string; title?: string; artist?: string }[],
  albumId?: string,
): Promise<Map<string, WyTrackMetaPatch>> {
  const patches = new Map<string, WyTrackMetaPatch>();
  if (items.length === 0) return patches;

  // hash 小写索引 + 数字 ID（audio_id/mixsongid）索引，同一曲目双键登记
  const hashIndex = new Map<string, { durationMs: number; coverUrl: string }>();
  const numIndex = new Map<string, { durationMs: number; coverUrl: string }>();
  const register = (hash: any, nums: any[], durationSec: number, coverUrl: string) => {
    if (durationSec <= 0) return;
    const entry = { durationMs: durationSec * 1000, coverUrl: coverUrl || '' };
    const h = String(hash || '').trim().toLowerCase();
    if (h) hashIndex.set(h, entry);
    for (const n of nums) {
      const key = String(n ?? '').trim();
      if (key && /^\d+$/.test(key)) numIndex.set(key, entry);
    }
  };
  const lookup = (id: string): { durationMs: number; coverUrl: string } | undefined =>
    hashIndex.get(id.toLowerCase()) || numIndex.get(id);

  // 专辑页：一次拉全量曲目
  if (albumId && /^\d+$/.test(albumId)) {
    try {
      const resp = await httpFetch(
        `http://mobilecdn.kugou.com/api/v3/album/song?albumid=${albumId}&page=1&pagesize=-1`,
        'GET',
        { Referer: 'https://www.kugou.com/' },
      );
      const info = ((resp.body as any)?.data?.info || []) as any[];
      for (const track of info) {
        register(track.hash, [track.audio_id, track.album_audio_id, track.mixsongid], Number(track.duration) || 0, '');
      }
    } catch { /* 专辑接口失败走搜索兜底 */ }
  }

  let searched = 0;
  for (const item of items) {
    const hit = lookup(item.id);
    if (hit) {
      patches.set(item.id, hit);
      continue;
    }
    // 搜索兜底：按歌名搜索，hash/数字 ID 精确匹配（限量防刷）
    if (!item.title || searched >= 40) continue;
    searched++;
    try {
      const resp = await httpFetch(
        `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(item.title)}` +
        `&page=1&pagesize=30&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`,
        'GET',
        { Referer: 'https://www.kugou.com/' },
      );
      const lists = ((resp.body as any)?.data?.lists || []) as any[];
      for (const track of lists) {
        register(track.FileHash, [track.MixSongID, track.Audioid, track.AudioId], Number(track.Duration) || 0, '');
        const m = lookup(item.id);
        if (m) {
          patches.set(item.id, m);
          break;
        }
      }
    } catch { /* 逐首失败忽略 */ }
  }

  return patches;
}

/**
 * 逐首兜底：www.kuwo.cn 的 /api/www/* 接口对脚本类 TLS 指纹风控
 * （实测返回 "The request is illegal!"），musicInfo 逐首请求成功率低；
 * 失败再回退开放的 search.kuwo.cn/r.s 按歌名搜索精确匹配 MUSICRID（rid 全局唯一）。
 * 歌单/歌手页已由上方批量索引覆盖，这里只处理零星未命中的条目。
 */
/**
 * 酷我批量索引：优先一次拉全整页时长，未命中再逐首兜底。
 *
 * 时迁酱系酷我插件的 getMusicSheetInfo（nplserver）与 getArtistWorks（r.s artist2music）
 * 映射时丢弃了接口条目自带的 duration，且歌单/歌手页 item 不带时长。
 * 两个源接口本身稳定开放（无风控），条目自带 id/musicrid + duration（秒）：
 * - 歌单：nplserver pl.svc op=getlistinfo，一次 rn=1000 拉全
 * - 歌手：search.kuwo.cn/r.s stype=artist2music，rn=100 翻页（上限 5 页）
 * www.kuwo.cn/api musicInfo 已被风控（"The request is illegal!"），仅作最后兜底。
 */
async function buildKwSheetIndex(sheetId: string): Promise<Map<string, number>> {
  const index = new Map<string, number>();
  if (!/^\d+$/.test(sheetId)) return index;
  try {
    const resp = await httpFetch(
      `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${sheetId}&pn=0&rn=1000` +
      `&encode=utf8&keyset=pl2012&vipver=MUSIC_9.1.1.2_BCS2&newver=1`,
      'GET',
      { Referer: 'https://www.kuwo.cn/' },
    );
    const body = resp.body as any;
    if (!body || body.result !== 'ok') return index;
    for (const track of body.musiclist || []) {
      const rid = String(track.id ?? '').replace(/^MUSIC_/i, '');
      const sec = parseInt(track.duration || '0', 10) || 0;
      if (rid && sec > 0) index.set(rid, sec * 1000);
    }
  } catch { /* 失败走逐首兜底 */ }
  return index;
}

async function buildKwArtistIndex(artistId: string): Promise<Map<string, number>> {
  const index = new Map<string, number>();
  if (!/^\d+$/.test(artistId)) return index;
  for (let pn = 0; pn < 5; pn++) {
    try {
      const resp = await httpFetch(
        `http://search.kuwo.cn/r.s?pn=${pn}&rn=100&artistid=${artistId}&stype=artist2music` +
        `&sortby=0&alflac=1&show_copyright_off=1&pcmp4=1&encoding=utf8&plat=pc` +
        `&thost=search.kuwo.cn&vipver=MUSIC_9.1.1.2_BCS2&devid=38668888&newver=1&pcjson=1`,
        'GET',
        { Referer: 'https://www.kuwo.cn/' },
      );
      const text = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body);
      const body = JSON.parse(String(text).replace(/'/g, '"'));
      const list = body?.musiclist || [];
      for (const track of list) {
        const rid = String(track.musicrid ?? '').replace(/^MUSIC_/i, '');
        const sec = parseInt(track.duration || '0', 10) || 0;
        if (rid && sec > 0) index.set(rid, sec * 1000);
      }
      const total = Number(body?.total) || 0;
      if ((pn + 1) * 100 >= total || list.length === 0) break;
    } catch { break; }
  }
  return index;
}

export async function fetchKwTrackMetaByIds(
  items: { id: string; title?: string; artist?: string }[],
  opts?: {
    sheetId?: string;
    artistId?: string;
    /** 增量回调：批量索引/逐首兜底每个阶段就绪即回调，调用方立即落盘，无需等慢速兜底全部跑完 */
    onPatches?: (patches: ReadonlyMap<string, WyTrackMetaPatch>) => void;
  },
): Promise<Map<string, WyTrackMetaPatch>> {
  const patches = new Map<string, WyTrackMetaPatch>();
  const validItems = items.filter(item => /^\d+$/.test(item.id));
  if (validItems.length === 0) return patches;

  // 批量索引优先：歌单页/歌手页一次拉全（快且不受 musicInfo 风控影响）
  const batchIndex = new Map<string, number>();
  if (opts?.sheetId) {
    for (const [rid, ms] of await buildKwSheetIndex(opts.sheetId)) batchIndex.set(rid, ms);
  }
  if (opts?.artistId) {
    for (const [rid, ms] of await buildKwArtistIndex(opts.artistId)) batchIndex.set(rid, ms);
  }
  for (const item of validItems) {
    const ms = batchIndex.get(item.id);
    if (ms) patches.set(item.id, { coverUrl: '', durationMs: ms });
  }
  // 批量命中立即通知落盘（不等下方逐首兜底）
  opts?.onPatches?.(patches);

  const CONCURRENCY = 3;
  const fetchOne = async (rid: string): Promise<WyTrackMetaPatch | null> => {
    try {
      const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const resp = await httpFetch(
        `https://www.kuwo.cn/api/www/music/musicInfo?mid=${rid}&httpsStatus=1&reqId=${reqId}`,
        'GET',
        {
          csrf: 'ABCDEF',
          Cookie: 'kw_token=ABCDEF',
          Referer: 'https://www.kuwo.cn/',
        },
      );
      const data = (resp.body as any)?.data;
      if (!data) return null;
      const durationSec = Number(data.duration) || 0;
      const pic = String(data.pic || data.albumpic || '');
      return {
        coverUrl: pic ? pic.replace(/^http:\/\//i, 'https://') : '',
        durationMs: durationSec > 0 ? durationSec * 1000 : 0,
      };
    } catch {
      return null;
    }
  };

  // 逐首 musicInfo 只处理批量索引未命中的零星条目（全命中时立即返回，不等慢队列）。
  // www 域被风控时每首都要等超时，若全量跑会拖住整个补全的落盘时间
  const leftover = validItems.filter(item => !patches.get(item.id)?.durationMs).slice(0, 40);
  let cursor = 0;
  const worker = async () => {
    while (cursor < leftover.length) {
      const item = leftover[cursor++];
      const patch = await fetchOne(item.id);
      if (patch) patches.set(item.id, patch);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, leftover.length) }, () => worker()),
  );
  if (leftover.length > 0) opts?.onPatches?.(patches);

  // musicInfo 仍缺时长时回退：r.s 开放接口按歌名搜索（返回 Python 风格单引号 JSON），
  // rid 全局唯一，精确匹配 MUSICRID 后取 DURATION（秒）。限量防刷，小并发缩短串行尾巴
  const missing = validItems.filter(item => {
    const p = patches.get(item.id);
    return !p || !p.durationMs;
  }).filter(item => item.title).slice(0, 40);
  if (missing.length > 0) {
    let rsCursor = 0;
    const rsWorker = async () => {
      while (rsCursor < missing.length) {
        const item = missing[rsCursor++];
        try {
          const url =
            `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(item.title!)}` +
            `&pn=0&rn=30&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1` +
            `&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`;
          const resp = await httpFetch(url, 'GET', { Referer: 'https://www.kuwo.cn/' });
          const text = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body);
          const abslist = JSON.parse(String(text).replace(/'/g, '"'))?.abslist || [];
          const hit = abslist.find(
            (entry: any) => String(entry.MUSICRID || '').replace('MUSIC_', '') === item.id,
          );
          if (hit) {
            const durationSec = parseInt(hit.DURATION) || 0;
            if (durationSec > 0) {
              patches.set(item.id, { coverUrl: '', durationMs: durationSec * 1000 });
            }
          }
        } catch { /* 逐首失败忽略 */ }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, missing.length) }, () => rsWorker()),
    );
    opts?.onPatches?.(patches);
  }

  return patches;
}

function parseWyTrack(track: any): PluginSearchResult | null {
  const id = String(track.id ?? '');
  if (!id || id === '0') return null;

  const name = decodeName(track.name || '');
  // 兼容 v3 端点（ar/al/dt）和 v1 端点（artists/album/duration）
  const ar = track.ar || track.artists || [];
  const al = track.al || track.album || {};
  const duration = track.dt || track.duration || 0;
  const img = al.picUrl || track.album?.picUrl || '';
  const singerName = formatSingerName(ar);

  const rawData = {
    songmid: id,
    name,
    singer: singerName,
    source: 'wy',
    interval: formatPlayTime(Math.floor(duration / 1000)),
  };

  return createSearchResult({
    id,
    title: name,
    artist: singerName,
    album: decodeName(al.name || ''),
    coverUrl: img,
    duration,
    platform: '网易云',
    sourceKey: 'wy',
    rawData,
  });
}

// ==================== QQ音乐歌单详情 =====================

async function getListDetailTx(rawId: string): Promise<PlaylistImportResult> {
  let id = getTxListId(rawId);
  if (!id && (rawId.startsWith('http://') || rawId.startsWith('https://'))) {
    id = await resolveTxShareUrl(rawId);
  }
  if (!id) return { source: 'tx', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };

  const url = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg` +
    `?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${id}` +
    `&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8` +
    `&notice=0&platform=yqq.json&needNewCode=0`;

  const resp = await httpFetch(url, 'GET', {
    'Origin': 'https://y.qq.com',
    'Referer': `https://y.qq.com/n/yqq/playsquare/${id}.html`,
  });

  const body = resp.body;
  if (typeof body !== 'object' || body === null || body.code !== 0) {
    throw new Error(`QQ音乐歌单获取失败: code=${body?.code ?? 'unknown'}`);
  }

  const cdlist = body.cdlist || [];
  if (cdlist.length === 0) return { source: 'tx', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };

  const cd = cdlist[0];
  const songlist = cd.songlist || [];

  const songs: PluginSearchResult[] = [];
  for (const item of songlist) {
    const parsed = parseTxSong(item);
    if (parsed) songs.push(parsed);
  }

  const info: PlaylistInfo = {
    name: decodeName(cd.dissname || ''),
    img: cd.logo || '',
    desc: decodeName(cd.desc || '').replace(/<br>/g, '\n'),
    author: cd.nickname || '',
    playCount: String(cd.visitnum || 0),
  };

  return { source: 'tx', songs, total: songs.length, info };
}

function parseTxSong(item: any): PluginSearchResult | null {
  const songmid = item.mid || '';
  const songId = String(item.id || '');
  if (!songmid && !songId) return null;

  const singer = item.singer || [];
  const singerName = formatSingerName(singer);
  const name = decodeName(item.title || '');
  const album = item.album || {};
  const albumName = decodeName(album.name || '');
  const albumMid = album.mid || '';
  const interval = item.interval || 0;
  const file = item.file || {};
  const strMediaMid = file.media_mid || '';

  // 封面
  let img = '';
  if (!albumName || albumName === '空') {
    const firstSinger = singer[0];
    if (firstSinger) {
      img = `https://y.gtimg.cn/music/photo_new/T001R500x500M000${firstSinger.mid || ''}.jpg`;
    }
  } else {
    img = `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg`;
  }

  const rawData = {
    songmid,
    songId,
    strMediaMid,
    albumMid,
    name,
    singer: singerName,
    source: 'tx',
    interval: formatPlayTime(interval),
  };

  return createSearchResult({
    id: songmid || songId,
    title: name,
    artist: singerName,
    album: albumName,
    coverUrl: img,
    duration: interval * 1000,
    platform: 'QQ音乐',
    sourceKey: 'tx',
    rawData,
  });
}

/** 解析 QQ音乐分享 URL，从 HTML/JSON 中提取歌单 id */
async function resolveTxShareUrl(url: string): Promise<string | null> {
  try {
    const resp = await httpFetch(url, 'GET', {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; HLK-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.5112.102 Mobile Safari/537.36 EdgA/104.0.1293.70',
    });
    const body = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body);

    // 1. id= 查询参数
    let m = body.match(/id=(\d+)/);
    if (m) return m[1];
    // 2. /playlist/\d+ 路径
    m = body.match(/\/playlist\/(\d+)/);
    if (m) return m[1];
    // 3. /playsquare/\d+ 路径
    m = body.match(/\/playsquare\/(\d+)/);
    if (m) return m[1];
    // 4. "disstid":"?\d+" JSON 字段
    m = body.match(/"disstid"\s*:\s*"?(\d+)"?/);
    if (m) return m[1];
    // 5. "dissid":"?\d+" JSON 字段
    m = body.match(/"dissid"\s*:\s*"?(\d+)"?/);
    if (m) return m[1];

    return null;
  } catch (e: any) {
    log(`resolveTxShareUrl failed: ${e?.message}`);
    return null;
  }
}

// ==================== 酷我歌单详情 =====================

async function getListDetailKw(rawId: string): Promise<PlaylistImportResult> {
  const id = getKwListId(rawId);
  if (!id) return { source: 'kw', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };

  const url = `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}` +
    `&pn=0&rn=1000&encode=utf8&keyset=pl2012` +
    `&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`;

  const resp = await httpFetch(url, 'GET', {
    'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 9;)',
  });

  const body = resp.body;
  if (typeof body !== 'object' || body === null || body.result !== 'ok') {
    throw new Error(`酷我歌单获取失败: result=${body?.result ?? 'unknown'}`);
  }

  const musiclist = body.musiclist || [];
  const songs: PluginSearchResult[] = [];
  for (const item of musiclist) {
    const parsed = parseKwSong(item);
    if (parsed) songs.push(parsed);
  }

  const info: PlaylistInfo = {
    name: decodeName(body.title || ''),
    img: body.pic || '',
    desc: decodeName(body.info || ''),
    author: decodeName(body.uname || ''),
    playCount: String(body.playnum || 0),
  };

  return { source: 'kw', songs, total: body.total || songs.length, info };
}

function parseKwSong(item: any): PluginSearchResult | null {
  const idStr = String(item.id ?? '');
  if (!idStr) return null;

  const name = decodeName(item.name || '');
  const artist = decodeName(item.artist || '');
  const album = decodeName(item.album || '');
  const durationSec = parseInt(item.duration || '0', 10) || 0;

  const rawData = {
    songmid: idStr,
    name,
    singer: artist,
    source: 'kw',
    interval: formatPlayTime(durationSec),
  };

  return createSearchResult({
    id: idStr,
    title: name,
    artist,
    album,
    coverUrl: '',
    duration: durationSec * 1000,
    platform: '酷我',
    sourceKey: 'kw',
    rawData,
  });
}

// ==================== 酷狗歌单详情 =====================

async function getListDetailKg(rawId: string): Promise<PlaylistImportResult> {
  // 分支 1：gcid_ 分享链接
  if (rawId.includes('gcid_')) {
    return getKgListDetailByGcid(rawId);
  }
  // 分支 2：包含 global_collection_id 参数
  if (rawId.includes('global_collection_id')) {
    const m = rawId.match(/global_collection_id=(\w+)/);
    if (m && m[1]) {
      return getKgUserListDetail2(m[1]);
    }
  }
  // 分支 3：先尝试本地正则提取 specialid
  let id = getKgListId(rawId);
  if (!id && (rawId.startsWith('http://') || rawId.startsWith('https://'))) {
    const gcid = await resolveKgShareUrl(rawId);
    if (gcid) return getKgUserListDetail2(gcid);
  }
  if (!id) return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };

  // 通过 specialid 获取歌单详情（HTML 解析）
  const url = `https://www2.kugou.kugou.com/yueku/v9/special/single/${id}-5-9999.html`;
  const resp = await httpFetch(url, 'GET');
  const body = typeof resp.body === 'string' ? resp.body : '';

  const listDataMatch = body.match(/global\.data\s*=\s*(\[.+]);/s);
  if (!listDataMatch) {
    return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  let listArr: any[];
  try {
    listArr = JSON.parse(listDataMatch[1]);
  } catch {
    return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  const songs: PluginSearchResult[] = [];
  for (const item of listArr) {
    const parsed = parseKgSong(item);
    if (parsed) songs.push(parsed);
  }

  const listInfoMatch = body.match(/global\s*=\s*\{[\s\S]+?name:\s*"(.+?)"[\s\S]+?pic:\s*"(.+?)"[\s\S]+?};/);
  const info: PlaylistInfo = {
    name: listInfoMatch ? decodeName(listInfoMatch[1]) : '',
    img: listInfoMatch ? listInfoMatch[2] : '',
    desc: '',
    author: '',
    playCount: '',
  };

  return { source: 'kg', songs, total: songs.length, info };
}

function parseKgSong(item: any): PluginSearchResult | null {
  const hash = item.hash || '';
  const audioId = String(item.audio_id ?? '');
  if (!hash && !audioId) return null;

  const singerName = decodeName(item.singername || '');
  const songname = decodeName(item.songname || '');
  const albumName = decodeName(item.album_name || '');
  const durationMs = item.duration || 0;

  const songIdStr = audioId || hash;
  const rawData: any = {
    songmid: songIdStr,
    name: songname,
    singer: singerName,
    source: 'kg',
    interval: formatPlayTime(Math.floor(durationMs / 1000)),
  };
  if (hash) rawData.hash = hash;

  return createSearchResult({
    id: songIdStr,
    title: songname,
    artist: singerName,
    album: albumName,
    coverUrl: '',
    duration: durationMs,
    platform: '酷狗',
    sourceKey: 'kg',
    rawData,
  });
}

/** 处理 gcid_ 分享链接 */
async function getKgListDetailByGcid(rawId: string): Promise<PlaylistImportResult> {
  const gcidMatch = rawId.match(/gcid_(\w+)/);
  let globalCollectionId: string | null = null;

  if (gcidMatch) {
    const gcid = 'gcid_' + gcidMatch[1];
    try {
      globalCollectionId = await decodeGcid(gcid);
    } catch (e: any) {
      log(`getKgListDetailByGcid: decodeGcid failed: ${e?.message}`);
    }
  }

  // 回退：fetch 分享链接 HTML
  if (!globalCollectionId && (rawId.startsWith('http://') || rawId.startsWith('https://'))) {
    globalCollectionId = await resolveKgShareUrl(rawId);
  }

  if (!globalCollectionId) {
    return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  return getKgUserListDetail2(globalCollectionId);
}

/** 从分享 URL HTML 中提取 global_collection_id */
async function resolveKgShareUrl(url: string): Promise<string | null> {
  try {
    const resp = await httpFetch(url, 'GET', {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1',
      'Referer': url,
    });
    const body = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body);
    if (!body) return null;

    // 1. 直接提取 global_collection_id
    let m = body.match(/global_collection_id["']?\s*[:=]\s*["']?(\w+)/);
    if (m && m[1]) return m[1];

    // 2. 提取 encode_gic / encode_src_gid → decodeGcid
    const gcid = body.match(/"encode_gic"\s*:\s*"(\w+)"/)?.[1]
      || body.match(/"encode_src_gid"\s*:\s*"(\w+)"/)?.[1]
      || body.match(/encode_gic["']?\s*[:=]\s*["']?(\w+)/)?.[1]
      || body.match(/encode_src_gid["']?\s*[:=]\s*["']?(\w+)/)?.[1];

    if (gcid) {
      try {
        return await decodeGcid('gcid_' + gcid);
      } catch (e: any) {
        log(`resolveKgShareUrl: decodeGcid(${gcid}) failed: ${e?.message}`);
      }
    }

    return null;
  } catch (e: any) {
    log(`resolveKgShareUrl failed: ${e?.message}`);
    return null;
  }
}

/** 酷狗 decodeGcid（与 kg/songList.js decodeGcid 一致） */
async function decodeGcid(gcid: string): Promise<string> {
  const params = 'dfid=-&appid=1005&mid=0&clientver=20109&clienttime=640612895&uuid=-';
  const bodyStr = `{"ret_info":1,"data":[{"id":"${gcid}","id_type":2}]}`;
  const signature = await signatureParamsKg(params, 'android', bodyStr);
  const url = `https://t.kugou.com/v1/songlist/batch_decode?${params}&signature=${signature}`;

  const resp = await httpFetch(url, 'POST', {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; HUAWEI HMA-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36',
    'Referer': 'https://m.kugou.com/',
    'Content-Type': 'application/json',
  }, bodyStr);

  const body = resp.body;
  if (typeof body !== 'object' || body === null) {
    throw new Error('decodeGcid: response not JSON');
  }

  const errCode = body.error_code ?? body.errcode ?? body.err_code ?? -1;
  if (errCode !== 0) {
    throw new Error(`decodeGcid failed: errcode=${errCode}`);
  }

  const list = body.data?.list || body.list || body.info?.list || body.data?.info;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('decodeGcid: missing or empty list');
  }

  const globalCollectionId = list[0].global_collection_id || list[0].global_specialid;
  if (!globalCollectionId) {
    throw new Error('decodeGcid: missing global_collection_id');
  }

  return globalCollectionId;
}

/** 酷狗 getUserListDetail2（与 kg/songList.js 一致） */
async function getKgUserListDetail2(globalCollectionId: string): Promise<PlaylistImportResult> {
  if (globalCollectionId.length > 1000) {
    return { source: 'kg', songs: [], total: 0, info: { name: '', img: '', desc: '', author: '', playCount: '' } };
  }

  const id = globalCollectionId;
  const commonHeaders: Record<string, string> = {
    'mid': '1586163242519',
    'Referer': 'https://m3ws.kugou.com/share/index.php',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
    'dfid': '-',
    'clienttime': '1586163242519',
  };

  // 1. 获取歌单元信息
  const infoParams = `appid=1058&specialid=0&global_specialid=${id}&format=jsonp&srcappid=2919&clientver=20000&clienttime=1586163242519&mid=1586163242519&uuid=1586163242519&dfid=-`;
  const infoSig = await signatureParamsKg(infoParams, 'web', '');
  const infoUrl = `https://mobiles.kugou.com/api/v5/special/info_v2?${infoParams}&signature=${infoSig}`;
  const infoResp = await httpFetch(infoUrl, 'GET', commonHeaders);
  const infoBody = infoResp.body;
  if (typeof infoBody !== 'object' || infoBody === null) {
    throw new Error('kg info_v2: response not JSON');
  }

  const errCode = infoBody.error_code ?? infoBody.errcode ?? infoBody.err_code ?? -1;
  if (errCode !== 0) {
    throw new Error(`kg info_v2 failed: errcode=${errCode}`);
  }

  const info = infoBody.data || infoBody;
  const songCount = info.songcount || 0;
  const playlistName = decodeName(info.specialname || '');
  const playlistImg = (info.imgurl || '').replace('{size}', '240');
  const playlistDesc = decodeName(info.intro || '');
  const playlistAuthor = decodeName(info.nickname || '');

  // 2. 分页获取歌曲 hash 列表
  const hashList: any[] = [];
  let total = songCount;
  let p = 0;
  while (total > 0) {
    const limit = Math.min(total, 300);
    total -= limit;
    p++;
    const songParams = `appid=1058&global_specialid=${id}&specialid=0&plat=0&version=8000&page=${p}&pagesize=${limit}&srcappid=2919&clientver=20000&clienttime=1586163263991&mid=1586163263991&uuid=1586163263991&dfid=-`;
    const songSig = await signatureParamsKg(songParams, 'web', '');
    const songUrl = `https://mobiles.kugou.com/api/v5/special/song_v2?${songParams}&signature=${songSig}`;
    const songResp = await httpFetch(songUrl, 'GET', commonHeaders);
    const songBody = songResp.body;
    if (typeof songBody !== 'object' || songBody === null) break;

    const sErr = songBody.error_code ?? songBody.errcode ?? songBody.err_code ?? -1;
    if (sErr !== 0) break;

    const infoArr = songBody.data?.info || songBody.info || [];
    for (const item of infoArr) {
      hashList.push(item);
    }
  }

  // 3. 批量获取完整歌曲信息
  const songs = await getKgMusicInfos(hashList);

  const infoObj: PlaylistInfo = {
    name: playlistName,
    img: playlistImg,
    desc: playlistDesc,
    author: playlistAuthor,
    playCount: '',
  };

  return { source: 'kg', songs, total: songs.length, info: infoObj };
}

/** 酷狗批量获取歌曲信息 */
async function getKgMusicInfos(list: any[]): Promise<PluginSearchResult[]> {
  if (list.length === 0) return [];

  // 去重（按 hash）
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const item of list) {
    const hash = item.hash || '';
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    deduped.push(item);
  }

  // 分批（每批 100 个）
  const batches: any[][] = [];
  for (let i = 0; i < deduped.length; i += 100) {
    batches.push(deduped.slice(i, i + 100));
  }

  const results = await Promise.all(batches.map(async (batch) => {
    try {
      const key = await hostKugouRequestKey();
      const dataObj = {
        area_code: '1',
        show_privilege: 1,
        show_album_info: 1,
        is_publish: '',
        appid: 1005,
        clientver: 11451,
        mid: '1',
        dfid: '-',
        clienttime: Date.now(),
        key,
        fields: 'album_info,author_name,audio_info,ori_audio_name,base,songname',
        data: batch,
      };

      const resp = await httpFetch(
        'http://gateway.kugou.com/v2/album_audio/audio',
        'POST',
        {
          'KG-THash': '13a3164',
          'KG-RC': '1',
          'KG-Fake': '0',
          'KG-RF': '00869891',
          'User-Agent': 'Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi',
          'x-router': 'kmr.service.kugou.com',
          'Content-Type': 'application/json',
        },
        JSON.stringify(dataObj),
      );

      const body = resp.body;
      if (typeof body !== 'object' || body === null) return [];

      const errCode = body.error_code ?? body.errcode ?? body.err_code ?? -1;
      if (errCode !== 0) return [];

      const dataArr = body.data || [];
      const songs: PluginSearchResult[] = [];
      for (const item of dataArr) {
        // 每个元素是数组，取 [0]
        const first = Array.isArray(item) ? item[0] : item;
        if (first) {
          const parsed = parseKgSongDetailV2(first);
          if (parsed) songs.push(parsed);
        }
      }
      return songs;
    } catch (e: any) {
      log(`getKgMusicInfos batch failed: ${e?.message}`);
      return [];
    }
  }));

  return results.flat();
}

function parseKgSongDetailV2(item: any): PluginSearchResult | null {
  const audioInfo = item.audio_info || {};
  const albumInfo = item.album_info || {};
  const hash = audioInfo.hash || '';
  const audioId = String(audioInfo.audio_id ?? '');
  if (!hash && !audioId) return null;

  const singerName = decodeName(item.author_name || '');
  const songname = decodeName(item.songname || '');
  const albumName = decodeName(albumInfo.album_name || '');
  const durationMs = audioInfo.timelength || 0;

  const songIdStr = audioId || hash;
  const rawData: any = {
    songmid: songIdStr,
    name: songname,
    singer: singerName,
    source: 'kg',
    interval: formatPlayTime(Math.floor(durationMs / 1000)),
  };
  if (hash) rawData.hash = hash;

  return createSearchResult({
    id: songIdStr,
    title: songname,
    artist: singerName,
    album: albumName,
    coverUrl: '',
    duration: durationMs,
    platform: '酷狗',
    sourceKey: 'kg',
    rawData,
  });
}

// ==================== MusicFree 插件歌单导入 ====================

/**
 * 通过 MusicFree 插件导入歌单
 * 流程：用户输入关键词 → 插件搜索歌单 → 取第一个结果 → 获取歌单详情
 *
 * @param pluginSource MusicFree 插件源
 * @param keyword 歌单名称、ID 或链接（作为搜索关键词）
 * @returns 导入结果
 */
export async function importPlaylistFromMusicFreePlugin(
  pluginSource: PluginSource,
  keyword: string,
): Promise<PlaylistImportResult> {
  const input = keyword.trim();
  if (!input) {
    throw new Error('请输入歌单名称或链接');
  }

  log(`[MusicFree] 搜索歌单: "${input}" via ${pluginSource.name}`);

  // 1. 搜索歌单
  const searchResults = await pluginPlaylistSearch(pluginSource, input, 1);
  if (searchResults.length === 0) {
    throw new Error(`未在 ${pluginSource.name} 中找到匹配的歌单`);
  }

  // 取第一个搜索结果
  const sheetItem = searchResults[0];
  log(`[MusicFree] 找到歌单: "${sheetItem.title}" (${sheetItem.id})`);

  // 2. 获取歌单详情（可能分页，循环获取全部歌曲）
  const allSongs: PluginSearchResult[] = [];
  const seen = new Set<string>();
  let page = 1;
  let maxPageSize = 0;
  const MAX_PAGES = 50; // 安全上限
  const total = Number(sheetItem.trackCount) || 0;

  while (page <= MAX_PAGES) {
    const { songs, isEnd } = await pluginGetPlaylistDetailWithEnd(pluginSource, sheetItem.rawData, page);
    if (songs.length === 0) break;
    // 去重：部分插件忽略 page 参数，每页返回同一批
    const fresh = songs.filter(s => {
      const key = `${s.platformId ?? s.id}|${s.title}|${s.artist}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length === 0) break;
    allSongs.push(...fresh);
    // 插件明确返回 isEnd → 已到最后一页
    if (isEnd === true) break;
    // 已拉满歌单总数 → 结束
    if (total > 0 && allSongs.length >= total) break;
    maxPageSize = Math.max(maxPageSize, songs.length);
    // 兜底：isEnd 缺失时，本页数量不足已见最大页大小 → 最后一页（部分页）
    if (songs.length < maxPageSize) break;
    page++;
  }

  log(`[MusicFree] 歌单详情: ${allSongs.length} 首歌曲`);

  return {
    source: pluginSource.name,
    songs: allSongs,
    total: allSongs.length,
    info: {
      name: sheetItem.title || '导入的歌单',
      img: sheetItem.coverUrl || '',
      desc: '',
      author: sheetItem.artist || '',
      playCount: '',
    },
  };
}

// ==================== 收藏夹导入（哔哩哔哩等） ====================

/**
 * 通过插件的 importMusicSheet 接口直接导入收藏夹
 *
 * 与 importPlaylistFromMusicFreePlugin 不同，此函数不经过搜索步骤，
 * 直接将 URL/ID 传给插件的 importMusicSheet 方法获取全部曲目。
 *
 * @param pluginSource 支持收藏夹导入的插件源（如哔哩哔哩）
 * @param urlOrId 收藏夹链接或 ID
 * @returns 导入结果
 */
export async function importPlaylistFromFavorites(
  pluginSource: PluginSource,
  urlOrId: string,
): Promise<PlaylistImportResult> {
  const input = urlOrId.trim();
  if (!input) {
    throw new Error('请输入收藏夹链接或 ID');
  }

  log(`[Favorites] 导入收藏夹: "${input}" via ${pluginSource.name}`);

  const songs = await pluginImportMusicSheet(pluginSource, input);
  if (songs.length === 0) {
    throw new Error(`未能从 ${pluginSource.name} 收藏夹中获取歌曲，请检查链接是否正确`);
  }

  log(`[Favorites] 收藏夹导入完成: ${songs.length} 首歌曲`);

  return {
    source: pluginSource.name,
    songs,
    total: songs.length,
    info: {
      name: `${pluginSource.name}收藏夹`,
      img: songs[0]?.coverUrl || '',
      desc: '',
      author: '',
      playCount: '',
    },
  };
}

// ==================== 主入口 ====================

/**
 * 导入外部歌单（LX 音源）
 *
 * @param source 音源 key: "wy" | "tx" | "kw" | "kg" | "auto"
 * @param idOrUrl 歌单 ID 或分享链接
 * @returns 导入结果
 */
export async function importPlaylist(
  source: string,
  idOrUrl: string,
): Promise<PlaylistImportResult> {
  const input = idOrUrl.trim();
  if (!input) {
    throw new Error('请输入歌单链接或 ID');
  }

  // 当输入是 URL 时，自动从 URL 识别平台（忽略用户选择的源，避免选错）
  // 当输入是纯 ID 时，使用用户选择的源
  let actualSource = source;
  let actualId = input;

  if (input.startsWith('https://') || input.startsWith('https://')) {
    const parsed = parseLink(input);
    if (parsed) {
      actualSource = parsed.source;
      actualId = parsed.playlistId;
      log(`importPlaylist: auto-detected source=${actualSource} from URL (user selected=${source})`);
    } else {
      throw new Error('无法识别歌单链接，请确认链接来自网易云/QQ音乐/酷我/酷狗');
    }
  } else if (source === 'auto') {
    throw new Error('请选择对应音源后重试，或直接粘贴歌单链接');
  }

  log(`importPlaylist: source=${actualSource}, id=${actualId.substring(0, 100)}`);

  try {
    switch (actualSource) {
      case 'wy':
        return await getListDetailWy(actualId);
      case 'tx':
        return await getListDetailTx(actualId);
      case 'kw':
        return await getListDetailKw(actualId);
      case 'kg':
        return await getListDetailKg(actualId);
      default:
        throw new Error(`不支持的音源: ${actualSource}`);
    }
  } catch (e: any) {
    log(`importPlaylist[${actualSource}] failed: ${e?.message}`);
    throw e;
  }
}
