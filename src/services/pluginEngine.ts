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
import { invoke } from '@tauri-apps/api/core';
import type {
  PluginSource,
  PluginSearchResult,
  PluginMusicInfo,
} from '../types';
import { isLxPluginScript, loadLxPluginFromScript, initLxPlugin, destroyLxPlugin, parseLxScriptInfo } from './lxPluginEngine';

// ==================== 常量 ====================

const PLUGIN_SOURCES_KEY = 'lycia_plugin_sources_v4';
const PLUGIN_SOURCES_KEY_LEGACY = 'lycia_plugin_sources_v3';
const MAX_PLUGIN_SIZE = 2 * 1024 * 1024;

// 内置插件定义：已取消所有内置插件，此映射保留为空用于清理旧版本遗留的内置插件条目
const BUILTIN_PLUGINS: Record<string, string> = {};

// 不需要卡密的内置插件路径集合（已无内置插件，保留空集合兼容导出）
export const FREE_BUILTIN_PATHS = new Set<string>();

// ==================== 日志 ====================

let _logCallback: ((msg: string) => void) | null = null;

function log(msg: string) {
  console.log(`[PluginEngine] ${msg}`);
  // [DEBUG]: 把日志发送到 Rust 后端，输出到终端
  try { if (typeof (window as any).__TAURI_INTERNALS__ !== 'undefined') invoke('debug_log', { message: `[PluginEngine] ${msg}` }).catch(() => {}); } catch { /* ignore */ }
  try { _logCallback?.(msg); } catch { /* ignore */ }
}

export function setLogCallback(cb: ((msg: string) => void) | null) {
  _logCallback = cb;
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
    const { pluginApi } = await import('./tauri/pluginApi');
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

    const { pluginApi } = await import('./tauri/pluginApi');
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
  userVariables?: any[];
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

// ==================== resetMediaItem（与 MusicFree mediaUtils.ts 完全一致）====================

/**
 * 去除 HTML 标签 —— 部分插件（如酷我）搜索结果中歌手/专辑名带有 <em> 等高亮标签
 */
function stripHtmlTags(str: unknown): string {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '');
}

/**
 * 提取封面 URL —— 兼容各插件（网易云等）不同的字段命名
 */
function extractCoverUrl(item: any): string {
  let url = item.artwork || item.cover || item.pic || item.img || item.albumPic || item.picture || '';
  // 网易云歌曲：al.picUrl / album.picUrl
  if (!url && item.al?.picUrl) url = item.al.picUrl;
  if (!url && item.album?.picUrl) url = item.album.picUrl;
  if (!url && item.album?.blurPicUrl) url = item.album.blurPicUrl;
  // 网易云歌单：coverImgUrl / picUrl
  if (!url && item.coverImgUrl) url = item.coverImgUrl;
  if (!url && item.picUrl) url = item.picUrl;
  // HTTP → HTTPS 升级（网易云 p1.music.126.net 等图片不支持 HTTP）
  if (url && url.startsWith('http://')) {
    url = url.replace('http://', 'https://');
  }
  return url;
}

/**
 * 重置媒体项 —— 与 MusicFree resetMediaItem() 完全一致
 *
 * 核心作用：确保每个搜索结果/播放项都有正确的 platform 字段
 * MusicFree 中搜索结果每个 item 都会调用 resetMediaItem(_, pluginName)
 * getMediaSource/getLyric 等方法传入的也是 resetMediaItem 后的对象
 *
 * 关键逻辑：
 *   1. 保留插件返回的所有原始字段（id, title, artist, artwork 等）
 *   2. 设置 platform = pluginName（确保能通过 platform 找到对应插件）
 *   3. 保留插件自定义的字段（如 songId, musicId 等）
 */
