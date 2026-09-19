import { pluginApi } from '../tauri/pluginApi';


// ==================== 音源定义 ====================

export interface PlaylistSource {
  key: string;
  name: string;
  platform: string;
  type: 'lx' | 'musicfree' | 'favorites';
  pluginSource?: import('../../types').PluginSource;
}

export interface PlaylistInfo {
  name: string;
  img: string;
  desc: string;
  author: string;
  playCount: string;
}

export interface PlaylistSourceRef {
  /** 来源插件 id（MusicFree 插件 id 或 wy|tx|kw|kg 平台） */
  sourcePluginId?: string;
  /** 来源链接或 ID */
  sourceUrl?: string;
  /** 来源歌单原始数据（插件搜索结果 rawData） */
  sourceRaw?: any;
}

export interface PlaylistImportResult {
  source: string;
  songs: import('../../types').PluginSearchResult[];
  total: number;
  info: PlaylistInfo;
  /** 来源信息，用于之后从源端更新歌单 */
  sourceRef?: PlaylistSourceRef;
}

export interface ParsedLink {
  source: string;
  playlistId: string;
}

export interface WyTrackMetaPatch {
  coverUrl: string;
  durationMs: number;
}

// ==================== 工具函数 ====================

export function log(_msg: string) {
}

export function formatPlayTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '--/--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;
}

// ==================== HTTP 请求 ====================

export async function httpFetch(
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

  if (response.status >= 400) {
    log(`[httpFetch] ERROR body: ${text.substring(0, 500)}`);
  }

  let parsedBody: any = text;
  try {
    parsedBody = JSON.parse(text);
  } catch { /* 保持字符串 */ }

  return { status: response.status, body: parsedBody, headers: response.headers || {} };
}

// ==================== LinkParser（移植自 LinkParser.kt）====================

const URL_EXTRACTOR = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

export function parseLink(input: string): ParsedLink | null {
  if (!input || !input.trim()) return null;

  const direct = matchPlatform(input);
  if (direct) return direct;

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

const wyRegex1 = /^.+[?&]id=(\d+)(?:&.*$|#.*$|$)/;
const wyRegex2 = /^.+\/playlist\/(\d+)\/\d+\/.+$/;

function matchWy(text: string): ParsedLink | null {
  let m = text.match(wyRegex1);
  if (m) return { source: 'wy', playlistId: m[1] };
  m = text.match(wyRegex2);
  if (m) return { source: 'wy', playlistId: m[1] };
  return null;
}

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

const kwRegex1 = /\/playlists?(?:_detail)?\/(\d+)/;
const kwRegex2 = /playlistId=(\d+)/;

function matchKw(text: string): ParsedLink | null {
  let m = text.match(kwRegex1);
  if (m) return { source: 'kw', playlistId: m[1] };
  m = text.match(kwRegex2);
  if (m) return { source: 'kw', playlistId: m[1] };
  return null;
}

const kgRegex1 = /\/(\d+)\.html(?:\?.*|&.*$|#.*$|$)/;
const kgRegex2 = /\/special\/(?:single\/)?(\d+)/;

const kgGcidRegex = /gcid_(\w+)/;

function matchKg(text: string): ParsedLink | null {
  if (kgGcidRegex.test(text)) {
    return { source: 'kg', playlistId: text };
  }
  let m = text.match(kgRegex1);
  if (m) return { source: 'kg', playlistId: m[1] };
  m = text.match(kgRegex2);
  if (m) return { source: 'kg', playlistId: m[1] };
  if (text.includes('global_collection_id')) {
    return { source: 'kg', playlistId: text };
  }
  return null;
}

// ==================== 歌单 ID 提取（各平台 URL → id）====================

export function getWyListId(rawId: string): string | null {
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

export function getTxListId(rawId: string): string | null {
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

export function getKwListId(rawId: string): string | null {
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

export function getKgListId(rawId: string): string | null {
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

export function createSearchResult(params: {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
  platform: string;
  sourceKey: string;
  rawData: object;
}): import('../../types').PluginSearchResult {
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