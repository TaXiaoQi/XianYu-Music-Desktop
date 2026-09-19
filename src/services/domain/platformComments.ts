
export type {
  CommentPlatform,
  PlatformComment,
  PlatformCommentResult,
} from './platformCommentShared';
export { detectCommentPlatform, extractMediaItem, httpJson, PAGE_SIZE } from './platformCommentShared';

import type { PluginSearchResult, PluginSource } from '../../types';
import { detectCommentPlatform, extractMediaItem } from './platformCommentShared';
import type { PlatformCommentResult } from './platformCommentShared';
import { fetchWyComments } from './platformCommentWy';
import { fetchTxComments } from './platformCommentTx';
import { fetchKgComments } from './platformCommentKg';
import { fetchKwComments } from './platformCommentKw';
import { fetchMgComments } from './platformCommentMg';
import { fetchQishuiComments } from './platformCommentQishui';

export async function fetchPlatformMusicComments(
  source: PluginSource,
  item: PluginSearchResult,
  page: number = 1,
): Promise<PlatformCommentResult | null> {
  const mediaItem = extractMediaItem(item);
  const platform = detectCommentPlatform(source, mediaItem?.platform || (item as any)?.platform || source.name);
  if (!platform) return null;

  try {
    switch (platform) {
      case 'wy': {
        const songId = mediaItem?.id || (item as any)?.id;
        if (!songId) return null;
        return await fetchWyComments(String(songId), page);
      }
      case 'tx':
        return await fetchTxComments(mediaItem, page);
      case 'kg':
        return await fetchKgComments(mediaItem, page);
      case 'kw': {
        const songId = mediaItem?.id || mediaItem?.rid || (item as any)?.id;
        if (!songId) return null;
        return await fetchKwComments(String(songId), page);
      }
      case 'mg': {
        const songId = mediaItem?.id || mediaItem?.copyrightId || mediaItem?.copyright_id || (item as any)?.id;
        if (!songId) return null;
        return await fetchMgComments(String(songId), page);
      }
      case 'qishui': {
        const songId = mediaItem?.id || mediaItem?.item_id || mediaItem?.track_id || (item as any)?.id;
        if (!songId) return null;
        return await fetchQishuiComments(String(songId), page);
      }
    }
  } catch (e) {
    console.warn(`[platformComments] ${platform} 评论获取失败:`, e);
    return { isEnd: true, data: [] };
  }
  return null;
}