import { pluginHttpRequest } from '../tauri/pluginApi';
import type { PluginSearchResult, PluginSource } from '../../types';

export type CommentPlatform = 'wy' | 'tx' | 'kg' | 'kw' | 'mg' | 'qishui';

export interface PlatformComment {
  id?: string;
  nickName: string;
  avatar?: string;
  comment: string;
  like?: number | null;
  createAt?: number | string | null;
  location?: string;
  replies?: PlatformComment[];
}

export interface PlatformCommentResult {
  isEnd: boolean;
  data: PlatformComment[];
}

export const PAGE_SIZE = 20;

const PLATFORM_PATTERNS: Array<[CommentPlatform, RegExp]> = [
  ['wy', /网易|netease|\bwy\b/i],
  ['tx', /qq/i],
  ['kg', /酷狗|kugou|\bkg\b/i],
  ['kw', /酷我|kuwo|\bkw\b/i],
  ['mg', /咪咕|migu|\bmg\b/i],
  ['qishui', /汽水|qishui/i],
];

export function detectCommentPlatform(
  source: PluginSource | null | undefined,
  platformText?: string | null,
): CommentPlatform | null {
  const haystack = `${source?.name || ''}|${platformText || ''}`;
  if (!haystack.trim() || haystack === '|') return null;
  for (const [platform, pattern] of PLATFORM_PATTERNS) {
    if (pattern.test(haystack)) return platform;
  }
  return null;
}

export function extractMediaItem(item: PluginSearchResult): any {
  const inner = (item as any)?.rawData;
  if (inner?.pluginId && inner?.rawData) return inner.rawData;
  return inner ?? item;
}

export async function httpJson(
  method: 'GET' | 'POST',
  url: string,
  headers?: Record<string, string>,
  body?: string,
  timeoutSec = 15,
): Promise<any | null> {
  try {
    const resp = await pluginHttpRequest(method, url, headers, body, timeoutSec, 10);
    if (resp.status < 200 || resp.status >= 400) return null;
    return JSON.parse(resp.body);
  } catch {
    return null;
  }
}