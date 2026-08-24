/**
 * 插件引擎 —— 完全基于 MusicFree 插件系统
 *
 * 核心代码来自 MusicFree 项目：
 *   - 插件系统/core/pluginManager/plugin.ts  (Plugin 类 + PluginMethodsWrapper)
 *   - 搜索功能/searchPage/hooks/useSearch.ts  (搜索逻辑)
 *
 * 关键流程（与 MusicFree 完全一致）：
 *   1. 插件源码只允许委托给 Worker 沙箱执行，主线程不再执行插件源码
 *   2. Worker 沙箱内注入受控 npm 包和代理 fetch
 *   3. 执行后从 module.exports 提取插件实例
 *   4. 搜索结果中每个 item 调用 resetMediaItem(_, pluginName) 设置 platform
 *   5. getMediaSource 时传入的 musicItem 就是 resetMediaItem 后的对象
 */

import axios from 'axios';
import qs from 'qs';
import { ref } from 'vue';
import type {
  PluginSource,
  PluginSearchResult,
  PluginMusicInfo,
  PluginPlaylistSearchResult,
  QualityKey,
} from '../types';
import { ALL_QUALITY_KEYS, ALL_QUALITY_KEYS_DESC, QUALITY_META, normalizeQualityKey, qualityKeyToMfQuality, resolveOnlinePlayQuality } from '../types';
import type { OnlineQualityFallbackBehavior } from '../types';
import { buildBakaMfLyricsRaw } from './bakaMfLyricsBuilder';
import { isLxPluginScript, loadLxPluginFromScript, initLxPlugin, destroyLxPlugin, parseLxScriptInfo, isSongLevelError, getLxPluginScript } from './lxPluginEngine';
import { pluginApi } from './tauri/pluginApi';
import { hostSha256Hex } from './tauri/hostCryptoApi';
import {
  loadMusicFreeInSandbox,
  callSandboxMethod,
  destroySandbox,
  setUserVarsProvider,
  linkSandboxAlias,
} from './pluginSandboxManager';
import {
  createPluginSubscriptionService,
} from './pluginSubscriptions';
import {
  extractAlbum,
  extractArtist,
  extractCoverUrl,
  extractResultList,
  extractArtistAvatarUrl,
  qualityKeyToPluginString,
  resetMediaItem,
  stripHtmlTags,
  toPluginSearchResult,
  extractDurationMs,
  flattenTopListCategories,
} from './pluginResultMappers';
import { fetchWithTimeout } from './pluginFetch';
import { isQqMusicPluginSource, qqFillSongDurations, qqHostAlbumSearchFallback, qqHostAlbumSongsFallback, qqHostSearchFallback } from './qqHostSearchFallback';
import { fetchPlatformMusicComments } from './platformComments';
import {
  compareVersions,
  createPluginUpdateService,
} from './pluginUpdates';
import { BakaPluginManager } from './bakaPluginManager';
import { normalizeMediaRequestHeaders, sanitizeMediaUrl } from '../utils/mediaUrl';

export type { PluginUpdateCheckResult } from './pluginUpdates';

// B站插件标识：其专辑/歌单详情走统一的 getBilibiliDetail 专用路径
function isBilibiliSource(source: PluginSource): boolean {
  return source.name === 'bilibili' || String(source.id || '').includes('bilibili');
}

// ==================== 常量 ====================

const PLUGIN_SOURCES_KEY = 'xianyu_plugin_sources_v4';
const PLUGIN_SOURCES_KEY_LEGACY = 'xianyu_plugin_sources_v3';
const MAX_PLUGIN_SIZE = 2 * 1024 * 1024;

// 内置插件定义：已取消所有内置插件，此映射保留为空用于清理旧版本遗留的内置插件条目
const BUILTIN_PLUGINS: Record<string, string> = {};

// ==================== 沙箱隔离配置 ====================

// 沙箱模式开关：启用后插件代码在 Web Worker 中隔离执行
// 默认关闭，确保向后兼容；启用后可逐步验证各插件在沙箱中的表现
const USE_SANDBOX = true;

// 记录在沙箱中运行的插件 ID 集合
const _sandboxedPlugins = new Set<string>();

function inferActualQualityFromPluginResult(
  result: any,
  urlLike: string,
  fallback?: QualityKey,
): QualityKey | undefined {
  const resultQuality = normalizeQualityKey(result?.quality);
  if (resultQuality) return resultQuality;

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

/**
 * 创建沙箱代理实例
 *
 * 当插件在沙箱（Web Worker）中加载时，主线程无法直接持有插件实例。
 * 此函数创建一个代理对象，将所有方法调用通过 RPC 转发到 Worker。
 * 代理对象的接口与 IPluginInstance 完全一致，现有代码无需修改。
 */
function createSandboxProxy(pluginId: string, metadata: any): IPluginInstance {
  const allMethodNames = [
    'search', 'getMediaSource', 'getMvSource', 'getMusicInfo', 'getLyric',
    'getAlbumInfo', 'getArtistWorks', 'getTopLists', 'getTopListDetail',
    'importMusicSheet', 'importMusicItem', 'getMusicSheetInfo',
    'getRecommendSheetTags', 'getRecommendSheetsByTag',
    'getArtistInfo', 'getMusicComments', 'getMusicDetailPageUrl',
  ];

  // Worker 返回的 _availableMethods 包含插件实例实际实现的方法名列表
  // 只为这些方法创建代理函数，未实现的方法不创建函数桩
  // 这样 typeof proxy.someMethod === 'function' 能正确反映插件是否实现了该方法
  const availableMethods: string[] = Array.isArray(metadata._availableMethods)
    ? metadata._availableMethods
    : allMethodNames; // 回退：元数据无 _availableMethods 时全部代理（向后兼容）

  const proxy: any = {
    platform: metadata.platform,
    version: metadata.version,
    appVersion: metadata.appVersion,
    srcUrl: metadata.srcUrl,
    author: metadata.author,
    description: metadata.description,
    primaryKey: metadata.primaryKey,
    cacheControl: metadata.cacheControl,
    supportedSearchType: metadata.supportedSearchType,
    defaultSearchType: metadata.defaultSearchType,
    userVariables: normalizePluginUserVariables(metadata.userVariables),
    hints: metadata.hints,
    supportedQualities: metadata.supportedQualities,
  };

  for (const method of availableMethods) {
    proxy[method] = async (...args: any[]) => {
      return callSandboxMethod(pluginId, method, args, method === 'getLyric' ? 8000 : 30000);
    };
  }

  return proxy as IPluginInstance;
}

function isUnsupportedQualityError(message: string): boolean {
  return /不支持.*音质|音质.*不支持|quality.*not\s+support|not\s+support.*quality/i.test(message);
}

function buildNativePluginQualityPairs(
  quality: QualityKey | 'standard' | 'high' | 'lossless',
  fallbackBehavior: OnlineQualityFallbackBehavior,
  availableQualities: QualityKey[] | null,
): Array<{ pluginQ: string; qualityKey: QualityKey }> {
  const isQualityKey = (q: string): q is QualityKey => q in QUALITY_META;
  const pairs: Array<{ pluginQ: string; qualityKey: QualityKey }> = [];
  const seen = new Set<string>();
  const add = (qualityKey: QualityKey) => {
    const pluginQ = qualityKeyToPluginString(qualityKey);
    if (!seen.has(pluginQ)) {
      seen.add(pluginQ);
      pairs.push({ pluginQ, qualityKey });
    }
    // 部分 MusicFree QQ 插件把无损档称作 super，而不是 lossless/flac。
    if (QUALITY_META[qualityKey].isLossless && !seen.has('super')) {
      seen.add('super');
      pairs.push({ pluginQ: 'super', qualityKey });
    }
  };

  if (isQualityKey(quality) && availableQualities && availableQualities.length > 0) {
    resolveOnlinePlayQuality(quality, availableQualities, fallbackBehavior).forEach(add);
  } else if (isQualityKey(quality)) {
    if (fallbackBehavior === 'pause') {
      add(quality);
    } else if (fallbackBehavior === 'higher') {
      const startIdx = ALL_QUALITY_KEYS.indexOf(quality);
      if (startIdx >= 0) {
        for (let i = startIdx; i < ALL_QUALITY_KEYS.length; i++) add(ALL_QUALITY_KEYS[i]);
      } else {
        add(quality);
      }
    } else {
      const startIdx = ALL_QUALITY_KEYS_DESC.indexOf(quality);
      if (startIdx >= 0) {
        for (let i = startIdx; i < ALL_QUALITY_KEYS_DESC.length; i++) add(ALL_QUALITY_KEYS_DESC[i]);
      } else {
        add(quality);
      }
    }
  } else if (quality === 'lossless') {
    add('flac');
  } else if (quality === 'high') {
    add('320k');
  } else {
    add('128k');
  }

  return pairs;
}

let _logCallback: ((msg: string) => void) | null = null;

function log(msg: string) {
  try { if (_logCallback) { _logCallback(msg); } } catch { /* ignore */ }
}

// ==================== 插件状态版本号 ====================
// 响应式版本号：每次插件列表变更（增删/排序/开关/更新）后自增，
// 供 Search 等页面 watch 以第一时间刷新本地缓存的插件派生数据。
export const pluginsVersion = ref(0);

function bumpPluginsVersion() {
  pluginsVersion.value += 1;
}

// ==================== Cookie 管理（模拟 Electron session.cookies）====================

function getCookiesForUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const cookieStore = JSON.parse(localStorage.getItem('__plugin_cookies') || '{}');
    const cookies: string[] = [];
    for (const [name, info] of Object.entries(cookieStore)) {
      const c = info as any;
      if (c.domain && (domain.includes(c.domain) || c.domain.includes(domain))) {
        cookies.push(`${name}=${c.value}`);
      }
    }
    return cookies.join('; ');
  } catch {
    return '';
  }
}

function captureCookiesFromResponse(url: string, responseHeaders: Record<string, string>) {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const cookieStore = JSON.parse(localStorage.getItem('__plugin_cookies') || '{}');
    const setCookie = responseHeaders['set-cookie'] || responseHeaders['Set-Cookie'];
    if (setCookie) {
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      for (const c of cookies) {
        const parts = c.split(';')[0].split('=');
        if (parts.length >= 2) {
          const name = parts[0].trim();
          const value = parts.slice(1).join('=').trim();
          cookieStore[name] = { value, domain };
        }
      }
      localStorage.setItem('__plugin_cookies', JSON.stringify(cookieStore));
    }
  } catch { /* ignore */ }
}

// ==================== MusicFree 包注入（与 plugin.ts 第57~73行完全一致）====================

