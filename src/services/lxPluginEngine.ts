/**
 * 落雪（LX）插件引擎 —— 适配 lx-music-desktop UserApi 插件格式
 *
 * 核心设计（与 lx-music-desktop 一致）：
 *   lx-music-desktop 使用独立 BrowserWindow + contextBridge 隔离运行插件脚本
 *   本引擎直接在主窗口 eval 插件脚本，通过 globalThis.lx 对象暴露 API 与插件通信
 *   （与 lx-music-desktop webFrame.executeJavaScript + contextBridge.exposeInMainWorld 等价）
 *
 * 通信机制：
 *   主窗口 → 插件:  globalThis.lx = lxApi（暴露 EVENT_NAMES / request / send / on / utils 等）
 *   插件 → 主窗口:  lx.send(EVENT_NAMES.inited, info) 声明初始化完成
 *   插件 → 主窗口:  lx.on(EVENT_NAMES.request, handler) 注册请求处理器
 *   主窗口 → 插件:  调用 requestHandler({ source, action, info }) 触发请求
 *   插件 → 主窗口:  lx.request(url, options, callback) 发起 HTTP 请求（由主窗口 Tauri 后端代理）
 *
 * 多插件隔离：
 *   多插件共享 globalThis.lx，通过初始化锁与请求锁串行化，调用时临时设置 globalThis.lx 指向对应插件
 */

import CryptoJs from 'crypto-js';
import { Buffer } from 'buffer';
import type { PluginSource } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { pluginApi } from './tauri/pluginApi';

// ==================== 常量 ====================

const INIT_TIMEOUT = 15000;
const REQUEST_TIMEOUT = 30000;

// ==================== 日志 ====================

let _logCallback: ((msg: string) => void) | null = null;
const _nativeLog = console.log.bind(console);

// [DEBUG]: 全局调试日志数组，供应用内调试面板显示
interface DebugLogEntry {
  time: string;
  msg: string;
}
const _debugLogsHolder: any = typeof window !== 'undefined' ? window : {};
if (!_debugLogsHolder.__lxDebugLogs) {
  _debugLogsHolder.__lxDebugLogs = [];
}
const debugLogs: DebugLogEntry[] = _debugLogsHolder.__lxDebugLogs;

function log(msg: string) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0');
  _nativeLog(`[LxPluginEngine] ${msg}`);
  // [DEBUG]: 记录到全局数组，供应用内调试面板显示
  debugLogs.push({ time, msg: `[LxPluginEngine] ${msg}` });
  if (debugLogs.length > 500) debugLogs.shift(); // 限制最多 500 条
  // [DEBUG]: 把日志发送到 Rust 后端，输出到终端（仅开发模式有效）
  try { if (typeof (window as any).__TAURI_INTERNALS__ !== 'undefined') invoke('debug_log', { message: `[LxPluginEngine] ${msg}` }).catch(() => {}); } catch { /* ignore */ }
  try { _logCallback?.(msg); } catch { /* ignore */ }
}

// [DEBUG]: 导出调试日志数组，供应用内调试面板读取
export function getLxDebugLogs(): DebugLogEntry[] {
  return debugLogs;
}

// [DEBUG]: 清空调试日志
export function clearLxDebugLogs(): void {
  debugLogs.length = 0;
}

export function setLogCallback(cb: ((msg: string) => void) | null) {
  _logCallback = cb;
}

// ==================== 类型 ====================

export interface LxSourceInfo {
  type: 'music';
  actions: string[];
  qualitys: string[];
}

export interface LxInitInfo {
  sources: Record<string, LxSourceInfo>;
  openDevTools?: boolean;
}

