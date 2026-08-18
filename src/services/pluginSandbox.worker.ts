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
    throw new Error(`${label}: ${error?.message || String(error)}`, { cause: error });
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

async function proxyHttpRequestBinary(
  method: string,
  url: string,
  headers?: Record<string, string>,
  body?: string,
  timeout?: number,
  follow?: number,
): Promise<{ status: number; url: string; headers: Record<string, string>; body_base64: string }> {
  return sendToMain('http_request_binary', { method, url, headers, body, timeout, follow });
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const buf = Buffer.from(base64 || '', 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
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

    const responseType = String(config.responseType || '').toLowerCase();
    const wantsBinary = responseType === 'arraybuffer' || responseType === 'blob';
    const response = wantsBinary
      ? await proxyHttpRequestBinary(method, url, headers, body, config.timeout)
      : await proxyHttpRequest(method, url, headers, body, config.timeout);

    // 捕获 Set-Cookie
    if (response.headers) {
      await captureCookies(url, response.headers);
    }

    let responseData: any;
    if (wantsBinary) {
      const arrayBuffer = base64ToArrayBuffer((response as any).body_base64);
      responseData = responseType === 'blob'
        ? new Blob([arrayBuffer])
        : arrayBuffer;
    } else {
      try {
        responseData = JSON.parse((response as HttpProxyResponse).body);
      } catch {
        responseData = (response as HttpProxyResponse).body;
      }
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

// ==================== 纯 JS DEFLATE 解码器 ====================
//
// 基于 RFC 1951 的紧凑 inflate 实现，提供同步解压能力。
// 浏览器 DecompressionStream 仅支持异步，无法满足插件中
// zlib.inflateSync / pako.inflate 等同步调用需求。

interface HuffmanTable {
  counts: Int32Array;
  symbols: Int32Array;
}

function buildHuffmanTable(lengths: Uint8Array): HuffmanTable {
  const counts = new Int32Array(16);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
  counts[0] = 0;

  const offsets = new Int32Array(16);
  let sum = 0;
  for (let i = 1; i < 16; i++) { offsets[i] = sum; sum += counts[i]; }

  const symbols = new Int32Array(lengths.length);
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i] !== 0) symbols[offsets[lengths[i]]++] = i;
  }
  return { counts, symbols };
}

class BitReader {
  data: Uint8Array;
  bytePos = 0;
  bitPos = 0;

  constructor(data: Uint8Array) { this.data = data; }

  readBit(): number {
    if (this.bytePos >= this.data.length) throw new Error('DEFLATE: 数据意外结束');
    const bit = (this.data[this.bytePos] >> this.bitPos) & 1;
    this.bitPos++;
    if (this.bitPos === 8) { this.bitPos = 0; this.bytePos++; }
    return bit;
  }

  readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) result |= this.readBit() << i;
    return result;
  }

  alignToByte(): void {
    if (this.bitPos > 0) { this.bitPos = 0; this.bytePos++; }
  }
}

const _LEN_BASE = new Int32Array([3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258]);
const _LEN_EXTRA = new Int32Array([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0]);
const _DIST_BASE = new Int32Array([1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577]);
const _DIST_EXTRA = new Int32Array([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13]);
const _CL_ORDER = new Int32Array([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]);

function decodeHuffmanSymbol(reader: BitReader, table: HuffmanTable): number {
  let code = 0, first = 0, index = 0;
  for (let len = 1; len <= 15; len++) {
    code = (code << 1) | reader.readBit();
    const count = table.counts[len];
    if (code < first + count) return table.symbols[index + (code - first)];
    index += count;
    first = (first + count) << 1;
  }
  throw new Error('DEFLATE: 无效 Huffman 编码');
}

// 预构建固定 Huffman 表（RFC 1951 §3.2.6）
const _FIXED_LIT_LENGTHS = new Uint8Array(288);
for (let i = 0; i < 144; i++) _FIXED_LIT_LENGTHS[i] = 8;
for (let i = 144; i < 256; i++) _FIXED_LIT_LENGTHS[i] = 9;
for (let i = 256; i < 280; i++) _FIXED_LIT_LENGTHS[i] = 7;
for (let i = 280; i < 288; i++) _FIXED_LIT_LENGTHS[i] = 8;
const _FIXED_LIT_TABLE = buildHuffmanTable(_FIXED_LIT_LENGTHS);
const _FIXED_DIST_TABLE = buildHuffmanTable(new Uint8Array(30).fill(5));