async function tauriAdapter(config: any): Promise<any> {
  try {
    const method = (config.method || 'GET').toUpperCase();

    let url = config.url || '';
    if (config.baseURL && !url.startsWith('http')) {
      url = config.baseURL + url;
    }

    if (config.params) {
      // [修复] 插件内部可能将 RegExp.match() 的结果（数组）直接作为 params 值传入，
      // qs.stringify 会把数组序列化为 key[0]=&key[1]= 格式，导致服务端解析失败。
      // 这里把数组值取第一个元素，模拟 axios 默认 paramsSerializer 对单值数组的行为。
      const cleanParams: Record<string, any> = {};
      for (const [key, value] of Object.entries(config.params)) {
        cleanParams[key] = Array.isArray(value) ? value[0] : value;
      }
      const paramStr = qs.stringify(cleanParams);
      url += (url.includes('?') ? '&' : '?') + paramStr;
    }

    const headers: Record<string, string> = {};
    if (config.headers) {
      for (const [key, value] of Object.entries(config.headers)) {
        if (typeof value === 'string' && !['Accept-Encoding', 'Connection'].includes(key)) {
          headers[key] = value;
        }
      }
    }

    let body: string | undefined;
    if (config.data !== undefined && config.data !== null) {
      body = typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
      // [修复防御]: body 经过上赋值后仍可能被 TS 推断为 undefined，需显式校验避免后续 .length 抛错
      if (body && body.length > 256 * 1024) {
        log(`[proxyAxios] 请求体过大 ${body.length} bytes，截断`);
        body = body.substring(0, 256 * 1024);
      }
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    // [修复防御]: 确保 URL 有效
    if (!url || !url.startsWith('http')) {
      throw new Error(`Invalid URL: ${url || '(empty)'}`);
    }

    // [修复] 自动注入 Cookie（模拟 Electron session.cookies 自动携带）
    const cookieStr = getCookiesForUrl(url);
    if (cookieStr && !headers['Cookie'] && !headers['cookie']) {
      headers['Cookie'] = cookieStr;
    }

    log(`[tauriAdapter] ${method} ${url.substring(0, 150)}, headers=${JSON.stringify(headers).substring(0, 300)}, body=${body ? body.substring(0, 200) : '(none)'}`);
    const response = await pluginApi.pluginHttpRequest(method, url, headers, body);
    log(`[tauriAdapter] 响应: status=${response.status}, bodyLen=${response.body?.length ?? 0}, bodyPreview=${response.body?.substring(0, 200) ?? ''}`);

    // [修复] 自动捕获 Set-Cookie（模拟 Electron session.cookies 自动捕获）
    if (response.headers) {
      captureCookiesFromResponse(url, response.headers);
    }

    let responseData: any;
    try {
      responseData = JSON.parse(response.body);
    } catch {
      responseData = response.body;
    }

    const axiosResponse = {
      data: responseData,
      status: response.status,
      statusText: response.status >= 200 && response.status < 300 ? 'OK' : 'Error',
      headers: response.headers,
      config,
    };

    const validateStatus = config.validateStatus || ((s: number) => s >= 200 && s < 300);
    if (!validateStatus(response.status)) {
      const error: any = new Error(`Request failed with status code ${response.status}`);
      error.response = axiosResponse;
      throw error;
    }

    return axiosResponse;
  } catch (e: any) {
    if (e?.response) throw e;
    // [修复防御]: Tauri v2 错误可能是字符串或对象，不一定是 Error 实例
    const errMsg = e?.message || (typeof e === 'string' ? e : JSON.stringify(e)?.substring(0, 200)) || 'Tauri backend request failed';
    log(`[proxyAxios] 请求失败: ${errMsg}, url=${config.url?.substring(0, 80)}`);
    const error: any = new Error(errMsg);
    error.config = config;
    throw error;
  }
}

// ==================== MusicFree 包注入（与 plugin.ts 第15~46行完全一致）====================

// Tauri 环境下 axios 无法直接发跨域请求，需要通过 tauriAdapter 代理到 Rust 后端
const proxyAxios = axios.create({
  adapter: tauriAdapter as any,
});

// 与 MusicFree plugin.ts 第15行一致：axios.defaults.timeout = 15000
proxyAxios.defaults.timeout = 15000;

const _originalCreate = proxyAxios.create.bind(proxyAxios);
proxyAxios.create = (config?: any) => {
  const inst = _originalCreate(config);
  inst.defaults.adapter = tauriAdapter as any;
  inst.defaults.timeout = 15000;
  inst.create = proxyAxios.create;
  return inst;
};

// ==================== 插件实例缓存 ====================

/** 用户变量定义（与 MusicFree IPlugin.IUserVariable 一致） */
export interface PluginUserVariable {
  /** 变量名，即 env.getUserVariables() 返回对象的 key */
  name: string;
  /** 显示标题 */
  title?: string;
  /** 变量类型: text/password/select */
  type?: 'text' | 'password' | 'select';
  /** 默认值 */
  defaultValue?: string;
  /** 选项列表（type=select 时使用） */
  options?: string[];
  /** 描述/提示文本 */
  description?: string;
  /** 输入框 placeholder */
  placeholder?: string;
  /** 是否为必填项 */
  required?: boolean;
}

/**
 * 兼容 MusicFree 与 Baka/Toskysun 插件的用户变量定义。
 *
 * MF 常用 name/title/defaultValue，Baka 插件可能使用 key/id、label、default、desc 等别名。
 * 统一规范化后，设置页按 name 保存，Worker 里的 env.getUserVariables()/env.userVariables
 * 就能拿到插件期望的 key。
 *
 * [修复] Baka 插件常用 key 作为变量键、name 作为显示名。
 * 优先使用 key（Baka 约定），其次 name（MF 约定），最后 id。
 * 同时将 name 字段作为 title 的回退（Baka 的 name 实为显示名）。
 */
function normalizePluginUserVariables(raw: unknown): PluginUserVariable[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.entries(raw as Record<string, any>).map(([key, value]) => (
        value && typeof value === 'object'
          ? { name: key, ...value }
          : { name: key, defaultValue: value }
      ))
      : [];

  return list
    .map((item): PluginUserVariable | null => {
      if (!item || typeof item !== 'object') return null;
      const v = item as Record<string, any>;
      // [修复] 优先使用 key（Baka 约定：key 是变量键，name 是显示名），
      // 其次 name（MF 约定：name 本身就是变量键），最后 id
      const name = String(v.key ?? v.name ?? v.id ?? '').trim();
      if (!name) return null;

      const rawType = String(v.type ?? v.inputType ?? '').toLowerCase();
      const type: PluginUserVariable['type'] = rawType === 'password'
        ? 'password'
        : rawType === 'select'
          ? 'select'
          : 'text';

      const rawOptions = Array.isArray(v.options)
        ? v.options
        : Array.isArray(v.enums)
          ? v.enums
          : [];
      const options = rawOptions
        .map((option: any) => {
          if (typeof option === 'string') return option;
          if (option && typeof option === 'object') {
            return String(option.value ?? option.key ?? option.label ?? option.name ?? '').trim();
          }
          return String(option ?? '').trim();
        })
        .filter(Boolean);

      const defaultValue = v.defaultValue ?? v.default ?? v.value;
      // [修复] 当 key 被用作变量键时，name 实为显示名，应作为 title 回退
      const titleFromName = (typeof v.name === 'string' && v.name !== name) ? v.name : undefined;
      return {
        name,
        title: typeof v.title === 'string'
          ? v.title
          : typeof v.label === 'string'
            ? v.label
            : titleFromName,
        type,
        defaultValue: defaultValue === undefined || defaultValue === null ? undefined : String(defaultValue),
        options,
        description: typeof v.description === 'string'
          ? v.description
          : typeof v.desc === 'string'
            ? v.desc
            : typeof v.remark === 'string'
              ? v.remark
              : undefined,
        placeholder: typeof v.placeholder === 'string'
          ? v.placeholder
          : typeof v.hint === 'string'
            ? v.hint
            : undefined,
        required: Boolean(v.required),
      };
    })
    .filter((item): item is PluginUserVariable => Boolean(item));
}

function getNormalizedCachedUserVariables(pluginId: string): PluginUserVariable[] {
  const cached = userVarDefsCache.get(pluginId);
  if (!cached) return [];
  const normalized = normalizePluginUserVariables(cached);
  if (normalized.length > 0 && normalized !== cached) {
    userVarDefsCache.set(pluginId, normalized);
  }
  return normalized;
}

function extractStringProperty(source: string, prop: string): string | undefined {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|[,\\s])${escaped}\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`));
  return match?.[2]?.trim() || undefined;
}

function extractBooleanProperty(source: string, prop: string): boolean | undefined {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|[,\\s])${escaped}\\s*:\\s*(true|false)`));
  return match ? match[1] === 'true' : undefined;
}

