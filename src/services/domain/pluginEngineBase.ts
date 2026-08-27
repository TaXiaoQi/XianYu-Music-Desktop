/**
 * 插件引擎 · 共享底座（叶子模块）。
 *
 * 汇聚各插件引擎子模块共用的：常量、类型、日志/响应式版本号、HTTP 适配器
 * （tauriAdapter/proxyAxios + Cookie 模拟）、质量键工具、用户变量规范化与
 * 静态提取、插件实例缓存全局（pluginInstances 等）与基础插件存储读取。
 *
 * 仅依赖外部工具模块（axios/pluginApi/pluginSandboxManager 等），
 * 不依赖 domain 下其它插件引擎子模块，作为叶子被它们共同引用。
 */
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

// 内置插件定义：已取消所有内置插件，此映射保留为空用于清理旧版本遗留的内置插件条目
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
// 响应式版本号：每次插件列表变更（增删/排序/开关/更新）后自增，
// 供 Search 等页面 watch 以第一时间刷新本地缓存的插件派生数据。
export const pluginsVersion = ref(0);

export function bumpPluginsVersion() {
  pluginsVersion.value += 1;
}

// ==================== 沙箱隔离配置 ====================

// 沙箱模式开关：启用后插件代码在 Web Worker 中隔离执行
export const USE_SANDBOX = true;

// 记录在沙箱中运行的插件 ID 集合
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
export const proxyAxios = axios.create({
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

// B站插件标识：其专辑/歌单详情走统一的 getBilibiliDetail 专用路径
export function isBilibiliSource(source: PluginSource): boolean {
  return source.name === 'bilibili' || String(source.id || '').includes('bilibili');
}

// ==================== 用户变量（类型 + 规范化 + 静态提取） ====================

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
  script: string; // 存储插件源码用于错误诊断
}

/** 与 MusicFree IPlugin.IPluginDefine 一致（扩展 Baka 插件方法） */
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
export const pluginInstances: Map<string, PluginInstance> = _globalThis.__pluginInstances;

if (!_globalThis.__pluginInstanceErrors) {
  _globalThis.__pluginInstanceErrors = new Map<string, string>();
}
export const pluginInstanceErrors: Map<string, string> = _globalThis.__pluginInstanceErrors;

// [用户变量定义缓存] 独立于完整插件实例缓存，用于在懒加载模式下
// 不初始化完整插件即可获取 userVariables 定义（如 QQ音乐L2 的密钥配置）。
// key = pluginId (SHA-256 hash), value = userVariables 数组
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

/**
 * 创建沙箱代理实例
 *
 * 当插件在沙箱（Web Worker）中加载时，主线程无法直接持有插件实例。
 * 此函数创建一个代理对象，将所有方法调用通过 RPC 转发到 Worker。
 * 代理对象的接口与 IPluginInstance 完全一致，现有代码无需修改。
 */
export function createSandboxProxy(pluginId: string, metadata: any): IPluginInstance {
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

// ==================== 用户变量值存取（纯 localStorage 读写，供沙箱 Provider 与外部使用） ====================

// 每个插件的用户变量值独立存储，key 格式: xianyu_plugin_user_vars_<pluginId>
export const userVarKey = (pluginId: string) => `xianyu_plugin_user_vars_${pluginId}`;

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

// ==================== 插件存储读取（纯 localStorage 读写，作为叶子被存储/用户变量等子模块复用） ====================

// 所有插件（内置 + 用户导入）都持久化到 localStorage，跨重启保留。
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