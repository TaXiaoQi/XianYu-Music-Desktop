/**
 * 插件引擎 —— 完全基于 MusicFree 插件系统
 *
 * 核心代码来自 MusicFree 项目：
 *   - 插件系统/core/pluginManager/plugin.ts  (Plugin 类 + PluginMethodsWrapper)
 *   - 搜索功能/searchPage/hooks/useSearch.ts  (搜索逻辑)
 *
 * 关键流程（与 MusicFree 完全一致）：
 *   1. packages 对象注入 npm 包（axios, cheerio, crypto-js, dayjs, he, qs）
 *   2. _require() 从 packages 中查找模块
 *   3. new Function() 创建插件函数，注入 require/module/exports/console/env/URL/process
 *   4. 执行后从 module.exports 提取插件实例
 *   5. 搜索结果中每个 item 调用 resetMediaItem(_, pluginName) 设置 platform
 *   6. getMediaSource 时传入的 musicItem 就是 resetMediaItem 后的对象
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import CryptoJs from 'crypto-js';
import dayjs from 'dayjs';
import he from 'he';
import qs from 'qs';
import bigInt from 'big-integer';
import { Buffer } from 'buffer';
import { ref } from 'vue';
import type {
  PluginSource,
  PluginSearchResult,
  PluginMusicInfo,
  PluginPlaylistSearchResult,
  QualityKey,
} from '../types';
import { QUALITY_META, qualityKeyToMfQuality, ALL_QUALITY_KEYS, ALL_QUALITY_KEYS_DESC, resolveOnlinePlayQuality } from '../types';
import type { OnlineQualityFallbackBehavior } from '../types';
import { buildLyricsRaw } from '../composables/lyrics';
import { isLxPluginScript, loadLxPluginFromScript, initLxPlugin, destroyLxPlugin, parseLxScriptInfo, isSongLevelError } from './lxPluginEngine';
import { pluginApi } from './tauri/pluginApi';
import {
  createPluginSubscriptionService,
  type SubscriptionInstallResult,
} from './pluginSubscriptions';
import {
  extractAlbum,
  extractArtist,
  extractCoverUrl,
  qualityKeyToPluginString,
  resetMediaItem,
  stripHtmlTags,
  toPluginSearchResult,
} from './pluginResultMappers';
import { fetchWithTimeout } from './pluginFetch';
import {
  compareVersions,
  createPluginUpdateService,
} from './pluginUpdates';

export type { PluginUpdateCheckResult } from './pluginUpdates';

// ==================== 常量 ====================

const PLUGIN_SOURCES_KEY = 'xianyu_plugin_sources_v4';
const PLUGIN_SOURCES_KEY_LEGACY = 'xianyu_plugin_sources_v3';
const MAX_PLUGIN_SIZE = 2 * 1024 * 1024;

// 内置插件定义：已取消所有内置插件，此映射保留为空用于清理旧版本遗留的内置插件条目
const BUILTIN_PLUGINS: Record<string, string> = {};

// 不需要卡密的内置插件路径集合（已无内置插件，保留空集合兼容导出）
export const FREE_BUILTIN_PATHS = new Set<string>();

// ==================== 日志 ====================

let _logCallback: ((msg: string) => void) | null = null;

function log(msg: string) {
  console.log(`[PluginEngine] ${msg}`);
  try { _logCallback?.(msg); } catch { /* ignore */ }
}