function extractBalancedArray(script: string, key: string): string | null {
  const keyIndex = script.indexOf(key);
  if (keyIndex < 0) return null;
  const colonIndex = script.indexOf(':', keyIndex + key.length);
  if (colonIndex < 0) return null;
  const start = script.indexOf('[', colonIndex + 1);
  if (start < 0) return null;

  let depth = 0;
  let quote: '"' | '\'' | '`' | null = null;
  let escaped = false;
  for (let i = start; i < script.length; i += 1) {
    const ch = script[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  return null;
}

function extractPluginUserVariablesFromScript(script: string): PluginUserVariable[] {
  const arraySource = extractBalancedArray(script, 'userVariables');
  if (!arraySource) return [];

  const raw = [...arraySource.matchAll(/\{([\s\S]*?)\}/g)]
    .map((match) => {
      const body = match[1];
      const key = extractStringProperty(body, 'key');
      const name = extractStringProperty(body, 'name');
      const id = extractStringProperty(body, 'id');
      if (!key && !name && !id) return null;
      return {
        key,
        name,
        id,
        title: extractStringProperty(body, 'title'),
        label: extractStringProperty(body, 'label'),
        type: extractStringProperty(body, 'type') || extractStringProperty(body, 'inputType'),
        defaultValue: extractStringProperty(body, 'defaultValue'),
        default: extractStringProperty(body, 'default'),
        value: extractStringProperty(body, 'value'),
        description: extractStringProperty(body, 'description'),
        desc: extractStringProperty(body, 'desc'),
        remark: extractStringProperty(body, 'remark'),
        placeholder: extractStringProperty(body, 'placeholder'),
        hint: extractStringProperty(body, 'hint'),
        required: extractBooleanProperty(body, 'required'),
      };
    })
    .filter(Boolean);

  return normalizePluginUserVariables(raw);
}

async function readPluginScriptForUserVariables(source: PluginSource): Promise<string> {
  if (source.filePath.startsWith('builtin://')) {
    const webPath = BUILTIN_PLUGINS[source.filePath];
    if (!webPath) return '';
    const resp = await fetchWithTimeout(webPath, 5000);
    return resp.ok ? await resp.text() : '';
  }
  if (source.filePath.startsWith('http')) {
    try {
      const resp = await fetchWithTimeout(source.filePath, 10000);
      if (resp.ok) return await resp.text();
    } catch { /* fallback to tauri fetch */ }
    try {
      return await pluginApi.fetchPluginUrl(source.filePath);
    } catch {
      return '';
    }
  }
  if (source.filePath) {
    try {
      return await pluginApi.readPluginFile(source.filePath);
    } catch {
      return '';
    }
  }
  return '';
}

interface PluginInstance {
  source: PluginSource;
  instance: IPluginInstance;
  script: string; // 存储插件源码用于错误诊断
}

/** 与 MusicFree IPlugin.IPluginDefine 一致（扩展 Baka 插件方法） */
interface IPluginInstance {
  platform: string;
  version?: string;
  appVersion?: string;
  srcUrl?: string;
  author?: string;
  description?: string;
  supportedSearchType?: string[];
  defaultSearchType?: string;
  userVariables?: PluginUserVariable[];
  cacheControl?: string;
  primaryKey?: string[];
  /** 提示文本（与 MusicFree IPlugin.IPluginDefine.hints 一致） */
  hints?: Record<string, string[]>;
  /** Baka 系列特有：12 档音质声明 */
  supportedQualities?: string[];
  search?: (query: string, page: number, type: string) => Promise<any>;
  getMediaSource?: (musicItem: any, quality: string) => Promise<any>;
  getMvSource?: (musicItem: any, videoQuality?: string) => Promise<any>;
  getMusicInfo?: (musicItem: any) => Promise<any>;
  getLyric?: (musicItem: any) => Promise<any>;
  getAlbumInfo?: (albumItem: any, page: number) => Promise<any>;
  getArtistWorks?: (artistItem: any, page: number, type: string) => Promise<any>;
  getTopLists?: () => Promise<any>;
  getTopListDetail?: (topListItem: any, page: number) => Promise<any>;
  importMusicSheet?: (urlLike: string) => Promise<any>;
  importMusicItem?: (urlLike: string) => Promise<any>;
  getMusicSheetInfo?: (sheetItem: any, page: number) => Promise<any>;
  getRecommendSheetTags?: () => Promise<any>;
  getRecommendSheetsByTag?: (tagItem: any, page: number) => Promise<any>;
  /** Baka 扩展：获取歌手详情 */
  getArtistInfo?: (artistItem: any) => Promise<any>;
  /** Baka 扩展：获取歌曲评论 */
  getMusicComments?: (musicItem: any, page?: number) => Promise<any>;
  /** Baka 扩展：获取歌曲详情页 URL */
  getMusicDetailPageUrl?: (musicItem: any) => Promise<any>;
}

// [修复防御]: 挂载到 window 防止 Vite HMR 重置缓存，导致每次搜索都重新加载插件
const _globalThis = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
if (!_globalThis.__pluginInstances) {
  _globalThis.__pluginInstances = new Map<string, PluginInstance>();
}
const pluginInstances: Map<string, PluginInstance> = _globalThis.__pluginInstances;

if (!_globalThis.__pluginInstanceErrors) {
  _globalThis.__pluginInstanceErrors = new Map<string, string>();
}
const pluginInstanceErrors: Map<string, string> = _globalThis.__pluginInstanceErrors;

// [用户变量定义缓存] 独立于完整插件实例缓存，用于在懒加载模式下
// 不初始化完整插件即可获取 userVariables 定义（如 QQ音乐L2 的密钥配置）。
// key = pluginId (SHA-256 hash), value = userVariables 数组
if (!_globalThis.__userVarDefsCache) {
  _globalThis.__userVarDefsCache = new Map<string, PluginUserVariable[]>();
}
const userVarDefsCache: Map<string, PluginUserVariable[]> = _globalThis.__userVarDefsCache;

// ==================== 插件加载（与 MusicFree Plugin.mountPlugin() 完全一致）====================

export async function loadPluginFromScript(
  script: string,
  uri: string,
  userVarsPluginId?: string,
): Promise<PluginSource | null> {
  try {
    const bytes = new TextEncoder().encode(script);
    if (bytes.length > MAX_PLUGIN_SIZE) {
      throw new Error(`插件大小不能超过 2MB (当前: ${bytes.length} bytes)`);
    }
    if (script.trim().length === 0) {
      throw new Error('插件内容为空');
    }

    // ===== Step 0: 格式检测 - 落雪 LX 插件委托给 lxPluginEngine =====
    if (isLxPluginScript(script)) {
      log(`检测到落雪 LX 插件格式，委托给 lxPluginEngine`);
      const lxSource = await loadLxPluginFromScript(script, uri);
      if (lxSource) return lxSource;
      // [修复防御]: 落雪插件无法以 MusicFree 格式运行（完全不同的 API 协议）
      throw new Error('落雪 LX 插件加载失败，请检查插件是否兼容');
    }

    log(`=== 开始加载插件: ${uri} (${script.length} chars) ===`);

    // 预计算 hash，用于 env.getUserVariables() 按插件 ID 索引用户变量值。
    // 提前到 Step 1 之前，确保插件脚本执行期间调用 getUserVariables() 也能拿到值。
    const hash = await hostSha256Hex(script);

    // ===== 沙箱模式：在 Web Worker 中隔离执行插件脚本 =====
    if (USE_SANDBOX) {
      log(`[loadPluginFromScript] 沙箱模式加载: ${uri}`);
      try {
        // 注册用户变量提供器（供 Worker 通过 RPC 获取用户变量）
        setUserVarsProvider((pluginId: string) => getPluginUserVariableValues(pluginId));

        const userVars = getPluginUserVariableValues(userVarsPluginId || hash);
        const userVarKeys = Object.keys(userVars);
        log(`[loadPluginFromScript] hash=${hash.substring(0, 16)}... userVarsPluginId=${(userVarsPluginId || hash).substring(0, 16)}... userVars keys=[${userVarKeys.join(',')}] count=${userVarKeys.length}`);
        const metadata = await loadMusicFreeInSandbox(hash, script, userVars);

        if (!metadata?.platform) {
          throw new Error('沙箱: 插件缺少 platform 字段');
        }

        // [诊断] 记录插件声明的 userVariables 定义
        const declaredVars = normalizePluginUserVariables(metadata.userVariables);
        if (declaredVars.length > 0) {
          log(`[loadPluginFromScript] 插件 "${metadata.platform}" 声明 userVariables: ${declaredVars.map(v => `name=${v.name} type=${v.type || 'text'}`).join(', ')}`);
        } else {
          log(`[loadPluginFromScript] 插件 "${metadata.platform}" 未声明 userVariables`);
        }

        // 创建代理实例（所有方法调用通过 RPC 转发到 Worker）
        const proxyInstance = createSandboxProxy(hash, metadata);

        const source: PluginSource = {
          id: hash,
          name: metadata.platform,
          format: 'musicfree',
          version: metadata.version || '',
          author: metadata.author || '',
          description: metadata.description || '',
          filePath: uri,
          importedAt: Date.now(),
          enabled: true,
          sources: [metadata.platform],
        };

        pluginInstances.set(hash, { source, instance: proxyInstance, script });
        _sandboxedPlugins.add(hash);

        const userVariables = normalizePluginUserVariables(metadata.userVariables);
        if (userVariables.length > 0) {
          userVarDefsCache.set(hash, userVariables);
        }

        log(`=== 插件沙箱加载成功: "${metadata.platform}" ===`);
        return source;
      } catch (e: any) {
        log(`[loadPluginFromScript] 沙箱加载失败，已阻止回退到主线程直接执行: ${e?.message}`);
        throw e;
      }
    }

    throw new Error('插件沙箱未启用，已拒绝在主线程直接执行插件源码');
  } catch (e: any) {
    log(`[loadPluginFromScript] 插件加载失败 (uri=${uri}): ${e?.message || e}`);
    return null;
  }
}

// ==================== 搜索（与 MusicFree useSearch.ts + PluginMethodsWrapper.search 完全一致）====================

/**
 * 搜索音乐
 *
 * MusicFree useSearch.ts 核心逻辑：
 *   plugins.forEach(async plugin => {
 *     const searchType = type ?? plugin.instance.defaultSearchType ?? "music";
 *     const result = await plugin?.methods?.search?.(query, page, searchType);
 *     // result.data 就是搜索结果数组
 *   });
 *
 * MusicFree PluginMethodsWrapper.search() 核心逻辑：
 *   const result = (await this.plugin.instance.search(query, page, type)) ?? {};
 *   if (Array.isArray(result.data)) {
 *     result.data.forEach(_ => { resetMediaItem(_, this.plugin.name); });
 *     return { isEnd: result.isEnd ?? true, data: result.data };
 *   }
 *   return { isEnd: true, data: [] };
 */
type PluginMusicSearchStatus =
  | 'success'
  | 'empty'
  | 'init_failed'
  | 'search_unsupported'
  | 'lyrics_unsupported'
  | 'invalid_response'
  | 'search_failed';

interface PluginMusicSearchDiagnostics {
  results: PluginSearchResult[];
  status: PluginMusicSearchStatus;
  reason: string;
  searchType?: string;
  supportsLyrics: boolean;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const MF_EMPTY_SEARCH_RETRY_DELAY_MS = 450;

/** 加载日志：直接输出到浏览器 console，便于前端排查插件目录（歌单/歌手/专辑）间歇加载问题 */
const catalogLog = (msg: string) => {
  console.log(`[CatalogLoad] ${msg}`);
  log(msg);
};

/** 汇总一次插件返回的结构，便于日志中人工判断返回了什么 */
const describeResult = (r: any): string => {
  if (!r || typeof r !== 'object') return `type=${typeof r}`;
  const keys = Object.keys(r).filter(k => k !== 'isEnd').join(',') || '空对象';
  let len = 0;
  try { len = extractResultList(r).length; } catch { /* ignore */ }
  return `keys=[${keys}] extractedLen=${len}`;
};

/**
 * 调用插件方法，若结果为空则等待后重试。
 * 参考落雪(lx) 的加载方式：失败时用增量退避拉长每次间隔，延后放弃，让加载转圈持续更久、命中率更高；
 * 不做短固定间隔的快速重试。delay 可传固定值或返回每次等待时长的函数。
 */
async function retryOnEmpty<T>(
  label: string,
  fn: () => Promise<T>,
  isEmpty: (val: T) => boolean,
  delay: number | ((attempt: number) => number) = (i: number) => MF_EMPTY_SEARCH_RETRY_DELAY_MS * 2 * i,
  attempts: number = 6,
): Promise<T> {
  const getDelay = (i: number) => (typeof delay === 'function' ? delay(i) : delay);
  let result: T | undefined;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    const wait = getDelay(i);
    try {
      result = await fn();
      catalogLog(`${label} 第${i}次 → ${describeResult(result)}`);
      if (!isEmpty(result)) return result;
      if (i < attempts) {
        catalogLog(`${label} 第${i}次为空，${wait}ms后重试(共${attempts}次)`);
        await sleep(wait);
      }
    } catch (e: any) {
      lastErr = e;
      catalogLog(`${label} 第${i}次异常: ${e?.message || e}`);
      if (i < attempts) {
        catalogLog(`${label} 异常后 ${wait}ms重试(共${attempts}次)`);
        await sleep(wait);
      }
    }
  }
  // 所有尝试都用尽且每次结果都判空 → 抛错由调用方决定兜底策略
  if (result === undefined || isEmpty(result as T)) {
    throw lastErr ?? new Error(`${label} 多次尝试后仍为空`);
  }
  return result as T;
}

/** 音乐搜索诊断版：保留初始化、能力和接口错误，供歌词选择页直接展示原因。 */
export async function pluginMusicSearchWithDiagnostics(
  source: PluginSource,
  keyword: string,
  page: number,
  _limit: number,
  requireLyricSupport = false,
): Promise<PluginMusicSearchDiagnostics> {
  log(`[pluginSearch] 开始: ${source.name}, keyword="${keyword}", page=${page}`);
  const inst = await ensurePluginInstance(source);
  if (!inst) {
    log(`[pluginSearch] 实例为 null: ${source.name}`);
    return {
      results: [],
      status: 'init_failed',
      reason: pluginInstanceErrors.get(source.id) || '插件实例初始化失败，请检查插件文件、订阅地址或插件日志',
      supportsLyrics: false,
    };
  }
  log(`[pluginSearch] 实例就绪: ${source.name}, search=${typeof inst.instance.search}`);

  if (typeof inst.instance.search !== 'function') {
    log(`[${source.name}] 无 search 函数`);
    return {
      results: [],
      status: 'search_unsupported',
      reason: '插件未实现歌曲搜索方法 search，无法按搜索内容查找歌词',
      supportsLyrics: typeof inst.instance.getLyric === 'function',
    };
  }
  const pluginSearchMethod = inst.instance.search;

  // 仅在歌词替换场景下要求 getLyric；普通搜索（如 bilibili 插件）不要求歌词支持
  if (requireLyricSupport && typeof inst.instance.getLyric !== 'function') {
    log(`[${source.name}] 无 getLyric 函数（歌词替换场景需要）`);
    return {
      results: [],
      status: 'lyrics_unsupported',
      reason: '插件可以提供音乐资源，但未实现独立歌词方法 getLyric，不能用于更改歌词',
      supportsLyrics: false,
    };
  }

  try {
    // 音乐搜索始终使用 'music' 类型；Baka 插件可能未在 supportedSearchType 中声明 'music'
    // 但实际支持音乐搜索。若插件确实不支持则会返回空，由调用方处理。
    const searchType = 'music';

    const callSearch = async (attempt: number) => {
      log(`[pluginSearch] ${source.name} searchType=${searchType}, 第 ${attempt} 次调用 search()`);
      // 与 MusicFree PluginMethodsWrapper.search() 第175~176行一致
      const result = (await pluginSearchMethod(keyword, page, searchType)) ?? {};
      const list = extractResultList(result);
      log(
        `[pluginSearch] ${source.name} search 返回(第 ${attempt} 次): type=${typeof result}, keys=${result ? Object.keys(result).join(',') : 'null'}, dataIsArray=${Array.isArray(result?.data)}, dataLen=${result?.data?.length ?? 0}, extractedLen=${list.length}`,
      );
      return { result, list };
    };

    let { result, list } = await callSearch(1);

    // QQ 音乐插件搜索兜底：无签名搜索端点已被腾讯累积风控（reqCode 2001 恒空列表），
    // 插件返回空不代表真无结果。短间隔重试对累积风控无效，QQ 插件直接跳过重试，
    // 改由宿主复用 LX 侧已验证的搜索链（签名 Mobile → Web 兜底）代取结果；
    // 播放仍走插件自身 getMediaSource，不受影响。
    if (list.length === 0 && isQqMusicPluginSource(source, (inst.instance as any)?.platform)) {
      log(`[pluginSearch] ${source.name} 插件搜索为空，走宿主 QQ 兜底链: "${keyword}"`);
      const hostResults = await qqHostSearchFallback(source, keyword, page);
      if (hostResults.length > 0) {
        log(`[pluginSearch] ${source.name} 宿主兜底成功: ${hostResults.length} 首`);
        return {
          results: hostResults,
          status: 'success',
          reason: `插件搜索被风控，宿主兜底解析返回 ${hostResults.length} 首歌曲`,
          searchType,
          supportsLyrics: typeof inst.instance.getLyric === 'function',
        };
      }
      return {
        results: [],
        status: 'empty',
        reason: `插件搜索与宿主兜底均未找到与“${keyword}”匹配的歌曲`,
        searchType,
        supportsLyrics: true,
      };
    }

    // 部分 MusicFree QQ 插件的上游接口会偶发正常响应但 data=[]。
    // 参考落雪(lx) 的增量退避：不做短固定间隔的快速放弃，逐步拉长间隔反复重试，共 6 次约 12s
    if (list.length === 0) {
      const attempts = 6;
      let attempt = 2;
      while (list.length === 0 && attempt <= attempts) {
        const wait = 800 * (attempt - 1);
        log(`[pluginSearch] ${source.name} 第 ${attempt - 1} 次返回空列表，${wait}ms 后重试(共 ${attempts} 次)`);
        await sleep(wait);
        ({ result, list } = await callSearch(attempt));
        attempt++;
      }
    }

    if (list.length > 0) {
      // 关键：每个 item 都调用 resetMediaItem，与 MusicFree 完全一致
      list.forEach((_: any) => {
        resetMediaItem(_, source.name);
      });

      // 将 resetMediaItem 后的对象转为 PluginSearchResult
      const results = list.map((item: any) => toPluginSearchResult(item, source));
      return {
        results,
        status: results.length > 0 ? 'success' : 'empty',
        reason: results.length > 0
          ? `插件返回 ${results.length} 首歌曲，可逐项获取歌词`
          : `插件搜索成功，但没有找到与“${keyword}”匹配的歌曲`,
        searchType,
        supportsLyrics: typeof inst.instance.getLyric === 'function',
      };
    }
    return {
      results: [],
      status: Array.isArray(result?.data) ? 'empty' : 'invalid_response',
      reason: Array.isArray(result?.data)
        ? `插件多次搜索（最多 6 次）均未找到与“${keyword}”匹配的歌曲`
        : `插件 search 返回格式无效或为空：实际字段为 ${result ? Object.keys(result).join(', ') || '空对象' : 'null'}`,
      searchType,
      supportsLyrics: true,
    };
  } catch (e: any) {
    // [修复防御]: 完整序列化错误信息，方便调试
    const errMsg = e?.message || (typeof e === 'string' ? e : '') || 'Unknown error';
    log(`[${source.name}] 搜索失败: ${errMsg}`);
    return {
      results: [],
      status: 'search_failed',
      reason: `插件搜索调用失败：${errMsg}`,
      supportsLyrics: true,
    };
  }
}

export async function pluginSearch(
  source: PluginSource,
  keyword: string,
  page: number,
  limit: number,
): Promise<PluginSearchResult[]> {
  return (await pluginMusicSearchWithDiagnostics(source, keyword, page, limit)).results;
}

export function getLastPluginError(): string {
  return String((globalThis as any).__lastPluginError || '').trim();
}

// ==================== 插件歌单搜索 ====================

export async function pluginPlaylistSearch(
  source: PluginSource,
  keyword: string,
  page: number,
): Promise<PluginPlaylistSearchResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.search !== 'function') return [];

    // 尝试 'sheet' 类型；部分插件使用 'playlist' 类型
    let result = (await inst.instance.search(keyword, page, 'sheet')) ?? {};
    let list = extractResultList(result);
    if (list.length === 0) {
      result = (await inst.instance.search(keyword, page, 'playlist')) ?? {};
      list = extractResultList(result);
    }
    // 回退 0: 尝试 'album' 类型，将专辑也索引到歌单页
    if (list.length === 0) {
      result = (await inst.instance.search(keyword, page, 'album')) ?? {};
      list = extractResultList(result);
      if (list.length > 0) {
        return list.map((item: any) => {
          resetMediaItem(item, source.name);
          const id = item.id || item.albumId || item.songId || item.musicId || '';
          const title = stripHtmlTags(item.title || item.name || item.album || '');
          const coverUrl = extractCoverUrl(item);
          return {
            id,
            title,
            coverUrl,
            playCount: item.playCount ?? item.playcount ?? item.play_count,
            trackCount: item.trackCount ?? item.trackcount ?? item.track_count,
            artist: stripHtmlTags(item.artist || item.author || item.singer || ''),
            platform: item.platform || source.name,
            platformId: id,
            pluginId: source.id,
            rawData: { ...item, _isAlbum: true },
          };
        });
      }
    }
    if (list.length === 0) {
      // 回退 1: 尝试 importMusicSheet（用户输入收藏夹 URL/ID 时）
      if (typeof inst.instance.importMusicSheet === 'function') {
        try {
          const imported = await inst.instance.importMusicSheet(keyword);
          if (Array.isArray(imported) && imported.length > 0) {
            const title = `${source.name}收藏夹`;
            return [{
              id: keyword,
              title,
              coverUrl: extractCoverUrl(imported[0]),
              trackCount: imported.length,
              artist: '',
              platform: source.name,
              platformId: keyword,
              pluginId: source.id,
              rawData: { id: keyword, title, _importedTracks: imported },
            }];
          }
        } catch (e: any) {
          console.warn(`[${source.name}] importMusicSheet 回退失败:`, e?.message || e);
        }
      }

      // 注意：不再回退 getTopLists——关键词与榜单无关，把榜单塞进歌单搜索结果
      // 会让搜索页歌单 tab 偶现排行榜内容（榜单有专门的榜单页入口）。

      console.warn(
        `[${source.name}] 歌单搜索无结果: search(sheet/playlist) 返回 keys=`,
        result ? Object.keys(result) : result,
        '; 插件可能未实现歌单搜索或上游接口变更',
      );
      return [];
    }

    return list.map((item: any) => {
      resetMediaItem(item, source.name);
      const id = item.id || item.songId || item.musicId || '';
      const title = stripHtmlTags(item.title || item.name || '');
      const coverUrl = extractCoverUrl(item);
      return {
        id,
        title,
        coverUrl,
        playCount: item.playCount ?? item.playcount ?? item.play_count,
        trackCount: item.trackCount ?? item.trackcount ?? item.track_count,
        artist: stripHtmlTags(item.artist || item.author || ''),
        platform: item.platform || source.name,
        platformId: id,
        pluginId: source.id,
        rawData: item,
      };
    });
  } catch (e: any) {
    console.warn(`[${source.name}] 歌单搜索失败:`, e?.message || e);
    log(`[${source.name}] 歌单搜索失败: ${e?.message}`);
    return [];
  }
}