function resetMediaItem(mediaItem: any, pluginName: string): any {
  if (!mediaItem) return mediaItem;
  return {
    ...mediaItem,
    platform: pluginName,
  };
}

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
      getUserVariables: () => ({}),
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

    // 与 MusicFree 第1006~1007行一致：hash = sha256(funcCode)
    const hash = CryptoJs.SHA256(script).toString();

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
export async function pluginSearch(
  source: PluginSource,
  keyword: string,
  page: number,
  _limit: number,
): Promise<PluginSearchResult[]> {
  log(`[pluginSearch] 开始: ${source.name}, keyword="${keyword}", page=${page}`);
  const inst = await ensurePluginInstance(source);
  if (!inst) {
    log(`[pluginSearch] 实例为 null: ${source.name}`);
    return [];
  }
  log(`[pluginSearch] 实例就绪: ${source.name}, search=${typeof inst.instance.search}`);

  try {
    if (typeof inst.instance.search !== 'function') {
      log(`[${source.name}] 无 search 函数`);
      return [];
    }

    // 与 MusicFree useSearch.ts 第52~53行一致
    const searchType = inst.instance.defaultSearchType
      ?? inst.instance.supportedSearchType?.[0]
      ?? 'music';
    log(`[pluginSearch] ${source.name} searchType=${searchType}, 开始调用 search()`);

    // 与 MusicFree PluginMethodsWrapper.search() 第175~176行一致
    const result = (await inst.instance.search(keyword, page, searchType)) ?? {};
    log(`[pluginSearch] ${source.name} search 返回: type=${typeof result}, keys=${result ? Object.keys(result).join(',') : 'null'}, dataIsArray=${Array.isArray(result?.data)}, dataLen=${result?.data?.length ?? 0}`);

    // 与 MusicFree PluginMethodsWrapper.search() 第177~189行一致
    if (Array.isArray(result.data)) {
      // 关键：每个 item 都调用 resetMediaItem，与 MusicFree 完全一致
      result.data.forEach((_: any) => {
        resetMediaItem(_, source.name);
      });

      // 将 resetMediaItem 后的对象转为 PluginSearchResult
      return result.data.map((item: any) => toPluginSearchResult(item, source));
    }
    return [];
  } catch (e: any) {
    // [修复防御]: 完整序列化错误信息，方便调试
    const errMsg = e?.message || (typeof e === 'string' ? e : '') || 'Unknown error';
    log(`[${source.name}] 搜索失败: ${errMsg}`);
    return [];
  }
}

// ==================== 插件歌单搜索 ====================

export async function pluginPlaylistSearch(
  source: PluginSource,
  keyword: string,
  page: number,
): Promise<import('../types').PluginPlaylistSearchResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.search !== 'function') return [];

    // 检查插件是否支持歌单搜索
    const supported = inst.instance.supportedSearchType ?? [];
    if (!supported.includes('sheet')) return [];

    const result = (await inst.instance.search(keyword, page, 'sheet')) ?? {};
    if (!Array.isArray(result.data)) return [];

    return result.data.map((item: any) => {
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
    if (typeof inst.instance.getMusicSheetInfo !== 'function') return [];

    const result = await inst.instance.getMusicSheetInfo(sheetItem, page);
    const list = extractResultList(result);
    if (list.length === 0) return [];

    list.forEach((_: any) => { resetMediaItem(_, source.name); });
    return list.map((item: any) => toPluginSearchResult(item, source));
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
    if (typeof inst.instance.getArtistWorks !== 'function') return [];

    const result = await inst.instance.getArtistWorks(artistItem, page, 'music');
    const list = extractResultList(result);
    if (list.length === 0) return [];

    list.forEach((_: any) => { resetMediaItem(_, source.name); });
    return list.map((item: any) => toPluginSearchResult(item, source));
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
    if (typeof inst.instance.getAlbumInfo !== 'function') return [];

    const result = await inst.instance.getAlbumInfo(albumItem, page);
    const list = extractResultList(result);
    if (list.length === 0) return [];

    list.forEach((_: any) => { resetMediaItem(_, source.name); });
    return list.map((item: any) => toPluginSearchResult(item, source));
  } catch (e: any) {
    log(`[${source.name}] 获取专辑详情失败: ${e?.message}`);
    return [];
  }
}

