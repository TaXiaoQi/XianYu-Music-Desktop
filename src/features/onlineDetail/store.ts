/**
 * 在线详情 Store
 *
 * 存储从搜索页点击插件歌手/专辑/歌单时传递的上下文数据，
 * 供 OnlineDetailView 复用本地详情头组件渲染。
 * 支持上下文历史栈，实现"从哪儿来回哪儿去"的嵌套导航。
 */

import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { PluginSource } from '../../types';

export type OnlineDetailType = 'artist' | 'album' | 'playlist';

/** 搜索页来源类型，用于"从哪儿来回哪儿去"导航 */
export type SourceSearchType = 'track' | 'artist' | 'album' | 'playlist';

export interface OnlineDetailContext {
  type: OnlineDetailType;
  /** 标题（歌手名/专辑名/歌单名） */
  title: string;
  /** 副标题（如歌手描述/专辑艺人/创建日期） */
  subtitle: string;
  /** 封面 URL */
  coverUrl: string;
  /** 歌手简介（仅 artist 类型使用，来源 pluginArtistSearch/artist 详情接口） */
  description?: string;
  /** 插件来源（musicfree/baka 系使用） */
  pluginSource: PluginSource;
  /** 插件搜索结果的 rawData（用于调用 getArtistWorks/getAlbumInfo/getMusicSheetInfo） */
  rawData: any;
  /** 搜索页来源类型，返回搜索时恢复对应 tab */
  sourceSearchType?: SourceSearchType;
  /** 引擎类型：'musicfree'（MF/baka 系）或 'lx'（落雪系） */
  engineType?: 'musicfree' | 'lx';
  /** 落雪系音源 ID（engineType='lx' 时使用，如 'kw'/'kg'/'tx'/'wy'/'mg'） */
  lxSourceId?: string;
}

export const useOnlineDetailStore = defineStore('onlineDetail', () => {
  const context = ref<OnlineDetailContext | null>(null);
  /** 上下文历史栈：从歌手详情点击专辑时保存歌手上下文 */
  const contextStack = ref<OnlineDetailContext[]>([]);
  /** 返回搜索页时需要恢复的搜索 tab 类型 */
  const pendingSearchType = ref<SourceSearchType | null>(null);

  const setContext = (ctx: OnlineDetailContext) => {
    context.value = ctx;
  };

  /** 带历史的上下文设置：保存当前上下文到栈，再设置新上下文 */
  const setContextWithHistory = (ctx: OnlineDetailContext) => {
    if (context.value) {
      contextStack.value.push(context.value);
    }
    context.value = ctx;
  };

  /** 尝试恢复上一个上下文（用于 router.back 后上下文不匹配的场景） */
  const restorePreviousContext = (): boolean => {
    if (contextStack.value.length > 0) {
      context.value = contextStack.value.pop()!;
      return true;
    }
    return false;
  };

  /** 检查是否有上一个上下文可恢复 */
  const hasPreviousContext = (): boolean => contextStack.value.length > 0;

  const clearContext = () => {
    context.value = null;
    contextStack.value = [];
    pendingSearchType.value = null;
  };

  const setPendingSearchType = (type: SourceSearchType | null) => {
    pendingSearchType.value = type;
  };

  const consumePendingSearchType = (): SourceSearchType | null => {
    const type = pendingSearchType.value;
    pendingSearchType.value = null;
    return type;
  };

  return {
    context,
    contextStack,
    pendingSearchType,
    setContext,
    setContextWithHistory,
    restorePreviousContext,
    hasPreviousContext,
    clearContext,
    setPendingSearchType,
    consumePendingSearchType,
  };
});
