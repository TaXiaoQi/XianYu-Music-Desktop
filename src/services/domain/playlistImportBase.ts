import { pluginApi } from '../tauri/pluginApi';

/**
 * 外部歌单导入 · 共享底座（叶子模块）。
 * 类型、HTTP 封装、链接解析（URL → 平台+歌单 ID）与歌曲转换（createSearchResult）。
 * 无任何内部模块依赖，被各平台导入模块（Wy/Tx/Kw/Kg）与 playlistImport 门面共同引用。
 */

// ==================== 音源定义 ====================

export interface PlaylistSource {
  key: string;       // "wy" | "tx" | "kw" | "kg" | "auto" | "mf_<pluginId>"
  name: string;      // 显示名称
  platform: string;  // 平台中文名
  /** 来源类型：LX 直连导入 / MusicFree 插件导入 / 收藏夹导入 */
  type: 'lx' | 'musicfree' | 'favorites';
  /** MusicFree 插件源（仅 type='musicfree' 时有值），用于调用插件 API */
  pluginSource?: import('../../types').PluginSource;
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
  songs: import('../../types').PluginSearchResult[];
  total: number;
  info: PlaylistInfo;
}

export interface ParsedLink {
  source: string;      // "wy" | "tx" | "kw" | "kg"
  playlistId: string;
}

/** 网易云歌曲元信息补全结果：封面 URL 与时长（毫秒） */
export interface WyTrackMetaPatch {
  coverUrl: string;
  durationMs: number;
}

// ==================== 工具函数 ====================

export function log(_msg: string) {
}

/** 格式化播放时间（与 LxSdk.formatPlayTime 一致） */
export function formatPlayTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '--/--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;
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
  duration: number;   // 毫秒
  platform: string;   // 平台中文名
  sourceKey: string;  // "wy" | "tx" | "kw" | "kg"
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