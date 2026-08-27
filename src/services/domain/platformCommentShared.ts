/**
 * 宿主直连平台评论 · 共享类型与工具。
 *
 * 平台识别、通用 HTTP JSON 请求、MusicFree 条目解包，供各平台评论子模块复用。
 */
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

/** 判断歌曲所属的评论平台（按插件名/平台字段匹配，顺序决定优先级） */
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

/**
 * 提取评论接口所需的 MusicFree 原始歌曲条目。
 * 正常传入的 rawData 即 MusicFree 条目；若调用方仍传入搜索阶段的
 * PluginSearchResult 包装（pluginId+rawData 同时存在），再解一层内嵌。
 */
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