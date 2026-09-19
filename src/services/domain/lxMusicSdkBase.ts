import {
  normalizeQualityKey,
  qualityKeyToLxQuality,
} from '../../types';
import { pluginApi } from '../tauri/pluginApi';
import { hostZzcSign } from '../tauri/hostCryptoApi';
import type { LxUrlSongInfoContract } from '../tauri/contracts';


// ==================== Types ====================
export interface LxSearchResultItem {
  name: string;
  singer: string;
  albumName: string;
  albumId: string | number;
  songmid: string;
  source: 'kw' | 'kg' | 'tx' | 'wy' | 'mg';
  interval: string;
  img: string | null;
  singerAvatars?: Record<string, string>;
  singerIds?: Record<string, string>;
  types: { type: string; size: string | null; hash?: string }[];
  _types: Record<string, { size: string | null; hash?: string }>;
  hash?: string;
  strMediaMid?: string;
  songId?: string | number;
  albumMid?: string;
  copyrightId?: string;
  lrcUrl?: string;
  mrcUrl?: string;
  trcUrl?: string;
}

export interface LxSearchResult {
  list: LxSearchResultItem[];
  allPage: number;
  limit: number;
  total: number;
  source: string;
}

function normalizeLxTypes(
  raw: Record<string, { size?: string | null; hash?: string }> | undefined,
): Record<string, { size?: string | null; hash?: string }> | undefined {
  if (!raw || typeof raw !== 'object') return raw;
  const result: Record<string, { size?: string | null; hash?: string }> = { ...raw };
  for (const [key, value] of Object.entries(raw)) {
    const qualityKey = normalizeQualityKey(key);
    if (!qualityKey) continue;
    result[qualityKey] = value;
    result[qualityKeyToLxQuality(qualityKey)] = value;
  }
  return result;
}

export function toUrlSongInfo(item: LxSearchResultItem): LxUrlSongInfoContract {
  return {
    songmid: String(item.songmid ?? ''),
    source: item.source,
    hash: item.hash,
    name: item.name,
    singer: item.singer,
    albumName: item.albumName,
    albumId: item.albumId != null ? String(item.albumId) : undefined,
    albumMid: item.albumMid != null ? String(item.albumMid) : undefined,
    copyrightId: item.copyrightId != null ? String(item.copyrightId) : undefined,
    strMediaMid: item.strMediaMid != null ? String(item.strMediaMid) : undefined,
    songId: item.songId != null ? String(item.songId) : undefined,
    _types: normalizeLxTypes(item._types) as Record<string, { size?: string | null; hash?: string }> | undefined,
  };
}

// ==================== Utility Functions ====================

export function formatPlayTime(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function sizeFormate(bytes: number | undefined | null): string {
  if (!bytes) return '0B';
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
}

// ==================== HTTP Request via Tauri ====================

interface HttpResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export async function httpFetch(url: string, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
} = {}): Promise<HttpResponse> {
  return pluginApi.pluginHttpRequest(
    options.method || 'GET',
    url,
    options.headers,
    options.body,
  );
}

export async function httpGetJson(url: string, headers?: Record<string, string>): Promise<any> {
  const resp = await httpFetch(url, { method: 'GET', headers });
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status} for ${url}`);
  try {
    return JSON.parse(resp.body);
  } catch {
    throw new Error(`Invalid JSON response from ${url}`);
  }
}

export async function httpPostJson(url: string, body: string, headers?: Record<string, string>): Promise<any> {
  const resp = await httpFetch(url, { method: 'POST', headers, body });
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status} for ${url}`);
  try {
    return JSON.parse(resp.body);
  } catch {
    throw new Error(`Invalid JSON response from ${url}`);
  }
}

function parseLooseJson(text: string): any {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inStr) {
      if (ch === "'") { inStr = true; out += '"'; }
      else out += ch;
    } else if (ch === '\\') {
      out += ch + (text[i + 1] ?? '');
      i++;
    } else if (ch === "'") {
      inStr = false;
      out += '"';
    } else {
      out += ch === '"' ? '\\"' : ch;
    }
  }
  return JSON.parse(out);
}

export async function httpGetLooseJson(url: string, headers?: Record<string, string>): Promise<any> {
  const resp = await httpFetch(url, { method: 'GET', headers });
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status} for ${url}`);
  try {
    return JSON.parse(resp.body);
  } catch {
    return parseLooseJson(resp.body);
  }
}

// ==================== TX (QQ音乐) Signing（Rust host_crypto） ====================

export function zzcSign(text: string): Promise<string> {
  return hostZzcSign(text);
}

export function firstValue(item: any, keys: string[]): any {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}