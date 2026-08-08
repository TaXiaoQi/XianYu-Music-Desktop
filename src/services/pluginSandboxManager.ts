/**
 * 插件沙箱管理器 —— 主线程端
 *
 * 职责：
 *   1. 创建和管理 Web Worker 实例（每个插件一个 Worker，或共享 Worker 池）
 *   2. 处理 Worker 发来的代理请求（HTTP、Cookie、Storage）
 *   3. 提供干净的 API 供 pluginEngine / lxPluginEngine 调用
 *   4. 管理 RPC 调用的 Promise 解析（方法调用、加载结果）
 *
 * 安全保障：
 *   - 插件代码在 Worker 中执行，无法直接访问主线程的 window、DOM、Tauri API
 *   - 所有外部操作（HTTP、Cookie、Storage）通过管理器代理，管理器可添加审计/限制
 *   - Worker 中的 globalThis.lx 和 packages 由管理器控制，插件无法篡改
 */

import { pluginApi } from './tauri/pluginApi';
import {
  captureCookiesFromResponse,
  setCookie,
  getCookies,
  flushCookies,
  setStorageItem,
  getStorageItem,
  removeStorageItem,
} from './pluginCookieStore';
import type {
  WorkerCommand,
  WorkerEvent,
  ProxyRequest,
  ProxyResponse,
  LxScriptInfo,
  HttpProxyResponse,
} from './pluginSandboxTypes';

// ==================== 日志 ====================

let _logCallback: ((msg: string) => void) | null = null;

function log(msg: string) {
  console.log(`[SandboxManager] ${msg}`);
  try { _logCallback?.(msg); } catch { /* ignore */ }
}

// ==================== 类型 ====================