// ==================== 插件榜单 ====================

/**
 * 获取插件排行榜（榜单）列表。
 * 调用插件的 getTopLists 接口，返回按分类展平的榜单条目。
 * 条目 rawData 带 _isTopList 标记，供 pluginGetPlaylistDetail 走 getTopListDetail 获取曲目。
 * Baka 插件的榜单机制（获取 + 展平）完全委托给 BakaPluginManager，与 MF 分离。
 */
export async function pluginGetTopLists(source: PluginSource): Promise<PluginPlaylistSearchResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (await BakaPluginManager.isBakaPlugin(source)) {
      return BakaPluginManager.getTopLists(source);
    }
    if (typeof inst.instance.getTopLists !== 'function') return [];
    const topLists = await inst.instance.getTopLists();
    return flattenTopListCategories(topLists, source);
  } catch (e: any) {
    console.warn(`[${source.name}] getTopLists 调用失败:`, e?.message || e);
    return [];
  }
}

/** 检查插件是否支持榜单接口（getTopLists） */
export async function pluginSupportsTopLists(source: PluginSource): Promise<boolean> {
  const inst = await ensurePluginInstance(source);
  return !!inst && typeof inst.instance.getTopLists === 'function';
}

// ==================== 插件歌单详情 ====================

async function pluginGetPlaylistDetailInner(
  source: PluginSource,
  sheetItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  if (await BakaPluginManager.isBakaPlugin(source)) {
    await ensurePluginInstance(source);
    // B站专辑与歌单统一走专用取数路径
    if (isBilibiliSource(source)) {
      return BakaPluginManager.getBilibiliDetail(source, sheetItem, page);
    }
    return BakaPluginManager.getPlaylistDetail(source, sheetItem, page);
  }
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    // 如果是 importMusicSheet 导入的歌单，直接返回已导入的曲目
    if (Array.isArray(sheetItem?._importedTracks) && sheetItem._importedTracks.length > 0) {
      if (page === 1) {
        const list = sheetItem._importedTracks;
        list.forEach((_: any) => { resetMediaItem(_, source.name); });
        return list.map((item: any) => toPluginSearchResult(item, source));
      }
      return [];
    }

    // 如果是专辑条目（歌单搜索中将专辑索引为歌单），用 getAlbumInfo 获取曲目
    if (sheetItem?._isAlbum) {
      if (typeof inst.instance.getAlbumInfo === 'function') {
        const getAlbumInfo = inst.instance.getAlbumInfo;
        try {
          const result = await retryOnEmpty(
            `[${source.name}] getAlbumInfo(album as playlist) album="${stripHtmlTags(sheetItem?.title || sheetItem?.name || '')}"`,
            () => getAlbumInfo(sheetItem, page),
            (r) => extractResultList(r).length === 0,
          );
          const list = extractResultList(result);
          if (list.length > 0) {
            list.forEach((_: any) => { resetMediaItem(_, source.name); });
            return list.map((item: any) => toPluginSearchResult(item, source));
          }
        } catch (e: any) {
          log(`[${source.name}] getAlbumInfo(album as playlist) 调用失败: ${e?.message}`);
        }
      }
      return [];
    }

    // 如果是排行榜条目，用 getTopListDetail 获取曲目
    if (sheetItem?._isTopList && typeof inst.instance.getTopListDetail === 'function') {
      try {
        const result = await inst.instance.getTopListDetail(sheetItem, page);
        const list = extractResultList(result);
        if (list.length > 0) {
          list.forEach((_: any) => { resetMediaItem(_, source.name); });
          return list.map((item: any) => toPluginSearchResult(item, source));
        }
      } catch (e: any) {
        log(`[${source.name}] getTopListDetail 调用失败: ${e?.message}`);
      }
      return [];
    }

    // 优先用 getMusicSheetInfo 获取歌单曲目
    if (typeof inst.instance.getMusicSheetInfo === 'function') {
      const getSheetInfo = inst.instance.getMusicSheetInfo;
      try {
        const result = await retryOnEmpty(
          `[${source.name}] getMusicSheetInfo sheet="${stripHtmlTags(sheetItem?.title || sheetItem?.name || '')}"`,
          () => getSheetInfo(sheetItem, page),
          (r) => extractResultList(r).length === 0,
        );
        const list = extractResultList(result);
        if (list.length > 0) {
          list.forEach((_: any) => { resetMediaItem(_, source.name); });
          return list.map((item: any) => toPluginSearchResult(item, source));
        }
      } catch (e: any) {
        log(`[${source.name}] getMusicSheetInfo 调用失败，尝试搜索回退: ${e?.message}`);
      }
    }

    // 回退：getMusicSheetInfo 不可用或返回空，用歌单名搜索
    if (page === 1 && typeof inst.instance.search === 'function') {
      const sheetTitle = stripHtmlTags(sheetItem?.title || sheetItem?.name || '');
      if (sheetTitle) {
        log(`[${source.name}] getMusicSheetInfo 不可用或为空，回退到搜索 "${sheetTitle}"`);
        const result = (await inst.instance.search(sheetTitle, 1, 'music')) ?? {};
        const list = extractResultList(result);
        list.forEach((_: any) => { resetMediaItem(_, source.name); });
        return list.map((item: any) => toPluginSearchResult(item, source));
      }
    }

    return [];
  } catch (e: any) {
    log(`[${source.name}] 获取歌单详情失败: ${e?.message}`);
    return [];
  }
}

// ==================== 收藏夹导入 ====================

export async function pluginImportMusicSheet(
  source: PluginSource,
  urlLike: string,
): Promise<PluginSearchResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.importMusicSheet !== 'function') return [];
    const imported = await inst.instance.importMusicSheet(urlLike);
    if (!Array.isArray(imported) || imported.length === 0) return [];
    imported.forEach((_: any) => { resetMediaItem(_, source.name); });
    return imported.map((item: any) => toPluginSearchResult(item, source));
  } catch (e: any) {
    log(`[${source.name}] importMusicSheet 失败: ${e?.message}`);
    return [];
  }
}

