/**
 * 落雪（LX）插件引擎 —— 适配 lx-music-desktop UserApi 插件格式
 *
 * 核心设计（与 lx-music-desktop 一致）：
 *   lx-music-desktop 使用独立 BrowserWindow + contextBridge 隔离运行插件脚本
 *   本引擎使用隐藏 iframe + postMessage 实现同等隔离
 *
 * 通信协议：
 *   主窗口 → iframe:  { type: 'lx-init', script, scriptInfo }
 *   主窗口 → iframe:  { type: 'lx-request', requestKey, data }
 *   iframe → 主窗口:  { type: 'lx-inited', info } | { type: 'lx-inited-error', message }
 *   iframe → 主窗口:  { type: 'lx-response', requestKey, result } | { type: 'lx-response-error', requestKey, message }
 *   iframe → 主窗口:  { type: 'lx-log', messages }
 *   iframe → 主窗口:  { type: 'lx-http-request', requestId, method, url, headers, body }
 *   主窗口 → iframe:  { type: 'lx-http-response', requestId, response } | { type: 'lx-http-error', requestId, error }
 */

import CryptoJs from 'crypto-js';
import { Buffer } from 'buffer';
import type { PluginSource } from '../types';
import { invoke } from '@tauri-apps/api/core';

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
if (!(window as any).__lxDebugLogs) {
  (window as any).__lxDebugLogs = [];
}
const debugLogs: DebugLogEntry[] = (window as any).__lxDebugLogs;

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

interface LxSourceInfo {
  type: 'music';
  actions: string[];
  qualitys: string[];
}

interface LxInitInfo {
  sources: Record<string, LxSourceInfo>;
  openDevTools?: boolean;
}