function inflateBlockSync(
  output: number[],
  reader: BitReader,
  litTable: HuffmanTable,
  distTable: HuffmanTable,
): void {
  while (true) {
    const sym = decodeHuffmanSymbol(reader, litTable);
    if (sym === 256) break;
    if (sym < 256) {
      output.push(sym);
    } else {
      const lenIdx = sym - 257;
      const length = _LEN_BASE[lenIdx] + (_LEN_EXTRA[lenIdx] > 0 ? reader.readBits(_LEN_EXTRA[lenIdx]) : 0);
      const distSym = decodeHuffmanSymbol(reader, distTable);
      const distance = _DIST_BASE[distSym] + (_DIST_EXTRA[distSym] > 0 ? reader.readBits(_DIST_EXTRA[distSym]) : 0);
      const start = output.length - distance;
      for (let j = 0; j < length; j++) output.push(output[start + j]);
    }
  }
}

function inflateRawSync(data: Uint8Array): Uint8Array {
  if (!data || data.length === 0) return new Uint8Array(0);
  const reader = new BitReader(data);
  const output: number[] = [];
  let finalBlock = false;

  while (!finalBlock) {
    finalBlock = reader.readBit() === 1;
    const btype = reader.readBits(2);

    if (btype === 0) {
      // Stored block
      reader.alignToByte();
      const len = reader.data[reader.bytePos] | (reader.data[reader.bytePos + 1] << 8);
      reader.bytePos += 4; // 跳过 LEN + NLEN
      for (let i = 0; i < len; i++) output.push(reader.data[reader.bytePos++]);
    } else if (btype === 1) {
      inflateBlockSync(output, reader, _FIXED_LIT_TABLE, _FIXED_DIST_TABLE);
    } else if (btype === 2) {
      // Dynamic Huffman
      const hlit = reader.readBits(5) + 257;
      const hdist = reader.readBits(5) + 1;
      const hclen = reader.readBits(4) + 4;

      const clLengths = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) clLengths[_CL_ORDER[i]] = reader.readBits(3);
      const clTable = buildHuffmanTable(clLengths);

      const lengths = new Uint8Array(hlit + hdist);
      let i = 0;
      while (i < hlit + hdist) {
        const sym = decodeHuffmanSymbol(reader, clTable);
        if (sym < 16) {
          lengths[i++] = sym;
        } else if (sym === 16) {
          const count = reader.readBits(2) + 3;
          const prev = lengths[i - 1];
          for (let j = 0; j < count; j++) lengths[i++] = prev;
        } else if (sym === 17) {
          i += reader.readBits(3) + 3;
        } else if (sym === 18) {
          i += reader.readBits(7) + 11;
        }
      }

      inflateBlockSync(
        output, reader,
        buildHuffmanTable(lengths.subarray(0, hlit)),
        buildHuffmanTable(lengths.subarray(hlit)),
      );
    } else {
      throw new Error('DEFLATE: 无效块类型 3');
    }
  }

  return new Uint8Array(output);
}

function inflateZlibSync(data: Uint8Array): Uint8Array {
  if (data.length < 6) throw new Error('zlib: 数据过短');
  if ((data[0] & 0x0f) !== 8) throw new Error('zlib: 不支持的压缩方法');
  let offset = 2;
  if (data[1] & 0x20) offset += 4; // FDICT
  return inflateRawSync(data.subarray(offset, data.length - 4));
}

function gunzipSyncImpl(data: Uint8Array): Uint8Array {
  if (data.length < 18 || data[0] !== 0x1f || data[1] !== 0x8b) throw new Error('gzip: 无效头部');
  if (data[2] !== 8) throw new Error('gzip: 不支持的压缩方法');
  const flg = data[3];
  let offset = 10;
  if (flg & 0x04) { const xlen = data[offset] | (data[offset + 1] << 8); offset += 2 + xlen; }
  if (flg & 0x08) { while (data[offset] !== 0) offset++; offset++; }
  if (flg & 0x10) { while (data[offset] !== 0) offset++; offset++; }
  if (flg & 0x02) offset += 2;
  return inflateRawSync(data.subarray(offset, data.length - 8));
}

