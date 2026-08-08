/**
 * 插件沙箱类型定义 —— 主线程与 Worker 之间的通信协议
 *
 * 设计要点：
 *   1. 主线程 → Worker: WorkerCommand（加载插件、调用方法、销毁）
 *   2. Worker → 主线程: WorkerEvent（结果、错误、代理请求）
 *   3. 代理请求: Worker 通过 ProxyRequest 请求主线程执行受限操作（HTTP、Cookie、Storage）
 *   4. RPC 模式: 每个请求带唯一 id，主线程/Worker 通过 id 匹配响应
 */

// ==================== 代理操作类型 ====================

export type ProxyAction =
  | 'http_request'
  | 'http_request_binary'
  | 'cookie_get'
  | 'cookie_set'
  | 'cookie_capture'
  | 'cookie_flush'
  | 'storage_set'
  | 'storage_get'
  | 'storage_remove'
  | 'user_vars_get'
  | 'log';

// ==================== 代理请求/响应 ====================

export interface ProxyRequest {
  __rpc: true;
  id: number;
  action: ProxyAction;
  payload: Record<string, any>;
}

export interface ProxyResponse {
  __rpc: true;
  id: number;
  ok: boolean;
  data?: any;
  error?: string;
}

// ==================== Worker 命令（主线程 → Worker）====================

export type WorkerCommand =
  | { type: 'load_musicfree'; pluginId: string; script: string; userVariables: Record<string, string> }
  | { type: 'load_lx'; pluginId: string; script: string; scriptInfo: LxScriptInfo }
  | { type: 'call_method'; pluginId: string; method: string; args: any[]; callId?: number; userVars?: Record<string, string> }
  | { type: 'destroy'; pluginId: string }
  | { type: 'proxy_response'; response: ProxyResponse };

// ==================== Worker 事件（Worker → 主线程）====================

export type WorkerEvent =
  | { type: 'loaded'; pluginId: string; success: boolean; instance?: any; error?: string }
  | { type: 'method_result'; pluginId: string; callId: number; success: boolean; data?: any; error?: string }
  | { type: 'proxy_request'; request: ProxyRequest }
  | { type: 'error'; pluginId: string; message: string }
  | { type: 'log'; level: 'log' | 'warn' | 'error'; message: string };

// ==================== 辅助类型 ====================

export interface LxScriptInfo {
  name: string;
  version: string;
  author: string;
  description: string;
  homepage: string;
}

// ==================== HTTP 代理类型 ====================

export interface HttpProxyResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
}