interface LxPluginState {
  source: PluginSource;
  initInfo: LxInitInfo | null;
  status: 'loading' | 'ready' | 'error';
  errorMessage?: string;
  iframe: HTMLIFrameElement | null;  // 保留字段兼容旧代码，新方案不再使用 iframe
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
      const { pluginApi } = await import('./tauri/pluginApi');
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
      const { pluginApi } = await import('./tauri/pluginApi');
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

// ==================== iframe HTML（模拟 lx-music-desktop 的 user-api.html + preload.js）====================

/**
 * 生成注入到 iframe 的 HTML 内容
 * 完整复刻 lx-music-desktop preload.js 的 contextBridge.exposeInMainWorld('lx', {...}) 行为
 */
function buildIframeHtml(scriptInfo: { name: string; version: string; author: string; description: string; homepage: string }, rawScript: string): string {
  // [修复防御]: 用 JSON.stringify 注入脚本，完全避免 eval + 模板字符串的转义问题
  // 之前的 escapedScript 转义方式（\\, \`, \$）在模板字符串中可能有边界情况
  // 例如 \\n 在模板字符串中会被解析为换行符，而非字面量 \n
  // JSON.stringify 会正确处理所有特殊字符，escapedRawScript 额外处理 </script>
  const escapedRawScript = JSON.stringify(rawScript).replace(/<\/script/gi, '<\\/script');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head><body>
<script>
// ==================== 错误捕获（与 lx-music-desktop preload.js 一致）====================
// [修复防御]: 初始化完成后的 unhandledrejection 不再发送 lx-inited-error
// 落雪插件（如 ikun）的 checkUpdate() 是异步且无 catch 的，HTTP 失败会产生 unhandledrejection
// 如果在初始化完成后仍发送 lx-inited-error，会与 lx-inited 产生竞争，导致初始化被误判为失败
window.addEventListener('error', function(event) {
  if (event.isTrusted && !isInitedApi) {
    parent.postMessage({ type: 'lx-inited-error', message: String(event.message || event).substring(0, 1024) }, '*');
  } else if (event.isTrusted) {
    parent.postMessage({ type: 'lx-log', messages: ['[error] ' + String(event.message || event).substring(0, 512)] }, '*');
  }
});
window.addEventListener('unhandledrejection', function(event) {
  if (!event.isTrusted) return;
  var message = typeof event.reason === 'string' ? event.reason : (event.reason && event.reason.message ? event.reason.message : String(event.reason));
  // [修复防御]: 初始化已完成时，仅记录日志，不触发 lx-inited-error
  if (!isInitedApi) {
    parent.postMessage({ type: 'lx-inited-error', message: message.substring(0, 1024) }, '*');
  } else {
    parent.postMessage({ type: 'lx-log', messages: ['[unhandledrejection] ' + message.substring(0, 512)] }, '*');
  }
});

// ==================== 常量（与 lx-music-desktop preload.js 一致）====================
var EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' };
var eventNames = Object.values(EVENT_NAMES);
var events = { request: null };
var allSources = ['kw', 'kg', 'tx', 'wy', 'mg', 'local'];
var supportQualitys = {
  kw: ['128k', '320k', 'flac', 'flac24bit'],
  kg: ['128k', '320k', 'flac', 'flac24bit'],
  tx: ['128k', '320k', 'flac', 'flac24bit'],
  wy: ['128k', '320k', 'flac', 'flac24bit'],
  mg: ['128k', '320k', 'flac', 'flac24bit'],
  local: []
};
var supportActions = {
  kw: ['musicUrl'], kg: ['musicUrl'], tx: ['musicUrl'],
  wy: ['musicUrl'], mg: ['musicUrl'], local: ['musicUrl', 'lyric', 'pic']
};
var isInitedApi = false;

// ==================== handleInit（与 lx-music-desktop preload.js handleInit 一致）====================
function handleInit(context, info) {
  parent.postMessage({ type: 'lx-log', messages: ['[DEBUG-handleInit] 入口, info=' + (info ? '有' : '无') + ', sources keys=' + (info && info.sources ? Object.keys(info.sources).join(',') : 'none')] }, '*');
  if (!info) {
    parent.postMessage({ type: 'lx-inited-error', message: 'Missing required parameter init info' }, '*');
    return;
  }
  var sourceInfo = { sources: {} };
  try {
    for (var i = 0; i < allSources.length; i++) {
      var source = allSources[i];
      var userSource = info.sources && info.sources[source];
      if (!userSource || userSource.type !== 'music') continue;
      var qualitys = supportQualitys[source];
      var actions = supportActions[source];
      sourceInfo.sources[source] = {
        type: 'music',
        actions: actions.filter(function(a) { return userSource.actions && userSource.actions.indexOf(a) !== -1; }),
        qualitys: qualitys.filter(function(q) { return userSource.qualitys && userSource.qualitys.indexOf(q) !== -1; })
      };
    }
    // 保留非标准源
    if (info.sources) {
      var keys = Object.keys(info.sources);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        if (sourceInfo.sources[key]) continue;
        var val = info.sources[key];
        if (val.type !== 'music') continue;
        sourceInfo.sources[key] = val;
      }
    }
  } catch (error) {
    parent.postMessage({ type: 'lx-log', messages: ['[DEBUG-handleInit] 异常: ' + error.message + ' stack=' + (error.stack ? error.stack.substring(0, 300) : 'none')] }, '*');
    parent.postMessage({ type: 'lx-inited-error', message: error.message }, '*');
    return;
  }
  parent.postMessage({ type: 'lx-log', messages: ['[DEBUG-handleInit] 成功, sourceInfo.sources keys=' + Object.keys(sourceInfo.sources).join(',')] }, '*');
  parent.postMessage({ type: 'lx-inited', info: sourceInfo }, '*');
}

// ==================== handleRequest（与 lx-music-desktop preload.js handleRequest 一致）====================
function handleRequest(context, data) {
  if (!events.request) {
    parent.postMessage({ type: 'lx-response-error', requestKey: data.requestKey, message: 'Request event is not defined' }, '*');
    return;
  }
  try {
    events.request.call(context, { source: data.data.source, action: data.data.action, info: data.data.info }).then(function(response) {
      var sendData = { requestKey: data.requestKey };
      switch (data.data.action) {
        case 'musicUrl':
          if (typeof response != 'string' || response.length > 2048 || !/^https?:/.test(response)) throw new Error('failed');
          sendData.result = { source: data.data.source, action: data.data.action, data: { type: data.data.info.type, url: response } };
          break;
        case 'lyric':
          if (typeof response != 'object' || typeof response.lyric != 'string') throw new Error('failed');
          if (response.lyric.length > 51200) throw new Error('failed');
          sendData.result = {
            source: data.data.source, action: data.data.action,
            data: {
              lyric: response.lyric,
              tlyric: (typeof response.tlyric == 'string' && response.tlyric.length < 5120) ? response.tlyric : null,
              rlyric: (typeof response.rlyric == 'string' && response.rlyric.length < 5120) ? response.rlyric : null,
              lxlyric: (typeof response.lxlyric == 'string' && response.lxlyric.length < 8192) ? response.lxlyric : null,
            }
          };
          break;
        case 'pic':
          if (typeof response != 'string' || response.length > 2048 || !/^https?:/.test(response)) throw new Error('failed');
          sendData.result = { source: data.data.source, action: data.data.action, data: response };
          break;
      }
      parent.postMessage({ type: 'lx-response', requestKey: sendData.requestKey, result: sendData.result }, '*');
    }).catch(function(err) {
      parent.postMessage({ type: 'lx-response-error', requestKey: data.requestKey, message: err.message }, '*');
    });
  } catch (err) {
    parent.postMessage({ type: 'lx-response-error', requestKey: data.requestKey, message: err.message }, '*');
  }
}

// ==================== lx 对象（与 lx-music-desktop preload.js contextBridge.exposeInMainWorld 一致）====================
var lx = {
  EVENT_NAMES: EVENT_NAMES,
  request: function(url, options, callback) {
    // 与 lx-music-desktop preload.js lx.request() 一致
    // 通过 postMessage 请求主窗口代理 HTTP 请求
    options = options || {};
    var requestId = 'req_' + Math.random().toString(36).substring(2);
    var method = (options.method || 'get').toUpperCase();
    var headers = Object.assign({}, options.headers);
    var body;
    if (options.body) {
      body = typeof options.body === 'object' ? JSON.stringify(options.body) : String(options.body);
    } else if (options.form) {
      var parts = [];
      for (var k in options.form) { parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(options.form[k])); }
      body = parts.join('&');
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (options.formData) {
      body = typeof options.formData === 'object' ? JSON.stringify(options.formData) : String(options.formData);
    }
    if (method === 'POST' && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    parent.postMessage({ type: 'lx-log', messages: ['[lx.request] ' + method + ' ' + url] }, '*');

    parent.postMessage({
      type: 'lx-http-request',
      requestId: requestId,
      method: method,
      url: url,
      headers: headers,
      body: body || null,
      timeout: options.timeout || null,
      follow: typeof options.follow === 'number' ? options.follow : (options.follow_max != null ? options.follow_max : null),
    }, '*');

    // 监听响应
    var handler = function(event) {
      if (event.data && event.data.requestId === requestId) {
        window.removeEventListener('message', handler);
        if (event.data.type === 'lx-http-response') {
          parent.postMessage({ type: 'lx-log', messages: ['[lx.request] 响应 ' + event.data.resp.statusCode] }, '*');
          try {
            callback.call(null, null, event.data.resp, event.data.body);
          } catch(e) {
            parent.postMessage({ type: 'lx-inited-error', message: e.message }, '*');
          }
        } else if (event.data.type === 'lx-http-error') {
          parent.postMessage({ type: 'lx-log', messages: ['[lx.request] 错误 ' + event.data.error] }, '*');
          callback.call(null, new Error(event.data.error), null, null);
        }
      }
    };
    window.addEventListener('message', handler);
    // 返回取消函数
    return function() { window.removeEventListener('message', handler); };
  },
  send: function(eventName, data) {
    parent.postMessage({ type: 'lx-log', messages: ['[DEBUG-send] 入口, eventName=' + eventName + ', isInitedApi=' + isInitedApi] }, '*');
    return new Promise(function(resolve, reject) {
      if (eventNames.indexOf(eventName) === -1) return reject(new Error('The event is not supported: ' + eventName));
      switch (eventName) {
        case EVENT_NAMES.inited:
          if (isInitedApi) return reject(new Error('Script is inited'));
          isInitedApi = true;
          parent.postMessage({ type: 'lx-log', messages: ['[DEBUG-send] inited 事件, 调用 handleInit, data.sources keys=' + (data && data.sources ? Object.keys(data.sources).join(',') : 'none')] }, '*');
          handleInit(this, data);
          resolve();
          break;
        case EVENT_NAMES.updateAlert:
          parent.postMessage({ type: 'lx-log', messages: ['[updateAlert] ignored'] }, '*');
          resolve();
          break;
        default:
          reject(new Error('Unknown event name: ' + eventName));
      }
    });
  },
  on: function(eventName, handler) {
    if (eventNames.indexOf(eventName) === -1) return Promise.reject(new Error('The event is not supported: ' + eventName));
    switch (eventName) {
      case EVENT_NAMES.request:
        events.request = handler;
        break;
      default:
        return Promise.reject(new Error('The event is not supported: ' + eventName));
    }
    return Promise.resolve();
  },
  utils: {
    crypto: {
      aesEncrypt: function() { throw new Error('lx.utils.crypto.aesEncrypt not implemented'); },
      rsaEncrypt: function() { throw new Error('lx.utils.crypto.rsaEncrypt not implemented'); },
      randomBytes: function(size) {
        var arr = new Uint8Array(size);
        crypto.getRandomValues(arr);
        return arr;
      },
      md5: function(str) {
        // [修复防御]: 真正的 MD5 实现，与 lx-music-desktop preload.js 的 crypto.createHash('md5') 一致
        // 野花🌷等插件用 md5(version) 与服务器返回的 hash 比对，假 MD5 会导致"服务器异常"
        function md5cycle(x, k) {
          var a = x[0], b = x[1], c = x[2], d = x[3];
          a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
          c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
          a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
          c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
          a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
          c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
          a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
          c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
          a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
          c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
          a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
          c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
          a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
          c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
          a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
          c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
          a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
          c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
          a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
          c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
          a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
          c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
          a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835);
          c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
          a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415);
          c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
          a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606);
          c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
          a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
          c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
          a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
          c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
          x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
        }
        function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s) | (a >>> (32 - s)), b); }
        function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
        function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
        function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
        function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
        function md51(s) {
          var n = s.length, state = [1732584193, -271733879, -1732584194, 271733878], i;
          for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(s.substring(i - 64, i)));
          s = s.substring(i - 64);
          var tail = [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0];
          for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
          tail[i >> 2] |= 0x80 << ((i % 4) << 3);
          if (i > 55) { md5cycle(state, tail); for (i = 0; i < 16; i++) tail[i] = 0; }
          tail[14] = n * 8;
          md5cycle(state, tail);
          return state;
        }
        function md5blk(s) {
          var md5blks = [], i;
          for (i = 0; i < 64; i += 4) md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
          return md5blks;
        }
        var hex_chr = '0123456789abcdef'.split('');
        function rhex(n) { var s = '', j = 0; for (; j < 4; j++) s += hex_chr[(n >> (j * 8 + 4)) & 0x0f] + hex_chr[(n >> (j * 8)) & 0x0f]; return s; }
        function hex(x) { for (var i = 0; i < x.length; i++) x[i] = rhex(x[i]); return x.join(''); }
        function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
        var result = hex(md51(str));
        // [调试日志]: 输出 md5 输入（截断）和输出，用于排查版本校验失败
        parent.postMessage({ type: 'lx-log', messages: ['[md5] input=' + (str.length > 40 ? str.substring(0, 40) + '...(len=' + str.length + ')' : str) + ' output=' + result] }, '*');
        return result;
      },
    },
    // [修复防御]: 部分混淆插件使用 T.md5.hash(str) 而非 T.crypto.md5(str)
    // 同时暴露两种调用路径，与 lx-music-desktop 兼容
    md5: {
      hash: function(str) { return lx.utils.crypto.md5(str); }
    },
    buffer: {
      from: function(input, encoding) {
        if (typeof input === 'string') {
          if (encoding === 'base64') {
            var binaryStr = atob(input);
            var bytes = new Uint8Array(binaryStr.length);
            for (var i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
            return bytes;
          }
          if (encoding === 'hex') {
            var hexStr = input.match(/.{1,2}/g);
            return new Uint8Array(hexStr ? hexStr.map(function(b) { return parseInt(b, 16); }) : []);
          }
          return new TextEncoder().encode(input);
        }
        if (Array.isArray(input)) return new Uint8Array(input);
        return new Uint8Array(0);
      },
      bufToString: function(buf, format) {
        var arr = new Uint8Array(buf);
        switch (format) {
          case 'hex':
            return Array.from(arr).reduce(function(s, b) { return s + b.toString(16).padStart(2, '0'); }, '');
          case 'base64':
            var binary = '';
            for (var i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
            return btoa(binary);
          default:
            return new TextDecoder().decode(arr);
        }
      }
    },
    zlib: {
      inflate: function(buf) {
        return parent.postMessage({ type: 'lx-log', messages: ['[zlib.inflate] not implemented'] }, '*') || Promise.reject(new Error('zlib not available'));
      },
      deflate: function(data) {
        return parent.postMessage({ type: 'lx-log', messages: ['[zlib.deflate] not implemented'] }, '*') || Promise.reject(new Error('zlib not available'));
      }
    }
  },
  currentScriptInfo: {
    name: ${JSON.stringify(scriptInfo.name)},
    description: ${JSON.stringify(scriptInfo.description)},
    version: ${JSON.stringify(scriptInfo.version)},
    author: ${JSON.stringify(scriptInfo.author)},
    homepage: ${JSON.stringify(scriptInfo.homepage)},
    rawScript: ${escapedRawScript}
  },
  version: '2.0.0',
  env: 'desktop'
};