/** 自动检测格式（zlib / gzip / raw deflate）并解压 */
function inflateAutoSync(data: Uint8Array): Uint8Array {
  if (data.length >= 2) {
    if (data[0] === 0x1f && data[1] === 0x8b) return gunzipSyncImpl(data);
    if ((data[0] & 0x0f) === 8 && ((data[0] << 8 | data[1]) % 31 === 0)) return inflateZlibSync(data);
  }
  return inflateRawSync(data);
}

/** 将输入转为 Uint8Array */
function toUint8Array(data: any): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data && typeof data === 'object' && data.buffer instanceof ArrayBuffer) {
    return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength || data.buffer.byteLength);
  }
  return Buffer.from(data);
}

// ==================== zlib 包（对齐 Node.js zlib API）====================

const zlibPkg = {
  inflate(data: any, options?: any, callback?: any): any {
    if (typeof options === 'function') { callback = options; options = undefined; }
    const run = () => Buffer.from(inflateAutoSync(toUint8Array(data)));
    if (callback) {
      try { callback(null, run()); } catch (e) { callback(e); }
    } else {
      return run();
    }
  },
  inflateSync(data: any, _options?: any): Buffer {
    return Buffer.from(inflateAutoSync(toUint8Array(data)));
  },
  inflateRaw(data: any, options?: any, callback?: any): any {
    if (typeof options === 'function') { callback = options; options = undefined; }
    const run = () => Buffer.from(inflateRawSync(toUint8Array(data)));
    if (callback) {
      try { callback(null, run()); } catch (e) { callback(e); }
    } else {
      return run();
    }
  },
  inflateRawSync(data: any, _options?: any): Buffer {
    return Buffer.from(inflateRawSync(toUint8Array(data)));
  },
  gunzip(data: any, options?: any, callback?: any): any {
    if (typeof options === 'function') { callback = options; options = undefined; }
    const run = () => Buffer.from(gunzipSyncImpl(toUint8Array(data)));
    if (callback) {
      try { callback(null, run()); } catch (e) { callback(e); }
    } else {
      return run();
    }
  },
  gunzipSync(data: any, _options?: any): Buffer {
    return Buffer.from(gunzipSyncImpl(toUint8Array(data)));
  },
  async deflate(data: any, options?: any, callback?: any): Promise<any> {
    if (typeof options === 'function') { callback = options; options = undefined; }
    const run = async () => {
      const src = toUint8Array(data);
      const cs = new CompressionStream('deflate');
      const writer = cs.writable.getWriter();
      writer.write(src); writer.close();
      const reader = cs.readable.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (value) chunks.push(value);
        if (done) break;
      }
      const total = chunks.reduce((a, c) => a + c.length, 0);
      const result = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { result.set(c, off); off += c.length; }
      return Buffer.from(result);
    };
    if (callback) {
      run().then(r => callback(null, r)).catch(e => callback(e));
    } else {
      return run();
    }
  },
  deflateSync(_data: any, _options?: any): Buffer {
    throw new Error('zlib.deflateSync: 浏览器环境不支持同步压缩');
  },
  constants: {
    Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3,
    Z_FINISH: 4, Z_BLOCK: 5, Z_TREES: 6,
    Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2,
    Z_ERRNO: -1, Z_STREAM_ERROR: -2, Z_DATA_ERROR: -3, Z_BUF_ERROR: -5,
  },
};

// ==================== pako 包（对齐 pako API）====================