// ==================== 歌手作品（歌曲） ====================

async function pluginGetArtistWorksInner(
  source: PluginSource,
  artistItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  if (await BakaPluginManager.isBakaPlugin(source)) {
    await ensurePluginInstance(source);
    // B站：空间作品接口被风控时返回空，走专用路径（单次尝试 + 搜索兜底），避免 6 次无效重试导致歌手页长时间转圈
    if (isBilibiliSource(source)) {
      return BakaPluginManager.getBilibiliArtistWorks(source, artistItem, page, 'music');
    }
    return BakaPluginManager.getArtistWorks(source, artistItem, page, 'music');
  }
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    // 优先用 getArtistWorks 获取歌手作品
    if (typeof inst.instance.getArtistWorks === 'function') {
      const getWorks = inst.instance.getArtistWorks;
      try {
        const result = await retryOnEmpty(
          `[${source.name}] getArtistWorks(music) artist="${stripHtmlTags(artistItem?.name || artistItem?.title || '')}"`,
          () => getWorks(artistItem, page, 'music'),
          (r) => extractResultList(r).length === 0,
        );
        const list = extractResultList(result);
        if (list.length > 0) {
          list.forEach((_: any) => { resetMediaItem(_, source.name); });
          return list.map((item: any) => toPluginSearchResult(item, source));
        }
      } catch (e: any) {
        log(`[${source.name}] getArtistWorks 调用失败，尝试搜索回退: ${e?.message}`);
      }
    }

    // 回退：getArtistWorks 不可用或返回空，用歌手名搜索
    if (page === 1 && typeof inst.instance.search === 'function') {
      const artistName = stripHtmlTags(artistItem?.name || artistItem?.title || artistItem?.artist || '');
      if (artistName) {
        log(`[${source.name}] getArtistWorks 不可用或为空，回退到搜索 "${artistName}"`);
        const result = (await inst.instance.search(artistName, 1, 'music')) ?? {};
        const list = extractResultList(result);
        list.forEach((_: any) => { resetMediaItem(_, source.name); });
        return list.map((item: any) => toPluginSearchResult(item, source));
      }
    }

    return [];
  } catch (e: any) {
    log(`[${source.name}] 获取歌手作品失败: ${e?.message}`);
    return [];
  }
}

// ==================== 歌手作品（专辑） ====================

export async function pluginGetArtistAlbums(
  source: PluginSource,
  artistItem: any,
  page: number = 1,
): Promise<PluginAlbumResult[]> {
  if (await BakaPluginManager.isBakaPlugin(source)) {
    await ensurePluginInstance(source);
    const results = isBilibiliSource(source)
      ? await BakaPluginManager.getBilibiliArtistWorks(source, artistItem, page, 'album')
      : await BakaPluginManager.getArtistWorks(source, artistItem, page, 'album');
    return results.map((item: any) => ({
      id: item.id || '',
      name: item.title || '',
      artist: item.artist || '',
      coverUrl: item.coverUrl || '',
      platform: item.platform || source.name,
      platformId: item.id || '',
      pluginId: source.id,
      rawData: item.rawData,
    }));
  }
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.getArtistWorks !== 'function') return [];

    const getWorks = inst.instance.getArtistWorks;
    const result = await retryOnEmpty(
      `[${source.name}] getArtistWorks(album) artist="${stripHtmlTags(artistItem?.name || artistItem?.title || '')}"`,
      () => getWorks(artistItem, page, 'album'),
      (r) => extractResultList(r).length === 0,
    );
    const list = extractResultList(result);
    if (list.length === 0) return [];

    return list.map((item: any) => {
      resetMediaItem(item, source.name);
      const id = item.id || item.albumId || '';
      const name = stripHtmlTags(item.title || item.name || item.album || '');
      const artist = extractArtist(item);
      const coverUrl = extractCoverUrl(item);
      return {
        id,
        name,
        artist,
        coverUrl,
        platform: item.platform || source.name,
        platformId: id,
        pluginId: source.id,
        rawData: item,
      };
    });
  } catch (e: any) {
    log(`[${source.name}] 获取歌手专辑失败: ${e?.message}`);
    return [];
  }
}

/** 从歌手条目/详情对象中尽力提取简介，兼容各平台常见字段（含嵌套子对象） */
function extractArtistDescription(raw: any): string {
  if (!raw || typeof raw !== 'object') return '';
  const candidates = [
    'artistDesc', 'artistIntro', 'artist_intro', 'briefDesc', 'briefdesc',
    'intro', 'desc', 'description', 'profile', 'bio', 'biography',
    'aDesc', 'aDes',
  ];
  for (const key of candidates) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = extractArtistDescription(v);
      if (inner) return inner;
    }
  }
  return '';
}

/**
 * 获取歌手简介：调用插件的 getArtistInfo（如未实现则返回空字符串，不影响现有功能）。
 * 歌手的 search('artist') 列表通常不带简介，简介在歌手详情接口里。
 */
export async function pluginGetArtistInfo(
  source: PluginSource,
  artistItem: any,
): Promise<string> {
  if (!source || !artistItem) return '';
  let info: any = null;
  if (await BakaPluginManager.isBakaPlugin(source)) {
    await ensurePluginInstance(source);
    info = await BakaPluginManager.getArtistInfo(source, artistItem);
  } else {
    const inst = await ensurePluginInstance(source);
    if (!inst) return '';
    try {
      const fn = inst.instance.getArtistInfo;
      if (typeof fn === 'function') {
        const p = fn(artistItem);
        info = p && typeof p.catch === 'function' ? (await p.catch(() => null)) : p;
      }
    } catch {
      info = null;
    }
  }
  const desc = extractArtistDescription(info);
  catalogLog(`[${source.name}] getArtistInfo → ${desc ? `简介 ${desc.length} 字符` : '无简介'}`);
  return desc;
}

// ==================== 专辑详情 ====================

async function pluginGetAlbumSongsInner(
  source: PluginSource,
  albumItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  if (await BakaPluginManager.isBakaPlugin(source)) {
    await ensurePluginInstance(source);
    // B站专辑与歌单统一走专用取数路径
    if (isBilibiliSource(source)) {
      return BakaPluginManager.getBilibiliDetail(source, albumItem, page);
    }
    return BakaPluginManager.getAlbumSongs(source, albumItem, page);
  }
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  // QQ 插件 getAlbumInfo 读 albumItem.albumMID（大写），而歌曲推导/兜底结果里
  // 常只有 albummid（小写）。缺失时统一补齐，否则请求 albumMid=undefined 得 104400，
  // 表现为专辑页 6 次重试约 12s 后空白。
  const albumMid = albumItem?.albumMID || albumItem?.albummid || albumItem?.albumMid;
  if (albumMid && !albumItem?.albumMID) {
    albumItem = { ...albumItem, albumMID: albumMid };
  }

  try {
    // 优先用 getAlbumInfo 获取专辑曲目
    if (typeof inst.instance.getAlbumInfo === 'function') {
      const getAlbumInfo = inst.instance.getAlbumInfo;
      try {
        const result = await retryOnEmpty(
          `[${source.name}] getAlbumInfo album="${stripHtmlTags(albumItem?.title || albumItem?.name || '')}"`,
          () => getAlbumInfo(albumItem, page),
          (r) => extractResultList(r).length === 0,
        );
        const list = extractResultList(result);
        if (list.length > 0) {
          list.forEach((_: any) => { resetMediaItem(_, source.name); });
          return list.map((item: any) => toPluginSearchResult(item, source));
        }
      } catch (e: any) {
        log(`[${source.name}] getAlbumInfo 调用失败，尝试搜索回退: ${e?.message}`);
      }
    }

    // QQ 插件兜底：getAlbumInfo 的无签名端点也可能被风控返回空。宿主用签名
    // AlbumSongList 接口按 albumMid 代取曲目，映射回插件歌曲结构，播放不受影响。
    if (isQqMusicPluginSource(source, (inst.instance as any)?.platform)) {
      const albumMidForHost = albumItem?.albumMID || albumItem?.albummid || albumItem?.albumMid;
      if (albumMidForHost) {
        log(`[pluginGetAlbumSongs] ${source.name} getAlbumInfo 为空，走宿主 QQ 专辑曲目兜底: ${albumMidForHost}`);
        const hostSongs = await qqHostAlbumSongsFallback(source, albumMidForHost, page);
        if (hostSongs.length > 0) return hostSongs;
      }
    }

    // 回退：getAlbumInfo 不可用或返回空，用专辑名搜索并按专辑名过滤
    if (page === 1 && typeof inst.instance.search === 'function') {
      const albumName = stripHtmlTags(albumItem?.title || albumItem?.name || albumItem?.album || '');
      if (albumName) {
        log(`[${source.name}] getAlbumInfo 不可用或为空，回退到搜索 "${albumName}"`);
        const result = (await inst.instance.search(albumName, 1, 'music')) ?? {};
        const list = extractResultList(result);
        const albumNameLower = albumName.toLowerCase();
        const filtered = list.filter((item: any) => {
          const itemAlbum = stripHtmlTags(extractAlbum(item)).toLowerCase();
          return itemAlbum === albumNameLower || itemAlbum.includes(albumNameLower);
        });
        const songs = (filtered.length > 0 ? filtered : list);
        songs.forEach((_: any) => { resetMediaItem(_, source.name); });
        return songs.map((item: any) => toPluginSearchResult(item, source));
      }
    }

    return [];
  } catch (e: any) {
    log(`[${source.name}] 获取专辑详情失败: ${e?.message}`);
    return [];
  }
}

/**
 * QQ 插件详情列表统一补时长。QQ formatMusicItem 丢弃 interval、getMusicInfo
 * 对已带 artwork+qualities 的条目早退不回填，歌单/歌手/专辑详情会整页无时长；
 * 宿主按 songid 批量查 UniformRuleCtrl 补齐（一次请求，非 QQ 插件零开销）。
 */
async function withQqDurations(
  source: PluginSource,
  results: PluginSearchResult[],
): Promise<PluginSearchResult[]> {
  if (!results.length) return results;
  const inst = await ensurePluginInstance(source);
  return qqFillSongDurations(source, (inst?.instance as any)?.platform, results);
}

export async function pluginGetPlaylistDetail(
  source: PluginSource,
  sheetItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  return withQqDurations(source, await pluginGetPlaylistDetailInner(source, sheetItem, page));
}

export async function pluginGetArtistWorks(
  source: PluginSource,
  artistItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  return withQqDurations(source, await pluginGetArtistWorksInner(source, artistItem, page));
}

export async function pluginGetAlbumSongs(
  source: PluginSource,
  albumItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  return withQqDurations(source, await pluginGetAlbumSongsInner(source, albumItem, page));
}

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

// ==================== 歌手搜索 ====================

export interface PluginArtistResult {
  id: string;
  name: string;
  avatarUrl: string;
  description?: string;
  songCount?: number;
  albumCount?: number;
  platform: string;
  platformId: string;
  pluginId: string;
  rawData?: any;
}

