import axios from 'axios';
import qs from 'qs';
import { ref } from 'vue';
import type {
  PluginSource,
  QualityKey,
} from '../../types';
import { ALL_QUALITY_KEYS, ALL_QUALITY_KEYS_DESC, QUALITY_META, normalizeQualityKey, resolveOnlinePlayQuality } from '../../types';
import type { OnlineQualityFallbackBehavior } from '../../types';
import { callSandboxMethod } from './pluginSandboxManager';
import { qualityKeyToPluginString } from './pluginResultMappers';
import { pluginApi } from '../tauri/pluginApi';

// ==================== 常量 ====================

export const PLUGIN_SOURCES_KEY = 'xianyu_plugin_sources_v4';
export const PLUGIN_SOURCES_KEY_LEGACY = 'xianyu_plugin_sources_v3';
export const MAX_PLUGIN_SIZE = 2 * 1024 * 1024;

export const BUILTIN_PLUGINS: Record<string, string> = {};

// ==================== 日志 ====================

let _logCallback: ((msg: string) => void) | null = null;

export function setLoggerCallback(cb: ((msg: string) => void) | null) {
  _logCallback = cb;
}

export function log(msg: string) {
  try { if (_logCallback) { _logCallback(msg); } } catch { /* ignore */ }
}

// ==================== 插件状态版本号 ====================
export const pluginsVersion = ref(0);

export function bumpPluginsVersion() {
  pluginsVersion.value += 1;
}

// ==================== 沙箱隔离配置 ====================

export const USE_SANDBOX = true;

export const _sandboxedPlugins = new Set<string>();

// ==================== Cookie 管理（模拟 Electron session.cookies）====================

export function getCookiesForUrl(url: string): string {
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

export function captureCookiesFromResponse(url: string, responseHeaders: Record<string, string>) {
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
      if (body && body.length > 256 * 1024) {
        log(`[proxyAxios] 请求体过大 ${body.length} bytes，截断`);
        body = body.substring(0, 256 * 1024);
      }
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    if (!url || !url.startsWith('http')) {
      throw new Error(`Invalid URL: ${url || '(empty)'}`);
    }

    const cookieStr = getCookiesForUrl(url);
    if (cookieStr && !headers['Cookie'] && !headers['cookie']) {
      headers['Cookie'] = cookieStr;
    }

    log(`[tauriAdapter] ${method} ${url.substring(0, 150)}, headers=${JSON.stringify(headers).substring(0, 300)}, body=${body ? body.substring(0, 200) : '(none)'}`);
    const response = await pluginApi.pluginHttpRequest(method, url, headers, body);
    log(`[tauriAdapter] 响应: status=${response.status}, bodyLen=${response.body?.length ?? 0}, bodyPreview=${response.body?.substring(0, 200) ?? ''}`);

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
    const errMsg = e?.message || (typeof e === 'string' ? e : JSON.stringify(e)?.substring(0, 200)) || 'Tauri backend request failed';
    log(`[proxyAxios] 请求失败: ${errMsg}, url=${config.url?.substring(0, 80)}`);
    const error: any = new Error(errMsg);
    error.config = config;
    throw error;
  }
}

// ==================== MusicFree 包注入（与 plugin.ts 第15~46行完全一致）====================

export const proxyAxios = axios.create({
  adapter: tauriAdapter as any,
});

proxyAxios.defaults.timeout = 15000;

const _originalCreate = proxyAxios.create.bind(proxyAxios);
proxyAxios.create = (config?: any) => {
  const inst = _originalCreate(config);
  inst.defaults.adapter = tauriAdapter as any;
  inst.defaults.timeout = 15000;
  inst.create = proxyAxios.create;
  return inst;
};

// ==================== 通用小工具 ====================

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function inferActualQualityFromPluginResult(
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

export function isUnsupportedQualityError(message: string): boolean {
  return /不支持.*音质|音质.*不支持|quality.*not\s+support|not\s+support.*quality/i.test(message);
}

export function buildNativePluginQualityPairs(
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

export function isBilibiliSource(source: PluginSource): boolean {
  return source.name === 'bilibili' || String(source.id || '').includes('bilibili');
}

// ==================== 用户变量（类型 + 规范化 + 静态提取） ====================

export interface PluginUserVariable {
  name: string;
  title?: string;
  type?: 'text' | 'password' | 'select';
  defaultValue?: string;
  options?: string[];
  description?: string;
  placeholder?: string;
  required?: boolean;
}

export function normalizePluginUserVariables(raw: unknown): PluginUserVariable[] {
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

export function extractStringProperty(source: string, prop: string): string | undefined {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|[,\\s])${escaped}\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`));
  return match?.[2]?.trim() || undefined;
}

export function extractBooleanProperty(source: string, prop: string): boolean | undefined {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|[,\\s])${escaped}\\s*:\\s*(true|false)`));
  return match ? match[1] === 'true' : undefined;
}

