/**
 * 兜底模块宿主 ctx：注入给服务器下发代码的能力白名单。
 * 网络走 Rust 代理（plugin_http_request），缓存为内存 TTL，配置读取用户设置。
 */
import { APP_VERSION } from '../../../version';
import { pluginApi } from '../tauri/pluginApi';
import { normalizeQualityKey } from '../../types';
import { useSettingsStore } from '../../features/settings/store';
import type {
  FallbackHostCtx,
  FallbackHttpOptions,
  FallbackHttpResponse,
} from './types';

/** 与 utils/remoteSong 同实现的 "mm:ss" → 秒；内联以切断 hostCtx → remoteSong → lxMusicSdk 的模块环 */
const parseIntervalToSeconds = (interval?: string | null): number => {
  if (!interval) return 0;
  const parts = interval.trim().split(':').map(part => parseInt(part, 10));
  if (parts.length === 0 || parts.some(n => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

/** 与 pluginResultMappers 同实现；内联以切断 hostCtx → pluginResultMappers → registry 的模块环 */
const stripHtmlTags = (str: unknown): string => {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '');
};

interface CacheEntry {
  value: unknown;
  expireAt: number | null;
}

const _cache = new Map<string, CacheEntry>();

const readCache = <T,>(key: string): T | null => {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (entry.expireAt !== null && entry.expireAt < Date.now()) {
    _cache.delete(key);
    return null;
  }
  return entry.value as T;
};

const logWithLevel = (level: 'info' | 'warn' | 'error', msg: string, data?: unknown) => {
  const line = `[FallbackModule] ${msg}`;
  if (level === 'warn') console.warn(line, data ?? '');
  else if (level === 'error') console.error(line, data ?? '');
  else console.log(line, data ?? '');
};

const readConfig = (key: string): unknown => {
  try {
    const store = useSettingsStore();
    const settings = store.settings as unknown as Record<string, unknown>;
    let cursor: unknown = settings;
    for (const part of key.split('.')) {
      if (cursor && typeof cursor === 'object' && part in (cursor as Record<string, unknown>)) {
        cursor = (cursor as Record<string, unknown>)[part];
      } else {
        return null;
      }
    }
    return cursor;
  } catch {
    return null;
  }
};

const doRequest = async (
  method: 'GET' | 'POST',
  url: string,
  body: unknown,
  opts?: FallbackHttpOptions,
): Promise<FallbackHttpResponse> => {
  const headers = { ...(opts?.headers ?? {}) };
  let bodyStr: string | undefined;
  if (method === 'POST' && body !== undefined && body !== null) {
    if (typeof body === 'string') {
      bodyStr = body;
    } else {
      bodyStr = JSON.stringify(body);
      if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
    }
  }
  const resp = await pluginApi.pluginHttpRequest(
    method,
    url,
    headers,
    bodyStr ?? undefined,
    opts?.timeoutMs,
  );
  return {
    status: resp.status,
    headers: resp.headers ?? {},
    body: resp.body ?? '',
  };
};

/** 创建宿主 ctx。模块加载时传入，闭包持有同一份缓存/日志实现。 */
export const createFallbackHostCtx = (): FallbackHostCtx => ({
  appVersion: APP_VERSION,
  http: {
    get: (url, opts) => doRequest('GET', url, undefined, opts),
    post: (url, body, opts) => doRequest('POST', url, body, opts),
  },
  cache: {
    get: key => readCache(key),
    set: (key, value, ttlSeconds) => {
      _cache.set(key, {
        value,
        expireAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
      });
    },
    del: key => {
      _cache.delete(key);
    },
  },
  log: {
    info: (msg, data) => logWithLevel('info', msg, data),
    warn: (msg, data) => logWithLevel('warn', msg, data),
    error: (msg, data) => logWithLevel('error', msg, data),
  },
  config: {
    get: readConfig,
  },
  utils: {
    parseIntervalToSeconds,
    normalizeQualityKey: raw => normalizeQualityKey(raw),
    stripHtmlTags,
  },
});
