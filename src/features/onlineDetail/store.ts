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

export type OnlineDetailType = 'artist' | 'album' | 'playlist' | 'user';

/** 搜索页来源类型，用于"从哪儿来回哪儿去"导航 */
export type SourceSearchType = 'track' | 'artist' | 'album' | 'playlist';

/** 返回搜索页时待恢复的搜索会话（tab + 插件源），仅真正回到搜索页时被消费 */
export interface PendingSearchSession {
  type: SourceSearchType | null;
  sourceId: string | null;
  /** 搜索结果快照（含各 tab 结果与分页状态），恢复时免重搜，避免重复请求触发风控 */
  results?: SearchResultsSnapshot | null;
}

/** 搜索结果快照：结构由 Search.vue 维护（键对应其内部结果 ref 名），store 仅透传 */
export interface SearchResultsSnapshot {
  hasMore: boolean;
  currentPage: number;
  lists: Record<string, unknown[]>;
}

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
  /** 插件来源（musicfree/baka 系使用；用户详情等本地数据场景可省略） */
  pluginSource?: PluginSource;
  /** 插件搜索结果的 rawData（用于调用 getArtistWorks/getAlbumInfo/getMusicSheetInfo） */
  rawData: any;
  /** 搜索页来源类型，返回搜索时恢复对应 tab */
  sourceSearchType?: SourceSearchType;
  /** 进入详情时搜索页选中的插件源 ID（Search.vue 的 selectedSourceId），返回搜索时恢复 */
  sourceSearchSourceId?: string;
  /** 引擎类型：'musicfree'（MF/baka 系）或 'lx'（落雪系） */
  engineType?: 'musicfree' | 'lx';
  /** 落雪系音源 ID（engineType='lx' 时使用，如 'kw'/'kg'/'tx'/'wy'/'mg'） */
  lxSourceId?: string;
  /** 来源标记：'toplist' 表示从榜单页进入，不提供"收藏整张"功能 */
  origin?: 'toplist';
}

export const useOnlineDetailStore = defineStore('onlineDetail', () => {
  const context = ref<OnlineDetailContext | null>(null);
  /** 上下文历史栈：从歌手详情点击专辑时保存歌手上下文 */
  const contextStack = ref<OnlineDetailContext[]>([]);
  /** 返回搜索页时需要恢复的搜索会话（tab + 插件源） */
  const pendingSearchSession = ref<PendingSearchSession | null>(null);
  /** 搜索结果快照暂存：搜索页卸载进入详情时写入，返回搜索页消费后/离开详情流时销毁 */
  const searchResultsCache = ref<SearchResultsSnapshot | null>(null);

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
    pendingSearchSession.value = null;
    searchResultsCache.value = null;
  };

  const setPendingSearchSession = (session: PendingSearchSession | null) => {
    pendingSearchSession.value = session;
  };

  const setSearchResultsCache = (snapshot: SearchResultsSnapshot | null) => {
    searchResultsCache.value = snapshot;
  };

  const consumePendingSearchSession = (): PendingSearchSession | null => {
    const session = pendingSearchSession.value;
    pendingSearchSession.value = null;
    return session;
  };

  return {
    context,
    contextStack,
    pendingSearchSession,
    searchResultsCache,
    setContext,
    setContextWithHistory,
    restorePreviousContext,
    hasPreviousContext,
    clearContext,
    setPendingSearchSession,
    setSearchResultsCache,
    consumePendingSearchSession,
  };
});