const pakoPkg = {
  inflate(data: any, options?: any): Uint8Array | string {
    const result = inflateAutoSync(toUint8Array(data));
    if (options && (options as any).to === 'string') {
      return Buffer.from(result).toString('utf-8');
    }
    return result;
  },
  inflateRaw(data: any, options?: any): Uint8Array | string {
    const result = inflateRawSync(toUint8Array(data));
    if (options && (options as any).to === 'string') {
      return Buffer.from(result).toString('utf-8');
    }
    return result;
  },
  ungzip(data: any, options?: any): Uint8Array | string {
    const result = gunzipSyncImpl(toUint8Array(data));
    if (options && (options as any).to === 'string') {
      return Buffer.from(result).toString('utf-8');
    }
    return result;
  },
  gzip(_data: any, _options?: any): Uint8Array {
    throw new Error('pako.gzip: 浏览器环境不支持同步压缩');
  },
  deflate(_data: any, _options?: any): Uint8Array {
    throw new Error('pako.deflate: 浏览器环境不支持同步压缩');
  },
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
  zlib: zlibPkg,
  pako: pakoPkg,
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

// ==================== Node 全局模拟（混淆 LX 插件依赖）====================
//
// 重度混淆的 LX 插件（如"独家音源"）用自定义 VM 解释器运行，会以自由变量或
// globalThis 方式访问 Node.js 全局对象：process / require / SCRIPT_MD5 等。
// 这里提供安全模拟，绝不真正执行系统命令。

// child_process 安全桩：混淆插件可能调用 execSync('shutdown /s /t 0') 等
// 反调试/反破解命令（检测到环境不符就关机/杀进程）。绝不能真正执行，
// 返回空结果让插件误以为命令已执行，从而继续正常运行。
const childProcessStub: Record<string, any> = {
  exec(_cmd: string, options?: any, callback?: any) {
    if (typeof options === 'function') callback = options;
    if (typeof callback === 'function') {
      try { callback(null, '', ''); } catch { /* ignore */ }
    }
    return { stdout: '', stderr: '', pid: 0, exitCode: 0, on: () => {}, once: () => {}, kill: () => {} };
  },
  execFile(_file: string, ...rest: any[]) {
    const callback = rest.find((a: any) => typeof a === 'function');
    if (callback) { try { callback(null, '', ''); } catch { /* ignore */ } }
    return { stdout: '', stderr: '', pid: 0, exitCode: 0, on: () => {}, once: () => {}, kill: () => {} };
  },
  spawn() {
    return { stdout: '', stderr: '', pid: 0, exitCode: 0, on: () => {}, once: () => {}, kill: () => {} };
  },
  fork() {
    return { stdout: '', stderr: '', pid: 0, exitCode: 0, on: () => {}, once: () => {}, kill: () => {} };
  },
  execSync() { return Buffer.alloc(0); },
  execFileSync() { return Buffer.alloc(0); },
  spawnSync() { return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status: 0, pid: 0 }; },
};

// crypto 安全桩：基于 crypto-js 与 Web Crypto 提供常用同步 API
const cryptoShim = {
  createHash(algo: string) {
    const normalized = String(algo).toLowerCase().replace(/-/g, '');
    const hash = normalized === 'md5' ? CryptoJs.MD5
      : normalized === 'sha1' ? CryptoJs.SHA1
      : normalized === 'sha256' ? CryptoJs.SHA256
      : normalized === 'sha512' ? CryptoJs.SHA512
      : null;
    if (!hash) throw new Error(`crypto: 不支持的哈希算法 ${algo}`);
    let data: any = '';
    return {
      update(input: any) { data = input; return this; },
      digest(encoding?: string): any {
        const result = hash(data || '').toString();
        return encoding === 'hex' ? result : Buffer.from(result, 'hex');
      },
    };
  },
  createHmac(algo: string, key: any) {
    const normalized = String(algo).toLowerCase().replace(/-/g, '');
    const hmac = normalized === 'md5' ? CryptoJs.HmacMD5
      : normalized === 'sha1' ? CryptoJs.HmacSHA1
      : normalized === 'sha256' ? CryptoJs.HmacSHA256
      : null;
    if (!hmac) throw new Error(`crypto: 不支持的 HMAC 算法 ${algo}`);
    let data: any = '';
    return {
      update(input: any) { data = input; return this; },
      digest(encoding?: string): any {
        const result = hmac(data || '', key).toString();
        return encoding === 'hex' ? result : Buffer.from(result, 'hex');
      },
    };
  },
  randomBytes(size: number) {
    const arr = new Uint8Array(size);
    crypto.getRandomValues(arr);
    return Buffer.from(arr);
  },
  randomUUID() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  },
  timingSafeEqual(a: any, b: any) {
    const ba = Buffer.from(a), bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    let diff = 0;
    for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
    return diff === 0;
  },
};

// process 模拟：混淆插件会读取 version/versions/env/platform/arch/pid 等，
// 并可能调用 kill() 做反调试（返回 true 假装成功即可）
const lxProcess = {
  platform: 'win32',
  arch: 'x64',
  version: 'v20.0.0',
  versions: { node: '20.0.0', v8: '11.3.244.8', uv: '1.44.2', zlib: '1.2.13', openssl: '3.0.8' },
  env: {},
  pid: 12345,
  kill(_pid?: number, _signal?: string) { return true; },
  nextTick(fn: (...args: any[]) => void, ...args: any[]) { Promise.resolve().then(() => fn(...args)); },
  cwd: () => '/',
  browser: false,
};