export interface LxPluginState {
  source: PluginSource;
  initInfo: LxInitInfo | null;
  status: 'loading' | 'ready' | 'error';
  errorMessage?: string;
  requestHandler: ((data: any) => any) | null;  // [新方案] 插件注册的 request 处理器
  lxApi: any;  // [修复防御] 保存 globalThis.lx 对象引用，供 lxPluginRequest 调用时临时设置
  pendingRequests: Map<string, {
    resolve: (data: any) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
}

// ==================== 插件实例缓存 ====================

// [修复防御]: 挂载到 window 防止 Vite HMR 重置缓存
const _g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
if (!_g.__lxPlugins) {
  _g.__lxPlugins = new Map<string, LxPluginState>();
}
const lxPlugins: Map<string, LxPluginState> = _g.__lxPlugins;

// [新方案]: 初始化锁 —— 直接在主窗口 eval 脚本时，globalThis.lx 是共享的
// 必须串行初始化，确保同一时间只有一个插件在设置 globalThis.lx
if (!_g.__lxInitLock) {
  _g.__lxInitLock = Promise.resolve();
}
let _initLock: Promise<unknown> = _g.__lxInitLock;

// [修复防御]: 请求锁 —— 多插件共享 globalThis.lx，必须串行调用 requestHandler
// 避免插件A的 requestHandler 执行中 globalThis.lx 被插件B覆盖
if (!_g.__lxRequestLock) {
  _g.__lxRequestLock = Promise.resolve();
}
let _requestLock: Promise<unknown> = _g.__lxRequestLock;

// [修复防御]: ensureLxPluginInstance 并发初始化锁
// 首次播放时 fetchLxSongLyricsRaw（歌词获取）与 lxPluginGetMusicUrl（URL解析）会并发调用
// ensureLxPluginInstance，没有此锁时两个调用都会进入 loadLxPluginFromScript，
// 第二个调用会销毁第一个正在 loading 的实例（loadLxPluginFromScript 第 822-824 行），
// 导致第一个调用（歌词获取）的 initPromise 永远无法 resolve，歌词加载失败。
// 切换音质时插件已初始化完成，所以歌词能正常获取——这就是"切换音质才能显示歌词"的根因。
if (!_g.__lxEnsureLock) {
  _g.__lxEnsureLock = new Map<string, Promise<LxPluginState | null>>();
}
const _ensureLock: Map<string, Promise<LxPluginState | null>> = _g.__lxEnsureLock;

// [修复防御]: 脚本内容缓存 —— 避免同一脚本被反复 fetch
// 首次启动时 loadPlugins / ensureLxPluginInstance 等入口可能请求同一脚本
// 没有缓存时 N 次初始化 = N 次网络请求，有缓存后仅首次需要网络
if (!_g.__lxScriptCache) {
  _g.__lxScriptCache = new Map<string, string>();
}
const scriptCache: Map<string, string> = _g.__lxScriptCache;

/** 获取落雪插件脚本（带缓存） */
async function fetchLxPluginScript(filePath: string): Promise<string> {
  // 1. 检查缓存
  const cached = scriptCache.get(filePath);
  if (cached) return cached;

  let script = '';
  if (filePath.startsWith('builtin://')) {
    // 已取消所有内置插件，builtinMap 为空
    const builtinMap: Record<string, string> = {};
    const webPath = builtinMap[filePath];
    if (webPath) {
      try {
        const resp = await fetchWithTimeout(webPath, 5000);
        if (resp.ok) script = await resp.text();
      } catch (e: any) {
        log(`[fetchLxPluginScript] 内置插件 fetch 失败: ${filePath} - ${e?.message}`);
      }
    }
  } else if (filePath.startsWith('http')) {
    // [修复防御]: 远程 URL 必须通过 Tauri 后端代理，浏览器 fetch 会被 CORS 阻止
    try {
      const resp = await pluginApi.pluginHttpRequest('GET', filePath, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      }, undefined, 10000);
      if (resp.status >= 200 && resp.status < 300 && resp.body) script = resp.body;
    } catch (e: any) {
      log(`[fetchLxPluginScript] Tauri 代理获取远程脚本失败: ${filePath} - ${e?.message}`);
    }
  } else if (filePath) {
    try {
      script = await pluginApi.readPluginFile(filePath);
    } catch (e: any) {
      log(`[fetchLxPluginScript] 读取本地文件失败: ${filePath} - ${e?.message}`);
    }
  }

  if (script) {
    scriptCache.set(filePath, script);
  }
  return script;
}

// ==================== 脚本格式检测 ====================