export async function pluginArtistSearch(
  source: PluginSource,
  keyword: string,
  page: number,
): Promise<PluginArtistResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.search !== 'function') return [];
    const doSearch = inst.instance.search;

    const artistLabel = `[${source.name}] artistSearch w="${keyword}" p=${page}`;
    // 同一 artistSearch 路径可间歇性成功（风控/节流），因此多尝试几次成功路径本身，
    // 而不是退化到"从音乐搜索结果拼歌手"（后者拿不到完整 artist 元数据，多为假数据）。
    let result: any;
    try {
      result = await retryOnEmpty(
        artistLabel,
        () => doSearch(keyword, page, 'artist'),
        (r) => {
          const list = extractResultList(r);
          if (list.length === 0) return true;
          // 列表非空但没有任何有效 artist 字段 → 视为无效（疑似把歌曲当 artist 返回），重试
          return list.every(
            (it: any) => !it?.name && !it?.title && !it?.artist && !it?.singername && !it?.singer,
          );
        },
        // 参考落雪(lx) 的增量退避：800/1600/2400/...ms，累积约 12s 才放弃，加载转圈持续更久
        (i) => 800 * i,
        6,
      );
    } catch (e: any) {
      catalogLog(`${artistLabel} 多次尝试后仍为空/异常，放弃本次 artist 结果: ${e?.message || e}`);
      return [];
    }
    const list = extractResultList(result ?? {});
    if (list.length === 0) return [];
    const valid = list
      .map((item: any) => {
        resetMediaItem(item, source.name);
        const id = item.id || item.artistId || item.singerId || item.sid || '';
        const name = stripHtmlTags(item.name || item.title || item.artist || item.singername || item.singer || '');
        if (!name) return null;
        const avatarUrl = extractArtistAvatarUrl(item);
        return {
          id,
          name,
          avatarUrl,
          description: extractArtistDescription(item),
          songCount: item.songCount || item.musicCount || undefined,
          albumCount: item.albumCount || undefined,
          platform: item.platform || source.name,
          platformId: id,
          pluginId: source.id,
          rawData: item,
        } as PluginArtistResult;
      })
      .filter(Boolean) as PluginArtistResult[];
    if (valid.length === 0) {
      catalogLog(`${artistLabel} 提取出 ${list.length} 条但无有效 artist 字段`);
      return [];
    }
    return valid;
  } catch (e: any) {
    log(`[pluginArtistSearch] ${source.name} 失败: ${e?.message || e}`);
    return [];
  }
}

// ==================== 专辑搜索 ====================

export interface PluginAlbumResult {
  id: string;
  name: string;
  artist: string;
  coverUrl: string;
  description?: string;
  year?: string;
  songCount?: number;
  platform: string;
  platformId: string;
  pluginId: string;
  rawData?: any;
}

export async function pluginAlbumSearch(
  source: PluginSource,
  keyword: string,
  page: number,
): Promise<PluginAlbumResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.search !== 'function') return [];

    // 直接尝试搜索；Baka 插件可能未声明 album 但实际支持
    const result = (await inst.instance.search(keyword, page, 'album')) ?? {};
    const list = extractResultList(result);
    if (list.length > 0) {
      return list.map((item: any) => {
        resetMediaItem(item, source.name);
        const id = item.id || item.albumId || '';
        const name = stripHtmlTags(item.title || item.name || item.album || '');
        const artist = extractArtist(item);
        const coverUrl = extractCoverUrl(item);
        return {
          id,
          name,
          artist,
          coverUrl,
          description: item.description || item.desc || '',
          year: item.year || item.publishTime || undefined,
          songCount: item.songCount || item.musicCount || undefined,
          platform: item.platform || source.name,
          platformId: id,
          pluginId: source.id,
          rawData: item,
        };
      });
    }

    // QQ 插件兜底：无签名专辑搜索（search_type=2）已被间歇风控（2001），插件返回空
    // 不代表真无结果。宿主用签名 Desktop 接口代取，结果带插件原生 albumMID，
    // 后续 getAlbumInfo 解析曲目不受影响。
    if (list.length === 0 && page === 1 && isQqMusicPluginSource(source, (inst.instance as any)?.platform)) {
      log(`[pluginAlbumSearch] ${source.name} 插件专辑搜索为空，走宿主 QQ 专辑兜底: "${keyword}"`);
      const hostAlbums = await qqHostAlbumSearchFallback(source, keyword, page);
      if (hostAlbums.length > 0) {
        log(`[pluginAlbumSearch] ${source.name} 宿主专辑兜底成功: ${hostAlbums.length} 张`);
        return hostAlbums;
      }
    }

    // 回退：直接专辑搜索返回空时，从音乐搜索结果中提取去重专辑
    // （Baka QQ 音乐等插件的 search('album') 可能不支持，但 search('music') 可返回带专辑信息的歌曲）
    if (page === 1) {
      log(`[pluginAlbumSearch] ${source.name} 直接专辑搜索为空，回退到音乐搜索提取专辑`);
      const songResults = await pluginSearch(source, keyword, 1, 30);
      if (songResults.length === 0) return [];

      const albumMap = new Map<string, PluginAlbumResult>();
      for (const song of songResults) {
        const albumName = song.album || '';
        if (!albumName) continue;
        const key = albumName.toLowerCase();
        const existing = albumMap.get(key);
        if (existing) {
          // 合并：保留第一个封面，累计歌曲数
          if (!existing.coverUrl && song.coverUrl) existing.coverUrl = song.coverUrl;
          existing.songCount = (existing.songCount ?? 0) + 1;
          continue;
        }
        // 专辑标识字段名跨插件不统一：QQ 是 albummid/albumMID，网易是 al.id，
        // 统一提取并保留原字段，否则点击专辑后 getAlbumInfo 拿不到 albumMid
        // 会请求出 104400 空结果（表现为专辑页打不开）
        const rawAlbumId = song.rawData?.albumId || song.rawData?.albumid || song.rawData?.al?.id;
        const rawAlbumMid = song.rawData?.albumMID || song.rawData?.albummid || song.rawData?.albumMid;
        albumMap.set(key, {
          id: String(rawAlbumId || albumName),
          name: albumName,
          artist: song.artist || '',
          coverUrl: song.coverUrl || '',
          platform: song.platform || source.name,
          platformId: String(rawAlbumId || albumName),
          pluginId: source.id,
          rawData: { albumName, artist: song.artist, albumId: rawAlbumId, albummid: rawAlbumMid, albumMID: rawAlbumMid },
        });
      }
      return [...albumMap.values()];
    }

    return [];
  } catch (e: any) {
    log(`[pluginAlbumSearch] ${source.name} 失败: ${e?.message || e}`);
    return [];
  }
}

/**
 * 检查插件是否支持指定搜索类型
 * 始终返回 true：实际搜索函数内部已做 supportedSearchType 检查，
 * Baka 插件可能未完整声明但实际支持 album/sheet/artist 搜索。
 */
export function pluginSupportsSearchType(_source: PluginSource, _type: 'music' | 'sheet' | 'artist' | 'album'): boolean {
  return true;
}

/**
 * 获取插件声明的支持音质列表。
 *
 * 委托给 BakaPluginManager，Baka 插件使用 12 档新键值（如 '320k'、'flac'、'master'）。
 * 原版 MusicFree 插件无此字段，仅支持 standard/high/lossless 三档，
 * 返回对应的 3 档代表音质（128k / 320k / flac），由 qualityKeyToMfQuality 完成实际映射。
 *
 * 返回的键值已映射为本项目的 QualityKey（'96k' → 'mgg'）。
 */
export async function pluginGetSupportedQualities(source: PluginSource): Promise<QualityKey[] | null> {
  const inst = await ensurePluginInstance(source);
  if (await BakaPluginManager.isBakaPlugin(source)) {
    return BakaPluginManager.getSupportedQualities(source);
  }

  // [MF 原生音质键适配] 新式 MF 插件（时迁酱等）在 supportedQualities 中
  // 声明原生档位键（含 flac24bit/hires），直接作为 UI 展示与回退上界。
  const declared = inst?.instance.supportedQualities;
  if (Array.isArray(declared)) {
    const keys = declared
      .map((q: unknown) => normalizeQualityKey(q))
      .filter((q): q is QualityKey => q !== null);
    if (keys.length > 0) return keys;
  }

  // 原版 MusicFree 插件没有 Baka 的 12 档 supportedQualities，
  // 只暴露 standard/high/lossless 三档，这里返回对应的代表音质用于 UI 与回退逻辑。
  return ['128k', '320k', 'flac'];
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

// ==================== 辅助函数 ====================

// 正在加载中的插件实例 Promise 缓存，避免并发加载同一插件时互相销毁沙箱导致加载失败
const pendingPluginInstances = new Map<string, Promise<PluginInstance | null>>();

/**
 * 确保插件实例已加载到内存中
 */
async function ensurePluginInstance(source: PluginSource): Promise<PluginInstance | null> {
  const inst = pluginInstances.get(source.id);
  if (inst) {
    pluginInstanceErrors.delete(source.id);
    return inst;
  }

  // 并发保护：同一插件正在加载时共享同一个 Promise，避免重复加载互相干扰
  const pending = pendingPluginInstances.get(source.id);
  if (pending) return pending;

  const promise = loadPluginInstance(source);
  pendingPluginInstances.set(source.id, promise);
  try {
    return await promise;
  } finally {
    pendingPluginInstances.delete(source.id);
  }
}

async function loadPluginInstance(source: PluginSource): Promise<PluginInstance | null> {
  log(`插件实例未缓存，重新加载: ${source.name} (${source.filePath})`);

  try {
    let script = '';
    let readError = '';
    if (source.filePath.startsWith('builtin://')) {
      const webPath = BUILTIN_PLUGINS[source.filePath];
      if (webPath) {
        const resp = await fetchWithTimeout(webPath, 5000);
        if (resp.ok) script = await resp.text();
      }
    } else if (source.filePath.startsWith('http')) {
      // [修复防御]: 远程 URL 先尝试浏览器 fetch，失败则回退 Tauri 后端（绕过 CORS）
      const resp = await fetchWithTimeout(source.filePath, 10000);
      if (resp.ok) script = await resp.text();
      else readError = `插件地址返回 HTTP ${resp.status}`;
      if (!script) {
        try {
          script = await pluginApi.fetchPluginUrl(source.filePath);
        } catch (error) {
          readError = `无法下载插件脚本：${String(error)}`;
        }
      }
    } else if (source.filePath) {
      try {
        script = await pluginApi.readPluginFile(source.filePath);
        log(`[ensurePluginInstance] ${source.name} 读取脚本成功: ${script.length} chars`);
      } catch (error) {
        readError = `无法读取插件文件：${String(error)}`;
        log(`[ensurePluginInstance] ${source.name} 读取脚本失败: ${readError}`);
      }
    } else {
      readError = '插件 filePath 为空';
    }

    if (script) {
      const loadedSource = await loadPluginFromScript(script, source.filePath, source.id);
      if (!loadedSource) {
        readError = '插件脚本执行失败或缺少 platform 字段，请查看插件日志';
        log(`[ensurePluginInstance] ${source.name} loadPluginFromScript 返回 null`);
      } else {
        log(`[ensurePluginInstance] ${source.name} loadPluginFromScript 成功: loadedId=${loadedSource.id.substring(0, 16)}... sourceId=${source.id.substring(0, 16)}... match=${loadedSource.id === source.id}`);
        // [修复] 直接用 source.id 缓存实例，不依赖 SHA256 hash 匹配
        const entry = pluginInstances.get(loadedSource.id);
        if (entry) {
          linkSandboxAlias(source.id, loadedSource.id);
          const availableMethods = Object.keys(entry.instance)
            .filter(key => typeof (entry.instance as any)[key] === 'function');
          const sourceProxy = createSandboxProxy(source.id, {
            ...entry.instance,
            _availableMethods: availableMethods,
          });
          pluginInstances.set(source.id, {
            source,
            instance: sourceProxy,
            script: entry.script,
          });
          log(`[ensurePluginInstance] ${source.name} 已缓存实例到 source.id，并映射沙箱别名`);
        } else {
          log(`[ensurePluginInstance] ${source.name} 警告: loadedSource.id 在 pluginInstances 中未找到`);
        }
      }
      // 回退: 遍历找到 filePath 匹配的条目
      if (!pluginInstances.has(source.id)) {
        for (const [key, entry] of pluginInstances) {
          if (entry.source.filePath === source.filePath && key !== source.id) {
            linkSandboxAlias(source.id, key);
            const availableMethods = Object.keys(entry.instance)
              .filter(methodName => typeof (entry.instance as any)[methodName] === 'function');
            const sourceProxy = createSandboxProxy(source.id, {
              ...entry.instance,
              _availableMethods: availableMethods,
            });
            pluginInstances.set(source.id, {
              source,
              instance: sourceProxy,
              script: entry.script,
            });
            log(`[ensurePluginInstance] ${source.name} 回退匹配成功: key=${key.substring(0, 16)}...`);
            break;
          }
        }
      }
    } else {
      log(`[ensurePluginInstance] ${source.name} 脚本为空，readError=${readError}`);
    }

    const resolved = pluginInstances.get(source.id) || null;
    if (resolved) {
      pluginInstanceErrors.delete(source.id);
      log(`[ensurePluginInstance] ${source.name} 最终: 实例已就绪`);
    } else {
      pluginInstanceErrors.set(source.id, readError || '插件脚本为空或实例未注册');
      log(`[ensurePluginInstance] ${source.name} 最终: 实例为 null, error=${readError}`);
    }
    return resolved;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    log(`[ensurePluginInstance] ${source.name} 重新加载异常: ${message}`);
    pluginInstanceErrors.set(source.id, `插件初始化异常：${message}`);
    return null;
  }
}

// ==================== 用户变量存储 ====================

// 每个插件的用户变量值独立存储，key 格式: xianyu_plugin_user_vars_<pluginId>
const userVarKey = (pluginId: string) => `xianyu_plugin_user_vars_${pluginId}`;

/** 读取指定插件的用户变量值 */
export function getPluginUserVariableValues(pluginId: string): Record<string, string> {
  try {
    const storageKey = userVarKey(pluginId);
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      const keys = Object.keys(parsed);
      log(`[getPluginUserVariableValues] pluginId=${pluginId.substring(0, 12)}... storageKey=${storageKey.substring(0, 40)}... keys=[${keys.join(',')}] count=${keys.length}`);
      return parsed;
    }
    log(`[getPluginUserVariableValues] pluginId=${pluginId.substring(0, 12)}... localStorage无值 (key=${storageKey.substring(0, 40)}...)`);
  } catch (e) {
    log(`[getPluginUserVariableValues] pluginId=${pluginId.substring(0, 12)}... 读取异常: ${e}`);
  }
  return {};
}

