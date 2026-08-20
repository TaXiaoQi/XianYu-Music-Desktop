import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useOnlineDetailStore, type OnlineDetailContext } from './store';

const makeArtistContext = (overrides: Partial<OnlineDetailContext> = {}): OnlineDetailContext => ({
  type: 'artist',
  title: '周杰伦',
  subtitle: '100 首歌曲',
  coverUrl: 'https://example.com/artist.jpg',
  pluginSource: { id: 'p1', name: '测试插件', format: 'musicfree', sources: ['wy'], enabled: true } as any,
  rawData: { id: 'artist-1' },
  sourceSearchType: 'artist',
  engineType: 'musicfree',
  ...overrides,
});

const makeAlbumContext = (overrides: Partial<OnlineDetailContext> = {}): OnlineDetailContext => ({
  type: 'album',
  title: '范特西',
  subtitle: '周杰伦',
  coverUrl: 'https://example.com/album.jpg',
  pluginSource: { id: 'p1', name: '测试插件', format: 'musicfree', sources: ['wy'], enabled: true } as any,
  rawData: { id: 'album-1' },
  sourceSearchType: 'artist',
  engineType: 'musicfree',
  ...overrides,
});

describe('onlineDetail store 层级缓存', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('榜单页（一级）缓存', () => {
    it('setTopListsCache 后 consume 一次性取走并清空', () => {
      const store = useOnlineDetailStore();
      const cache = {
        sourceList: [{ id: 'p1', name: '测试插件', source: {} as any }],
        selectedSourceId: 'p1',
        topLists: [],
        gridScrollTop: 120,
        gridViewportHeight: 720,
        gridWidth: 960,
      };
      store.setTopListsCache(cache);
      expect(store.consumeTopListsCache()).toEqual(cache);
      expect(store.consumeTopListsCache()).toBeNull();
    });

    it('clearTopListsCache 销毁缓存（离开榜单页时）', () => {
      const store = useOnlineDetailStore();
      store.setTopListsCache({} as any);
      store.clearTopListsCache();
      expect(store.consumeTopListsCache()).toBeNull();
    });
  });

  describe('歌手详情状态随上下文入栈（歌手→专辑→返回）', () => {
    it('setContextWithHistory 携带 detailState 入栈，返回时随上下文一起恢复', () => {
      const store = useOnlineDetailStore();
      const artistCtx = makeArtistContext();
      store.setContext(artistCtx);

      const artistState = {
        songs: [{ id: 's1' }],
        albums: [{ id: 'a1' }],
        artistActiveTab: 'albums',
        scrollTop: 300,
      };
      store.setContextWithHistory(makeAlbumContext(), artistState);

      // 当前上下文是专辑，栈顶是携带 detailState 的歌手上下文
      expect(store.context?.type).toBe('album');
      expect(store.hasPreviousContext()).toBe(true);

      // 返回歌手详情：恢复上下文，detailState 随上下文带回
      expect(store.restorePreviousContext()).toBe(true);
      expect(store.context?.type).toBe('artist');
      expect(store.context?.detailState).toEqual(artistState);
    });

    it('不带 detailState 的入栈（如歌单→查看歌手）返回时不携带状态', () => {
      const store = useOnlineDetailStore();
      store.setContext(makeArtistContext());
      store.setContextWithHistory(makeAlbumContext());
      expect(store.restorePreviousContext()).toBe(true);
      expect(store.context?.detailState).toBeUndefined();
    });

    it('嵌套导航下 detailState 与对应上下文绑定，不与其他上下文错位', () => {
      const store = useOnlineDetailStore();
      // 歌手A → 专辑A（携带歌手A状态）
      const artistA = makeArtistContext({ title: '歌手A' });
      store.setContext(artistA);
      const stateA = { songs: ['A'], albums: [], artistActiveTab: 'songs', scrollTop: 100 };
      store.setContextWithHistory(makeAlbumContext({ title: '专辑A' }), stateA);
      // 专辑A → 查看歌手 → 歌手B（不携带状态）
      store.setContextWithHistory(makeArtistContext({ title: '歌手B' }));
      // 歌手B → 专辑B（携带歌手B状态）
      const stateB = { songs: ['B'], albums: [], artistActiveTab: 'albums', scrollTop: 200 };
      store.setContextWithHistory(makeAlbumContext({ title: '专辑B' }), stateB);

      // 返回歌手B：恢复的是歌手B的状态
      store.restorePreviousContext();
      expect(store.context?.title).toBe('歌手B');
      expect(store.context?.detailState).toEqual(stateB);
      // 返回专辑A：无 detailState，不恢复状态
      store.restorePreviousContext();
      expect(store.context?.title).toBe('专辑A');
      expect(store.context?.detailState).toBeUndefined();
      // 返回歌手A：恢复歌手A的状态
      store.restorePreviousContext();
      expect(store.context?.title).toBe('歌手A');
      expect(store.context?.detailState).toEqual(stateA);
    });
  });

  describe('离开详情流清理', () => {
    it('clearContextFlow 清空上下文与历史栈，但不触碰搜索/榜单缓存', () => {
      const store = useOnlineDetailStore();
      store.setContextWithHistory(makeArtistContext(), { songs: [], albums: [], artistActiveTab: 'songs', scrollTop: 0 });
      store.setTopListsCache({} as any);
      store.setSearchResultsCache({ hasMore: false, currentPage: 1, lists: {} });
      store.setPendingSearchSession({ type: 'artist', sourceId: 'p1' });

      store.clearContextFlow();

      expect(store.context).toBeNull();
      expect(store.hasPreviousContext()).toBe(false);
      // 搜索/榜单缓存保留，由调用方按去向决定是否清理
      expect(store.topListsCache).not.toBeNull();
      expect(store.searchResultsCache).not.toBeNull();
      expect(store.pendingSearchSession).not.toBeNull();
    });

    it('clearSearchSession 仅清理搜索会话，保留榜单缓存', () => {
      const store = useOnlineDetailStore();
      store.setTopListsCache({} as any);
      store.setSearchResultsCache({ hasMore: false, currentPage: 1, lists: {} });
      store.clearSearchSession();
      expect(store.searchResultsCache).toBeNull();
      expect(store.pendingSearchSession).toBeNull();
      expect(store.topListsCache).not.toBeNull();
    });

    it('clearTopListsCache 仅清理榜单缓存，保留搜索会话', () => {
      const store = useOnlineDetailStore();
      store.setTopListsCache({} as any);
      store.setSearchResultsCache({ hasMore: false, currentPage: 1, lists: {} });
      store.clearTopListsCache();
      expect(store.topListsCache).toBeNull();
      expect(store.searchResultsCache).not.toBeNull();
    });

    it('clearContext 清空全部缓存', () => {
      const store = useOnlineDetailStore();
      store.setContext(makeArtistContext());
      store.setTopListsCache({} as any);
      store.setSearchResultsCache({ hasMore: false, currentPage: 1, lists: {} });
      store.clearContext();
      expect(store.context).toBeNull();
      expect(store.topListsCache).toBeNull();
      expect(store.searchResultsCache).toBeNull();
      expect(store.pendingSearchSession).toBeNull();
    });
  });
});