// 注入到全局（与 lx-music-desktop contextBridge.exposeInMainWorld 等效）
window.lx = lx;

// ==================== require 桩（落雪插件可能 require Node 模块）====================
window.require = function(packageName) {
  parent.postMessage({ type: 'lx-log', messages: ['[require] ' + packageName + ' - stub'] }, '*');
  var emptyModule = {};
  emptyModule.default = emptyModule;
  return emptyModule;
};

// ==================== 监听主窗口请求（与 lx-music-desktop ipcRenderer.on(request) 一致）====================
window.addEventListener('message', function(event) {
  if (!event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'lx-request') {
    handleRequest(lx, event.data);
  }
});

// ==================== 执行插件脚本（与 lx-music-desktop webFrame.executeJavaScript 一致）====================
parent.postMessage({ type: 'lx-log', messages: ['[DEBUG-IFRAME] 脚本开始执行, 长度=' + ${escapedRawScript}.length] }, '*');
parent.postMessage({ type: 'lx-log', messages: ['[DEBUG-IFRAME] globalThis.lx 存在=' + (typeof globalThis.lx !== 'undefined') + ', keys=' + (typeof globalThis.lx === 'object' ? Object.keys(globalThis.lx).join(',') : 'N/A')] }, '*');
try {
  // [修复防御]: 用 JSON.parse 恢复原始脚本，避免 eval + 模板字符串的转义问题
  var __pluginScript = ${escapedRawScript};
  (0, eval)(__pluginScript);
  parent.postMessage({ type: 'lx-log', messages: ['[DEBUG-IFRAME] 脚本 eval 执行完成(无同步异常), isInitedApi=' + isInitedApi] }, '*');
} catch(e) {
  parent.postMessage({ type: 'lx-log', messages: ['[DEBUG-IFRAME] 脚本 eval 同步异常: ' + (e && e.message ? e.message : String(e)) + ' stack=' + (e && e.stack ? e.stack.substring(0, 500) : 'none')] }, '*');
  parent.postMessage({ type: 'lx-inited-error', message: 'Script eval error: ' + (e && e.message ? e.message : String(e)) }, '*');
}
parent.postMessage({ type: 'lx-log', messages: ['[DEBUG-IFRAME] 脚本执行后检查: isInitedApi=' + isInitedApi + ', events.request=' + (typeof events.request)] }, '*');
</script>
</body></html>`;
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
  if (/globalThis\s*\[\s*['"]lx['"]\s*\]/.test(trimmed)) return true;
  if (/globalThis\s*\.\s*lx\b/.test(trimmed)) return true;
  // 4. 混淆插件可能在解构时引用 globalThis.lx（如 const { EVENT_NAMES } = globalThis.lx）
  if (/globalThis/.test(trimmed) && /\bEVENT_NAMES\b/.test(trimmed)) return true;

  return false;
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
    const { pluginApi } = await import('./tauri/pluginApi');
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
    throw new Error(errMsg);
  }
}

// ==================== iframe 消息处理 ====================

/** 处理来自 iframe 的 postMessage */
function setupIframeMessageHandler(_iframeId: string, state: LxPluginState, initResolve: (info: LxInitInfo) => void, initReject: (err: Error) => void) {
  let initDone = false;

  function handler(event: MessageEvent) {
    // 只处理来自目标 iframe 的消息
    const iframe = state.iframe;
    if (!iframe || !iframe.contentWindow) return;
    if (event.source !== iframe.contentWindow) return;
    if (!event.data || typeof event.data !== 'object') return;

    const data = event.data;

    switch (data.type) {
      case 'lx-inited': {
        if (initDone) return;
        initDone = true;
        log(`[iframe→主窗口] 插件初始化成功, sources: ${data.info?.sources ? Object.keys(data.info.sources).join(',') : 'none'}`);
        initResolve(data.info as LxInitInfo);
        break;
      }

      case 'lx-inited-error': {
        if (initDone) return;
        initDone = true;
        log(`[iframe→主窗口] 插件初始化错误: ${data.message}`);
        initReject(new Error(data.message || 'Unknown init error'));
        break;
      }

      case 'lx-response': {
        const pending = state.pendingRequests.get(data.requestKey);
        if (pending) {
          clearTimeout(pending.timer);
          state.pendingRequests.delete(data.requestKey);
          pending.resolve(data.result);
        }
        break;
      }

      case 'lx-response-error': {
        const pending = state.pendingRequests.get(data.requestKey);
        if (pending) {
          clearTimeout(pending.timer);
          state.pendingRequests.delete(data.requestKey);
          pending.reject(new Error(data.message || 'Request failed'));
        }
        break;
      }

      case 'lx-http-request': {
        // iframe 请求主窗口代理 HTTP 请求
        handleLxHttpRequest(iframe, data);
        break;
      }

      case 'lx-log': {
        const msgs = data.messages || [];
        for (const m of msgs) log(`[LX] ${m}`);
        break;
      }
    }
  }

  window.addEventListener('message', handler);

  // 返回清理函数
  return () => {
    window.removeEventListener('message', handler);
  };
}

/** 处理 iframe 发来的 HTTP 请求，代理后返回结果 */
async function handleLxHttpRequest(iframe: HTMLIFrameElement, data: { requestId: string; method: string; url: string; headers: Record<string, string>; body: string | null; timeout?: number | null; follow?: number | null }) {
  log(`[HTTP代理] ${data.method} ${data.url}`);
  try {
    const defaultHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
      'Accept': '*/*',
    };
    const mergedHeaders = { ...defaultHeaders, ...data.headers };

    const resp = await lxNativeRequest(data.method, data.url, mergedHeaders, data.body || undefined, data.timeout || undefined, data.follow || undefined);

    log(`[HTTP代理] 响应 ${resp.statusCode} body长度=${typeof resp.body === 'string' ? resp.body.length : JSON.stringify(resp.body).length} body=${typeof resp.body === 'string' ? resp.body.substring(0, 200) : JSON.stringify(resp.body).substring(0, 200)}`);

    if (iframe.contentWindow) {
      // [修复防御]: 完全复刻 lx-music-desktop preload.js needle 回调格式
      // needle 回调: callback(err, { statusCode, statusMessage, headers, bytes, raw, body }, body)
      // 其中 body 先是 raw.toString()，然后尝试 JSON.parse
      // 注意: postMessage 无法序列化函数，所以 raw 必须是纯字符串
      const rawBody = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body);
      let parsedBody: any = rawBody;
      try {
        parsedBody = JSON.parse(rawBody);
        // [修复防御]: 移除 vinfo 中的 m 字段（md5 校验值）
        // 野花🌷等插件用 md5(rawScript) 与 npm registry 返回的 j.m 比对做完整性校验
        // 但脚本可能在 GitHub 更新后与 npm 包中的 m 值不同步，导致校验失败抛出"服务器异常"
        // lx-music-desktop 会在导入时缓存脚本，而我们每次重新获取，所以需要跳过此校验
        if (parsedBody && typeof parsedBody === 'object' && parsedBody.vinfo) {
          for (const key of Object.keys(parsedBody.vinfo)) {
            if (typeof parsedBody.vinfo[key] === 'object' && parsedBody.vinfo[key] !== null) {
              delete parsedBody.vinfo[key].m;
            }
          }
        }
      } catch { /* not JSON, keep as string */ }

      iframe.contentWindow.postMessage({
        type: 'lx-http-response',
        requestId: data.requestId,
        resp: {
          statusCode: resp.statusCode,
          statusMessage: resp.statusMessage,
          headers: resp.headers,
          bytes: rawBody.length,
          raw: rawBody,  // [修复] 直接传字符串，postMessage 可序列化
          body: parsedBody,
        },
        body: parsedBody,
      }, '*');
    }
  } catch (e: any) {
    log(`[HTTP代理] 请求失败: ${data.method} ${data.url} - ${e?.message}`);
    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'lx-http-error',
        requestId: data.requestId,
        error: e?.message || String(e),
      }, '*');
    }
  }
}

// ==================== 插件加载 ====================

/**
 * 加载落雪 LX 插件脚本
 * 使用隐藏 iframe 隔离执行（与 lx-music-desktop 使用独立 BrowserWindow 隔离一致）
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
    iframe: null,  // [新方案] 不再使用 iframe
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
    request(url: string, options: any, callback: Function) {
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
    on(eventName: string, handler: Function) {
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
          // 简化实现：用 pako 或返回原始数据
          return buf;
        },
        async deflate(data: any) {
          return data;
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

/** 销毁 iframe */
function destroyIframe(iframe: HTMLIFrameElement | null) {
  if (!iframe) return;
  try {
    iframe.srcdoc = '';
    iframe.remove();
  } catch { /* ignore */ }
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
              lxlyric: (typeof response.lxlyric === 'string' && response.lxlyric.length < 8192) ? response.lxlyric : null,
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
  if (state) return state;

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
  }
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
  // [新方案] 清理 requestHandler，不再使用 iframe
  state.requestHandler = null;
  state.lxApi = null;  // [修复防御] 清理 lxApi 引用，避免销毁后仍能调用
  destroyIframe(state.iframe);
  state.iframe = null;
  state.status = 'error';
  state.initInfo = null;
  lxPlugins.delete(sourceId);
  log(`落雪插件已销毁: ${sourceId}`);
}

// ==================== 插件启用时初始化 ====================

/**
 * 启用落雪插件时调用 —— 读取脚本并创建 iframe 初始化
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

export function setMusicFreePackages(_pkgs: Record<string, any>) {
  // 不再需要，iframe 内部自行处理 require
}

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  return Promise.race([
    fetch(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`fetch 超时(${ms / 1000}s): ${url}`)), ms),
    ),
  ]);
}

// [已弃用] iframe 方案已废弃，改用直接 eval 方案。保留函数避免 TS6133，将来可删除
void buildIframeHtml;
void setupIframeMessageHandler;
