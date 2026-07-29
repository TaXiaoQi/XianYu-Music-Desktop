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

import CryptoJs from 'crypto-js';
import he from 'he';
import { pluginApi } from './tauri/pluginApi';
import type { PluginSearchResult } from '../types';

// ==================== 音源定义 ====================

export interface PlaylistSource {
  key: string;       // "wy" | "tx" | "kw" | "kg" | "auto"
  name: string;      // 显示名称
  platform: string;  // 平台中文名
}

/** 4 个音源 + 自动识别，key 与 yyy 项目中的 LX 源 id 一致 */
export const PLAYLIST_SOURCES: PlaylistSource[] = [
  { key: 'auto', name: '自动识别', platform: '' },
  { key: 'wy', name: '小芸音乐', platform: '网易云' },
  { key: 'tx', name: '小秋音乐', platform: 'QQ音乐' },
  { key: 'kw', name: '小枸音乐', platform: '酷我' },
  { key: 'kg', name: '小蜗音乐', platform: '酷狗' },
];

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

// ==================== 日志 ====================

function log(msg: string) {
  console.log(`[PlaylistImport] ${msg}`);
}

// ==================== 工具函数 ====================

/** HTML 实体解码（与 LxSdk.decodeName 一致） */
function decodeName(str: string | null | undefined): string {
  if (!str) return '';
  try { return he.decode(str); } catch { return str; }
}

/** 格式化歌手名（与 LxSdk.formatSingerName 一致） */
function formatSingerName(singers: any[], nameKey = 'name', join = '、'): string {
  if (!singers || !Array.isArray(singers)) return '';
  const names: string[] = [];
  for (const item of singers) {
    if (item && typeof item === 'object') {
      const name = item[nameKey];
      if (name && typeof name === 'string' && name.trim()) {
        names.push(decodeName(name));
      }
    }
  }
  return names.join(join);
}

/** 格式化播放时间（与 LxSdk.formatPlayTime 一致） */
function formatPlayTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '--/--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;
}

// ==================== 加密工具 ====================

/** MD5 哈希（32 位小写 hex，与 LxSdk.md5 一致） */
function md5(str: string): string {
  return CryptoJs.MD5(str).toString();
}

/**
 * AES-ECB 加密（与 LxSdk.aesEncrypt ECB_128_NoPadding 一致）
 * 注意：原版 "AES" 在 Java 中默认是 PKCS5Padding，等价于 PKCS7Padding（16 字节块）
 * @param data 明文字符串
 * @param key 密钥字符串（UTF-8）
 * @returns base64 编码的密文
 */
function aesEcbEncrypt(data: string, key: string): string {
  const keyBytes = CryptoJs.enc.Utf8.parse(key);
  const encrypted = CryptoJs.AES.encrypt(data, keyBytes, {
    mode: CryptoJs.mode.ECB,
    padding: CryptoJs.pad.Pkcs7,
  });
  return encrypted.toString(); // base64
}

/** base64 → hex 大写 */
function b64ToHexUpper(b64: string): string {
  const words = CryptoJs.enc.Base64.parse(b64);
  return words.toString(CryptoJs.enc.Hex).toUpperCase();
}

// ---- 网易云加密 ----

/**
 * 网易云 linuxapi 加密（与 LxSdkSongList.linuxapiEncrypt 一致）
 * AES-ECB-128 (PKCS5Padding) + hex 大写
 */
function linuxapiEncrypt(obj: object): string {
  const text = JSON.stringify(obj);
  const encrypted = aesEcbEncrypt(text, 'rFgB&h#%2?^eDg:Q');
  return b64ToHexUpper(encrypted);
}

// ---- 酷狗签名 ----

/**
 * 酷狗签名参数（与 LxSdkSongList.signatureParamsKg 一致）
 * sign = md5(keyparam + sortedParams + body + keyparam)
 */
function signatureParamsKg(params: string, platform: string, body: string): string {
  const keyparam = platform === 'web'
    ? 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt'
    : 'OIlwieks28dk2k092lksi2UIkp';
  const paramList = params.split('&').sort();
  const signParams = keyparam + paramList.join('') + body + keyparam;
  return md5(signParams);
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
  log(`[httpFetch] ← ${response.status} bodyLen=${text.length}`);

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

const URL_EXTRACTOR = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;

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
const wyRegex1 = /^.+(?:\?|&)id=(\d+)(?:&.*$|#.*$|$)/;
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
  const eparams = linuxapiEncrypt(params);

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
 * 网易云批量获取歌曲详情
 * 使用 /api/song/detail GET 请求（无需加密），与 yyy LxSdkSongList.fetchWyMusicDetailList 目标一致
 * weapi 和 linuxapi 在 Tauri 环境下均异常（weapi 返回空 body，linuxapi 返回错误），
 * 改用 /api/song/detail 端点直接 GET 请求，该端点支持无加密访问。
 * 注意：v1 端点字段名与 v3 不同（artists/ar, album/al, duration/dt）。
 */
async function fetchWyMusicDetailList(ids: string[]): Promise<PluginSearchResult[]> {
  if (ids.length === 0) return [];

  const idsStr = `[${ids.join(',')}]`;
  const url = `https://music.163.com/api/song/detail/?ids=${encodeURIComponent(idsStr)}`;

  const resp = await httpFetch(url, 'GET', {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
    'Referer': 'https://music.163.com',
  });

  const body = resp.body;
  if (typeof body !== 'object' || body === null || body.code !== 200) {
    log(`fetchWyMusicDetailList: error code=${body?.code}, body=${typeof body === 'string' ? body.substring(0, 200) : JSON.stringify(body).substring(0, 200)}`);
    throw new Error(`网易云歌曲详情获取失败: code=${body?.code ?? 'unknown'}`);
  }

  const songs = body.songs || [];
  const list: PluginSearchResult[] = [];
  for (const track of songs) {
    const parsed = parseWyTrack(track);
    if (parsed) list.push(parsed);
  }
  log(`fetchWyMusicDetailList: requested=${ids.length}, parsed=${list.length}`);
  return list;
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
  const url = `http://www2.kugou.kugou.com/yueku/v9/special/single/${id}-5-9999.html`;
  const resp = await httpFetch(url, 'GET');
  const body = typeof resp.body === 'string' ? resp.body : '';

  const listDataMatch = body.match(/global\.data\s*=\s*(\[.+\]);/s);
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

  const listInfoMatch = body.match(/global\s*=\s*\{[\s\S]+?name:\s*"(.+?)"[\s\S]+?pic:\s*"(.+?)"[\s\S]+?\};/);
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
  const signature = signatureParamsKg(params, 'android', bodyStr);
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
  const infoSig = signatureParamsKg(infoParams, 'web', '');
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
    const songSig = signatureParamsKg(songParams, 'web', '');
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
        key: 'OIlwieks28dk2k092lksi2UIkp',
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

// ==================== 主入口 ====================

/**
 * 导入外部歌单
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

  if (input.startsWith('http://') || input.startsWith('https://')) {
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