export function setLogCallback(cb: ((msg: string) => void) | null) {
  _logCallback = cb;
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

/**
 * 解包 Vite ESM 包装的 CommonJS 模块
 *
 * MusicFreeDesktop 运行在 Electron/webpack 中，import he from "he" 直接得到 CJS module.exports。
 * 本项目运行在 Vite 中，import he from "he" 可能得到 { default: { decode, ... } }（ESM 包装）。
 * 此函数还原 MusicFreeDesktop 的行为：返回原始 CJS 模块对象。
 */
function unwrapMod(mod: any, checkProp?: string): any {
  if (!mod) return mod;
  // 如果模块本身就有 checkProp，说明已是正确形态
  if (checkProp && mod[checkProp]) return mod;
  // 如果有 default 属性且 default 有 checkProp，解包 default
  if (mod.default && mod.default !== mod) {
    if (!checkProp || mod.default[checkProp] || typeof mod.default === 'function') {
      return mod.default;
    }
  }
  return mod;
}

// 与 MusicFree plugin.ts 第26~37行一致
const packages: Record<string, any> = {
  cheerio: unwrapMod(cheerio, 'load'),
  'crypto-js': unwrapMod(CryptoJs, 'SHA256'),
  axios: proxyAxios,
  dayjs: unwrapMod(dayjs, 'isDayjs'),
  'big-integer': unwrapMod(bigInt),
  qs: unwrapMod(qs, 'stringify'),
  he: unwrapMod(he, 'decode'),
  buffer: { Buffer },
  '@react-native-cookies/cookies': {
    set: async (url: string, cookie: any) => {
      try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        const store = JSON.parse(localStorage.getItem('__plugin_cookies') || '{}');
        store[cookie.name] = { ...cookie, domain };
        localStorage.setItem('__plugin_cookies', JSON.stringify(store));
        return true;
      } catch { return false; }
    },
    get: async (url: string) => {
      try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        const store = JSON.parse(localStorage.getItem('__plugin_cookies') || '{}');
        const result: any = {};
        for (const [name, info] of Object.entries(store)) {
          const c = info as any;
          if (c.domain && (domain.includes(c.domain) || c.domain.includes(domain))) {
            result[name] = c;
          }
        }
        return result;
      } catch { return {}; }
    },
    flush: async () => {},
  },
  'musicfree/storage': {
    setItem: async (key: string, value: unknown) => {
      localStorage.setItem(`__plugin_storage_${key}`, typeof value === 'string' ? value : JSON.stringify(value));
    },
    getItem: async (key: string) => {
      return localStorage.getItem(`__plugin_storage_${key}`);
    },
    removeItem: async (key: string) => {
      localStorage.removeItem(`__plugin_storage_${key}`);
    },
  },
};

// 与 MusicFree plugin.ts 第39~46行一致：_require
const _require = (packageName: string) => {
  const pkg = packages[packageName];
  if (pkg) {
    try { pkg.default = pkg; } catch {}
    return pkg;
  }
  return null;
};

// ==================== proxyFetch（通过 Tauri 后端代理 fetch 请求，绕过 CORS）====================

export async function proxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    let urlStr: string;
    if (typeof input === 'string') {
      urlStr = input;
    } else if (input instanceof URL) {
      urlStr = input.toString();
    } else if (input instanceof Request) {
      urlStr = input.url;
    } else {
      urlStr = String(input);
    }

    // [修复防御]: 只代理外部 HTTP(S) 请求，本地资源走原生 fetch
    // 避免 /plugins/builtin_qq.js 等本地资源也走 Tauri IPC
    if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
      return globalThis.fetch(input, init);
    }

    const method = (init?.method || 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { if (typeof v === 'string') headers[k] = v; });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) { if (typeof v === 'string') headers[k] = v; }
      } else {
        for (const [k, v] of Object.entries(init.headers)) {
          if (typeof v === 'string') headers[k] = v;
        }
      }
    }

    let body: string | undefined;
    if (init?.body !== undefined && init.body !== null) {
      body = typeof init.body === 'string' ? init.body : String(init.body);
      if (body.length > 256 * 1024) {
        log(`[proxyFetch] 请求体过大 ${body.length} bytes，截断`);
        body = body.substring(0, 256 * 1024);
      }
    }

    log(`[proxyFetch] ${method} ${urlStr.substring(0, 120)}`);

    const response = await pluginApi.pluginHttpRequest(method, urlStr, headers, body);

    log(`[proxyFetch] ← ${response.status} bodyLen=${response.body?.length ?? 0}`);

    return new Response(response.body, {
      status: response.status,
      statusText: response.status >= 200 && response.status < 300 ? 'OK' : 'Error',
      headers: new Headers(response.headers as Record<string, string>),
    });
  } catch (e: any) {
    log(`[proxyFetch] 失败: ${e?.message}`);
    throw e;
  }
}

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

interface PluginInstance {
  source: PluginSource;
  instance: IPluginInstance;
  script: string; // 存储插件源码用于错误诊断
}

