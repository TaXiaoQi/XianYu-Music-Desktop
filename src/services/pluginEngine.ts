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
import { isLxPluginScript, loadLxPluginFromScript, initLxPlugin, destroyLxPlugin } from './lxPluginEngine';

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
      const paramStr = qs.stringify(config.params);
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

    log(`[tauriAdapter] ${method} ${url.substring(0, 120)}, headers=${JSON.stringify(headers).substring(0, 200)}`);
    const response = await pluginApi.pluginHttpRequest(method, url, headers, body);
    log(`[tauriAdapter] 响应: status=${response.status}, bodyLen=${response.body?.length ?? 0}, bodyPreview=${response.body?.substring(0, 200) ?? ''}`);

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

const proxyAxios = axios.create({
  adapter: tauriAdapter as any,
});

const _originalCreate = proxyAxios.create.bind(proxyAxios);
proxyAxios.create = (config?: any) => {
  const inst = _originalCreate(config);
  inst.defaults.adapter = tauriAdapter as any;
  inst.create = proxyAxios.create;
  return inst;
};

const packages: Record<string, any> = {
  cheerio,
  'crypto-js': CryptoJs,
  axios: proxyAxios,
  dayjs,
  qs,
  he,
  'big-integer': bigInt,
  buffer: { Buffer },
};

const _require = (packageName: string) => {
  let pkg = packages[packageName];
  if (pkg) {
    // 如果已有 default 属性，直接返回
    if (pkg.default) return pkg;

    // 函数类型的包（如 big-integer）：不能 Object.assign，否则丢失可调用性
    if (typeof pkg === 'function') {
      try {
        pkg.default = pkg;
        return pkg;
      } catch {
        // ES Module 冻结的函数 → 创建可调用包装
        const fn = pkg;
        const wrapper: any = function (this: unknown, ...args: any[]) { return fn.apply(this, args); };
        wrapper.default = fn;
        Object.keys(fn).forEach(k => { wrapper[k] = (fn as any)[k]; });
        return wrapper;
      }
    }

    // [修复防御]: axios 实例不能 Object.assign，否则丢失原型方法（request/get/post 等）
    // 直接返回 proxyAxios 实例，添加 .default 属性
    if (packageName === 'axios') {
      if (!pkg.default) pkg.default = pkg;
      return pkg;
    }

    // 普通对象：包装为可变副本
    const wrapped = Object.assign({}, pkg);
    wrapped.default = pkg;
    return wrapped;
  }
  // 未知包返回空对象
  log(`[require] 未知包: ${packageName}，返回空模块`);
  const emptyModule: any = {};
  emptyModule.default = emptyModule;
  return emptyModule;
};

const _console = {
  log: (...args: any[]) => { log(`[PLUGIN] ${args.map(a => typeof a === 'object' ? JSON.stringify(a)?.substring(0, 200) : String(a)).join(' ')}`); },
  warn: (...args: any[]) => { log(`[PLUGIN WARN] ${args.join(' ')}`); },
  info: (...args: any[]) => { log(`[PLUGIN INFO] ${args.join(' ')}`); },
  error: (...args: any[]) => { log(`[PLUGIN ERROR] ${args.join(' ')}`); },
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
  search?: (query: string, page: number, type: string) => Promise<any>;
  getMediaSource?: (musicItem: any, quality: string) => Promise<any>;
  getMusicInfo?: (musicItem: any) => Promise<any>;
  getLyric?: (musicItem: any) => Promise<any>;
  getAlbumInfo?: (albumItem: any, page: number) => Promise<any>;
  getArtistWorks?: (artistItem: any, page: number, type: string) => Promise<any>;
  getTopLists?: () => Promise<any>;
  getTopListDetail?: (topListItem: any, page: number) => Promise<any>;
  importMusicSheet?: (urlLike: string) => Promise<any>;
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
    const env = {
      getUserVariables: () => ({}),
      get userVariables() { return this.getUserVariables() ?? {}; },
      appVersion: '1.0.0',
      os: 'browser',
      lang: 'zh-CN',
    };
    const _process = {
      platform: 'browser',
      version: '1.0.0',
      env,
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
        _console,
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
    pluginInstances.set(hash, { source, instance: _instance });

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
      const title = item.title || item.name || '';
      const coverUrl = item.artwork || item.cover || item.pic || item.img || item.albumPic || item.picture || '';
      return {
        id,
        title,
        coverUrl,
        playCount: item.playCount ?? item.playcount ?? item.play_count,
        trackCount: item.trackCount ?? item.trackcount ?? item.track_count,
        artist: item.artist || item.author || '',
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
    if (!result?.data || !Array.isArray(result.data)) return [];

    result.data.forEach((_: any) => { resetMediaItem(_, source.name); });
    return result.data.map((item: any) => toPluginSearchResult(item, source));
  } catch (e: any) {
    log(`[${source.name}] 获取歌单详情失败: ${e?.message}`);
    return [];
  }
}

// ==================== 歌单导入（与 MusicFree importMusicSheet 一致）====================

/**
 * 从 URL 导入歌单
 * 与 MusicFree PluginMethodsWrapper.importMusicSheet() 一致
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

    // 与 MusicFree PluginMethodsWrapper.importMusicSheet() 第688-701行一致
    const result = (await inst.instance.importMusicSheet(urlLike)) ?? [];
    if (!Array.isArray(result) || result.length === 0) {
      log(`[${source.name}] 歌单导入返回空结果`);
      return [];
    }

    // 与 MusicFree 一致：每个 item 调用 resetMediaItem
    result.forEach((_: any) => { resetMediaItem(_, source.name); });
    return result.map((item: any) => toPluginSearchResult(item, source));
  } catch (e: any) {
    log(`[${source.name}] 歌单导入失败: ${e?.message}`);
    return [];
  }
}

/** 获取支持歌单导入的插件列表 */
export function getPluginsWithImportAbility(): PluginSource[] {
  return getStoredPlugins().filter(p => p.enabled && p.format === 'musicfree');
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
  const title = item.title || item.name || item.songname || '';
  const artist = extractArtist(item);
  const album = extractAlbum(item);
  let coverUrl = item.artwork || item.cover || item.pic || item.img || item.albumPic || item.picture || '';
  // B站 CDN 图片需要 HTTPS + 避免 Referer 403
  if (coverUrl && coverUrl.startsWith('http://') && (coverUrl.includes('hdslb.com') || coverUrl.includes('bilivideo.com') || coverUrl.includes('bilibili.com'))) {
    coverUrl = coverUrl.replace('http://', 'https://');
  }
  const duration = parseDuration(item.duration || item.interval);

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
  if (item.artist && typeof item.artist === 'string') return item.artist;
  if (item.singer && typeof item.singer === 'string') return item.singer;
  if (Array.isArray(item.artists)) {
    return item.artists.map((a: any) => typeof a === 'string' ? a : (a?.name || '')).filter(Boolean).join('/');
  }
  return '';
}

function extractAlbum(item: any): string {
  if (typeof item.album === 'string') return item.album;
  if (item.album?.name) return item.album.name;
  if (item.albumName) return item.albumName;
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
    plugins.push(source);
  }
  localStorage.setItem(PLUGIN_SOURCES_KEY, JSON.stringify(plugins));
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

export async function loadPlugins(): Promise<void> {
  // 清理旧版本遗留的内置插件条目（已无内置插件）
  await loadBuiltinPlugins();

  const plugins = getStoredPlugins();

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

