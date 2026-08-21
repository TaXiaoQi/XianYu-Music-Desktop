/**
 * 在线详情 Store
 *
 * 存储从搜索页点击插件歌手/专辑/歌单时传递的上下文数据，
 * 供 OnlineDetailView 复用本地详情头组件渲染。
 * 支持上下文历史栈，实现"从哪儿来回哪儿去"的嵌套导航。
 */

import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { PluginPlaylistSearchResult, PluginSource } from '../../types';

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
  /** 离开时当前 tab 的虚拟网格滚动位置（artist/album/playlist），返回时恢复 */
  scrollTop?: number;
}

/** 榜单页（一级）缓存：进入在线详情时保存，返回时恢复；离开榜单页时销毁 */
export interface TopListsCache {
  sourceList: Array<{ id: string; name: string; source: PluginSource }>;
  selectedSourceId: string;
  topLists: PluginPlaylistSearchResult[];
  gridScrollTop: number;
  gridViewportHeight: number;
  gridWidth: number;
}

/** 歌手详情（二级）状态缓存：从歌手详情进入专辑详情时保存，返回歌手详情时恢复 */
export interface ArtistDetailStateCache {
  songs: any[];
  albums: any[];
  artistActiveTab: string;
  scrollTop: number;
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
  /** 平台唯一 ID（搜索结果自带的 platformId / LX 的 id），用于生成内容唯一滚动记忆键与收藏键 */
  platformId?: string;
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
  /** 歌手详情数据状态（从歌手详情进入专辑详情时随上下文入栈，返回歌手详情时恢复）。
   *  与上下文绑定而非独立栈，避免嵌套导航（歌手→专辑→查看歌手→…）时状态与上下文错位 */
  detailState?: ArtistDetailStateCache;
}

export const useOnlineDetailStore = defineStore('onlineDetail', () => {
  const context = ref<OnlineDetailContext | null>(null);
  /** 上下文历史栈：从歌手详情点击专辑时保存歌手上下文（含 detailState），返回时恢复 */
  const contextStack = ref<OnlineDetailContext[]>([]);
  /** 返回搜索页时需要恢复的搜索会话（tab + 插件源） */
  const pendingSearchSession = ref<PendingSearchSession | null>(null);
  /** 搜索结果快照暂存：搜索页卸载进入详情时写入，返回搜索页消费后/离开详情流时销毁 */
  const searchResultsCache = ref<SearchResultsSnapshot | null>(null);
  /** 榜单页（一级）状态缓存：进入在线详情时写入，返回榜单页消费后/离开详情流时销毁 */
  const topListsCache = ref<TopListsCache | null>(null);

  const setContext = (ctx: OnlineDetailContext) => {
    context.value = ctx;
  };

  /** 带历史的上下文设置：保存当前上下文到栈，再设置新上下文。
   *  stateToAttach 仅用于歌手详情→专辑详情：把歌手页数据状态（歌曲/专辑/tab/滚动）随上下文入栈，
   *  返回歌手详情时随上下文一起恢复，避免嵌套导航时状态与上下文错位。 */
  const setContextWithHistory = (ctx: OnlineDetailContext, stateToAttach?: ArtistDetailStateCache) => {
    if (context.value) {
      if (stateToAttach) {
        contextStack.value.push({ ...context.value, detailState: stateToAttach });
      } else {
        contextStack.value.push(context.value);
      }
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
    topListsCache.value = null;
  };

  /** 清空上下文与历史栈（离开在线详情流时调用；不触碰搜索/榜单缓存，由调用方按去向处理） */
  const clearContextFlow = () => {
    context.value = null;
    contextStack.value = [];
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

  /** 仅清理搜索会话相关缓存（返回搜索页时保留，离开详情流时清理） */
  const clearSearchSession = () => {
    pendingSearchSession.value = null;
    searchResultsCache.value = null;
  };

  const setTopListsCache = (cache: TopListsCache | null) => {
    topListsCache.value = cache;
  };

  const consumeTopListsCache = (): TopListsCache | null => {
    const cache = topListsCache.value;
    topListsCache.value = null;
    return cache;
  };

  const clearTopListsCache = () => {
    topListsCache.value = null;
  };

  return {
    context,
    contextStack,
    pendingSearchSession,
    searchResultsCache,
    topListsCache,
    setContext,
    setContextWithHistory,
    restorePreviousContext,
    hasPreviousContext,
    clearContext,
    clearContextFlow,
    setPendingSearchSession,
    setSearchResultsCache,
    consumePendingSearchSession,
    clearSearchSession,
    setTopListsCache,
    consumeTopListsCache,
    clearTopListsCache,
  };
});