interface PendingCall {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ManagedSandbox {
  worker: Worker;
  pluginId: string;
  format: 'musicfree' | 'lx';
  ready: boolean;
  instance: any | null;
  pendingCalls: Map<number, PendingCall>;
}

// ==================== 状态 ====================

const _sandboxes = new Map<string, ManagedSandbox>();
let _callIdCounter = 0;

// ==================== Worker 创建 ====================

/**
 * 创建一个新的 Web Worker 用于插件隔离
 *
 * 使用 Vite 的 `new Worker(new URL(...), { type: 'module' })` 语法，
 * Vite 会自动将 Worker 及其依赖打包为 ES 模块。
 */
function createWorker(): Worker {
  const worker = new Worker(
    new URL('./pluginSandbox.worker.ts', import.meta.url),
    { type: 'module' },
  );
  return worker;
}

// ==================== 代理请求处理 ====================

/**
 * 处理 Worker 发来的代理请求
 *
 * 根据请求类型分派到对应的处理函数，所有处理函数都在主线程执行：
 * - http_request: 通过 Tauri 后端发送 HTTP 请求
 * - cookie_*: 读写主线程 localStorage 中的 Cookie
 * - storage_*: 读写主线程 localStorage 中的插件存储
 */
async function handleProxyRequest(request: ProxyRequest): Promise<ProxyResponse> {
  const { id, action, payload } = request;

  try {
    let data: any;

    switch (action) {
      case 'http_request': {
        const { method, url, headers, body, timeout, follow } = payload;
        const response: HttpProxyResponse = await pluginApi.pluginHttpRequest(
          method, url, headers, body, timeout, follow,
        );

        // 自动注入 Cookie（模拟 Electron session.cookies 自动携带）
        if (url && response.headers) {
          // Cookie 注入在 Worker 端的 adapter 中已完成，这里只需捕获响应 Cookie
          captureCookiesFromResponse(url, response.headers);
        }

        data = response;
        break;
      }

      case 'cookie_get': {
        data = getCookies(payload.url);
        break;
      }

      case 'cookie_set': {
        data = setCookie(payload.url, payload.cookie);
        break;
      }

      case 'cookie_capture': {
        captureCookiesFromResponse(payload.url, payload.headers);
        data = null;
        break;
      }

      case 'cookie_flush': {
        flushCookies();
        data = null;
        break;
      }

      case 'storage_set': {
        setStorageItem(payload.key, payload.value);
        data = null;
        break;
      }

      case 'storage_get': {
        data = getStorageItem(payload.key);
        break;
      }

      case 'storage_remove': {
        removeStorageItem(payload.key);
        data = null;
        break;
      }

      case 'user_vars_get': {
        // 用户变量由 pluginEngine 管理，通过回调获取
        data = _userVarsProvider?.(payload.pluginId) || {};
        break;
      }

      case 'log': {
        const level = payload.level || 'log';
        const msg = payload.message || '';
        if (level === 'error') console.error(`[SandboxProxy] ${msg}`);
        else if (level === 'warn') console.warn(`[SandboxProxy] ${msg}`);
        else console.log(`[SandboxProxy] ${msg}`);
        data = null;
        break;
      }

      default: {
        throw new Error(`未知的代理操作: ${action}`);
      }
    }

    return { __rpc: true, id, ok: true, data };
  } catch (e: any) {
    return { __rpc: true, id, ok: false, error: e?.message || String(e) };
  }
}

// ==================== 用户变量提供器 ====================

let _userVarsProvider: ((pluginId: string) => Record<string, string>) | null = null;

/**
 * 注册用户变量提供器
 *
 * pluginEngine 在加载插件时调用此函数注册一个回调，
 * Worker 通过 RPC 请求用户变量时，管理器调用此回调获取值。
 */
export function setUserVarsProvider(provider: ((pluginId: string) => Record<string, string>) | null) {
  _userVarsProvider = provider;
}

// ==================== Worker 消息处理 ====================

function handleWorkerMessage(sandbox: ManagedSandbox, e: MessageEvent): void {
  const event = e.data as WorkerEvent;

  switch (event.type) {
    case 'loaded': {
      log(`插件加载完成: ${event.pluginId} (success=${event.success})`);
      sandbox.ready = event.success;
      sandbox.instance = event.instance || null;

      // 解析加载 Promise
      const pending = sandbox.pendingCalls.get(-1); // -1 是加载操作的特殊 ID
      if (pending) {
        clearTimeout(pending.timeout);
        sandbox.pendingCalls.delete(-1);
        if (event.success) {
          pending.resolve(event.instance);
        } else {
          pending.reject(new Error(event.error || '加载失败'));
        }
      }
      break;
    }

    case 'method_result': {
      const pending = sandbox.pendingCalls.get(event.callId);
      if (pending) {
        clearTimeout(pending.timeout);
        sandbox.pendingCalls.delete(event.callId);
        if (event.success) {
          pending.resolve(event.data);
        } else {
          pending.reject(new Error(event.error || '方法调用失败'));
        }
      }
      break;
    }

    case 'proxy_request': {
      // 处理 Worker 的代理请求
      handleProxyRequest(event.request).then((response) => {
        const cmd: WorkerCommand = { type: 'proxy_response', response };
        sandbox.worker.postMessage(cmd);
      }).catch((err) => {
        const response: ProxyResponse = {
          __rpc: true,
          id: event.request.id,
          ok: false,
          error: err?.message || String(err),
        };
        const cmd: WorkerCommand = { type: 'proxy_response', response };
        sandbox.worker.postMessage(cmd);
      });
      break;
    }

    case 'log': {
      const msg = event.message || '';
      if (event.level === 'error') console.error(msg);
      else if (event.level === 'warn') console.warn(msg);
      else console.log(msg);
      try { _logCallback?.(msg); } catch { /* ignore */ }
      break;
    }

    case 'error': {
      log(`Worker 错误 [${event.pluginId}]: ${event.message}`);
      break;
    }

    default: {
      log(`未知 Worker 事件: ${(event as any).type}`);
    }
  }
}

function handleWorkerError(sandbox: ManagedSandbox, e: ErrorEvent): void {
  log(`Worker 异常 [${sandbox.pluginId}]: ${e.message}`);
  // 拒绝所有 pending calls
  for (const pending of sandbox.pendingCalls.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(`Worker 异常: ${e.message}`));
  }
  sandbox.pendingCalls.clear();
  sandbox.ready = false;
}

// ==================== 公开 API ====================

/**
 * 在沙箱中加载 MusicFree 插件
 *
 * @param pluginId 插件唯一 ID（通常是脚本 SHA256）
 * @param script 插件源码
 * @param userVariables 用户变量值
 * @returns 插件元数据（platform, version, userVariables 等）
 */
export async function loadMusicFreeInSandbox(
  pluginId: string,
  script: string,
  userVariables: Record<string, string>,
): Promise<any> {
  // 如果已有同 ID 的沙箱，先销毁
  if (_sandboxes.has(pluginId)) {
    await destroySandbox(pluginId);
  }

  const worker = createWorker();
  const sandbox: ManagedSandbox = {
    worker,
    pluginId,
    format: 'musicfree',
    ready: false,
    instance: null,
    pendingCalls: new Map(),
  };

  // 设置消息处理器
  worker.onmessage = (e) => handleWorkerMessage(sandbox, e);
  worker.onerror = (e) => handleWorkerError(sandbox, e);

  _sandboxes.set(pluginId, sandbox);

  // 发送加载命令
  const cmd: WorkerCommand = {
    type: 'load_musicfree',
    pluginId,
    script,
    userVariables,
  };

  // 等待加载结果
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      sandbox.pendingCalls.delete(-1);
      reject(new Error('插件加载超时(30s)'));
    }, 30000);

    sandbox.pendingCalls.set(-1, {
      resolve,
      reject,
      timeout,
    });

    worker.postMessage(cmd);
  });
}

