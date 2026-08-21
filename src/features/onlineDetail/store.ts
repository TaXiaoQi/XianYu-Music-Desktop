/**
 * 在线详情 Store —— 在线搜索 / 在线榜单的层级容器状态管理
 *
 * 层级规则（统一一条）：
 * - 一级页面（搜索/榜单）：进入详情流时快照缓存，返回时恢复（内容 + 滚动位置，免重搜防风控）；
 *   切换插件 / 切换顶部 tab 时重新加载；离开到其他一级页面时销毁缓存。
 * - 详情流内容器（歌手/专辑/歌单/用户，任意层级）：从当前容器下钻新容器时，快照当前容器
 *   状态（内容 + tab + 滚动）随帧入栈；返回时弹栈整体恢复；离开详情流时全部销毁。
 *
 * 详情流导航：每次打开详情通过 openDetail 压入帧栈并递增导航令牌（随路由 query.d 下发），
 * 路由 d 变小即"返回"，由详情页弹栈恢复；d 变大即"前进"，全新加载当前帧。
 */

import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { PluginPlaylistSearchResult, PluginSource } from '../../types';
import router from '../../router';

export type OnlineDetailType = 'artist' | 'album' | 'playlist' | 'user';

/** 搜索页来源类型 */
export type SourceSearchType = 'track' | 'artist' | 'album' | 'playlist';

/** 搜索结果快照：结构由 Search.vue 维护（键对应其内部结果 ref 名），store 仅透传 */
export interface SearchResultsSnapshot {
  hasMore: boolean;
  currentPage: number;
  lists: Record<string, unknown[]>;
  /** 离开时当前 tab 的虚拟网格滚动位置（artist/album/playlist），返回时恢复 */
  scrollTop?: number;
}

/** 搜索页（一级）缓存：进入详情流时保存，返回时恢复；离开搜索流时销毁 */
export interface SearchPageCache {
  selectedSourceId: string;
  activeSearchType: SourceSearchType;
  snapshot: SearchResultsSnapshot;
}

/** 榜单页（一级）缓存：进入详情流时保存，返回时恢复；离开榜单流时销毁 */
export interface TopListsCache {
  sourceList: Array<{ id: string; name: string; source: PluginSource }>;
  selectedSourceId: string;
  topLists: PluginPlaylistSearchResult[];
  gridScrollTop: number;
  gridViewportHeight: number;
  gridWidth: number;
}

/** 详情容器状态缓存：从当前容器下钻新容器时保存，返回该容器时整体恢复 */
export interface OnlineDetailStateCache {
  songs: any[];
  albums: any[];
  /** 歌手容器 tab（songs/albums/details），其他类型容器无意义 */
  activeTab: string;
  scrollTop: number;
  /** 用户详情容器专属：被查看用户的收藏与歌单 */
  userFavorites?: any[];
  userPlaylists?: Array<{ id: string; name: string; cloudCoverUrl?: string; songs?: any[] }>;
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
  /** 引擎类型：'musicfree'（MF/baka 系）或 'lx'（落雪系） */
  engineType?: 'musicfree' | 'lx';
  /** 落雪系音源 ID（engineType='lx' 时使用，如 'kw'/'kg'/'tx'/'wy'/'mg'） */
  lxSourceId?: string;
  /** 来源标记：'toplist' 表示从榜单页进入，不提供"收藏整张"功能 */
  origin?: 'toplist';
}

/** 详情流的一个导航帧：上下文 + 离开该帧时快照的容器状态（返回时整体恢复） */
export interface OnlineDetailFrame {
  context: OnlineDetailContext;
  state?: OnlineDetailStateCache;
  /** 该帧成为当前帧时的导航令牌（query.d），返回该帧时用于还原 URL 与滚动记忆键 */
  d: number;
}

