/// <reference lib="webworker" />
/**
 * 插件沙箱 Worker —— 在隔离的 Web Worker 中执行不可信插件代码
 *
 * 安全隔离：
 *   1. 插件代码在 Worker 中执行，无法访问主线程的 DOM、window、Tauri API
 *   2. 所有 HTTP 请求通过 postMessage RPC 代理到主线程，由主线程通过 Tauri 后端发送
 *   3. Cookie/Storage 操作通过 RPC 代理到主线程的 localStorage
 *   4. 插件实例的方法调用通过 RPC 从主线程发起
 *
 * 支持两种插件格式：
 *   - MusicFree: Blob 模块注入 packages（axios, cheerio, crypto-js 等）
 *   - LX (落雪): Blob 模块 + globalThis.lx 事件通信
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import CryptoJs from 'crypto-js';
import dayjs from 'dayjs';
import he from 'he';
import qs from 'qs';
import bigInt from 'big-integer';
import { Buffer } from 'buffer';
import type {
  WorkerCommand,
  WorkerEvent,
  ProxyAction,
  ProxyRequest,
  ProxyResponse,
  HttpProxyResponse,
  LxScriptInfo,
} from './pluginSandboxTypes';

type PluginRuntime = Record<string, any>;

const PLUGIN_RUNTIME_KEY = '__xyMusicPluginRuntime';

function getRuntimeMap(): Map<string, PluginRuntime> {
  const g = globalThis as any;
  if (!g[PLUGIN_RUNTIME_KEY]) {
    g[PLUGIN_RUNTIME_KEY] = new Map<string, PluginRuntime>();
  }
  return g[PLUGIN_RUNTIME_KEY];
}

async function importBlobModule(source: string, label: string): Promise<any> {
  const blob = new Blob([source], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    return await import(/* @vite-ignore */ url);
  } catch (error: any) {
    throw new Error(`${label}: ${error?.message || String(error)}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ==================== 日志 ====================

function log(level: 'log' | 'warn' | 'error', msg: string) {
  const event: WorkerEvent = { type: 'log', level, message: `[SandboxWorker] ${msg}` };
  (self as any).postMessage(event);
}

// ==================== RPC 通信层 ====================

let _rpcIdCounter = 0;
const _pendingRpc = new Map<number, {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

function nextRpcId(): number {
  _rpcIdCounter = (_rpcIdCounter + 1) % 0x7fffffff;
  return _rpcIdCounter;
}

function sendToMain<T>(action: ProxyAction, payload: Record<string, any>, timeout = 30000): Promise<T> {
  const id = nextRpcId();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      _pendingRpc.delete(id);
      reject(new Error(`RPC 超时: ${action} (${timeout}ms)`));
    }, timeout);
    _pendingRpc.set(id, { resolve, reject, timeout: timer });

    const request: ProxyRequest = { __rpc: true, id, action, payload };
    const event: WorkerEvent = { type: 'proxy_request', request };
    (self as any).postMessage(event);
  });
}

function handleProxyResponse(response: ProxyResponse): void {
  const pending = _pendingRpc.get(response.id);
  if (!pending) return;
  clearTimeout(pending.timeout);
  _pendingRpc.delete(response.id);
  if (response.ok) {
    pending.resolve(response.data);
  } else {
    pending.reject(new Error(response.error || 'Proxy request failed'));
  }
}

// ==================== 代理 HTTP 请求 ====================

async function proxyHttpRequest(
  method: string,
  url: string,
  headers?: Record<string, string>,
  body?: string,
  timeout?: number,
  follow?: number,
): Promise<HttpProxyResponse> {
  return sendToMain<HttpProxyResponse>('http_request', { method, url, headers, body, timeout, follow });
}

// ==================== 代理 Cookie 操作 ====================

const proxyCookies = {
  async set(url: string, cookie: { name: string; value: string; domain?: string }): Promise<boolean> {
    return sendToMain<boolean>('cookie_set', { url, cookie });
  },
  async get(url: string): Promise<Record<string, any>> {
    return sendToMain<Record<string, any>>('cookie_get', { url });
  },
  async flush(): Promise<void> {
    return sendToMain<void>('cookie_flush', {});
  },
};

/** 获取 URL 匹配的 Cookie 字符串（供 axios adapter 使用） */
async function getCookiesForUrl(url: string): Promise<string> {
  try {
    const cookies = await proxyCookies.get(url);
    return Object.entries(cookies)
      .map(([name, info]: [string, any]) => `${name}=${info.value}`)
      .join('; ');
  } catch {
    return '';
  }
}

/** 从响应头捕获 Cookie（供 axios adapter 使用） */
async function captureCookies(url: string, headers: Record<string, string>): Promise<void> {
  try {
    const setCookie = headers['set-cookie'] || headers['Set-Cookie'];
    if (!setCookie) return;
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const c of cookies) {
      const parts = c.split(';')[0].split('=');
      if (parts.length >= 2) {
        await proxyCookies.set(url, {
          name: parts[0].trim(),
          value: parts.slice(1).join('=').trim(),
        });
      }
    }
  } catch { /* ignore */ }
}

// ==================== 代理 Storage 操作 ====================

const proxyStorage = {
  async setItem(key: string, value: unknown): Promise<void> {
    return sendToMain<void>('storage_set', { key, value });
  },
  async getItem(key: string): Promise<string | null> {
    return sendToMain<string | null>('storage_get', { key });
  },
  async removeItem(key: string): Promise<void> {
    return sendToMain<void>('storage_remove', { key });
  },
};

// ==================== 代理 Fetch ====================

async function proxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let urlStr: string;
  if (typeof input === 'string') {
    urlStr = input;
  } else if (input instanceof URL) {
    urlStr = input.toString();
  } else if (typeof Request !== 'undefined' && input instanceof Request) {
    urlStr = input.url;
  } else {
    urlStr = String(input);
  }

  if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
    // Worker 内部本地资源走原生 fetch
    return fetch(input as any, init);
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
  if (init?.body !== undefined && init?.body !== null) {
    body = typeof init.body === 'string' ? init.body : String(init.body);
  }

  // 注入 Cookie
  const cookieStr = await getCookiesForUrl(urlStr);
  if (cookieStr && !headers['Cookie'] && !headers['cookie']) {
    headers['Cookie'] = cookieStr;
  }

  const response = await proxyHttpRequest(method, urlStr, headers, body);

  // 捕获 Set-Cookie
  if (response.headers) {
    await captureCookies(urlStr, response.headers);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.status >= 200 && response.status < 300 ? 'OK' : 'Error',
    headers: new Headers(response.headers),
  });
}

// ==================== MusicFree 包注入 ====================

function unwrapMod(mod: any, checkProp?: string): any {
  if (!mod) return mod;
  if (checkProp && mod[checkProp]) return mod;
  if (mod.default && mod.default !== mod) {
    if (!checkProp || mod.default[checkProp] || typeof mod.default === 'function') {
      return mod.default;
    }
  }
  return mod;
}

// 代理 axios adapter —— 所有 HTTP 请求通过 RPC 代理到主线程
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
        body = body.substring(0, 256 * 1024);
      }
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    if (!url || !url.startsWith('http')) {
      throw new Error(`Invalid URL: ${url || '(empty)'}`);
    }

    // 注入 Cookie
    const cookieStr = await getCookiesForUrl(url);
    if (cookieStr && !headers['Cookie'] && !headers['cookie']) {
      headers['Cookie'] = cookieStr;
    }

    const response = await proxyHttpRequest(method, url, headers, body);

    // 捕获 Set-Cookie
    if (response.headers) {
      await captureCookies(url, response.headers);
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
    const errMsg = e?.message || (typeof e === 'string' ? e : 'Request failed');
    const error: any = new Error(errMsg);
    error.config = config;
    throw error;
  }
}

const proxyAxios = axios.create({ adapter: tauriAdapter as any });
proxyAxios.defaults.timeout = 15000;

const _originalCreate = proxyAxios.create.bind(proxyAxios);
proxyAxios.create = (config?: any) => {
  const inst = _originalCreate(config);
  inst.defaults.adapter = tauriAdapter as any;
  inst.defaults.timeout = 15000;
  inst.create = proxyAxios.create;
  return inst;
};

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
    set: async (url: string, cookie: any) => proxyCookies.set(url, cookie),
    get: async (url: string) => proxyCookies.get(url),
    flush: async () => proxyCookies.flush(),
  },
  'musicfree/storage': {
    setItem: async (key: string, value: unknown) => proxyStorage.setItem(key, value),
    getItem: async (key: string) => proxyStorage.getItem(key),
    removeItem: async (key: string) => proxyStorage.removeItem(key),
  },
};

const _require = (packageName: string) => {
  const pkg = packages[packageName];
  if (pkg) {
    try { pkg.default = pkg; } catch {}
    return pkg;
  }
  return null;
};

// ==================== MusicFree 插件执行 ====================

interface MusicFreeInstance {
  platform: string;
  version?: string;
  appVersion?: string;
  author?: string;
  description?: string;
  srcUrl?: string;
  primaryKey?: string[];
  cacheControl?: string;
  supportedSearchType?: string[];
  defaultSearchType?: string;
  userVariables?: any[];
  hints?: Record<string, string[]>;
  /** Baka 系列特有：12 档音质声明 */
  supportedQualities?: string[];
  search?: (query: string, page: number, type: string) => Promise<any>;
  getMediaSource?: (musicItem: any, quality: string) => Promise<any>;
  getMusicInfo?: (musicBase: any) => Promise<any>;
  getLyric?: (musicItem: any) => Promise<any>;
  getAlbumInfo?: (albumItem: any, page: number) => Promise<any>;
  getArtistWorks?: (artistItem: any, page: number, type: string) => Promise<any>;
  getArtistInfo?: (artistItem: any) => Promise<any>;
  getTopLists?: () => Promise<any>;
  getTopListDetail?: (topListItem: any, page: number) => Promise<any>;
  importMusicSheet?: (urlLike: string) => Promise<any>;
  importMusicItem?: (urlLike: string) => Promise<any>;
  getMusicSheetInfo?: (sheetItem: any, page: number) => Promise<any>;
  getRecommendSheetTags?: () => Promise<any>;
  getRecommendSheetsByTag?: (tagItem: any, page?: number) => Promise<any>;
  /** Baka 扩展：获取歌曲评论 */
  getMusicComments?: (musicItem: any, page?: number) => Promise<any>;
  /** Baka 扩展：获取歌曲详情页 URL */
  getMusicDetailPageUrl?: (musicItem: any) => Promise<any>;
}

// 存储已加载的插件实例
const _musicfreeInstances = new Map<string, MusicFreeInstance>();

// 存储每个插件的可变用户变量（每次方法调用前由主线程刷新）
// 解决 env.getUserVariables() 需要同步返回最新值的问题
const _musicfreeUserVars = new Map<string, Record<string, string>>();

async function loadMusicFreePlugin(
  pluginId: string,
  script: string,
  userVariables: Record<string, string>,
): Promise<{ success: boolean; instance?: any; error?: string }> {
  try {
    if (script.trim().length === 0) {
      throw new Error('插件内容为空');
    }

    const _module: any = { exports: {} };
    let _instance: MusicFreeInstance;

    // 存储初始用户变量到可变 Map（后续方法调用时会由主线程刷新）
    _musicfreeUserVars.set(pluginId, { ...userVariables });

    const env = {
      getUserVariables: () => _musicfreeUserVars.get(pluginId) || {},
      get userVariables() { return _musicfreeUserVars.get(pluginId) || {}; },
      os: 'win32',
      appVersion: '1.0.0',
      lang: 'zh-CN',
    };
    const _process = {
      platform: 'win32',
      version: '1.0.0',
      env,
      ensurePluginInitialized: Promise.resolve(),
    };

    const runtimeId = `musicfree:${pluginId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    getRuntimeMap().set(runtimeId, {
      require: _require,
      module: _module,
      console: {
        log: (...args: any[]) => log('log', args.map(a => typeof a === 'object' ? JSON.stringify(a)?.substring(0, 200) : String(a)).join(' ')),
        warn: (...args: any[]) => log('warn', args.map(a => typeof a === 'object' ? JSON.stringify(a)?.substring(0, 200) : String(a)).join(' ')),
        error: (...args: any[]) => log('error', args.map(a => typeof a === 'object' ? JSON.stringify(a)?.substring(0, 200) : String(a)).join(' ')),
        debug: () => {},
        info: (...args: any[]) => log('log', args.map(a => typeof a === 'object' ? JSON.stringify(a)?.substring(0, 200) : String(a)).join(' ')),
      },
      env,
      process: _process,
      fetch: proxyFetch,
    });

    const moduleSource = `
      'use strict';
      const runtime = globalThis.${PLUGIN_RUNTIME_KEY}.get(${JSON.stringify(runtimeId)});
      if (!runtime) throw new Error('插件运行时上下文不存在');
      const require = runtime.require;
      const __musicfree_require = runtime.require;
      const module = runtime.module;
      const exports = module.exports;
      const console = runtime.console;
      const env = runtime.env;
      const process = runtime.process;
      const fetch = runtime.fetch;
      const URL = globalThis.URL;
      ${script}
      export default module.exports;
    `;

    try {
      const loadedModule = await importBlobModule(moduleSource, `MusicFree 插件加载失败(${pluginId})`);
      if (loadedModule.default !== _module.exports) {
        _module.exports = loadedModule.default;
      }
    } finally {
      getRuntimeMap().delete(runtimeId);
    }

    if (_module.exports?.default) {
      _instance = _module.exports.default;
    } else {
      _instance = _module.exports;
    }

    _musicfreeInstances.set(pluginId, _instance);

    // 返回可序列化的元数据（函数不能跨 Worker 边界传递）
    // _availableMethods: 插件实例实际实现的方法名列表，供主线程代理精确创建函数桩
    // supportedQualities: Baka/Toskysun 系列插件声明的 12 档音质列表
    const allMethodNames = [
      'search', 'getMediaSource', 'getMusicInfo', 'getLyric',
      'getAlbumInfo', 'getArtistWorks', 'getTopLists', 'getTopListDetail',
      'importMusicSheet', 'importMusicItem', 'getMusicSheetInfo',
      'getRecommendSheetTags', 'getRecommendSheetsByTag',
      'getArtistInfo', 'getMusicComments', 'getMusicDetailPageUrl',
    ];
    const _availableMethods = allMethodNames.filter(m => typeof (_instance as any)[m] === 'function');
    return {
      success: true,
      instance: {
        platform: _instance.platform,
        version: _instance.version,
        appVersion: (_instance as any).appVersion,
        author: _instance.author,
        description: _instance.description,
        srcUrl: (_instance as any).srcUrl,
        primaryKey: (_instance as any).primaryKey,
        cacheControl: (_instance as any).cacheControl,
        supportedSearchType: _instance.supportedSearchType,
        defaultSearchType: _instance.defaultSearchType,
        userVariables: _instance.userVariables,
        hints: (_instance as any).hints,
        supportedQualities: (_instance as any).supportedQualities,
        _availableMethods,
      },
    };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

async function callMusicFreeMethod(
  pluginId: string,
  method: string,
  args: any[],
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const instance = _musicfreeInstances.get(pluginId);
    if (!instance) {
      return { success: false, error: `插件实例不存在: ${pluginId}` };
    }
    const fn = (instance as any)[method];
    if (typeof fn !== 'function') {
      return { success: false, error: `方法不存在: ${method}` };
    }
    const result = await fn.apply(instance, args);
    return { success: true, data: result };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

// ==================== LX 插件执行 ====================

interface LxPluginWorkerState {
  initInfo: any | null;
  requestHandler: ((data: any) => any) | null;
  status: 'loading' | 'ready' | 'error';
}

const _lxStates = new Map<string, LxPluginWorkerState>();

type LxRequestAction = 'musicUrl' | 'lyric' | 'pic';

const LX_SOURCE_KEYS = ['kw', 'kg', 'tx', 'wy', 'mg', 'xm', 'local'] as const;
const LX_MUSIC_ACTIONS: LxRequestAction[] = ['musicUrl', 'lyric', 'pic'];
const LX_STANDARD_QUALITIES = ['128k', '320k', 'flac', 'flac24bit'];
const LX_SUPPORT_QUALITIES: Record<string, string[]> = {
  kw: LX_STANDARD_QUALITIES,
  kg: LX_STANDARD_QUALITIES,
  tx: LX_STANDARD_QUALITIES,
  wy: LX_STANDARD_QUALITIES,
  mg: LX_STANDARD_QUALITIES,
  xm: LX_STANDARD_QUALITIES,
  local: [],
};

function normalizeLxSourceInfo(info: any): any {
  const sourceInfo: any = { sources: {} };
  if (!info?.sources || typeof info.sources !== 'object') return sourceInfo;

  for (const source of LX_SOURCE_KEYS) {
    const userSource = info.sources[source];
    if (!userSource || userSource.type !== 'music') continue;
    const declaredActions = Array.isArray(userSource.actions) ? userSource.actions : [];
    const declaredQualitys = Array.isArray(userSource.qualitys) ? userSource.qualitys : [];
    const qualitys = LX_SUPPORT_QUALITIES[source] || [];
    sourceInfo.sources[source] = {
      name: typeof userSource.name === 'string' ? userSource.name : undefined,
      type: 'music',
      actions: LX_MUSIC_ACTIONS.filter(action => declaredActions.includes(action)),
      qualitys: qualitys.length ? qualitys.filter(q => declaredQualitys.includes(q)) : declaredQualitys.filter((q: unknown) => typeof q === 'string'),
    };
  }

  for (const key of Object.keys(info.sources)) {
    if (sourceInfo.sources[key]) continue;
    const val = info.sources[key];
    if (!val || val.type !== 'music') continue;
    const declaredActions = Array.isArray(val.actions) ? val.actions : [];
    const declaredQualitys = Array.isArray(val.qualitys) ? val.qualitys : [];
    sourceInfo.sources[key] = {
      name: typeof val.name === 'string' ? val.name : undefined,
      type: 'music',
      actions: LX_MUSIC_ACTIONS.filter(action => declaredActions.includes(action)),
      qualitys: declaredQualitys.filter((q: unknown) => typeof q === 'string'),
    };
  }

  return sourceInfo;
}

async function loadLxPlugin(
  pluginId: string,
  script: string,
  scriptInfo: LxScriptInfo,
): Promise<{ success: boolean; initInfo?: any; error?: string }> {
  const INIT_TIMEOUT = 15000;

  const state: LxPluginWorkerState = {
    initInfo: null,
    requestHandler: null,
    status: 'loading',
  };

  let initResolve: ((info: any) => void) | null = null;
  let initReject: ((err: Error) => void) | null = null;
  const initPromise = new Promise<any>((resolve, reject) => {
    initResolve = resolve;
    initReject = reject;
  });

  let isInitedApi = false;
  const EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' };
  const eventNames = Object.values(EVENT_NAMES);

  const handleInit = (info: any) => {
    if (!info) {
      initReject!(new Error('Missing required parameter init info'));
      return;
    }
    try {
      const sourceInfo = normalizeLxSourceInfo(info);
      log('log', `插件初始化成功, sources: ${Object.keys(sourceInfo.sources).join(',')}`);
      initResolve!(sourceInfo);
    } catch (error: any) {
      initReject!(new Error(error.message));
      return;
    }
  };

  // HTTP 请求（通过 RPC 代理到主线程）
  const lxNativeRequest = async (
    method: string, url: string, headers: Record<string, string>, body: string | undefined,
    timeout?: number | null,
    follow?: number | null,
  ): Promise<{ statusCode: number; statusMessage: string; headers: Record<string, string>; body: string }> => {
    const response = await proxyHttpRequest(method, url, headers, body, timeout ?? undefined, follow ?? undefined);

    // 捕获 Cookie
    if (response.headers) {
      await captureCookies(url, response.headers);
    }

    return {
      statusCode: response.status,
      statusMessage: response.status >= 200 && response.status < 300 ? 'OK' : 'Error',
      headers: response.headers,
      body: response.body,
    };
  };

  // 创建 globalThis.lx 对象
  const lxApi = {
    EVENT_NAMES,
    request(url: string, options: any, callback: (err: unknown, response: unknown, body: unknown) => void) {
      const method = (options?.method || 'get').toLowerCase();
      log('log', `HTTP 请求: ${method} ${url}`);

      let bodyStr: string = '';
      const reqHeaders: Record<string, string> = { ...(options?.headers || {}) };
      if (options?.body != null) {
        if (typeof options.body === 'string') {
          bodyStr = options.body;
        } else if (typeof options.body === 'object') {
          bodyStr = JSON.stringify(options.body);
          if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) reqHeaders['Content-Type'] = 'application/json';
        }
      } else if (options?.form != null) {
        if (typeof options.form === 'string') {
          bodyStr = options.form;
        } else if (typeof options.form === 'object') {
          bodyStr = Object.entries(options.form)
            .filter(([, v]) => v != null)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join('&');
        }
        if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      } else if (options?.formData != null) {
        if (typeof options.formData === 'string') {
          bodyStr = options.formData;
        } else if (typeof options.formData === 'object') {
          bodyStr = Object.entries(options.formData)
            .filter(([, v]) => v != null)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join('&');
        }
        if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      }

      lxNativeRequest(method, url, reqHeaders, bodyStr, options?.timeout, options?.follow).then((response) => {
        try {
          let body: any = response.body;
          try { body = JSON.parse(response.body); } catch { /* 保持原始字符串 */ }
          callback(null, {
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            headers: response.headers,
            bytes: response.body.length,
            raw: response.body,
            body,
          }, body);
        } catch (err: any) {
          if (!isInitedApi) {
            log('error', `request 回调异常: ${err?.message}`);
            initReject!(new Error(err?.message || 'request callback error'));
          }
        }
      }).catch((err) => {
        try { callback(err, null, null); } catch { /* ignore */ }
      });
      return () => { /* cancel noop */ };
    },
    send(eventName: string, data: any) {
      return new Promise((resolve, reject) => {
        if (!eventNames.includes(eventName)) return reject(new Error('The event is not supported: ' + eventName));
        switch (eventName) {
          case EVENT_NAMES.inited:
            if (isInitedApi) return reject(new Error('Script is inited'));
            isInitedApi = true;
            handleInit(data);
            resolve(undefined);
            break;
          case EVENT_NAMES.updateAlert:
            log('log', 'updateAlert ignored');
            resolve(undefined);
            break;
          default:
            reject(new Error('Unknown event name: ' + eventName));
        }
      });
    },
    on(eventName: string, handler: (data: any) => any) {
      if (!eventNames.includes(eventName)) return Promise.reject(new Error('The event is not supported: ' + eventName));
      if (eventName === EVENT_NAMES.request) {
        state.requestHandler = handler as any;
      }
      return Promise.resolve();
    },
    utils: {
      crypto: {
        aesEncrypt(buffer: any, mode: string, key: any, iv: any) {
          const encrypted = CryptoJs.AES.encrypt(buffer, key, { iv, mode: (CryptoJs as any)[mode] });
          return Buffer.from(encrypted.toString(), 'base64');
        },
        rsaEncrypt(buffer: any, _key: string) {
          return buffer;
        },
        randomBytes(size: number) {
          const arr = new Uint8Array(size);
          crypto.getRandomValues(arr);
          return Buffer.from(arr);
        },
        md5(str: string) {
          return CryptoJs.MD5(str).toString();
        },
      },
      buffer: {
        from(...args: any[]) { return Buffer.from(...(args as [any, any])); },
        bufToString(buf: any, format: string) { return Buffer.from(buf, 'binary').toString(format as any); },
      },
      zlib: {
        async inflate(buf: any) {
          try {
            const data = buf instanceof Uint8Array ? buf : Buffer.from(buf);
            const ds = new DecompressionStream('deflate');
            const writer = ds.writable.getWriter();
            writer.write(data).catch(() => {});
            writer.close().catch(() => {});
            const reader = ds.readable.getReader();
            const chunks: Uint8Array[] = [];
            while (true) {
              const { done, value } = await reader.read();
              if (value) chunks.push(value);
              if (done) break;
            }
            reader.releaseLock();
            const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
            const result = new Uint8Array(totalLen);
            let offset = 0;
            for (const c of chunks) { result.set(c, offset); offset += c.length; }
            return Buffer.from(result);
          } catch (e) {
            log('warn', `zlib.inflate 解压失败: ${e}`);
            return buf;
          }
        },
        async deflate(data: any) {
          try {
            const src = data instanceof Uint8Array ? data : Buffer.from(data);
            const cs = new CompressionStream('deflate');
            const writer = cs.writable.getWriter();
            writer.write(src).catch(() => {});
            writer.close().catch(() => {});
            const reader = cs.readable.getReader();
            const chunks: Uint8Array[] = [];
            while (true) {
              const { done, value } = await reader.read();
              if (value) chunks.push(value);
              if (done) break;
            }
            reader.releaseLock();
            const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
            const result = new Uint8Array(totalLen);
            let offset = 0;
            for (const c of chunks) { result.set(c, offset); offset += c.length; }
            return Buffer.from(result);
          } catch (e) {
            log('warn', `zlib.deflate 压缩失败: ${e}`);
            return data;
          }
        },
      },
    },
    currentScriptInfo: {
      name: scriptInfo.name,
      description: scriptInfo.description,
      version: scriptInfo.version,
      author: scriptInfo.author,
      homepage: scriptInfo.homepage,
      rawScript: script,
    },
    version: '2.0.0',
    env: 'desktop',
  };

  // 设置 globalThis.lx
  (globalThis as any).lx = lxApi;

  // 通过 Blob 模块执行插件脚本，避免依赖 CSP 字符串求值能力。
  const runtimeId = `lx:${pluginId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  getRuntimeMap().set(runtimeId, {
    lx: lxApi,
    Buffer,
    CryptoJs,
  });

  try {
    const moduleSource = `
      'use strict';
      const runtime = globalThis.${PLUGIN_RUNTIME_KEY}.get(${JSON.stringify(runtimeId)});
      if (!runtime) throw new Error('LX 插件运行时上下文不存在');
      const lx = runtime.lx;
      const Buffer = runtime.Buffer;
      const CryptoJs = runtime.CryptoJs;
      const CryptoJS = runtime.CryptoJs;
      const window = globalThis;
      const self = globalThis;
      const global = globalThis;
      ${script}
      export {};
    `;
    await importBlobModule(moduleSource, `LX 插件加载失败(${pluginId})`);
    log('log', '脚本模块加载完成(无同步异常)');
  } catch (e: any) {
    log('error', `脚本模块加载异常: ${e?.message}`);
    if (!isInitedApi) {
      return { success: false, error: e?.message || 'module import error' };
    }
  } finally {
    getRuntimeMap().delete(runtimeId);
  }

  // 等待初始化
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`插件初始化超时(${INIT_TIMEOUT / 1000}s)`)), INIT_TIMEOUT),
  );

  try {
    const initInfo = await Promise.race([initPromise, timeoutPromise]);
    state.initInfo = initInfo;
    state.status = 'ready';
    _lxStates.set(pluginId, state);
    return { success: true, initInfo };
  } catch (e: any) {
    state.status = 'error';
    log('error', `插件初始化失败: ${e?.message}`);
    return { success: false, error: e?.message || '初始化失败' };
  }
}

async function callLxMethod(
  pluginId: string,
  method: string,
  args: any[],
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const state = _lxStates.get(pluginId);
    if (!state || state.status !== 'ready') {
      return { success: false, error: `LX 插件未就绪: ${pluginId}` };
    }
    if (method === 'request') {
      // 调用 requestHandler
      if (!state.requestHandler) {
        return { success: false, error: 'LX 插件未注册 request 处理器' };
      }
      const result = await state.requestHandler(args[0]);
      return { success: true, data: result };
    }
    return { success: false, error: `未知的 LX 方法: ${method}` };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

// ==================== 插件销毁 ====================

function destroyPlugin(pluginId: string): void {
  _musicfreeInstances.delete(pluginId);
  _musicfreeUserVars.delete(pluginId);
  _lxStates.delete(pluginId);
  // 清理 globalThis.lx（LX 插件共享）
  if ((globalThis as any).lx) {
    (globalThis as any).lx = undefined;
  }
  log('log', `插件已销毁: ${pluginId}`);
}

// ==================== Worker 消息处理 ====================

(self as any).onmessage = async (e: MessageEvent) => {
  const cmd = e.data as WorkerCommand;

  try {
    switch (cmd.type) {
      case 'load_musicfree': {
        log('log', `加载 MusicFree 插件: ${cmd.pluginId}`);
        const result = await loadMusicFreePlugin(cmd.pluginId, cmd.script, cmd.userVariables);
        const event: WorkerEvent = {
          type: 'loaded',
          pluginId: cmd.pluginId,
          success: result.success,
          instance: result.instance,
          error: result.error,
        };
        (self as any).postMessage(event);
        break;
      }

      case 'load_lx': {
        log('log', `加载 LX 插件: ${cmd.pluginId}`);
        const result = await loadLxPlugin(cmd.pluginId, cmd.script, cmd.scriptInfo);
        const event: WorkerEvent = {
          type: 'loaded',
          pluginId: cmd.pluginId,
          success: result.success,
          instance: result.initInfo,
          error: result.error,
        };
        (self as any).postMessage(event);
        break;
      }

      case 'call_method': {
        const callId = cmd.callId || 0;

        // 方法调用前刷新用户变量（如卡密），确保 env.getUserVariables() 返回最新值
        if (cmd.userVars && _musicfreeInstances.has(cmd.pluginId)) {
          _musicfreeUserVars.set(cmd.pluginId, { ...cmd.userVars });
        }

        const state = _lxStates.get(cmd.pluginId);
        const result = state
          ? await callLxMethod(cmd.pluginId, cmd.method, cmd.args)
          : await callMusicFreeMethod(cmd.pluginId, cmd.method, cmd.args);

        const event: WorkerEvent = {
          type: 'method_result',
          pluginId: cmd.pluginId,
          callId,
          success: result.success,
          data: result.data,
          error: result.error,
        };
        (self as any).postMessage(event);
        break;
      }

      case 'destroy': {
        destroyPlugin(cmd.pluginId);
        break;
      }

      case 'proxy_response': {
        handleProxyResponse(cmd.response);
        break;
      }

      default: {
        log('warn', `未知命令: ${(cmd as any).type}`);
      }
    }
  } catch (err: any) {
    log('error', `命令处理异常: ${err?.message || err}`);
    const event: WorkerEvent = {
      type: 'error',
      pluginId: (cmd as any).pluginId || 'unknown',
      message: err?.message || String(err),
    };
    (self as any).postMessage(event);
  }
};

// 通知主线程 Worker 已就绪
log('log', '插件沙箱 Worker 已启动');