// require 模拟：解析常见模块 + 安全桩
const lxRequire = (name: string) => {
  const pkg = packages[name];
  if (pkg) return pkg;
  switch (name) {
    case 'child_process': return childProcessStub;
    case 'crypto': return cryptoShim;
    case 'zlib': return zlibPkg;
    case 'buffer': return { Buffer };
    case 'crypto-js': return CryptoJs;
    default:
      throw new Error(`Cannot find module '${name}'`);
  }
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

// 同一 MusicFree 插件的 search 串行执行，避免插件内部临时状态被并发搜索互相覆盖。
const _musicfreeSearchQueues = new Map<string, Promise<void>>();

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

    // [修复] 使用 Proxy 使 env 兼容多种用户变量访问方式：
    //   1. env.getUserVariables().SOURCE_API_KEY  (MusicFree 标准)
    //   2. env.userVariables.SOURCE_API_KEY       (Baka 属性式)
    //   3. env.SOURCE_API_KEY                      (直接属性访问)
    //   4. process.env.SOURCE_API_KEY              (通过 process.env)
    const _envBase = {
      getUserVariables: () => _musicfreeUserVars.get(pluginId) || {},
      os: 'win32',
      appVersion: '1.0.0',
      lang: 'zh-CN',
    };
    const env = new Proxy(_envBase, {
      get(target, prop, receiver) {
        // 优先返回静态属性
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        // userVariables 属性式访问
        if (prop === 'userVariables') {
          return _musicfreeUserVars.get(pluginId) || {};
        }
        // 直接属性访问：当作用户变量键
        const userVars = _musicfreeUserVars.get(pluginId) || {};
        if (typeof prop === 'string' && prop in userVars) {
          return userVars[prop];
        }
        return undefined;
      },
      has(target, prop) {
        if (prop in target) return true;
        if (prop === 'userVariables') return true;
        const userVars = _musicfreeUserVars.get(pluginId) || {};
        return prop in userVars;
      },
      ownKeys(target) {
        const userVars = _musicfreeUserVars.get(pluginId) || {};
        return [...Reflect.ownKeys(target), 'userVariables', ...Object.keys(userVars)];
      },
      getOwnPropertyDescriptor(target, prop) {
        if (prop in target) {
          return Reflect.getOwnPropertyDescriptor(target, prop);
        }
        const userVars = _musicfreeUserVars.get(pluginId) || {};
        if (typeof prop === 'string' && prop in userVars) {
          return { configurable: true, enumerable: true, value: userVars[prop], writable: false };
        }
        return undefined;
      },
    });
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

    // 以全局变量形式提供 Buffer/CryptoJS，供插件以自由变量方式直接引用。
    // 不能用模块作用域 const 注入：插件自身若声明 const Buffer/CryptoJS（如
    // kw/qq 插件的 const { Buffer } = require("buffer")）会与注入声明冲突，
    // 导致 "Identifier has already been declared" 加载失败。全局变量可被
    // 模块内自由变量解析，同时被模块内同名声明遮蔽，互不冲突。
    (globalThis as any).Buffer = Buffer;
    (globalThis as any).CryptoJs = CryptoJs;
    (globalThis as any).CryptoJS = CryptoJs;

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

async function callQueuedMusicFreeMethod(
  pluginId: string,
  method: string,
  args: any[],
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (method !== 'search') {
    return callMusicFreeMethod(pluginId, method, args);
  }

  const previous = _musicfreeSearchQueues.get(pluginId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const queued = previous.then(() => current, () => current);
  _musicfreeSearchQueues.set(pluginId, queued);

  await previous.catch(() => undefined);
  try {
    return await callMusicFreeMethod(pluginId, method, args);
  } finally {
    release();
    if (_musicfreeSearchQueues.get(pluginId) === queued) {
      _musicfreeSearchQueues.delete(pluginId);
    }
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
const LX_STANDARD_QUALITIES = [
  '96k',
  '128k',
  '192k',
  '320k',
  'flac',
  'flac24bit',
  'hires',
  'vinyl',
  'dolby',
  'atmos',
  'atmos_plus',
  'master',
];
const LX_SUPPORT_QUALITIES: Record<string, string[]> = {
  kw: LX_STANDARD_QUALITIES,
  kg: LX_STANDARD_QUALITIES,
  tx: LX_STANDARD_QUALITIES,
  wy: LX_STANDARD_QUALITIES,
  mg: LX_STANDARD_QUALITIES,
  xm: LX_STANDARD_QUALITIES,
  local: [],
};

const LX_QUALITY_ALIASES: Record<string, string> = {
  '96k': 'mgg',
  mgg: 'mgg',
  '128': '128k',
  '128k': '128k',
  '192': '192k',
  '192k': '192k',
  '320': '320k',
  '320k': '320k',
  flac: 'flac',
  sq: 'flac',
  super: 'flac',
  lossless: 'flac',
  flac24: 'flac24bit',
  '24bit': 'flac24bit',
  '24bits': 'flac24bit',
  '24_bit': 'flac24bit',
  flac24bit: 'flac24bit',
  hires: 'hires',
  'hi-res': 'hires',
  hi_res: 'hires',
  hr: 'hires',
  vinyl: 'vinyl',
  dolby: 'dolby',
  atmos: 'atmos',
  atmosplus: 'atmos_plus',
  atmos_plus: 'atmos_plus',
  'atmos+': 'atmos_plus',
  master: 'master',
};

function normalizeLxQualityKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, '').replace(/-/g, '_');
  if (!normalized) return null;
  return LX_QUALITY_ALIASES[normalized] ?? null;
}

function qualityKeyToBakaPluginQuality(qualityKey: string): string {
  return qualityKey === 'mgg' ? '96k' : qualityKey;
}

function normalizeLxQualitys(raw: unknown[], allowed?: string[]): string[] {
  const allowedSet = allowed && allowed.length > 0 ? new Set(allowed) : null;
  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const qualityKey = normalizeLxQualityKey(item);
    const quality = qualityKey ? qualityKeyToBakaPluginQuality(qualityKey) : (typeof item === 'string' ? item.trim() : '');
    if (!quality) continue;
    if (allowedSet && !allowedSet.has(quality)) continue;
    if (seen.has(quality)) continue;
    seen.add(quality);
    result.push(quality);
  }

  return result;
}

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
      qualitys: normalizeLxQualitys(declaredQualitys, qualitys),
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
      qualitys: normalizeLxQualitys(declaredQualitys),
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
            return Buffer.from(inflateAutoSync(data));
          } catch (e) {
            log('warn', `zlib.inflate 解压失败: ${e}`);
            return buf;
          }
        },
        inflateSync(buf: any) {
          try {
            const data = buf instanceof Uint8Array ? buf : Buffer.from(buf);
            return Buffer.from(inflateAutoSync(data));
          } catch (e) {
            log('warn', `zlib.inflateSync 解压失败: ${e}`);
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

  // 重度混淆插件以 globalThis 方式访问 Node 全局对象，需在全局注入。
  // 每个插件独立 Worker，注入不会跨插件泄漏。
  (globalThis as any).process = lxProcess;
  (globalThis as any).require = lxRequire;
  (globalThis as any).Buffer = Buffer;
  (globalThis as any).CryptoJs = CryptoJs;
  (globalThis as any).CryptoJS = CryptoJs;
  (globalThis as any).SCRIPT_MD5 = CryptoJs.MD5(script).toString();

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
      const process = globalThis.process;
      const require = globalThis.require;
      // 不本地声明 SCRIPT_MD5：混淆插件可能自行声明同名变量（unicode 转义），
      // 本地 const 会与之冲突；globalThis.SCRIPT_MD5 已注入，裸引用自动解析到全局。
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
        log('warn', `LX 插件未注册 request 处理器: ${pluginId} (action=${args[0]?.action})`);
        return { success: false, error: 'LX 插件未注册 request 处理器' };
      }
      const result = await state.requestHandler(args[0]);
      log('log', `LX request(action=${args[0]?.action}) 返回: type=${typeof result} len=${typeof result === 'string' ? result.length : 'n/a'} preview=${typeof result === 'string' ? result.substring(0, 100) : (result === null ? 'null' : JSON.stringify(result)?.substring(0, 100))}`);
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

        if (cmd.userVars && _musicfreeInstances.has(cmd.pluginId)) {
          _musicfreeUserVars.set(cmd.pluginId, { ...cmd.userVars });
        }

        const state = _lxStates.get(cmd.pluginId);
        const result = state
          ? await callLxMethod(cmd.pluginId, cmd.method, cmd.args)
          : await callQueuedMusicFreeMethod(cmd.pluginId, cmd.method, cmd.args);

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