export const useOnlineDetailStore = defineStore('onlineDetail', () => {
  /** 搜索页（一级）缓存 */
  const searchPageCache = ref<SearchPageCache | null>(null);
  /** 榜单页（一级）缓存 */
  const topListsCache = ref<TopListsCache | null>(null);
  /** 详情流帧栈（二、三级容器），栈底为最早进入的二级容器 */
  const detailStack = ref<OnlineDetailFrame[]>([]);
  /** 当前展示的详情帧 */
  const currentDetail = ref<OnlineDetailFrame | null>(null);
  /** 导航令牌：每次 openDetail 递增并随 query.d 下发，用于详情页区分前进/返回 */
  let navToken = 0;

  /**
   * 打开详情容器：
   * - 已处于详情流中（详情页内下钻、播放器详情弹窗查看歌手/专辑）：当前帧（连同离开时
   *   快照的容器状态）入栈，新上下文成为当前帧 —— 上级容器保留；
   * - 从一级/外部页面进入：清空帧栈开启全新详情流。
   * 返回导航令牌，调用方需以其作为路由 query.d 下发。
   */
  const openDetail = (context: OnlineDetailContext, state?: OnlineDetailStateCache): number => {
    const d = navToken + 1;
    if (currentDetail.value && router.currentRoute.value.path === '/online-detail') {
      detailStack.value.push(
        state ? { ...currentDetail.value, state } : currentDetail.value,
      );
    } else {
      detailStack.value = [];
    }
    currentDetail.value = { context, d };
    navToken = d;
    return d;
  };

  /** 补写栈顶帧的容器状态快照：外部入口下钻（不经组件 pushDetail）时由详情页对账补上 */
  const setTopFrameState = (state: OnlineDetailStateCache) => {
    const top = detailStack.value[detailStack.value.length - 1];
    if (top) detailStack.value.splice(detailStack.value.length - 1, 1, { ...top, state });
  };

  /** 返回上一级：弹出栈顶帧并设为当前帧，返回弹出的帧（无栈时返回 null） */
  const popDetail = (): OnlineDetailFrame | null => {
    const frame = detailStack.value.pop() ?? null;
    if (frame) currentDetail.value = frame;
    return frame;
  };

  const canPopDetail = (): boolean => detailStack.value.length > 0;

  /** 清空详情流（离开 /online-detail 时调用；不触碰一级页面缓存，由调用方按去向处理） */
  const clearDetailFlow = () => {
    detailStack.value = [];
    currentDetail.value = null;
  };

  const setSearchPageCache = (cache: SearchPageCache | null) => {
    searchPageCache.value = cache;
  };

  const consumeSearchPageCache = (): SearchPageCache | null => {
    const cache = searchPageCache.value;
    searchPageCache.value = null;
    return cache;
  };

  const clearSearchPageCache = () => {
    searchPageCache.value = null;
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
    searchPageCache,
    topListsCache,
    detailStack,
    currentDetail,
    openDetail,
    setTopFrameState,
    popDetail,
    canPopDetail,
    clearDetailFlow,
    setSearchPageCache,
    consumeSearchPageCache,
    clearSearchPageCache,
    setTopListsCache,
    consumeTopListsCache,
    clearTopListsCache,
  };
});

/**
 * 打开在线详情容器的统一入口：压入详情流帧栈并携带导航令牌（query.d）跳转 /online-detail。
 * - 从一级/外部页面进入：push（详情流成为独立历史条目，返回键可回到来源页）；
 * - 详情流内下钻：replace（层级间导航不堆积历史条目，返回由帧栈显式驱动，
 *   避免浏览器历史链中任何 replace（启动重绘/守卫重定向）导致 back 跳级）。
 */
export function openOnlineDetail(context: OnlineDetailContext, state?: OnlineDetailStateCache): number {
  const inFlow = router.currentRoute.value.path === '/online-detail';
  const store = useOnlineDetailStore();
  const d = store.openDetail(context, state);
  void (inFlow ? router.replace : router.push)({
    path: '/online-detail',
    query: { type: context.type, d: String(d) },
  });
  return d;
}
