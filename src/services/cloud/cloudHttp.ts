// 移植自移动端 lib/src/cloud/cloud_http.dart
// 网盘引擎统一 HTTP 出口。
//
// 移动端经 appRequest 收口；桌面端一律走 Rust 代理 plugin_http_request
//（可自定义 UA/Referer）。在其上封装网盘 API 最常用的三种形态：
// GET/POST-JSON/POST-FORM，附统一超时与 CloudException 错误转换。
// 响应头由调用方自行取用。
//
// 业务下沉后仅登录链（webview 捕获后的账号构造、httpPassword/smsPassword/
// qrCode 登录）仍在使用本模块；十盘业务请求已改走 cloudRemote → Rust。
//
// 另含少量移植辅助（Dart 类型强转的 TS 对应物：asRecord/asInt/asString、
// encodeQueryComponent 等）。

import { pluginApi } from '../tauri/pluginApi';
import { CloudException } from './cloudTypes';

/** Set-Cookie 值的合法 cookie-name 起始判定（RFC 6265 token + '='）。 */
const COOKIE_NAME_START_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\s*=/;

/** 逗号切分可能被合并的 Set-Cookie 串（Expires 日期内的逗号不切）。 */
export function splitSetCookieValues(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const out: string[] = [];
  let cur = '';
  for (const part of trimmed.split(',')) {
    const seg = part.trim();
    if (cur && COOKIE_NAME_START_RE.test(seg)) {
      out.push(cur);
      cur = seg;
    } else {
      cur = cur ? `${cur},${seg}` : seg;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export class CloudHttpResponse {
  constructor(
    readonly status: number,
    readonly headers: Record<string, string>,
    readonly body: string,
    readonly setCookies: string[],
  ) {}

  get isOk(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  /** Set-Cookie 解析成 name → value（取分号前的首段，忽略 Path/Expires 等
   * 属性；同名后写覆盖前写，贴合浏览器语义）。 */
  get setCookiePairs(): Record<string, string> {
    const pairs: Record<string, string> = {};
    for (const raw of this.setCookies) {
      const head = raw.split(';')[0] ?? '';
      const eq = head.indexOf('=');
      if (eq <= 0) continue;
      pairs[head.slice(0, eq).trim()] = head.slice(eq + 1).trim();
    }
    return pairs;
  }

  /** 懒解析 JSON；解析失败抛 CloudException。 */
  get json(): Record<string, unknown> {
    try {
      const v: unknown = JSON.parse(this.body);
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        return v as Record<string, unknown>;
      }
      throw new CloudException('接口返回格式异常');
    } catch (e) {
      if (e instanceof CloudException) throw e;
      throw new CloudException('接口返回格式异常');
    }
  }
}

export interface CloudRequestOptions {
  headers?: Record<string, string>;
  jsonBody?: unknown;
  form?: Record<string, string>;
  rawBody?: string;
  /** 超时毫秒数（默认 15s）。 */
  timeout?: number;
}

/** 统一请求入口。body 优先级：json > form > raw。 */
export async function cloudRequest(
  method: string,
  url: string,
  opts: CloudRequestOptions = {},
): Promise<CloudHttpResponse> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  let bodyStr: string | undefined;
  if (opts.jsonBody !== undefined) {
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
    bodyStr = JSON.stringify(opts.jsonBody);
  } else if (opts.form) {
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    bodyStr = Object.entries(opts.form)
      .map(([k, v]) => `${encodeQueryComponent(k)}=${encodeQueryComponent(v)}`)
      .join('&');
  } else if (opts.rawBody !== undefined) {
    bodyStr = opts.rawBody;
  }
  const timeoutMs = opts.timeout ?? 15000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const resp = await Promise.race([
      pluginApi.pluginHttpRequest(method, url, headers, bodyStr, timeoutMs, 10),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CloudException('请求超时')), timeoutMs);
      }),
    ]);
    const setCookies: string[] = [];
    const headerMap: Record<string, string> = {};
    for (const [name, value] of Object.entries(resp.headers ?? {})) {
      if (name.toLowerCase() === 'set-cookie') {
        setCookies.push(...splitSetCookieValues(String(value)));
      } else {
        headerMap[name] = String(value);
      }
    }
    return new CloudHttpResponse(resp.status, headerMap, resp.body ?? '', setCookies);
  } catch (e) {
    if (e instanceof CloudException) throw e;
    throw new CloudException(`网络请求失败: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function cloudGet(
  url: string,
  opts: { headers?: Record<string, string>; timeout?: number } = {},
): Promise<CloudHttpResponse> {
  return cloudRequest('GET', url, { headers: opts.headers, timeout: opts.timeout });
}

export function cloudPostJson(
  url: string,
  opts: { body?: unknown; headers?: Record<string, string>; timeout?: number } = {},
): Promise<CloudHttpResponse> {
  return cloudRequest('POST', url, { jsonBody: opts.body, headers: opts.headers, timeout: opts.timeout });
}

export function cloudPostForm(
  url: string,
  form: Record<string, string>,
  opts: { headers?: Record<string, string>; timeout?: number } = {},
): Promise<CloudHttpResponse> {
  return cloudRequest('POST', url, { form, headers: opts.headers, timeout: opts.timeout });
}

/** Uri.encodeQueryComponent 对应物：空格转 +，保留字全编码。 */
export function encodeQueryComponent(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

/** 凭据 Cookie 键值拼请求头（各盘 cred 存 'cookie' 单键整串时用另一形态）。 */
export function cookieHeader(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/** 大小写不敏感读取响应头。 */
export function getHeader(headers: Record<string, string>, name: string): string | null {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

// ── 移植辅助（Dart 类型强转/解析的 TS 对应物）────────────────

/** Dart `x as Map<String, dynamic>?` 对应物。 */
export function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Dart `(x as num?)?.toInt()` 对应物。 */
export function asInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;
}

/** Dart `(x ?? '').toString()` 对应物。 */
export function asString(v: unknown): string {
  return v == null ? '' : String(v);
}
