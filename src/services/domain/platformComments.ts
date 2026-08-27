/**
 * 宿主直连平台评论服务 —— 门面（Facade）。
 *
 * MF 插件规范没有评论 API（getMusicComments 是 BakaMusic 扩展），
 * 但歌曲 id 全平台通用——插件未实现评论方法时，宿主按歌曲平台
 * 直接调用平台公开评论接口。接口路径、参数与返回映射均与
 * BakaMusic 官方插件（music.cwo.cc.cd，author Toskysun）逐一对齐，
 * 统一返回 { isEnd, data } 结构，CommentPanel 无需感知来源差异。
 *
 * 汇聚 re-export 拆分后的子模块并保留主编排入口，保持既有消费者
 * （pluginEngineMedia / platformComments.test.ts）的入口路径不变。
 * 已拆分的子模块：
 *   - platformCommentShared 类型 + 平台识别 + 通用 HTTP/解包（叶子）
 *   - platformCommentWy / Tx / Kg / Kw / Mg / Qishui  各平台评论实现
 *
 * 返回 null 表示平台不受支持或缺少歌曲 id（调用方据此展示"不支持"）；
 * 网络失败等一律返回 { isEnd: true, data: [] }（展示"暂无评论"）。
 */

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

/**
 * 按歌曲平台直连平台评论接口（MF 插件无 getMusicComments 时的兜底）。
 * @returns 平台不支持或缺歌曲 id 时返回 null，调用方展示"不支持评论"
 */
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