/** 保存指定插件的用户变量值 */
export function setPluginUserVariableValues(pluginId: string, values: Record<string, string>) {
  try {
    const keys = Object.keys(values);
    log(`[setPluginUserVariableValues] pluginId=${pluginId.substring(0, 12)}... 保存 keys=[${keys.join(',')}] count=${keys.length}`);
    for (const k of keys) {
      log(`[setPluginUserVariableValues]  ${k}=${values[k] ? '(已设置,' + String(values[k]).length + '字符)' : '(空)'}`);
    }
    localStorage.setItem(userVarKey(pluginId), JSON.stringify(values));
    // B站插件：把用户变量里的 B站 Cookie 同步进取流读取的 Cookie 存储（取流/下载防盗链）
    const biliSource = getStoredPlugins().find(
      (p) => p.id === pluginId && (p.name === 'bilibili' || String(p.id || '').includes('bilibili')),
    );
    if (biliSource) {
      syncBilibiliCookiesFromVars(values);
    }
  } catch (e) {
    log(`[setPluginUserVariableValues] 保存异常: ${e}`);
  }
}

const BILIBILI_COOKIE_KEYS = new Set([
  'SESSDATA',
  'buvid3',
  'buvid4',
  'bili_jct',
  'DedeUserID',
  'DedeUserID__ckMd5',
  'b_nut',
  '_uuid',
  'PVID',
  'sid',
]);

function storePluginCookie(name: string, value: unknown): void {
  try {
    if (!name || value == null || String(value) === '') return;
    const cookieStore = JSON.parse(localStorage.getItem('__plugin_cookies') || '{}');
    cookieStore[name] = { value: String(value), domain: 'bilibili.com' };
    localStorage.setItem('__plugin_cookies', JSON.stringify(cookieStore));
  } catch {
    /* ignore */
  }
}

/**
 * 把 B站插件用户变量里可识别的 B站 Cookie 写入 __plugin_cookies，
 * 供 getPluginBilibiliCookies() 取流/下载防盗链使用。支持：
 *  - 已知 Cookie 键名的变量（SESSDATA/buvid3 等）
 *  - 值整体为浏览器导出的 Cookie JSON 数组 / 对象
 */
function syncBilibiliCookiesFromVars(values: Record<string, string>): void {
  for (const k of Object.keys(values)) {
    if (BILIBILI_COOKIE_KEYS.has(k) && values[k]) {
      storePluginCookie(k, values[k]);
    }
  }
  for (const raw of Object.values(values)) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!(trimmed.startsWith('[') || trimmed.startsWith('{'))) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const items = Array.isArray(parsed)
        ? parsed
        : Object.entries(parsed).map(([n, v]) => ({ name: n, value: v }));
      for (const it of items) {
        if (it && it.name && it.value != null) {
          storePluginCookie(String(it.name), it.value);
        }
      }
    } catch {
      /* ignore */
    }
  }
}

/** 删除指定插件的用户变量值（卸载时调用） */
function removePluginUserVariableValues(pluginId: string) {
  try {
    localStorage.removeItem(userVarKey(pluginId));
  } catch { /* ignore */ }
}

/**
 * 获取插件实例定义的用户变量列表（用于 UI 渲染输入表单）。
 * 优先从完整实例缓存读取，其次从轻量 userVarDefsCache 读取，
 * 两者均未命中时返回空数组（需调用 ensurePluginUserVariables 异步加载）。
 */
export function getPluginUserVariables(pluginId: string): PluginUserVariable[] {
  const inst = pluginInstances.get(pluginId);
  if (inst?.instance?.userVariables) {
    const normalized = normalizePluginUserVariables(inst.instance.userVariables);
    if (normalized.length > 0) {
      userVarDefsCache.set(pluginId, normalized);
      return normalized;
    }
  }
  return getNormalizedCachedUserVariables(pluginId);
}

/**
 * 异步确保插件用户变量定义已加载。
 * 懒加载模式下插件可能尚未初始化，此函数会触发 ensurePluginInstance 完成加载，
 * 然后从实例中提取 userVariables 并缓存到 userVarDefsCache。
 * 
 * 典型场景：QQ音乐L2 等插件需要用户配置密钥（cookie/token）才能播放，
 * 用户在设置页打开插件详情时调用此函数获取变量定义以渲染输入表单。
 */
export async function ensurePluginUserVariables(source: PluginSource): Promise<PluginUserVariable[]> {
  // 1. 优先从已有缓存读取（无需加载插件）
  const cached = getNormalizedCachedUserVariables(source.id);
  if (cached.length > 0) return cached;

  const inst = pluginInstances.get(source.id);
  if (inst?.instance?.userVariables) {
    const normalized = normalizePluginUserVariables(inst.instance.userVariables);
    userVarDefsCache.set(source.id, normalized);
    return normalized;
  }

  // 2. 缓存未命中，触发完整加载
  const loaded = await ensurePluginInstance(source);
  if (loaded?.instance?.userVariables) {
    const normalized = normalizePluginUserVariables(loaded.instance.userVariables);
    userVarDefsCache.set(source.id, normalized);
    return normalized;
  }

  // 3. 实例加载失败或实例未暴露 userVariables 时，从源码静态提取。
  // Baka/Toskysun 插件通常直接在 module.exports 中声明 userVariables，
  // 例如 QQ音乐[L2] 的 SOURCE_API_KEY。静态兜底可避免设置页密钥输入框消失。
  const script = await readPluginScriptForUserVariables(source);
  if (script) {
    const normalized = extractPluginUserVariablesFromScript(script);
    if (normalized.length > 0) {
      userVarDefsCache.set(source.id, normalized);
      return normalized;
    }
  }

  return [];
}

/**
 * 异步刷新所有已存储插件的 userVariables 定义缓存。
 * 用于设置页初始化时显示"变量"徽标——仅加载尚未缓存的插件，已缓存则跳过。
 * 返回有用户变量定义的插件 ID 集合。
 */
export async function refreshUserVariableBadges(): Promise<Set<string>> {
  const allPlugins = getStoredPlugins();
  const result = new Set<string>();

  await Promise.allSettled(allPlugins.map(async (source) => {
    // 跳过 LX 插件（LX 协议无 userVariables 概念）
    if (source.format === 'lx') return;

    // 优先读缓存
    const cached = getNormalizedCachedUserVariables(source.id);
    if (cached.length > 0) {
      result.add(source.id);
      return;
    }

    // 已在实例缓存中
    const inst = pluginInstances.get(source.id);
    if (inst?.instance?.userVariables) {
      const normalized = normalizePluginUserVariables(inst.instance.userVariables);
      if (normalized.length > 0) {
        userVarDefsCache.set(source.id, normalized);
        result.add(source.id);
      }
      return;
    }

    // 未缓存：异步加载或从源码静态提取。
    // 不限制 enabled 状态，也兼容历史数据中 format=unknown 的 MusicFree/Baka 插件。
    try {
      const normalized = await ensurePluginUserVariables(source);
      if (normalized.length > 0) {
        result.add(source.id);
      }
    } catch {
      // 加载失败不阻塞其他插件
    }
  }));

  return result;
}

/**
 * 用户变量变更后重新加载插件实例，使新值通过 env.getUserVariables() 生效。
 * 清除缓存后下次 ensurePluginInstance 会重新执行插件脚本。
 */
export function reloadPluginInstance(pluginId: string) {
  // 用户变量或插件实例变化后，清理 Baka 短时直链缓存，避免继续复用旧 key 解析出来的 URL。
  BakaPluginManager.clearMediaSourceCache(pluginId);
  // 沙箱模式清理：销毁 Worker，下次加载时重新创建
  if (_sandboxedPlugins.has(pluginId)) {
    _sandboxedPlugins.delete(pluginId);
    destroySandbox(pluginId).catch(() => {});
  }
  pluginInstances.delete(pluginId);
  // 不清除 userVarDefsCache：用户变量定义不因值变更而改变，
  // 重新加载后 ensurePluginInstance 会自动刷新缓存
  bumpPluginsVersion();
}

// ==================== 插件存储 ====================

// 所有插件（内置 + 用户导入）都持久化到 localStorage，跨重启保留。
function readPluginsFromLocalStorage(): PluginSource[] {
  try {
    const raw = localStorage.getItem(PLUGIN_SOURCES_KEY);
    if (raw) return JSON.parse(raw);

    const legacyRaw = localStorage.getItem(PLUGIN_SOURCES_KEY_LEGACY);
    if (legacyRaw) {
      const legacyPlugins = JSON.parse(legacyRaw);
      localStorage.setItem(PLUGIN_SOURCES_KEY, legacyRaw);
      localStorage.removeItem(PLUGIN_SOURCES_KEY_LEGACY);
      return legacyPlugins;
    }

    return [];
  } catch {
    return [];
  }
}

export function getStoredPlugins(): PluginSource[] {
  return readPluginsFromLocalStorage();
}

export function addPluginSource(source: PluginSource) {
  const plugins = readPluginsFromLocalStorage();
  const existing = plugins.findIndex(p => p.id === source.id);
  if (existing >= 0) {
    plugins[existing] = source;
  } else {
    // 设置初始排序权重：新插件排到所有插件的末尾
    source.sortOrder = plugins.length;
    plugins.push(source);
  }
  localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(plugins));
  bumpPluginsVersion();
}

/**
 * 按用户拖拽后的新顺序重写所有插件的 sortOrder
 * @param orderedIds 排序后的插件 ID 数组（完整列表）
 */
export function reorderPlugins(orderedIds: string[]) {
  const stored = readPluginsFromLocalStorage();
  const idToIndex = new Map(orderedIds.map((id, i) => [id, i]));
  for (const p of stored) {
    const idx = idToIndex.get(p.id);
    if (idx !== undefined) {
      p.sortOrder = idx;
    }
  }
  localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(stored));
  bumpPluginsVersion();
}

export function removePluginSource(id: string) {
  const stored = readPluginsFromLocalStorage().filter(p => p.id !== id);
  localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(stored));
  // 沙箱模式清理：销毁 Worker
  if (_sandboxedPlugins.has(id)) {
    _sandboxedPlugins.delete(id);
    destroySandbox(id).catch(() => {});
  }
  pluginInstances.delete(id);
  userVarDefsCache.delete(id);
  removePluginUserVariableValues(id);
  // [修复防御]: LX 插件删除时也要销毁 iframe
  destroyLxPlugin(id);
  bumpPluginsVersion();
}

function updatePluginSource(id: string, updates: Partial<PluginSource>) {
  const stored = readPluginsFromLocalStorage();
  const idx = stored.findIndex(p => p.id === id);
  if (idx >= 0) {
    stored[idx] = { ...stored[idx], ...updates };
    localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(stored));
    bumpPluginsVersion();
  }
}