/** 与 MusicFree IPlugin.IPluginDefine 一致 */
interface IPluginInstance {
  platform: string;
  version?: string;
  srcUrl?: string;
  author?: string;
  description?: string;
  supportedSearchType?: string[];
  defaultSearchType?: string;
  userVariables?: PluginUserVariable[];
  cacheControl?: string;
  /** 提示文本（与 MusicFree IPlugin.IPluginDefine.hints 一致） */
  hints?: Record<string, string[]>;
  search?: (query: string, page: number, type: string) => Promise<any>;
  getMediaSource?: (musicItem: any, quality: string) => Promise<any>;
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

// ==================== 插件加载（与 MusicFree Plugin.mountPlugin() 完全一致）====================

export async function loadPluginFromScript(
  script: string,
  uri: string,
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
    const hash = CryptoJs.SHA256(script).toString();

    // ===== Step 1: 执行插件脚本（与 MusicFree mountPlugin 第911~955行完全一致）=====
    const _module: any = { exports: {} };
    let _instance: IPluginInstance;

    // 与 MusicFree 第915~932行一致
    // [修复] ensurePluginInitialized — 与 MusicFree plugin.ts 第88~90行一致
    // 使用 ref 对象避免 TS 控制流分析将变量收窄为 null
    const _resolveRef: { fn: (() => void) | null } = { fn: null };
    const ensurePluginInitialized = new Promise<void>((resolve) => {
      _resolveRef.fn = resolve;
    });

    // 与 MusicFree plugin.ts 第94~104行一致
    const env = {
      getUserVariables: () => getPluginUserVariableValues(hash),
      os: 'win32',
      appVersion: '1.0.0',
      lang: 'zh-CN',
    };
    const _process = {
      // [修复] 设为 win32 模拟桌面端环境
      platform: 'win32',
      version: '1.0.0',
      env,
      // [修复] 与 MusicFree plugin.ts 第109行一致
      ensurePluginInitialized,
    };

    try {
      // 与 MusicFree 第935~949行完全一致
      // Function(body)() —— 第一次 () 执行外层函数返回内层函数
      // 第二次 (args) 执行内层函数，传入 require/module/exports 等参数
      _instance = Function(
        `'use strict';
        return function(require, __musicfree_require, module, exports, console, env, URL, process, fetch) {
          ${script}
        }
      `,
      )()(
        _require,
        _require,
        _module,
        _module.exports,
        console,
        env,
        URL,
        _process,
        proxyFetch,
      );

      // 与 MusicFree 第950~955行完全一致
      if (_module.exports.default) {
        _instance = _module.exports.default;
      } else {
        _instance = _module.exports;
      }

      // [修复] 与 MusicFree plugin.ts 第132行一致：resolve ensurePluginInitialized
      if (_resolveRef.fn) _resolveRef.fn();

      // 调试：检查 _instance 内容
      log(`_module.exports 类型: ${typeof _module.exports}`);
      log(`_module.exports.default 类型: ${typeof _module.exports.default}`);
      log(`_module.exports keys: ${Object.keys(_module.exports).join(', ')}`);
      if (_module.exports.default) {
        log(`_module.exports.default keys: ${Object.keys(_module.exports.default).join(', ')}`);
      }
      log(`_instance 类型: ${typeof _instance}`);
      log(`_instance keys: ${_instance ? Object.keys(_instance).join(', ') : 'null'}`);
      log(`_instance.platform: ${(_instance as any)?.platform}`);
    } catch (e: any) {
      log(`插件脚本执行失败: ${e?.message || e}`);
      log(`  堆栈: ${e?.stack || '无'}`);
      return null;
    }

    // ===== Step 1.5: 不再替换 globalThis.fetch =====
    // 之前通过 globalThis.fetch = proxyFetch 临时替换导致 OOM：
    // 插件异步方法执行期间，Vue 的 <img> 加载封面图也走了 proxyFetch，
    // 图片二进制数据通过 Tauri IPC 传输导致内存溢出。
    // 现在只通过 Function 参数注入 fetch（Step 1 中已完成），
    // 插件代码中直接调用 fetch() 会使用参数中的 proxyFetch（作用域链优先）。
    // 如果插件通过 globalThis.fetch/window.fetch 调用，则走原生 fetch（受 CORS 限制），
    // 但这比 OOM 崩溃要好得多。

    // ===== Step 2: 提取插件信息（与 MusicFree 第990~1016行完全一致）=====
    const platform = _instance.platform || '';
    const version = _instance.version || '';
    const author = _instance.author || '';
    const description = _instance.description || '';

    if (!platform) {
      log('插件缺少 platform 字段，无法识别');
      return null;
    }

    // hash 已在 Step 1 之前预计算（用于 env.getUserVariables 闭包）

    // 与 MusicFree 第993~995行一致：supportedMethods
    const supportedMethodsSet = new Set(
      Object.keys(_instance).filter(key => typeof (_instance as any)[key] === 'function'),
    );

    log(`插件信息 → platform="${platform}", version="${version}", methods=[${[...supportedMethodsSet].join(', ')}]`);

    // ===== Step 3: 构建返回值 =====
    const source: PluginSource = {
      id: hash,
      name: platform,
      format: 'musicfree',
      version,
      author,
      description,
      filePath: uri,
      importedAt: Date.now(),
      enabled: true,
      sources: [platform],
    };

// 缓存实例
pluginInstances.set(hash, { source, instance: _instance, script });

    log(`=== 插件加载成功: "${platform}" (version=${version}) ===`);
    return source;
  } catch (e) {
    console.error('插件加载失败:', e);
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
export type PluginMusicSearchStatus =
  | 'success'
  | 'empty'
  | 'init_failed'
  | 'search_unsupported'
  | 'lyrics_unsupported'
  | 'invalid_response'
  | 'search_failed';

export interface PluginMusicSearchDiagnostics {
  results: PluginSearchResult[];
  status: PluginMusicSearchStatus;
  reason: string;
  searchType?: string;
  supportsLyrics: boolean;
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
    log(`[pluginSearch] ${source.name} searchType=${searchType}, 开始调用 search()`);

    // 与 MusicFree PluginMethodsWrapper.search() 第175~176行一致
    const result = (await inst.instance.search(keyword, page, searchType)) ?? {};
    log(`[pluginSearch] ${source.name} search 返回: type=${typeof result}, keys=${result ? Object.keys(result).join(',') : 'null'}, dataIsArray=${Array.isArray(result?.data)}, dataLen=${result?.data?.length ?? 0}`);

    // 使用 extractResultList 统一提取结果，兼容 data/musicList/list/songs 等多种格式
    // （Baka 系插件可能返回非 { data: [...] } 格式）
    const list = extractResultList(result);
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
      status: 'invalid_response',
      reason: `插件 search 返回格式无效或为空：实际字段为 ${result ? Object.keys(result).join(', ') || '空对象' : 'null'}`,
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

    // 直接尝试搜索；Baka 插件可能未声明 sheet 但实际支持
    const result = (await inst.instance.search(keyword, page, 'sheet')) ?? {};
    const list = extractResultList(result);
    if (list.length === 0) return [];

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
    log(`[${source.name}] 歌单搜索失败: ${e?.message}`);
    return [];
  }
}

// ==================== 插件歌单详情 ====================

/** 从插件返回结果中提取歌曲列表，兼容 data/musicList/isEnd 等多种格式 */
function extractResultList(result: any): any[] {
  if (!result) return [];
  // 常见格式: { data: [...] }
  if (Array.isArray(result.data)) return result.data;
  // MusicFree 部分插件格式: { musicList: [...] }
  if (Array.isArray(result.musicList)) return result.musicList;
  // Baka 插件可能使用 list/albumList/songList 等字段
  if (Array.isArray(result.list)) return result.list;
  if (Array.isArray(result.albumList)) return result.albumList;
  if (Array.isArray(result.songList)) return result.songList;
  if (Array.isArray(result.songs)) return result.songs;
  if (Array.isArray(result.tracks)) return result.tracks;
  // 嵌套格式: { data: { list/songs/... } }
  if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    if (Array.isArray(result.data.list)) return result.data.list;
    if (Array.isArray(result.data.songs)) return result.data.songs;
    if (Array.isArray(result.data.musicList)) return result.data.musicList;
    if (Array.isArray(result.data.albumList)) return result.data.albumList;
  }
  // 直接返回数组
  if (Array.isArray(result)) return result;
  return [];
}