export function isLxPluginScript(script: string): boolean {
  const trimmed = script.trim();

  // [修复防御]: MusicFree 格式特征检测（优先级最高）
  // MusicFree 插件必须包含 module.exports 或 exports.default
  const hasMusicFreeExport = /\bmodule\.exports\s*[.=]/.test(trimmed) ||
    /\bexports\s*\.\s*default\s*=/.test(trimmed);
  // MusicFree 插件通常有 platform 和 search 方法
  const hasMusicFreePlatform = /\bplatform\s*[=:]\s*['"]/.test(trimmed);
  const hasMusicFreeSearch = /\bsearch\s*[=:]\s*function|\.search\s*=\s*(async\s+)?\(/.test(trimmed);

  if (hasMusicFreeExport || (hasMusicFreePlatform && hasMusicFreeSearch)) return false;

  // LX 格式特征检测（包括混淆后的插件）
  // 1. 明文调用 lx.on / lx.send
  if (/\blx\s*\.\s*(on|send)\s*\(/.test(trimmed)) return true;
  // 2. 明文引用 EVENT_NAMES.request
  if (/EVENT_NAMES\s*\.\s*request/.test(trimmed)) return true;
  // 3. 混淆插件通过 globalThis.lx 访问（包括 globalThis['lx']、globalThis.lx 等）
  if (/globalThis\s*\[\s*['"]lx['"]\s*]/.test(trimmed)) return true;
  if (/globalThis\s*\.\s*lx\b/.test(trimmed)) return true;
  // 4. 混淆插件可能在解构时引用 globalThis.lx（如 const { EVENT_NAMES } = globalThis.lx）
  return /globalThis/.test(trimmed) && /\bEVENT_NAMES\b/.test(trimmed);


}

export function parseLxScriptInfo(script: string): {
  name: string; version: string; author: string; description: string; homepage: string;
} {
  const result = /^\/\*[\S|\s]+?\*\//.exec(script);
  if (!result) return { name: '', version: '', author: '', description: '', homepage: '' };

  const header = result[0];
  const infoArr = header.split(/\r?\n/);
  const rxp = /^\s?\*\s?@(\w+)\s(.+)$/;
  const infos: Record<string, string> = {};
  for (const line of infoArr) {
    const m = rxp.exec(line);
    if (!m) continue;
    infos[m[1]] = m[2].trim();
  }

  return {
    name: (infos.name || '').substring(0, 24),
    version: (infos.version || '').substring(0, 36),
    author: (infos.author || '').substring(0, 56),
    description: (infos.description || '').substring(0, 36),
    homepage: (infos.homepage || '').substring(0, 1024),
  };
}

// ==================== HTTP 请求桥接 ====================

async function lxNativeRequest(
  method: string, url: string, headers: Record<string, string>, body: string | undefined,
  timeout?: number | null, follow?: number | null,
): Promise<{ statusCode: number; statusMessage: string; headers: Record<string, string>; body: string }> {
  try {
    const response = await pluginApi.pluginHttpRequest(method, url, headers, body, timeout ?? undefined, follow ?? undefined);

    // [修复防御]: 返回原始字符串 body，不在此处 JSON.parse
    // JSON 解析在 handleLxHttpRequest 中按 needle 回调格式处理
    return {
      statusCode: response.status,
      statusMessage: response.status >= 200 && response.status < 300 ? 'OK' : 'Error',
      headers: response.headers,
      body: response.body,  // 始终是原始字符串
    };
  } catch (e: any) {
    // [修复防御]: Tauri IPC 错误可能没有 .message，需要完整序列化
    const errMsg = e?.message || (typeof e === 'string' ? e : JSON.stringify(e)?.substring(0, 200)) || 'Tauri IPC request failed';
    throw new Error(errMsg, { cause: e });
  }
}

// ==================== 插件加载 ====================

/**
 * 加载落雪 LX 插件脚本
 * 直接在主窗口 eval 脚本（与 lx-music-desktop webFrame.executeJavaScript 一致）
 */
export async function loadLxPluginFromScript(
  script: string,
  uri: string,
): Promise<PluginSource | null> {
  const bytes = new TextEncoder().encode(script);
  if (bytes.length > 2 * 1024 * 1024) {
    log(`插件大小超过 2MB: ${bytes.length} bytes`);
    return null;
  }
  if (script.trim().length === 0) {
    log('插件内容为空');
    return null;
  }

  const scriptInfo = parseLxScriptInfo(script);
  log(`=== 开始加载落雪插件: ${scriptInfo.name || uri} ===`);

  // [修复防御]: 如果已有同 hash 且状态为 ready 的实例，直接复用，避免销毁重建 iframe
  // 之前每次 loadLxPluginFromScript 都会销毁已有实例并重建 iframe，导致 15s 初始化超时被重复触发
  const hash = CryptoJs.SHA256(script).toString();
  const existingState = lxPlugins.get(hash);
  if (existingState && existingState.status === 'ready' && existingState.source) {
    log(`[loadLxPluginFromScript] 复用已有就绪实例: ${hash}`);
    return existingState.source;
  }
  // 残留状态（loading 或 error）则先销毁
  if (existingState) {
    log(`[loadLxPluginFromScript] 销毁残留实例(非就绪): ${hash}`);
    destroyLxPlugin(hash);
  }

  // ----- 创建 init Promise -----
  let initResolve: ((info: LxInitInfo) => void) | null = null;
  let initReject: ((err: Error) => void) | null = null;
  const initPromise = new Promise<LxInitInfo>((resolve, reject) => {
    initResolve = resolve;
    initReject = reject;
  });

  const state: LxPluginState = {
    source: null as any,
    initInfo: null,
    status: 'loading',
    requestHandler: null,
    lxApi: null,  // [修复防御] 初始为 null，创建 lx 对象后赋值
    pendingRequests: new Map(),
  };

  // ----- [新方案] 直接在主窗口 eval 脚本（与 lx-music-desktop webFrame.executeJavaScript 一致）-----
  // 放弃 iframe 方案：打包模式下 Tauri WebView2 CSP 阻止 iframe 内脚本执行
  // lx-music-desktop 用 Electron webFrame.executeJavaScript 直接在主窗口执行，不使用 iframe
  const allSources = ['kw', 'kg', 'tx', 'wy', 'mg', 'local'];
  const supportQualitys: Record<string, string[]> = {
    kw: ['128k', '320k', 'flac', 'flac24bit'],
    kg: ['128k', '320k', 'flac', 'flac24bit'],
    tx: ['128k', '320k', 'flac', 'flac24bit'],
    wy: ['128k', '320k', 'flac', 'flac24bit'],
    mg: ['128k', '320k', 'flac', 'flac24bit'],
    local: [],
  };
  const supportActions: Record<string, string[]> = {
    kw: ['musicUrl'], kg: ['musicUrl'], tx: ['musicUrl'], wy: ['musicUrl'], mg: ['musicUrl'],
    xm: ['musicUrl'], local: ['musicUrl', 'lyric', 'pic'],
  };
  let isInitedApi = false;
  const EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' };
  const eventNames = Object.values(EVENT_NAMES);

  // handleInit（与 lx-music-desktop preload.js 一致）
  const handleInit = (info: any) => {
    if (!info) {
      initReject!(new Error('Missing required parameter init info'));
      return;
    }
    const sourceInfo: any = { sources: {} };
    try {
      for (const source of allSources) {
        const userSource = info.sources?.[source];
        if (!userSource || userSource.type !== 'music') continue;
        const qualitys = supportQualitys[source];
        const actions = supportActions[source];
        sourceInfo.sources[source] = {
          type: 'music',
          actions: actions.filter((a: string) => userSource.actions?.includes(a)),
          qualitys: qualitys.filter((q: string) => userSource.qualitys?.includes(q)),
        };
      }
      // 保留非标准源
      if (info.sources) {
        for (const key of Object.keys(info.sources)) {
          if (sourceInfo.sources[key]) continue;
          const val = info.sources[key];
          if (val.type !== 'music') continue;
          sourceInfo.sources[key] = val;
        }
      }
    } catch (error: any) {
      initReject!(new Error(error.message));
      return;
    }
    log(`[新方案] 插件初始化成功, sources: ${Object.keys(sourceInfo.sources).join(',')}`);
    initResolve!(sourceInfo as LxInitInfo);
  };

  // 创建 globalThis.lx 对象（与 lx-music-desktop preload.js initEnv 一致）
  // [修复防御]: 把 lx 对象保存到 state.lxApi，供 lxPluginRequest 调用时临时设置 globalThis.lx
  // 否则初始化完成后 globalThis.lx 被恢复/覆盖，插件内部 lx.request 会失效
  const prevLx = (globalThis as any).lx;
  const lxApi = {
    EVENT_NAMES,
    request(url: string, options: any, callback: (err: unknown, response: unknown, body: unknown) => void) {
      const method = (options?.method || 'get').toLowerCase();
      log(`[新方案] HTTP 请求: ${method} ${url}`);

      // [修复防御]: 与 lx-music-desktop needle.request 行为对齐
      // needle: body 原样发送；form 自动 url-encode；formData 自动 multipart
      // 我们通过 Tauri reqwest 后端发送，需手动处理编码和 Content-Type
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
        // form: application/x-www-form-urlencoded
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
        // formData: 简化处理 —— 用 url-encode 代替 multipart（大多数 API 接受）
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

      lxNativeRequest(
        method,
        url,
        reqHeaders,
        bodyStr,
        options?.timeout,
        null,
      ).then((response) => {
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
            log(`[新方案] request 回调异常: ${err?.message}`);
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
            log('[新方案] updateAlert ignored');
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
          // 简化实现：用 crypto-js
          const CryptoJS = (window as any).CryptoJS || CryptoJs;
          const encrypted = CryptoJS.AES.encrypt(buffer, key, { iv, mode: (CryptoJS as any)[mode] });
          return Buffer.from(encrypted.toString(), 'base64');
        },
        rsaEncrypt(buffer: any, _key: string) {
          // 简化实现：返回原始 buffer（大多数插件不依赖 RSA）
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
          // [修复] 使用 DecompressionStream 正确解压 deflate 数据
          // 之前是 no-op 直接返回原始数据，导致依赖 zlib.inflate 的 LX 插件
          // (如 KW/KG 歌词解压) 无法正确解析歌词
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
            log(`[zlib.inflate] 解压失败，返回原始数据: ${e}`);
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
            log(`[zlib.deflate] 压缩失败，返回原始数据: ${e}`);
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

  // [修复防御]: 保存 lxApi 到 state，供 lxPluginRequest 调用时临时设置 globalThis.lx
  state.lxApi = lxApi;
  // 设置 globalThis.lx 供脚本 eval 时使用（与 lx-music-desktop contextBridge.exposeInMainWorld 一致）
  (globalThis as any).lx = lxApi;

  // [新方案] 用初始化锁确保串行初始化，避免 globalThis.lx 冲突
  const evalPromise = _initLock.then(async () => {
    log(`[新方案] 开始 eval 插件脚本: ${scriptInfo.name}`);
    try {
      // 直接在主窗口 eval 脚本（与 lx-music-desktop webFrame.executeJavaScript 一致）
      (0, eval)(script);
      log(`[新方案] 脚本 eval 完成(无同步异常)`);
    } catch (e: any) {
      log(`[新方案] 脚本 eval 异常: ${e?.message}`);
      if (!isInitedApi) {
        initReject!(new Error(e?.message || 'eval error'));
      }
    }
  });
  _initLock = evalPromise;

  // ----- 等待初始化 -----
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`插件初始化超时(${INIT_TIMEOUT / 1000}s)`)), INIT_TIMEOUT),
  );

  let initInfo: LxInitInfo;
  try {
    initInfo = await Promise.race([initPromise, timeoutPromise]);
  } catch (e: any) {
    // [DEBUG]: 记录完整错误堆栈，定位初始化失败的根本原因
    log(`[DEBUG-loadLxPlugin] 插件初始化失败: ${e?.message}`);
    log(`[DEBUG-loadLxPlugin] 错误堆栈: ${e?.stack || 'none'}`);
    log(`[DEBUG-loadLxPlugin] 脚本前100字符: ${script.substring(0, 100)}`);
    // [修复防御]: 初始化失败时恢复 globalThis.lx，避免残留无效的 lxApi 污染后续插件
    (globalThis as any).lx = prevLx;
    state.lxApi = null;

    // [修复防御]: 初始化失败时仍允许导入，保存插件元数据
    const fallbackSource: PluginSource = {
      id: hash,
      name: scriptInfo.name || '未知插件',
      format: 'lx',
      version: scriptInfo.version || '',
      author: scriptInfo.author || '',
      description: scriptInfo.description || `初始化失败: ${e?.message || '未知错误'}`,
      filePath: uri,
      importedAt: Date.now(),
      enabled: false,
      sources: [],
    };
    log(`=== 落雪插件导入(初始化失败): "${fallbackSource.name}" ===`);
    return fallbackSource;
  }

  // [修复防御]: 初始化成功后不恢复 globalThis.lx —— 插件后续 handleGetMusicUrl 等异步回调
  // 仍需通过 globalThis.lx.request 发起 HTTP 请求。lxPluginRequest 调用时会临时设置
  // globalThis.lx = state.lxApi 确保多插件场景下指向正确的 lxApi。
  // (与 lx-music-desktop contextBridge.exposeInMainWorld 持久暴露 lx 一致)

  if (!initInfo?.sources || Object.keys(initInfo.sources).length === 0) {
    log('插件未声明任何源 (sources 为空)');
    const fallbackSource: PluginSource = {
      id: hash,
      name: scriptInfo.name || '未知插件',
      format: 'lx',
      version: scriptInfo.version || '',
      author: scriptInfo.author || '',
      description: scriptInfo.description || '插件未声明任何音源',
      filePath: uri,
      importedAt: Date.now(),
      enabled: false,
      sources: [],
    };
    return fallbackSource;
  }

  // ----- 构建 PluginSource (复用已计算的 hash) -----
  const source: PluginSource = {
    id: hash,
    name: scriptInfo.name || Object.keys(initInfo.sources).join('/'),
    format: 'lx',
    version: scriptInfo.version || '',
    author: scriptInfo.author || '',
    description: scriptInfo.description || '',
    filePath: uri,
    importedAt: Date.now(),
    enabled: true,
    sources: Object.keys(initInfo.sources),
  };

  // ----- 缓存实例 -----
  state.source = source;
  state.initInfo = initInfo;
  state.status = 'ready';
  lxPlugins.set(hash, state);
  // [修复防御]: 同时用 uri 作为别名 key 缓存，确保 ensureLxPluginInstance 通过 source.id 也能找到
  // source.id 可能与 hash 不同（脚本内容变化后 hash 变了，但 localStorage 中的 source.id 还是旧值）
  if (uri && uri !== hash) {
    lxPlugins.set(uri, state);
  }

  log(`=== 落雪插件加载成功: "${source.name}" sources=[${Object.keys(initInfo.sources).join(', ')}] ===`);
  return source;
}

// ==================== 歌曲级错误 ====================

/**
 * 歌曲级错误：表示歌曲本身不可用（不存在、版权限制、需要 VIP 等），
 * 换音质无法解决，播放循环应立即停止尝试其他音质。
 */
export class LxSongLevelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LxSongLevelError';
  }
}

/**
 * 检测错误消息是否为歌曲级错误（换音质无法解决）。
 * 匹配 LX 插件常见的歌曲级错误模式：
 * - "歌曲不存在" / "歌曲已下架"
 * - "版权" + ("限制" | "保护" | "原因")
 * - "需要登录" / "需登录"
 * - "地区限制"
 * - "VIP" / "会员" 歌曲限制
 */
const SONG_LEVEL_ERROR_PATTERNS = [
  /歌曲不存在/i,
  /歌曲已下架/i,
  /已?下架/i,
  /版权.{0,4}(限制|保护|原因)/i,
  /需要?登录/i,
  /地区限制/i,
  /需要?\s*(VIP|会员|付费)/i,
  /VIP歌曲/i,
  /会员歌曲/i,
  /付费歌曲/i,
  /无版权/i,
  /暂无版权/i,
];

export function isSongLevelError(message: string): boolean {
  return SONG_LEVEL_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

// ==================== 请求方法 ====================

/**
 * 向落雪插件发送请求
 * [修复防御]: 与 lx-music-desktop handleRequest 一致，调用 events.request.call(context, { source, action, info })
 * 关键点：调用前临时设置 globalThis.lx = state.lxApi，确保插件内部 lx.request 可用
 */
export async function lxPluginRequest(
  source: PluginSource,
  action: 'musicUrl' | 'lyric' | 'pic',
  data: { source: string; type?: string; musicInfo: any },
): Promise<any> {
  const state = lxPlugins.get(source.id);
  if (!state || state.status !== 'ready') {
    log(`[lxPluginRequest] 插件未就绪: ${source.name}`);
    return null;
  }

  // [新方案] 直接调用插件注册的 requestHandler（与 lx-music-desktop handleRequest 一致）
  if (!state.requestHandler) {
    log(`[lxPluginRequest] 插件未注册 requestHandler: ${source.name}`);
    return null;
  }
  if (!state.lxApi) {
    log(`[lxPluginRequest] 插件 lxApi 未保存: ${source.name}`);
    return null;
  }

  // [修复防御]: 用局部变量保存，避免闭包内 TypeScript null 检查失败
  const requestHandler = state.requestHandler;
  const lxApi = state.lxApi;

  // [修复防御]: 用请求锁串行化，避免多插件并发时 globalThis.lx 被覆盖
  // 调用前临时设置 globalThis.lx = lxApi，确保插件内部 lx.request 指向正确的 lxApi
  // (lx-music-desktop 每个插件在独立 BrowserWindow，globalThis.lx 不会冲突；我们共享主窗口，需串行)
  const run = _requestLock.then(async () => {
    const prevLx = (globalThis as any).lx;
    (globalThis as any).lx = lxApi;
    log(`[lxPluginRequest] 调用 ${source.name} ${action} source=${data.source} type=${data.type || '-'}`);
    try {
      const response = await Promise.race([
        Promise.resolve(requestHandler({
          source: data.source,
          action,
          info: {
            type: data.type,
            musicInfo: data.musicInfo,
          },
        })),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`请求超时(${REQUEST_TIMEOUT / 1000}s)`)), REQUEST_TIMEOUT),
        ),
      ]);

      // 构造与 lx-music-desktop handleRequest 一致的返回格式
      switch (action) {
        case 'musicUrl':
          if (typeof response !== 'string' || response.length > 2048 || !/^https?:/.test(response)) {
            throw new Error('Invalid musicUrl response');
          }
          log(`[lxPluginRequest] ${source.name} musicUrl 成功: ${response.substring(0, 80)}...`);
          return {
            source: data.source,
            action,
            data: { type: data.type, url: response },
          };
        case 'lyric':
          // [修复防御]: 验证 lyric 响应格式, 与 iframe handleRequest 的验证逻辑一致
          if (typeof response !== 'object' || response === null) {
            throw new Error('lyric response is not an object');
          }
          if (typeof response.lyric !== 'string' || response.lyric.length === 0) {
            throw new Error(`lyric response missing or empty: ${JSON.stringify(response).substring(0, 100)}`);
          }
          if (response.lyric.length > 51200) {
            throw new Error('lyric response too large');
          }
          return {
            source: data.source,
            action,
            data: {
              lyric: response.lyric,
              tlyric: (typeof response.tlyric === 'string' && response.tlyric.length < 5120) ? response.tlyric : null,
              rlyric: (typeof response.rlyric === 'string' && response.rlyric.length < 5120) ? response.rlyric : null,
              lxlyric: (typeof response.lxlyric === 'string' && response.lxlyric.length < 51200) ? response.lxlyric : null,
            },
          };
        case 'pic':
          if (typeof response !== 'string' || response.length > 2048 || !/^https?:/.test(response)) {
            throw new Error('Invalid pic response');
          }
          return {
            source: data.source,
            action,
            data: response,
          };
        default:
          return response;
      }
    } finally {
      // [修复防御]: 恢复 globalThis.lx，避免污染其他插件
      // (requestHandler 返回的 Promise resolve 时，插件内部 lx.request 回调已完成)
      (globalThis as any).lx = prevLx;
    }
  });
  // 串行化：无论成功失败都释放锁给下一个请求
  _requestLock = run.then(() => undefined, () => undefined);

  try {
    return await run;
  } catch (e) {
      // [修复防御]: 错误对象可能不是 Error 实例 (插件可能抛出字符串或任意值)
      const errMsg = e instanceof Error ? e.message : (typeof e === 'string' ? e : String(e || 'unknown error'));
      log(`[lxPluginRequest] ${source.name} ${action} 失败: ${errMsg}`);

      // [歌曲级错误] 当错误表明歌曲本身不可用（不存在/版权限制/VIP 等），
      // 换音质无法解决，抛出 LxSongLevelError 让调用方立即停止音质回退循环，
      // 避免对同一首不可用的歌曲发起 12 次无意义的 HTTP 请求。
      if (action === 'musicUrl' && isSongLevelError(errMsg)) {
        throw new LxSongLevelError(errMsg);
      }

      return null;
  }
}

export async function lxPluginGetMusicUrl(
  source: PluginSource, sourceKey: string, songInfo: any, quality: string = '320k',
): Promise<{ type: string; url: string } | null> {
  const result = await lxPluginRequest(source, 'musicUrl', { source: sourceKey, type: quality, musicInfo: songInfo });
  // [修复防御]: lxPluginRequest 返回 iframe 原始格式 { source, action, data: {...} }，需解包 data
  return result?.data ?? result ?? null;
}

export async function lxPluginGetLyric(
  source: PluginSource, sourceKey: string, songInfo: any,
): Promise<{ lyric: string; tlyric: string | null; rlyric: string | null; lxlyric: string | null } | null> {
  const result = await lxPluginRequest(source, 'lyric', { source: sourceKey, musicInfo: songInfo });
  // [修复防御]: lxPluginRequest 现在返回 { source, action, data: { lyric, tlyric, rlyric, lxlyric } }
  // data 层已由 lxPluginRequest 的 lyric 分支构造，无需额外解包
  if (!result?.data) return null;
  return result.data as { lyric: string; tlyric: string | null; rlyric: string | null; lxlyric: string | null };
}

export async function lxPluginGetPic(
  source: PluginSource, sourceKey: string, songInfo: any,
): Promise<string | null> {
  const result = await lxPluginRequest(source, 'pic', { source: sourceKey, musicInfo: songInfo });
  // [修复防御]: pic 的 data 直接是 URL 字符串
  return result?.data ?? result ?? null;
}

// ==================== 插件状态查询 ====================

export function getLxPluginInitInfo(sourceId: string): LxInitInfo | null {
  return lxPlugins.get(sourceId)?.initInfo ?? null;
}

export function getLxPluginStatus(sourceId: string): LxPluginState | null {
  return lxPlugins.get(sourceId) ?? null;
}

export async function ensureLxPluginInstance(source: PluginSource): Promise<LxPluginState | null> {
  // [修复防御]: 禁用的插件不自动初始化
  if (!source.enabled) {
    log(`[ensureLxPluginInstance] 插件已禁用，跳过: ${source.name}`);
    return null;
  }
  const state = lxPlugins.get(source.id);
  if (state && state.status === 'ready') return state;

  // [修复防御]: 并发初始化锁 —— 同一插件的并发调用共享同一个初始化 Promise，
  // 避免两个调用同时进入 loadLxPluginFromScript 导致互相销毁 loading 实例
  const existing = _ensureLock.get(source.id);
  if (existing) {
    log(`[ensureLxPluginInstance] 等待已存在的初始化 Promise: ${source.name}`);
    return existing;
  }

  const initPromise = (async () => {
    log(`落雪插件实例未缓存，重新加载: ${source.name} (${source.filePath})`);
    try {
      // [修复防御]: 使用带缓存的 fetchLxPluginScript，避免同一脚本被反复 fetch
      const script = await fetchLxPluginScript(source.filePath);

      if (script) {
        const result = await loadLxPluginFromScript(script, source.filePath);
        // [修复防御]: 用 source.id 也缓存一份，确保后续 lxPluginRequest 能找到
        if (result && result.id !== source.id) {
          const newState = lxPlugins.get(result.id);
          if (newState) {
            lxPlugins.set(source.id, newState);
          }
        }
      }

      return lxPlugins.get(source.id) || null;
    } catch (e) {
      log(`落雪插件重新加载失败: ${source.name} ${e}`);
      return null;
    } finally {
      // 初始化完成（成功或失败）后清除锁，允许后续重试
      _ensureLock.delete(source.id);
    }
  })();

  _ensureLock.set(source.id, initPromise);
  return initPromise;
}

/** 销毁落雪插件实例 */
export function destroyLxPlugin(sourceId: string) {
  const state = lxPlugins.get(sourceId);
  if (!state) return;
  // [修复防御]: 清理所有待处理请求，避免 resolve/reject 泄漏
  for (const [key, pending] of state.pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Plugin destroyed'));
    state.pendingRequests.delete(key);
  }
  // [新方案] 清理 requestHandler
  state.requestHandler = null;
  state.lxApi = null;  // [修复防御] 清理 lxApi 引用，避免销毁后仍能调用
  state.status = 'error';
  state.initInfo = null;
  lxPlugins.delete(sourceId);
  log(`落雪插件已销毁: ${sourceId}`);
}

// ==================== 插件启用时初始化 ====================

/**
 * 启用落雪插件时调用 —— 读取脚本并直接 eval 初始化
 * 与 lx-music-desktop setUserApi → createWindow → initEnv 流程一致
 */
export async function initLxPlugin(source: PluginSource): Promise<boolean> {
  // 已就绪则直接返回
  const existing = lxPlugins.get(source.id);
  if (existing && existing.status === 'ready') return true;

  // 有残留状态则先销毁
  if (existing) {
    destroyLxPlugin(source.id);
  }

  log(`[initLxPlugin] 开始初始化: ${source.name} (${source.filePath})`);

  try {
    // [修复防御]: 使用带缓存的 fetchLxPluginScript，避免同一脚本被反复 fetch
    const script = await fetchLxPluginScript(source.filePath);

    if (!script) {
      log(`[initLxPlugin] 无法读取脚本: ${source.filePath}`);
      return false;
    }

    const result = await loadLxPluginFromScript(script, source.filePath);
    // [修复防御]: 区分真正初始化成功（sources 非空）和 fallback（初始化失败但允许导入）
    if (result && result.sources && result.sources.length > 0) {
      // [修复防御]: 用 source.id（localStorage 中的旧 hash）也缓存一份
      // loadLxPluginFromScript 用 SHA256(script) 作为 key，如果脚本内容变化，新 hash 与旧 source.id 不同
      // 导致后续 ensureLxPluginInstance/lxPluginRequest 通过 source.id 找不到缓存
      if (result.id !== source.id) {
        const newState = lxPlugins.get(result.id);
        if (newState) {
          lxPlugins.set(source.id, newState);
        }
      }
      log(`[initLxPlugin] 初始化成功: ${source.name}`);
      return true;
    } else {
      log(`[initLxPlugin] 初始化失败: ${source.name} (sources 为空)`);
      return false;
    }
  } catch (e: any) {
    log(`[initLxPlugin] 初始化异常: ${source.name} - ${e?.message}`);
    return false;
  }
}

/** 获取落雪插件状态标签（供 UI 显示） */
export function getLxPluginStatusLabel(sourceId: string): string {
  const state = lxPlugins.get(sourceId);
  if (!state) return '未初始化';
  switch (state.status) {
    case 'loading': return '初始化中...';
    case 'ready': return '就绪';
    case 'error': return '初始化失败';
    default: return '未知';
  }
}

// ==================== 辅助函数 ====================

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  return Promise.race([
    fetch(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`fetch 超时(${ms / 1000}s): ${url}`)), ms),
    ),
  ]);
}