/**
 * 切换插件启用/禁用状态
 * LX 插件启用时创建 iframe 初始化，禁用时销毁 iframe
 * 与 lx-music-desktop setUserApi → createWindow/closeWindow 流程一致
 */
export async function togglePlugin(id: string): Promise<{ success: boolean; enabled: boolean; message?: string }> {
  const plugins = getStoredPlugins();
  const idx = plugins.findIndex(p => p.id === id);
  if (idx < 0) {
    return { success: false, enabled: false, message: '插件不存在' };
  }

  const source = plugins[idx];
  const newEnabled = !source.enabled;
  const updatedSource = { ...source, enabled: newEnabled };

  const stored = readPluginsFromLocalStorage();
  const sIdx = stored.findIndex(p => p.id === id);
  if (sIdx >= 0) {
    stored[sIdx] = updatedSource;
    localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(stored));
    bumpPluginsVersion();
  }

  // LX 插件需要管理 iframe 生命周期
  if (source.format === 'lx') {
    if (newEnabled) {
      // 启用：创建 iframe 并初始化
      log(`[togglePlugin] 启用 LX 插件，开始初始化: ${source.name}`);
      const ok = await initLxPlugin(updatedSource);
      if (!ok) {
        // 初始化失败，回滚为禁用
        const rollback = readPluginsFromLocalStorage();
        const rIdx = rollback.findIndex(p => p.id === id);
        if (rIdx >= 0) {
          rollback[rIdx] = { ...updatedSource, enabled: false };
          localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(rollback));
          bumpPluginsVersion();
        }
        return { success: false, enabled: false, message: `${source.name} 初始化失败` };
      }
      return { success: true, enabled: true };
    } else {
      // 禁用：销毁 iframe
      log(`[togglePlugin] 禁用 LX 插件，销毁实例: ${source.name}`);
      destroyLxPlugin(id);
      return { success: true, enabled: false };
    }
  }

  // MusicFree 插件只需切换标志
  return { success: true, enabled: newEnabled };
}

// ==================== 内置插件清理（已取消所有内置插件，此函数仅用于清除旧版本遗留的内置插件条目） ====================

async function loadBuiltinPlugins(): Promise<void> {
  // 清除所有遗留的内置插件条目（BUILTIN_PLUGINS 已为空，所有 builtin:// 条目均视为过期）
  const stored = getStoredPlugins();
  const builtinPaths = new Set(Object.keys(BUILTIN_PLUGINS));
  const stalePlugins = stored.filter(p => p.filePath.startsWith('builtin://') && !builtinPaths.has(p.filePath));
  if (stalePlugins.length > 0) {
    for (const stale of stalePlugins) {
      removePluginSource(stale.id);
      pluginInstances.delete(stale.id);
    }
    log(`已清除 ${stalePlugins.length} 个旧内置插件`);
  }

  // BUILTIN_PLUGINS 已为空，无内置插件需加载；entries 为空数组，以下循环不会执行
  const entries = Object.entries(BUILTIN_PLUGINS);
  const results = await Promise.allSettled(entries.map(async ([builtinPath, webPath]) => {
    try {
      // 检查是否已存在
      const existing = getStoredPlugins().find(p => p.filePath === builtinPath);
      if (existing) {
        // 已存在：确保实例已加载
        if (!pluginInstances.has(existing.id) && existing.format !== 'lx') {
          try {
            const resp = await fetch(webPath);
            if (resp.ok) {
              const script = await resp.text();
              await loadPluginFromScript(script, builtinPath);
              for (const [key, entry] of pluginInstances) {
                if (entry.source.filePath === builtinPath && key !== existing.id) {
                  pluginInstances.set(existing.id, entry);
                  break;
                }
              }
            }
          } catch { /* ignore */ }
        }
        return null;
      }

      // 不存在：加载并注册
      const resp = await fetch(webPath);
      if (!resp.ok) {
        log(`内置插件文件不可用: ${webPath}`);
        return null;
      }
      const script = await resp.text();
      const source = await loadPluginFromScript(script, builtinPath);
      if (source) {
        source.filePath = builtinPath;
        source.isBuiltin = true;
        addPluginSource(source);
        log(`内置插件加载成功: ${source.name}`);
      }
      return source;
    } catch (e) {
      log(`内置插件加载失败: ${builtinPath} - ${e}`);
      return null;
    }
  }));

  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) log(`loadBuiltinPlugins: ${failed} 个插件加载被拒绝`);
}

export async function loadPlugins(lazyLoad: boolean = false): Promise<void> {
  // 清理旧版本遗留的内置插件条目（已无内置插件）
  await loadBuiltinPlugins();

  const plugins = getStoredPlugins();

  // 懒加载模式：仅加载插件列表到内存，不预初始化实例
  // 实例将在 ensurePluginInstance 被调用时按需初始化
  if (lazyLoad) {
    log(`[loadPlugins] 懒加载模式：跳过 ${plugins.length} 个插件的预初始化`);
    return;
  }

  // [修复防御]: 并行加载所有插件，避免串行 await 导致 N 个插件 = N × 单插件耗时
  // 落雪插件每个最多等待 15s 初始化超时，串行 3 个 = 45s，并行后 = 15s
  await Promise.allSettled(plugins.map(async (source) => {
    // MusicFree 插件：已缓存则跳过
    if (pluginInstances.has(source.id)) return;
    // LX 插件：已初始化则跳过，禁用则不加载
    if (source.format === 'lx') {
      if (!source.enabled) {
        log(`跳过禁用的 LX 插件: ${source.name}`);
        return;
      }
      try {
        await initLxPlugin(source);
      } catch (e: any) {
        log(`LX 插件 ${source.name} 初始化失败: ${e?.message || e}`);
      }
      return;
    }

    // MusicFree 插件：复用 ensurePluginInstance 加载（含并发保护），
    // 避免与榜单/搜索等页面按需加载同一插件时互相销毁沙箱导致加载失败
    try {
      await ensurePluginInstance(source);
    } catch (e: any) {
      log(`插件 ${source.name} 加载失败: ${e?.message || e}`);
    }
  }));
}

// ==================== 插件更新 ====================

const pluginUpdateService = createPluginUpdateService({
  ensurePluginInstance,
  loadPluginFromScript,
  getStoredPlugins,
  // 订阅服务在本模块后部创建，此处以闭包惰性引用，运行时必然已初始化。
  getSubscriptions: () => pluginSubscriptionService.getSubscriptions(),
  addPluginSource,
  removePluginSource,
  updatePluginSource,
  getPluginUserVariableValues,
  setPluginUserVariableValues,
  parseLxScriptInfo,
  initLxPlugin,
  destroyLxPlugin,
  pluginApi,
  log,
});

export const checkPluginUpdate = pluginUpdateService.checkPluginUpdate;
export const performPluginUpdate = pluginUpdateService.performPluginUpdate;
export const checkAllPluginUpdates = pluginUpdateService.checkAllPluginUpdates;

// ==================== 云端同步支持 ====================

/**
 * 获取插件脚本内容（用于云端同步上传）
 * 优先从内存缓存读取，没有则尝试从文件/URL 读取
 */
export async function getPluginScript(id: string): Promise<string | null> {
  // 1. 优先从内存缓存读取
  const instance = pluginInstances.get(id);
  if (instance?.script) {
    return instance.script;
  }

  // 2. 从 localStorage 读取元数据，尝试重新加载脚本
  const source = getStoredPlugins().find(p => p.id === id);
  if (!source) return null;

  // 3. LX 格式插件：从 lxPluginEngine 的脚本缓存获取（使用 Tauri 代理避免 CORS）
  if (source.format === 'lx') {
    const lxScript = await getLxPluginScript(id, source.filePath);
    if (lxScript) return lxScript;
  }

  try {
    if (source.filePath.startsWith('builtin://')) {
      return null; // 内置插件不需要同步
    } else if (source.filePath.startsWith('http')) {
      const resp = await fetchWithTimeout(source.filePath, 10000);
      if (resp.ok) return await resp.text();
    } else {
      return await pluginApi.readPluginFile(source.filePath);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 将本地文件路径的插件脚本保存到应用数据目录，返回新的 filePath。
 * 避免插件安装后原文件被移动/删除导致脚本读取失败。
 * 非本地路径（builtin/http）或保存失败时返回 null。
 */
export async function persistPluginScriptToDataDir(
  source: PluginSource,
  script: string,
): Promise<string | null> {
  const fp = source.filePath;
  if (!fp || fp.startsWith('builtin://') || fp.startsWith('http')) return null;
  try {
    const savedPath = await pluginApi.savePluginScript(source.id, script);
    return savedPath;
  } catch (e: any) {
    log(`保存插件脚本到数据目录失败 ${source.name}: ${e?.message || e}`);
    return null;
  }
}

/**
 * 从云端同步数据恢复插件
 * 解析脚本、创建实例、持久化元数据
 */
export async function restorePluginFromSync(
  source: PluginSource,
  script: string,
): Promise<boolean> {
  try {
    if (!script || script.trim().length === 0) {
      log(`restorePluginFromSync: 脚本为空, 跳过 ${source.name}`);
      return false;
    }

    // 检查是否已存在相同插件
    const existing = getStoredPlugins().find(p => p.id === source.id);
    if (existing) {
      // 已存在：更新元数据，保留现有脚本缓存
      const updates: Partial<PluginSource> = {
        enabled: source.enabled,
        sortOrder: source.sortOrder,
        name: source.name,
        version: source.version,
      };
      // 本地文件路径的插件：同步一份副本到数据目录，避免原文件移动后失效
      const savedPath = await persistPluginScriptToDataDir(existing, script);
      if (savedPath) {
        updates.filePath = savedPath;
      }
      updatePluginSource(source.id, updates);
      log(`restorePluginFromSync: 插件已存在, 更新元数据 ${source.name}`);
      return true;
    }

    // 新插件：解析脚本并创建实例
    const loadedSource = await loadPluginFromScript(script, source.filePath);
    if (!loadedSource) {
      log(`restorePluginFromSync: 脚本解析失败 ${source.name}`);
      return false;
    }

    // 本地文件路径的插件：保存副本到数据目录，避免原文件移动后失效
    const savedPath = await persistPluginScriptToDataDir(loadedSource, script);
    if (savedPath) {
      loadedSource.filePath = savedPath;
    }

    // 合并同步的元数据（保留 enabled、sortOrder 等用户设置）
    const merged: PluginSource = {
      ...loadedSource,
      enabled: source.enabled,
      sortOrder: source.sortOrder ?? loadedSource.sortOrder,
      importedAt: source.importedAt || loadedSource.importedAt,
    };

    // 确保 instance 缓存使用正确的 id
    const entry = pluginInstances.get(loadedSource.id);
    if (entry) {
      entry.source = merged;
      pluginInstances.set(merged.id, entry);
      if (loadedSource.id !== merged.id) {
        pluginInstances.delete(loadedSource.id);
      }
    }

    addPluginSource(merged);
    log(`restorePluginFromSync: 恢复成功 ${merged.name} (${merged.format})`);

    // LX 插件如果启用，需要初始化 iframe
    if (merged.format === 'lx' && merged.enabled) {
      await initLxPlugin(merged);
    }

    return true;
  } catch (e: any) {
    log(`restorePluginFromSync: 恢复失败 ${source.name} - ${e?.message || e}`);
    return false;
  }
}

// ==================== 订阅管理 ====================

const pluginSubscriptionService = createPluginSubscriptionService({
  loadPluginFromScript,
  addPluginSource,
  getStoredPlugins,
  compareVersions,
});

export const getSubscriptions = pluginSubscriptionService.getSubscriptions;
export const isValidSubscriptionUrl = pluginSubscriptionService.isValidSubscriptionUrl;
export const addSubscription = pluginSubscriptionService.addSubscription;
export const updateSubscription = pluginSubscriptionService.updateSubscription;
export const removeSubscription = pluginSubscriptionService.removeSubscription;
export const mergeSubscriptionsFromCloud = pluginSubscriptionService.mergeSubscriptionsFromCloud;
export const installFromSubscriptionUrl = pluginSubscriptionService.installFromSubscriptionUrl;
export const installAllSubscriptions = pluginSubscriptionService.installAllSubscriptions;

// ==================== 导出 ====================