// ==================== 歌单导入 ====================

/**
 * URL 预处理：从各种格式的分享链接中提取歌单 ID
 *
 * 各平台插件的 importMusicSheet 正则有局限性，不能匹配所有 URL 格式：
 *   - 网易云: 只匹配 y.music.163.com/m/playlist?id= ，不匹配 music.163.com/m/playlist?id=
 *   - QQ: 只匹配 i.y.qq.com/n2/m/share/details/taoge.html?id= ，不匹配新版 i2.y.qq.com/n3/...
 *   - 酷我: 正则有 typo (www/ 而非 www.)，且不匹配 m.kuwo.cn/newh5app/playlist/
 *   - 酷狗: 正则 ^(.*?)(\d+)(.*?)$ 提取第一个数字序列，对 gcid_xxx 会截断为首个数字
 *
 * 所有插件的 importMusicSheet 都支持 ^\d+$ 纯数字格式。
 * 修复方案：从 URL 中提取歌单 ID，以纯数字形式传给插件。
 */
async function normalizeImportUrl(source: PluginSource, urlLike: string): Promise<string> {
  const url = urlLike.trim();

  // 纯数字直接返回（所有插件都支持）
  if (/^\d+$/.test(url)) return url;

  // 尝试解析为 URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return url; // 不是合法 URL，原样返回让插件自行处理
  }

  const platform = source.name;

  // ---- 网易云音乐 ----
  // 插件正则: y.music.163.com/m/playlist?id= 或 music.163.com/playlist/id/ 或 music.163.com/#/playlist?id=
  // 不匹配: music.163.com/m/playlist?id= (缺少 y. 前缀)
  // 修复: 提取 id 查询参数
  if (platform.includes('网易云') || parsedUrl.hostname.includes('music.163.com')) {
    const id = parsedUrl.searchParams.get('id');
    if (id && /^\d+$/.test(id)) return id;
  }

  // ---- QQ音乐 ----
  // 插件正则: i.y.qq.com/n2/m/share/details/taoge.html?id= 或 y.qq.com/n/ryqq/playlist/
  // 不匹配: i2.y.qq.com/n3/other/pages/details/playlist.html?id=
  // 修复: 提取 id 查询参数
  if (platform.includes('QQ') || parsedUrl.hostname.includes('y.qq.com')) {
    const id = parsedUrl.searchParams.get('id');
    if (id && /^\d+$/.test(id)) return id;
  }

  // ---- 酷我音乐 ----
  // 插件正则有 typo: www/kuwo.cn (应为 www.) 且只匹配 h5app/playlist/
  // 不匹配: m.kuwo.cn/newh5app/playlist_detail/ 或 m.kuwo.cn/playlist_detail/
  // 修复: 从路径或查询参数中提取数字 ID
  if (platform.includes('酷我') || parsedUrl.hostname.includes('kuwo.cn')) {
    const id = parsedUrl.searchParams.get('id');
    if (id && /^\d+$/.test(id)) return id;
    const pathMatch = parsedUrl.pathname.match(/(\d+)/);
    if (pathMatch) return pathMatch[1];
  }

  // ---- 酷狗音乐 ----
  // 插件正则: ^(.*?)(\d+)(.*?)$ 提取第一个数字序列
  // 问题: gcid_3zu8nugmzaz02f 会提取到 "3" 而非完整 ID
  // 插件只支持纯数字酷狗码，不支持 gcid URL
  // 修复: 尝试从 query param code 提取酷狗码，或从路径提取 6 位以上数字
  //       如果是 gcid_ URL，通过 HTTP 请求解析出数字歌单 ID
  if (platform.includes('酷狗') || parsedUrl.hostname.includes('kugou.com')) {
    // 酷狗码通常在 query 参数 code 中
    const code = parsedUrl.searchParams.get('code');
    if (code && /^\d+$/.test(code)) return code;

    // 路径中的数字 ID（至少 6 位，避免匹配 gcid_3 中的 3）
    const pathMatch = parsedUrl.pathname.match(/(\d{6,})/);
    if (pathMatch) return pathMatch[1];

    // gcid_ URL: 需要通过 HTTP 请求解析出数字歌单 ID
    if (url.includes('gcid_')) {
      try {
        log(`[酷狗] 检测到 gcid URL，尝试通过 HTTP 请求解析歌单 ID...`);
        const res = await axios.get(url, {
          maxRedirects: 5,
          timeout: 10000,
          responseType: 'text',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36',
          },
        });
        const html = typeof res.data === 'string' ? res.data : '';
        // 尝试多种模式从 HTML 中提取 specialid
        const idMatch =
          html.match(/specialid["'\s:=]+(\d+)/i) ||
          html.match(/global_collection["'\s:=]+(\d+)/i) ||
          html.match(/special_single\/(\d+)/) ||
          html.match(/yy\/special\/single\/(\d+)/) ||
          html.match(/"global_collection_id"["'\s:=]+(\d+)/) ||
          html.match(/data-specialid[="'\s]+(\d+)/i);
        if (idMatch) {
          log(`[酷狗] 从 gcid URL 解析出歌单 ID: ${idMatch[1]}`);
          return idMatch[1];
        }
        log(`[酷狗] 无法从 gcid URL HTML 中解析出歌单 ID`);
      } catch (e: any) {
        log(`[酷狗] 解析 gcid URL 失败: ${e?.message ?? e}`);
      }
    }
  }

  return url;
}

/**
 * 从 URL 导入歌单
 * 先通过 normalizeImportUrl 从各种格式的分享链接中提取歌单 ID，
 * 然后将纯数字 ID 传给插件的 importMusicSheet 方法。
 */
export async function pluginImportMusicSheet(
  source: PluginSource,
  urlLike: string,
): Promise<PluginSearchResult[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];

  try {
    if (typeof inst.instance.importMusicSheet !== 'function') {
      log(`[${source.name}] 不支持歌单导入 (无 importMusicSheet 函数)`);
      return [];
    }

    // URL 预处理：提取歌单 ID
    const normalizedUrl = await normalizeImportUrl(source, urlLike);
    log(`[${source.name}] 开始导入歌单, url="${urlLike.substring(0, 200)}" → id="${normalizedUrl.substring(0, 100)}"`);

    const result = (await inst.instance.importMusicSheet(normalizedUrl)) ?? [];

    if (!Array.isArray(result)) {
      log(`[${source.name}] 歌单导入返回非数组: type=${typeof result}, value=${JSON.stringify(result)?.substring(0, 200)}`);
      return [];
    }

    if (result.length === 0) {
      log(`[${source.name}] 歌单导入返回空结果`);
      return [];
    }

    log(`[${source.name}] 歌单导入成功, 共 ${result.length} 首`);

    // 与 MusicFree 一致：对每个 item 调用 resetMediaItem
    result.forEach((_: any) => { resetMediaItem(_, source.name); });
    return result.map((item: any) => toPluginSearchResult(item, source));
  } catch (e: any) {
    const errMsg = e?.message || (typeof e === 'string' ? e : '') || 'Unknown error';
    const errStack = e?.stack ? `\n  堆栈: ${e.stack.substring(0, 500)}` : '';
    log(`[${source.name}] 歌单导入失败: ${errMsg}${errStack}`);
    return [];
  }
}

/** 获取支持歌单导入的插件列表 */
export function getPluginsWithImportAbility(): PluginSource[] {
  return getStoredPlugins().filter(p => p.enabled && p.format === 'musicfree');
}

/**
 * 检查插件是否支持歌单导入（importMusicSheet）
 * 通过加载插件实例并检查是否存在 importMusicSheet 函数来判断
 */
export async function pluginSupportsImportMusicSheet(source: PluginSource): Promise<boolean> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return false;
  return typeof inst.instance.importMusicSheet === 'function';
}

/**
 * 获取插件的 importMusicSheet 提示文本
 * 与 MusicFree IPlugin.IPluginDefine.hints.importMusicSheet 一致
 */
export async function getPluginImportHints(source: PluginSource): Promise<string[]> {
  const inst = await ensurePluginInstance(source);
  if (!inst) return [];
  return inst.instance.hints?.importMusicSheet ?? [];
}

/**
 * 批量检查多个插件是否支持歌单导入
 * 返回支持的插件 ID 集合
 */
export async function checkPluginsImportSupport(sources: PluginSource[]): Promise<Set<string>> {
  const supported = new Set<string>();
  await Promise.allSettled(
    sources.map(async (source) => {
      if (await pluginSupportsImportMusicSheet(source)) {
        supported.add(source.id);
      }
    }),
  );
  return supported;
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
 */
export async function pluginGetMusicInfo(
  source: PluginSource,
  item: PluginSearchResult,
  quality = 'standard',
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

  log(`[getMediaSource] 调用 ${source.name}, id=${musicItem.id}, platform=${musicItem.platform}, quality=${quality}`);

  // 与 MusicFree 第269行一致，带重试
  let result: any = null;
  let lastError: any = null;
  for (let retry = 0; retry <= 1; retry++) {
    try {
      result = await inst.instance.getMediaSource(musicItem, quality);
      if (result?.url) break;
    } catch (e: any) {
      lastError = e;
      log(`[getMediaSource] 第${retry + 1}次异常: ${e?.message || e}`);
      if (retry < 1) {
        await new Promise(r => setTimeout(r, 150));
      }
    }
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
  const lyric = result.lyric || '';
  const tlyric = result.tlyric || '';
  const coverUrl = result.coverUrl || '';
  if (!url) {
    log(`[getMediaSource] ${source.name} 返回空URL, result=${JSON.stringify(result)?.substring(0, 200)}`);
    (globalThis as any).__lastPluginError = `[${source.name}] 返回空URL`;
    return null;
  }

  log(`[getMediaSource] 成功: ${url.substring(0, 100)}`);
  return { url, headers: headers as Record<string, string>, lyric, tlyric, coverUrl };
}

// ==================== 获取歌词（与 MusicFree PluginMethodsWrapper.getLyric 完全一致）====================

/**
 * 获取歌词
 *
 * MusicFree PluginMethodsWrapper.getLyric() 核心逻辑：
 *   lrcSource = (await this.plugin.instance?.getLyric?.(resetMediaItem(musicItem, undefined, true))?.catch(() => null)) || null;
 *   rawLrc = lrcSource?.rawLrc || rawLrc;
 *   translation = lrcSource?.translation || null;
 */
export async function pluginGetLyric(
  source: PluginSource,
  item: PluginSearchResult,
): Promise<{ lyric: string; tlyric?: string } | null> {
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

    const rawLrc = lrcSource.rawLrc || '';
    const translation = lrcSource.translation || '';

    if (!rawLrc) {
      log(`[getLyric] ${source.name} rawLrc 为空, lrcSource keys: ${Object.keys(lrcSource).join(',')}`);
      return null;
    }
    log(`[getLyric] ${source.name} 成功, rawLrc长度=${rawLrc.length}`);
    return { lyric: rawLrc, tlyric: translation };
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
      if (result?.artwork) return result.artwork;
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

    // 检查插件是否支持歌手搜索
    const supported = inst.instance.supportedSearchType ?? [];
    if (!supported.includes('artist')) return [];

    const result = (await inst.instance.search(keyword, page, 'artist')) ?? {};
    if (!Array.isArray(result.data)) return [];

    return result.data.map((item: any) => {
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

    // 检查插件是否支持专辑搜索
    const supported = inst.instance.supportedSearchType ?? [];
    if (!supported.includes('album')) return [];

    const result = (await inst.instance.search(keyword, page, 'album')) ?? {};
    if (!Array.isArray(result.data)) return [];

    return result.data.map((item: any) => {
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
 */
export function pluginSupportsSearchType(source: PluginSource, type: 'music' | 'sheet' | 'artist' | 'album'): boolean {
  const supported = getPluginSupportedSearchTypes(source);
  if (supported.length === 0) return type === 'music'; // 无声明默认支持音乐搜索
  return supported.includes(type);
}

// ==================== 辅助函数 ====================

/**
 * 确保插件实例已加载到内存中
 */
async function ensurePluginInstance(source: PluginSource): Promise<PluginInstance | null> {
  const inst = pluginInstances.get(source.id);
  if (inst) return inst;

  log(`插件实例未缓存，重新加载: ${source.name} (${source.filePath})`);

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
          const { pluginApi } = await import('./tauri/pluginApi');
          script = await pluginApi.fetchPluginUrl(source.filePath);
        } catch { /* ignore */ }
      }
    } else if (source.filePath) {
      try {
        const { pluginApi } = await import('./tauri/pluginApi');
        script = await pluginApi.readPluginFile(source.filePath);
      } catch { /* ignore */ }
    }

    if (script) {
      const loadedSource = await loadPluginFromScript(script, source.filePath);
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

    return pluginInstances.get(source.id) || null;
  } catch (e) {
    log(`插件重新加载失败: ${source.name} ${e}`);
    return null;
  }
}

/**
 * 将 resetMediaItem 后的搜索结果转为 PluginSearchResult
 * 与 MusicFree 的展示逻辑一致
 */
function toPluginSearchResult(item: any, source: PluginSource): PluginSearchResult {
  const id = item.id || item.songId || item.musicId || '';
  const title = stripHtmlTags(item.title || item.name || item.songname || '');
  const artist = extractArtist(item);
  const album = extractAlbum(item);
  const coverUrl = extractCoverUrl(item);
  const duration = parseDuration(item.duration || item.interval || item.dt);

  return {
    id,
    title,
    artist,
    album,
    coverUrl,
    duration,
    platform: item.platform || source.name,
    platformId: id,
    pluginId: source.id,
    // 关键：保存 resetMediaItem 后的完整对象，getMediaSource 时直接使用
    rawData: item,
  };
}

function extractArtist(item: any): string {
  if (item.artist && typeof item.artist === 'string') return stripHtmlTags(item.artist);
  if (item.singer && typeof item.singer === 'string') return stripHtmlTags(item.singer);
  if (Array.isArray(item.artists)) {
    return stripHtmlTags(item.artists.map((a: any) => typeof a === 'string' ? a : (a?.name || '')).filter(Boolean).join('/'));
  }
  // 网易云: item.ar 数组
  if (Array.isArray(item.ar)) {
    return stripHtmlTags(item.ar.map((a: any) => a?.name || '').filter(Boolean).join('/'));
  }
  return '';
}

function extractAlbum(item: any): string {
  if (typeof item.album === 'string') return stripHtmlTags(item.album);
  if (item.album?.name) return stripHtmlTags(item.album.name);
  if (item.albumName) return stripHtmlTags(item.albumName);
  // 网易云: item.al.name
  if (item.al?.name) return stripHtmlTags(item.al.name);
  return '';
}

function parseDuration(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val > 1000 ? val : val * 1000;
  if (typeof val === 'string') {
    const parts = val.split(':');
    if (parts.length >= 2) return (parseInt(parts[0]) * 60 + parseInt(parts[1])) * 1000;
    const n = parseInt(val);
    return n > 1000 ? n : n * 1000;
  }
  return 0;
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
}

export function removePluginSource(id: string) {
  const stored = readPluginsFromLocalStorage().filter(p => p.id !== id);
  localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(stored));
  pluginInstances.delete(id);
  // [修复防御]: LX 插件删除时也要销毁 iframe
  destroyLxPlugin(id);
}

export function updatePluginSource(id: string, updates: Partial<PluginSource>) {
  const stored = readPluginsFromLocalStorage();
  const idx = stored.findIndex(p => p.id === id);
  if (idx >= 0) {
    stored[idx] = { ...stored[idx], ...updates };
    localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(stored));
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
            const { pluginApi } = await import('./tauri/pluginApi');
            script = await pluginApi.fetchPluginUrl(source.filePath);
          } catch { /* ignore */ }
        }
      } else {
        try {
          const { pluginApi } = await import('./tauri/pluginApi');
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

/**
 * 版本号比较：返回 >0 表示 a 更新，<0 表示 b 更新，0 表示相同
 * 支持语义化版本如 "1.0.5", "1.0.5-fix7", "2.0.0-beta.1"
 */
function compareVersions(a: string, b: string): number {
  const parseVer = (v: string) => {
    const parts = v.split(/[-.]/);
    return parts.map(p => {
      const n = parseInt(p);
      return isNaN(n) ? 0 : n;
    });
  };
  const va = parseVer(a);
  const vb = parseVer(b);
  const maxLen = Math.max(va.length, vb.length);
  for (let i = 0; i < maxLen; i++) {
    const diff = (va[i] || 0) - (vb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 从远程 URL 获取插件脚本 */
async function fetchPluginScript(url: string): Promise<string | null> {
  try {
    const resp = await fetchWithTimeout(url, 10000);
    if (resp.ok) return await resp.text();
  } catch { /* ignore */ }
  try {
    const { pluginApi } = await import('./tauri/pluginApi');
    return await pluginApi.fetchPluginUrl(url);
  } catch { /* ignore */ }
  return null;
}

/** 从 MusicFree 脚本中提取版本号（不执行脚本） */
function extractMusicFreeVersion(script: string): string | null {
  const match = script.match(/version\s*[=:]\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

/** 从 MusicFree 脚本中提取 srcUrl（不执行脚本） */
function extractMusicFreeSrcUrl(script: string): string | null {
  const match = script.match(/srcUrl\s*[=:]\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

export interface PluginUpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  newVersion: string;
  newScript: string | null;
  updateUrl: string;
}

/**
 * 检查插件是否有可用更新
 * - MusicFree 插件：优先使用实例的 srcUrl，回退到 filePath（如果是 http URL）
 * - LX 插件：使用 parseLxScriptInfo 提取的 @homepage，回退到 filePath
 */
export async function checkPluginUpdate(source: PluginSource): Promise<PluginUpdateCheckResult | null> {
  let updateUrl: string | undefined;

  if (source.format === 'musicfree') {
    // 优先从实例中获取 srcUrl
    const inst = await ensurePluginInstance(source);
    const instanceSrcUrl = (inst?.instance as any)?.srcUrl as string | undefined;

    if (instanceSrcUrl) {
      updateUrl = instanceSrcUrl;
    } else if (source.filePath.startsWith('http')) {
      // 回退到 filePath（导入时的 URL）
      updateUrl = source.filePath;
    }

    // 如果都没有，尝试从脚本中提取 srcUrl
    if (!updateUrl) {
      let script = '';
      try {
        if (source.filePath.startsWith('http')) {
          script = await fetchPluginScript(source.filePath) || '';
        } else if (source.filePath) {
          const { pluginApi } = await import('./tauri/pluginApi');
          script = await pluginApi.readPluginFile(source.filePath);
        }
      } catch { /* ignore */ }
      if (script) {
        updateUrl = extractMusicFreeSrcUrl(script) || undefined;
      }
    }
  } else if (source.format === 'lx') {
    // LX 插件：从脚本注释中提取 @homepage
    let script = '';
    try {
      if (source.filePath.startsWith('http')) {
        script = await fetchPluginScript(source.filePath) || '';
      } else if (source.filePath) {
        const { pluginApi } = await import('./tauri/pluginApi');
        script = await pluginApi.readPluginFile(source.filePath);
      }
    } catch { /* ignore */ }

    if (script) {
      const info = parseLxScriptInfo(script);
      if (info.homepage) {
        updateUrl = info.homepage;
      }
    }

    if (!updateUrl && source.filePath.startsWith('http')) {
      updateUrl = source.filePath;
    }
  }

  if (!updateUrl) {
    log(`[checkPluginUpdate] ${source.name} 无可用更新源`);
    return null;
  }

  log(`[checkPluginUpdate] ${source.name} 检查更新: ${updateUrl}`);
  const newScript = await fetchPluginScript(updateUrl);
  if (!newScript) {
    log(`[checkPluginUpdate] ${source.name} 获取脚本失败`);
    return null;
  }

  // 提取新版本号（不执行脚本）
  let newVersion = '';
  if (source.format === 'musicfree') {
    newVersion = extractMusicFreeVersion(newScript) || '';
  } else if (source.format === 'lx') {
    const info = parseLxScriptInfo(newScript);
    newVersion = info.version;
  }

  if (!newVersion) {
    log(`[checkPluginUpdate] ${source.name} 无法从新脚本提取版本号`);
    return null;
  }

  const hasUpdate = compareVersions(newVersion, source.version) > 0;
  log(`[checkPluginUpdate] ${source.name}: 当前=${source.version}, 远程=${newVersion}, 有更新=${hasUpdate}`);

  return {
    hasUpdate,
    currentVersion: source.version,
    newVersion,
    newScript: hasUpdate ? newScript : null,
    updateUrl,
  };
}

/**
 * 执行插件更新：重新加载新脚本并替换旧插件
 */
export async function performPluginUpdate(
  source: PluginSource,
  checkResult: PluginUpdateCheckResult,
): Promise<{ success: boolean; newSource: PluginSource | null; message: string }> {
  if (!checkResult.newScript) {
    return { success: false, newSource: null, message: '无新脚本可更新' };
  }

  try {
    // 加载新脚本
    const newSource = await loadPluginFromScript(checkResult.newScript, checkResult.updateUrl);
    if (!newSource) {
      return { success: false, newSource: null, message: '新脚本加载失败' };
    }

    // 保留原有的 enabled 和 sortOrder 状态
    newSource.enabled = source.enabled;
    newSource.sortOrder = source.sortOrder;

    // 如果新插件 ID 不同，删除旧插件
    if (newSource.id !== source.id) {
      removePluginSource(source.id);
    }

    // 添加新插件
    addPluginSource(newSource);

    // 如果是 LX 插件且启用，重新初始化
    if (newSource.format === 'lx' && newSource.enabled) {
      destroyLxPlugin(source.id);
      await initLxPlugin(newSource);
    }

    log(`[performPluginUpdate] ${source.name} 更新成功: ${source.version} → ${newSource.version}`);
    return { success: true, newSource, message: `${source.name} 已更新到 ${newSource.version}` };
  } catch (e: any) {
    log(`[performPluginUpdate] ${source.name} 更新失败: ${e?.message || e}`);
    return { success: false, newSource: null, message: `更新失败: ${e?.message || e}` };
  }
}

/**
 * 批量检查所有插件的更新
 */
export async function checkAllPluginUpdates(): Promise<Map<string, PluginUpdateCheckResult>> {
  const plugins = getStoredPlugins();
  const results = new Map<string, PluginUpdateCheckResult>();

  await Promise.allSettled(plugins.map(async (source) => {
    try {
      const result = await checkPluginUpdate(source);
      if (result) {
        results.set(source.id, result);
        // 更新 updateAvailable 标记
        updatePluginSource(source.id, { updateAvailable: result.hasUpdate });
      }
    } catch (e: any) {
      log(`[checkAllPluginUpdates] ${source.name} 检查失败: ${e?.message || e}`);
    }
  }));

  return results;
}

/** 带超时的 fetch，避免请求挂起 */
function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  return Promise.race([
    fetch(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`fetch 超时(${ms / 1000}s): ${url}`)), ms),
    ),
  ]);
}

// ==================== 导出 ====================

export type { IPluginInstance };