export function extractBalancedArray(script: string, key: string): string | null {
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

export function extractPluginUserVariablesFromScript(script: string): PluginUserVariable[] {
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

// ==================== 插件实例类型与全局缓存 ====================

export interface PluginInstance {
  source: PluginSource;
  instance: IPluginInstance;
  script: string;
}

export interface IPluginInstance {
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
  hints?: Record<string, string[]>;
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
  getArtistInfo?: (artistItem: any) => Promise<any>;
  getMusicComments?: (musicItem: any, page?: number) => Promise<any>;
  getMusicDetailPageUrl?: (musicItem: any) => Promise<any>;
}

const _globalThis = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
if (!_globalThis.__pluginInstances) {
  _globalThis.__pluginInstances = new Map<string, PluginInstance>();
}
export const pluginInstances: Map<string, PluginInstance> = _globalThis.__pluginInstances;

if (!_globalThis.__pluginInstanceErrors) {
  _globalThis.__pluginInstanceErrors = new Map<string, string>();
}
export const pluginInstanceErrors: Map<string, string> = _globalThis.__pluginInstanceErrors;

if (!_globalThis.__userVarDefsCache) {
  _globalThis.__userVarDefsCache = new Map<string, PluginUserVariable[]>();
}
export const userVarDefsCache: Map<string, PluginUserVariable[]> = _globalThis.__userVarDefsCache;

// ==================== 用户变量定义缓存读取 ====================

export function getNormalizedCachedUserVariables(pluginId: string): PluginUserVariable[] {
  const cached = userVarDefsCache.get(pluginId);
  if (!cached) return [];
  const normalized = normalizePluginUserVariables(cached);
  if (normalized.length > 0 && normalized !== cached) {
    userVarDefsCache.set(pluginId, normalized);
  }
  return normalized;
}

// ==================== 沙箱代理实例 ====================

export function createSandboxProxy(pluginId: string, metadata: any): IPluginInstance {
  const allMethodNames = [
    'search', 'getMediaSource', 'getMvSource', 'getMusicInfo', 'getLyric',
    'getAlbumInfo', 'getArtistWorks', 'getTopLists', 'getTopListDetail',
    'importMusicSheet', 'importMusicItem', 'getMusicSheetInfo',
    'getRecommendSheetTags', 'getRecommendSheetsByTag',
    'getArtistInfo', 'getMusicComments', 'getMusicDetailPageUrl',
  ];

  const availableMethods: string[] = Array.isArray(metadata._availableMethods)
    ? metadata._availableMethods
    : allMethodNames;

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

// ==================== 用户变量值存取（纯 localStorage 读写，供沙箱 Provider 与外部使用） ====================

export const userVarKey = (pluginId: string) => `xianyu_plugin_user_vars_${pluginId}`;

// 用户变量值进程内缓存：以原始字符串为键，未变化时免 JSON.parse 与重复日志；
// 仍每次读 localStorage（内存级开销，外部直接改写也能感知），返回浅拷贝防调用方改写污染缓存
const userVarValuesCache = new Map<string, { raw: string; values: Record<string, string> }>();

export function getPluginUserVariableValues(pluginId: string): Record<string, string> {
  try {
    const storageKey = userVarKey(pluginId);
    const raw = localStorage.getItem(storageKey);
    const cached = userVarValuesCache.get(storageKey);
    if (raw === null) {
      if (!cached || cached.raw !== '') {
        log(`[getPluginUserVariableValues] pluginId=${pluginId.substring(0, 12)}... localStorage无值 (key=${storageKey.substring(0, 40)}...)`);
        userVarValuesCache.set(storageKey, { raw: '', values: {} });
      }
      return {};
    }
    if (cached && cached.raw === raw) return { ...cached.values };
    const parsed = JSON.parse(raw);
    const keys = Object.keys(parsed);
    log(`[getPluginUserVariableValues] pluginId=${pluginId.substring(0, 12)}... storageKey=${storageKey.substring(0, 40)}... keys=[${keys.join(',')}] count=${keys.length}`);
    userVarValuesCache.set(storageKey, { raw, values: parsed });
    return { ...parsed };
  } catch (e) {
    log(`[getPluginUserVariableValues] pluginId=${pluginId.substring(0, 12)}... 读取异常: ${e}`);
  }
  return {};
}

// ==================== 插件存储读取（纯 localStorage 读写，作为叶子被存储/用户变量等子模块复用） ====================

export function readPluginsFromLocalStorage(): PluginSource[] {
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

export function setStoredPlugins(plugins: PluginSource[]): void {
  localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(plugins));
}