export async function pluginGetPlaylistDetail(
  source: PluginSource,
  sheetItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    // 优先用 getMusicSheetInfo 获取歌单曲目
    if (typeof inst.instance.getMusicSheetInfo === 'function') {
      const result = await inst.instance.getMusicSheetInfo(sheetItem, page);
      const list = extractResultList(result);
      if (list.length > 0) {
        list.forEach((_: any) => { resetMediaItem(_, source.name); });
        return list.map((item: any) => toPluginSearchResult(item, source));
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

// ==================== 歌手作品（歌曲） ====================

export async function pluginGetArtistWorks(
  source: PluginSource,
  artistItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    // 优先用 getArtistWorks 获取歌手作品
    if (typeof inst.instance.getArtistWorks === 'function') {
      const result = await inst.instance.getArtistWorks(artistItem, page, 'music');
      const list = extractResultList(result);
      if (list.length > 0) {
        list.forEach((_: any) => { resetMediaItem(_, source.name); });
        return list.map((item: any) => toPluginSearchResult(item, source));
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
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.getArtistWorks !== 'function') return [];

    const result = await inst.instance.getArtistWorks(artistItem, page, 'album');
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

// ==================== 专辑详情 ====================

export async function pluginGetAlbumSongs(
  source: PluginSource,
  albumItem: any,
  page: number = 1,
): Promise<PluginSearchResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    // 优先用 getAlbumInfo 获取专辑曲目
    if (typeof inst.instance.getAlbumInfo === 'function') {
      const result = await inst.instance.getAlbumInfo(albumItem, page);
      const list = extractResultList(result);
      if (list.length > 0) {
        list.forEach((_: any) => { resetMediaItem(_, source.name); });
        return list.map((item: any) => toPluginSearchResult(item, source));
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
export async function pluginGetMusicInfo(
  source: PluginSource,
  item: PluginSearchResult,
  quality: QualityKey | 'standard' | 'high' | 'lossless' = '320k',
  fallbackBehavior: OnlineQualityFallbackBehavior = 'lower',
  availableQualities: QualityKey[] | null = null,
): Promise<PluginMusicInfo | null> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return null;

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
  // 先检测插件是否声明了 supportedQualities（Toskysun 系列插件特有字段）
  const supportedNewQualities = (inst.instance as any).supportedQualities;
  const supportsNewKeys = Array.isArray(supportedNewQualities) && supportedNewQualities.length > 0;

  const isQualityKey = (q: string): q is QualityKey => q in QUALITY_META;

  // [音质解析] 当有可用音质列表时，使用 resolveOnlinePlayQuality 统一解析
  // 返回有序 (pluginString, QualityKey) 对，确保能追踪实际播放音质
  const tryPairs: Array<{ pluginQ: string; qualityKey: QualityKey }> = [];

  if (isQualityKey(quality) && availableQualities && availableQualities.length > 0) {
    // 使用统一解析函数：首选 → 回退行为 → 最高可用兜底
    const resolvedKeys = resolveOnlinePlayQuality(quality, availableQualities, fallbackBehavior);
    if (supportsNewKeys) {
      for (const q of resolvedKeys) {
        tryPairs.push({ pluginQ: qualityKeyToPluginString(q), qualityKey: q });
      }
    } else {
      // 原版 MF 插件：多 QualityKey 映射到同一三档，需去重
      const seen = new Set<string>();
      for (const q of resolvedKeys) {
        const mfQ = qualityKeyToMfQuality(q);
        if (!seen.has(mfQ)) {
          seen.add(mfQ);
          tryPairs.push({ pluginQ: mfQ, qualityKey: q });
        }
      }
    }
  } else if (isQualityKey(quality)) {
    // 无可用音质列表时，回退到原始行为（不按可用列表过滤）
    if (supportsNewKeys) {
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
      const mfQ = qualityKeyToMfQuality(quality);
      if (fallbackBehavior === 'pause') {
        tryPairs.push({ pluginQ: mfQ, qualityKey: quality });
      } else if (fallbackBehavior === 'higher') {
        if (mfQ === 'standard') {
          tryPairs.push({ pluginQ: 'standard', qualityKey: quality });
          tryPairs.push({ pluginQ: 'high', qualityKey: '320k' });
          tryPairs.push({ pluginQ: 'lossless', qualityKey: 'flac' });
        } else if (mfQ === 'high') {
          tryPairs.push({ pluginQ: 'high', qualityKey: quality });
          tryPairs.push({ pluginQ: 'lossless', qualityKey: 'flac' });
        } else {
          tryPairs.push({ pluginQ: 'lossless', qualityKey: quality });
        }
      } else {
        if (mfQ === 'lossless') {
          tryPairs.push({ pluginQ: 'lossless', qualityKey: quality });
          tryPairs.push({ pluginQ: 'high', qualityKey: '320k' });
          tryPairs.push({ pluginQ: 'standard', qualityKey: '128k' });
        } else if (mfQ === 'high') {
          tryPairs.push({ pluginQ: 'high', qualityKey: quality });
          tryPairs.push({ pluginQ: 'standard', qualityKey: '128k' });
        } else {
          tryPairs.push({ pluginQ: 'standard', qualityKey: quality });
        }
      }
    }
  } else {
    // 旧版 standard/high/lossless 直接使用
    tryPairs.push({ pluginQ: quality, qualityKey: '320k' });
  }

  const tryQualities = tryPairs.map(p => p.pluginQ);

  log(`[getMediaSource] 调用 ${source.name}, id=${musicItem.id}, platform=${musicItem.platform}, tryQualities=${JSON.stringify(tryQualities)}`);

  let result: any = null;
  let lastError: any = null;
  let successPairIdx = -1;
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

  const url = result.url || '';
  const headers = result.headers || {};
  // [修复防御]: 提取插件 getMediaSource 返回的歌词和封面
  // 兼容多种字段名：lyric / rawLrc / lrc（不同插件返回字段名可能不同）
  const lyric = result.lyric || result.rawLrc || result.lrc || '';
  const tlyric = result.tlyric || result.translation || '';
  const lxlyric = result.lxlyric || '';
  // 逐字歌词：兼容 yrc（网易云）/ qrc（QQ 音乐，可能为 hex 加密串）字段
  // 不同 MF 插件可能返回其中一种或多种，buildLyricsRaw 会按优先级选用
  const yrc = result.yrc || '';
  const qrc = result.qrc || '';
  const coverUrl = result.coverUrl || result.artwork || '';
  if (!url) {
    log(`[getMediaSource] ${source.name} 返回空URL, result=${JSON.stringify(result)?.substring(0, 200)}`);
    (globalThis as any).__lastPluginError = `[${source.name}] 返回空URL`;
    return null;
  }

  // 实际播放音质（用于底部栏同步显示）
  const actualQuality = successPairIdx >= 0 ? tryPairs[successPairIdx].qualityKey : undefined;

  // 使用 buildLyricsRaw 构建歌词文本（优先级：yrc > qrc > lxlyric > lyric，解析失败自动回退）
  const lyricsRaw = (lyric || tlyric || lxlyric || yrc || qrc)
    ? buildLyricsRaw(lyric, tlyric, null, lxlyric, yrc, qrc)
    : '';

  const headerKeys = Object.keys(headers);
  log(`[getMediaSource] 成功: url=${url.substring(0, 100)}, headers=[${headerKeys.join(',')}], lyricLen=${lyric.length}, lxlyricLen=${lxlyric.length}, yrcLen=${yrc.length}, qrcLen=${qrc.length}, actualQuality=${actualQuality}`);
  return { url, headers: headers as Record<string, string>, lyric, tlyric, lxlyric, lyricsRaw, coverUrl, actualQuality };
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
 * Toskysun 系列插件扩展返回 lxlyric（逐字歌词，lx-music-desktop 格式）。
 * 原版 MF 插件（如 Baka 插件）可能返回 yrc（网易云）/ qrc（QQ 音乐）字段。
 * 使用 buildLyricsRaw 统一构建为 lyricsRaw 文本（优先级：yrc > qrc > lxlyric > lyric，
 * 高优先级格式解析失败时由后端自动回退到下一档）。
 */
export async function pluginGetLyric(
  source: PluginSource,
  item: PluginSearchResult,
): Promise<{ lyric: string; tlyric?: string; lxlyric?: string; lyricsRaw?: string } | null> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return null;

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
    // 兼容多种翻译字段名：translation / tlyric / translateLyric
    const translation = lrcSource.translation || lrcSource.tlyric || lrcSource.translateLyric || '';
    // 逐字歌词字段：lxlyric（Toskysun 系列）/ yrc（网易云）/ qrc（QQ 音乐，可能为 hex 加密串）
    // 不同插件返回字段不同，buildLyricsRaw 会按优先级选用并自动回退
    const lxlyric = lrcSource.lxlyric || '';
    const yrc = lrcSource.yrc || '';
    const qrc = lrcSource.qrc || '';

    if (!rawLrc && !lxlyric && !yrc && !qrc) {
      log(`[getLyric] ${source.name} rawLrc 为空, lrcSource keys: ${Object.keys(lrcSource).join(',')}`);
      return null;
    }
    // 使用 buildLyricsRaw 构建歌词文本（优先级：yrc > qrc > lxlyric > lyric，解析失败自动回退）
    const lyricsRaw = buildLyricsRaw(rawLrc, translation, null, lxlyric, yrc, qrc);
    log(`[getLyric] ${source.name} 成功, rawLrc长度=${rawLrc.length}, lxlyric长度=${lxlyric.length}, yrc长度=${yrc.length}, qrc长度=${qrc.length}`);
    return { lyric: rawLrc, tlyric: translation, lxlyric, lyricsRaw };
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
  const inst = await ensurePluginInstance(source);
  if (!inst) return null;

  try {
    if (typeof inst.instance.getMusicInfo === 'function') {
      const musicItem = item.rawData
        ? resetMediaItem(item.rawData, source.name)
        : resetMediaItem(item, source.name);
      const result = await inst.instance.getMusicInfo(musicItem);
      // 兼容多种封面字段名（不同插件返回的字段名可能不同）
      const coverUrl = extractCoverUrl(result);
      if (coverUrl) return coverUrl;
    }
    return item.coverUrl || null;
  } catch {
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

    // 直接尝试搜索；Baka 插件可能未声明 artist 但实际支持
    const result = (await inst.instance.search(keyword, page, 'artist')) ?? {};
    const list = extractResultList(result);
    if (list.length === 0) return [];

    return list.map((item: any) => {
      resetMediaItem(item, source.name);
      const id = item.id || item.artistId || item.singerId || '';
      const name = stripHtmlTags(item.name || item.title || item.artist || '');
      const avatarUrl = extractCoverUrl(item) || item.avatar || '';
      return {
        id,
        name,
        avatarUrl,
        description: item.description || item.desc || '',
        songCount: item.songCount || item.musicCount || undefined,
        albumCount: item.albumCount || undefined,
        platform: item.platform || source.name,
        platformId: id,
        pluginId: source.id,
        rawData: item,
      };
    });
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
        albumMap.set(key, {
          id: String(song.rawData?.albumId || song.rawData?.al?.id || albumName),
          name: albumName,
          artist: song.artist || '',
          coverUrl: song.coverUrl || '',
          platform: song.platform || source.name,
          platformId: String(song.rawData?.albumId || song.rawData?.al?.id || albumName),
          pluginId: source.id,
          rawData: { albumName, artist: song.artist, albumId: song.rawData?.albumId || song.rawData?.al?.id },
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

// ==================== 检查插件搜索能力 ====================

/**
 * 检查插件支持的搜索类型
 */
export function getPluginSupportedSearchTypes(source: PluginSource): string[] {
  const inst = pluginInstances.get(source.id);
  if (!inst) return [];
  return inst.instance.supportedSearchType ?? [];
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
 * Toskysun 系列（BakaMusic）插件在实例上声明 `supportedQualities` 字段，
 * 使用 12 档新键值（如 '320k'、'flac'、'master'）。
 * 原版 MusicFree 插件无此字段，仅支持 standard/high/lossless 三档，
 * 返回对应的 3 档代表音质（128k / 320k / flac），由 qualityKeyToMfQuality 完成实际映射。
 *
 * 返回的键值已映射为本项目的 QualityKey（'96k' → 'mgg'）。
 */
export async function pluginGetSupportedQualities(source: PluginSource): Promise<QualityKey[] | null> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return null;
  const raw = (inst.instance as any).supportedQualities;
  if (Array.isArray(raw) && raw.length > 0) {
    // Toskysun 插件：映射 96k → mgg，其余保持原样；过滤未知键值
    return raw
      .map((q: string) => (q === '96k' ? 'mgg' : q))
      .filter((q: string) => q in QUALITY_META) as QualityKey[];
  }
  // 原版 MusicFree 插件：仅支持 standard/high/lossless 三档
  // 返回 3 档代表音质，选择时由 qualityKeyToMfQuality 映射回 MF 三档
  return ['128k', '320k', 'flac'];
}

// ==================== 辅助函数 ====================

/**
 * 确保插件实例已加载到内存中
 */
async function ensurePluginInstance(source: PluginSource): Promise<PluginInstance | null> {
  const inst = pluginInstances.get(source.id);
  if (inst) {
    pluginInstanceErrors.delete(source.id);
    return inst;
  }

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
      } catch (error) {
        readError = `无法读取插件文件：${String(error)}`;
      }
    }

    if (script) {
      const loadedSource = await loadPluginFromScript(script, source.filePath);
      if (!loadedSource) {
        readError = '插件脚本执行失败或缺少 platform 字段，请查看插件日志';
      }
      // [修复] 直接用 source.id 缓存实例，不依赖 SHA256 hash 匹配
      if (loadedSource) {
        const entry = pluginInstances.get(loadedSource.id);
        if (entry) {
          pluginInstances.set(source.id, entry);
        }
      }
      // 回退: 遍历找到 filePath 匹配的条目
      if (!pluginInstances.has(source.id)) {
        for (const [key, entry] of pluginInstances) {
          if (entry.source.filePath === source.filePath && key !== source.id) {
            pluginInstances.set(source.id, entry);
            break;
          }
        }
      }
    }

    const resolved = pluginInstances.get(source.id) || null;
    if (resolved) pluginInstanceErrors.delete(source.id);
    else pluginInstanceErrors.set(source.id, readError || '插件脚本为空或实例未注册');
    return resolved;
  } catch (e) {
    log(`插件重新加载失败: ${source.name} ${e}`);
    pluginInstanceErrors.set(source.id, `插件初始化异常：${String(e)}`);
    return null;
  }
}

// ==================== 用户变量存储 ====================

// 每个插件的用户变量值独立存储，key 格式: xianyu_plugin_user_vars_<pluginId>
const userVarKey = (pluginId: string) => `xianyu_plugin_user_vars_${pluginId}`;

/** 读取指定插件的用户变量值 */
export function getPluginUserVariableValues(pluginId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(userVarKey(pluginId));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

/** 保存指定插件的用户变量值 */
export function setPluginUserVariableValues(pluginId: string, values: Record<string, string>) {
  try {
    localStorage.setItem(userVarKey(pluginId), JSON.stringify(values));
  } catch { /* ignore */ }
}

/** 删除指定插件的用户变量值（卸载时调用） */
export function removePluginUserVariableValues(pluginId: string) {
  try {
    localStorage.removeItem(userVarKey(pluginId));
  } catch { /* ignore */ }
}

/**
 * 获取插件实例定义的用户变量列表（用于 UI 渲染输入表单）。
 * 需要插件已加载到实例缓存中，否则返回空数组。
 */
export function getPluginUserVariables(pluginId: string): PluginUserVariable[] {
  const inst = pluginInstances.get(pluginId);
  return inst?.instance?.userVariables ?? [];
}

/**
 * 用户变量变更后重新加载插件实例，使新值通过 env.getUserVariables() 生效。
 * 清除缓存后下次 ensurePluginInstance 会重新执行插件脚本。
 */
export function reloadPluginInstance(pluginId: string) {
  pluginInstances.delete(pluginId);
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
  pluginInstances.delete(id);
  removePluginUserVariableValues(id);
  // [修复防御]: LX 插件删除时也要销毁 iframe
  destroyLxPlugin(id);
  bumpPluginsVersion();
}

export function updatePluginSource(id: string, updates: Partial<PluginSource>) {
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

export async function loadBuiltinPlugins(): Promise<void> {
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

    try {
      let script = '';
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
        if (!script) {
          try {
            script = await pluginApi.fetchPluginUrl(source.filePath);
          } catch { /* ignore */ }
        }
      } else {
        try {
          script = await pluginApi.readPluginFile(source.filePath);
        } catch { /* ignore */ }
      }

      if (script) {
        const loadedSource = await loadPluginFromScript(script, source.filePath);
        // [修复] 直接用 source.id 缓存实例
        if (loadedSource) {
          const entry = pluginInstances.get(loadedSource.id);
          if (entry) {
            pluginInstances.set(source.id, entry);
          }
        }
        // 回退: 遍历找到 filePath 匹配的条目
        if (!pluginInstances.has(source.id)) {
          for (const [key, entry] of pluginInstances) {
            if (entry.source.filePath === source.filePath && key !== source.id) {
              pluginInstances.set(source.id, entry);
              break;
            }
          }
        }
      }
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
  addPluginSource,
  removePluginSource,
  updatePluginSource,
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
      updatePluginSource(source.id, {
        enabled: source.enabled,
        sortOrder: source.sortOrder,
        name: source.name,
        version: source.version,
      });
      log(`restorePluginFromSync: 插件已存在, 更新元数据 ${source.name}`);
      return true;
    }

    // 新插件：解析脚本并创建实例
    const loadedSource = await loadPluginFromScript(script, source.filePath);
    if (!loadedSource) {
      log(`restorePluginFromSync: 脚本解析失败 ${source.name}`);
      return false;
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
export const installFromSubscriptionUrl = pluginSubscriptionService.installFromSubscriptionUrl;
export const installAllSubscriptions = pluginSubscriptionService.installAllSubscriptions;
export type { SubscriptionInstallResult };

// ==================== 导出 ====================

export type { IPluginInstance };