/**
 * 在沙箱中加载 LX 插件
 *
 * @param pluginId 插件唯一 ID
 * @param script 插件源码
 * @param scriptInfo 脚本元信息
 * @returns 初始化信息（sources 等）
 */
export async function loadLxInSandbox(
  pluginId: string,
  script: string,
  scriptInfo: LxScriptInfo,
): Promise<any> {
  if (_sandboxes.has(pluginId)) {
    await destroySandbox(pluginId);
  }

  const worker = createWorker();
  const sandbox: ManagedSandbox = {
    worker,
    pluginId,
    format: 'lx',
    ready: false,
    instance: null,
    pendingCalls: new Map(),
  };

  worker.onmessage = (e) => handleWorkerMessage(sandbox, e);
  worker.onerror = (e) => handleWorkerError(sandbox, e);

  _sandboxes.set(pluginId, sandbox);

  const cmd: WorkerCommand = {
    type: 'load_lx',
    pluginId,
    script,
    scriptInfo,
  };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      sandbox.pendingCalls.delete(-1);
      reject(new Error('LX 插件初始化超时(30s)'));
    }, 30000);

    sandbox.pendingCalls.set(-1, {
      resolve,
      reject,
      timeout,
    });

    worker.postMessage(cmd);
  });
}

/**
 * 在沙箱中调用插件方法
 *
 * @param pluginId 插件 ID
 * @param method 方法名（如 'search', 'getMediaSource', 'request'）
 * @param args 方法参数
 * @param timeout 超时时间（毫秒）
 * @returns 方法返回值
 */
export async function callSandboxMethod(
  pluginId: string,
  method: string,
  args: any[],
  timeout = 30000,
): Promise<any> {
  const sandbox = _sandboxes.get(pluginId);
  if (!sandbox) {
    throw new Error(`沙箱不存在: ${pluginId}`);
  }
  if (!sandbox.ready) {
    throw new Error(`沙箱未就绪: ${pluginId}`);
  }

  const callId = ++_callIdCounter;

  // 每次方法调用前获取最新用户变量（如卡密），推送到 Worker 刷新
  // 解决沙箱中 env.getUserVariables() 返回加载时快照的问题
  const freshUserVars = _userVarsProvider?.(pluginId) || {};

  const cmd: WorkerCommand = {
    type: 'call_method',
    pluginId,
    method,
    args,
    callId,
    userVars: freshUserVars,
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sandbox.pendingCalls.delete(callId);
      reject(new Error(`方法调用超时: ${method} (${timeout}ms)`));
    }, timeout);

    sandbox.pendingCalls.set(callId, {
      resolve,
      reject,
      timeout: timer,
    });

    sandbox.worker.postMessage(cmd);
  });
}

/**
 * 销毁指定插件的沙箱
 */
export async function destroySandbox(pluginId: string): Promise<void> {
  const sandbox = _sandboxes.get(pluginId);
  if (!sandbox) return;

  // 通知 Worker 清理
  try {
    const cmd: WorkerCommand = { type: 'destroy', pluginId };
    sandbox.worker.postMessage(cmd);
  } catch { /* ignore */ }

  // 拒绝所有 pending calls
  for (const [, pending] of sandbox.pendingCalls) {
    clearTimeout(pending.timeout);
    pending.reject(new Error('沙箱已销毁'));
  }
  sandbox.pendingCalls.clear();

  // 终止 Worker
  sandbox.worker.terminate();
  sandbox.ready = false;

  _sandboxes.delete(pluginId);
  log(`沙箱已销毁: ${pluginId}`);
}

/**
 * 检查沙箱是否存在且就绪
 */
export function isSandboxReady(pluginId: string): boolean {
  const sandbox = _sandboxes.get(pluginId);
  return !!sandbox?.ready;
}

/**
 * 获取沙箱中的插件实例元数据
 */
export function getSandboxInstance(pluginId: string): any | null {
  const sandbox = _sandboxes.get(pluginId);
  return sandbox?.instance || null;
}
