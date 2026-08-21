import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { OnlineDetailContext, OnlineDetailStateCache } from './store';

// node 环境无 localStorage，真实路由的 onboarding 门会拦截一切导航；
// openDetail 依赖 router.currentRoute 区分"详情流内下钻"与"一级/外部进入"，这里用可控行路由替身
const { routeState, pushMock, replaceMock } = vi.hoisted(() => {
  const routeState = { path: '/' };
  const pushMock = vi.fn(async (to: any) => {
    routeState.path = typeof to === 'string' ? to : (to?.path ?? '/');
  });
  const replaceMock = vi.fn(async (to: any) => {
    routeState.path = typeof to === 'string' ? to : (to?.path ?? '/');
  });
  return { routeState, pushMock, replaceMock };
});

vi.mock('../../router', () => ({
  default: {
    currentRoute: { get value() { return routeState; } },
    push: pushMock,
    replace: replaceMock,
  },
}));

import { useOnlineDetailStore, openOnlineDetail } from './store';

const makeArtistContext = (overrides: Partial<OnlineDetailContext> = {}): OnlineDetailContext => ({
  type: 'artist',
  title: '周杰伦',
  subtitle: '100 首歌曲',
  coverUrl: 'https://example.com/artist.jpg',
  pluginSource: { id: 'p1', name: '测试插件', format: 'musicfree', sources: ['wy'], enabled: true } as any,
  rawData: { id: 'artist-1' },
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
  engineType: 'musicfree',
  ...overrides,
});

const makeState = (tag: string): OnlineDetailStateCache => ({
  songs: [{ id: `${tag}-s1` }],
  albums: [{ id: `${tag}-a1` }],
  activeTab: 'albums',
  scrollTop: 300,
});

/** 模拟"已处于详情流"的路由状态 */
async function enterDetailRoute() {
  await pushMock({ path: '/online-detail' });
}

describe('onlineDetail store 帧栈模型', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    pushMock.mockClear();
    replaceMock.mockClear();
    routeState.path = '/';
  });

  describe('一级页面缓存（搜索页）', () => {
    it('setSearchPageCache 后 consume 一次性取走并清空', () => {
      const store = useOnlineDetailStore();
      const cache = {
        selectedSourceId: 'p1',
        activeSearchType: 'artist' as const,
        snapshot: { hasMore: false, currentPage: 1, lists: {} },
      };
      store.setSearchPageCache(cache);
      expect(store.consumeSearchPageCache()).toEqual(cache);
      expect(store.consumeSearchPageCache()).toBeNull();
    });

    it('clearSearchPageCache 销毁缓存（离开搜索页时）', () => {
      const store = useOnlineDetailStore();
      store.setSearchPageCache({} as any);
      store.clearSearchPageCache();
      expect(store.consumeSearchPageCache()).toBeNull();
    });
  });

  describe('一级页面缓存（榜单页）', () => {
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

  describe('详情流导航（openDetail/popDetail）', () => {
    it('从一级/外部页面进入：清空帧栈开启全新详情流，导航令牌递增', async () => {
      const store = useOnlineDetailStore();
      // 先制造一个旧详情流
      await enterDetailRoute();
      store.openDetail(makeArtistContext({ title: '旧歌手' }));
      store.openDetail(makeAlbumContext({ title: '旧专辑' }));
      expect(store.detailStack.length).toBe(1);

      // 离开详情流后再次进入：帧栈清空
      routeState.path = '/';
      const d = store.openDetail(makeArtistContext({ title: '新歌手' }));
      expect(d).toBeGreaterThan(0);
      expect(store.detailStack).toHaveLength(0);
      expect(store.currentDetail?.context.title).toBe('新歌手');
      expect(store.canPopDetail()).toBe(false);
    });

    it('详情流内下钻：当前帧入栈（一级打开二级，一级保留）', async () => {
      const store = useOnlineDetailStore();
      const d1 = store.openDetail(makeArtistContext({ title: '歌手' }));
      await enterDetailRoute();
      const d2 = store.openDetail(makeAlbumContext({ title: '专辑' }));

      expect(d2).toBeGreaterThan(d1);
      expect(store.detailStack).toHaveLength(1);
      expect(store.detailStack[0].context.title).toBe('歌手');
      expect(store.currentDetail?.context.title).toBe('专辑');
      expect(store.canPopDetail()).toBe(true);
    });

    it('popDetail：弹栈恢复上一级帧（二级退出回一级详情容器）', async () => {
      const store = useOnlineDetailStore();
      store.openDetail(makeArtistContext({ title: '歌手' }));
      await enterDetailRoute();
      store.openDetail(makeAlbumContext({ title: '专辑' }));

      const frame = store.popDetail();
      expect(frame?.context.title).toBe('歌手');
      expect(store.currentDetail?.context.title).toBe('歌手');
      expect(store.canPopDetail()).toBe(false);
    });

    it('栈空时 popDetail 返回 null 且当前帧不变', () => {
      const store = useOnlineDetailStore();
      store.openDetail(makeArtistContext({ title: '歌手' }));
      expect(store.popDetail()).toBeNull();
      expect(store.currentDetail?.context.title).toBe('歌手');
    });
  });

  describe('容器状态随帧缓存（统一规则：下钻保存，返回恢复）', () => {
    it('openDetail 携带 state 时随被离开的容器帧入栈，返回时带回', async () => {
      const store = useOnlineDetailStore();
      store.openDetail(makeArtistContext({ title: '歌手A' }));
      await enterDetailRoute();

      const stateA = makeState('A');
      store.openDetail(makeAlbumContext({ title: '专辑A' }), stateA);

      // 当前帧是专辑，栈顶是携带状态快照的歌手帧
      expect(store.currentDetail?.context.type).toBe('album');
      expect(store.canPopDetail()).toBe(true);

      const frame = store.popDetail();
      expect(frame?.context.type).toBe('artist');
      expect(frame?.state).toEqual(stateA);
    });

    it('setTopFrameState 补写栈顶帧状态（外部入口下钻时由详情页对账补上）', async () => {
      const store = useOnlineDetailStore();
      store.openDetail(makeArtistContext({ title: '歌手A' }));
      await enterDetailRoute();
      // 外部入口（弹窗）下钻：openOnlineDetail 未携带状态
      store.openDetail(makeAlbumContext({ title: '专辑A' }));

      const stateA = makeState('A');
      store.setTopFrameState(stateA);

      const frame = store.popDetail();
      expect(frame?.context.title).toBe('歌手A');
      expect(frame?.state).toEqual(stateA);
    });

    it('嵌套导航下 state 与对应帧绑定，不与其他帧错位', async () => {
      const store = useOnlineDetailStore();
      // 歌手A → 专辑A（携带歌手A状态）
      store.openDetail(makeArtistContext({ title: '歌手A' }));
      await enterDetailRoute();
      const stateA = makeState('A');
      store.openDetail(makeAlbumContext({ title: '专辑A' }), stateA);
      // 专辑A → 查看歌手 → 歌手B（携带专辑A状态）
      const stateAlbumA = makeState('albumA');
      store.openDetail(makeArtistContext({ title: '歌手B' }), stateAlbumA);
      // 歌手B → 专辑B（携带歌手B状态）
      const stateB = makeState('B');
      store.openDetail(makeAlbumContext({ title: '专辑B' }), stateB);
      expect(store.detailStack).toHaveLength(3);

      // 返回歌手B：恢复的是歌手B的状态
      expect(store.popDetail()?.state).toEqual(stateB);
      // 返回专辑A：恢复专辑A的状态
      const albumFrame = store.popDetail();
      expect(albumFrame?.context.title).toBe('专辑A');
      expect(albumFrame?.state).toEqual(stateAlbumA);
      // 返回歌手A：恢复歌手A的状态
      expect(store.popDetail()?.state).toEqual(stateA);
    });
  });

  describe('统一导航入口 openOnlineDetail', () => {
    it('从一级/外部页面进入：push 打开全新详情流，返回导航令牌', () => {
      const store = useOnlineDetailStore();
      const ctx = makeArtistContext({ title: '歌手' });
      const d = openOnlineDetail(ctx);

      expect(d).toBeGreaterThan(0);
      expect(store.currentDetail?.context.title).toBe('歌手');
      expect(store.currentDetail?.d).toBe(d);
      expect(pushMock).toHaveBeenCalledWith({
        path: '/online-detail',
        query: expect.objectContaining({ type: 'artist', d: String(d) }),
      });
      expect(replaceMock).not.toHaveBeenCalled();
    });

    it('详情流内下钻：replace 跳转（不堆积历史条目，避免浏览器历史错位跳级）', async () => {
      const store = useOnlineDetailStore();
      openOnlineDetail(makeArtistContext({ title: '歌手' }));
      await enterDetailRoute();
      pushMock.mockClear();

      const d2 = openOnlineDetail(makeAlbumContext({ title: '专辑' }), makeState('A'));

      expect(d2).toBeGreaterThan(store.detailStack[0].d);
      expect(replaceMock).toHaveBeenCalledWith({
        path: '/online-detail',
        query: expect.objectContaining({ type: 'album', d: String(d2) }),
      });
      expect(pushMock).not.toHaveBeenCalled();
    });

    it('复现用户流程：搜索→歌手→专辑→返回，弹栈回到歌手帧（携带缓存状态与原导航令牌）', async () => {
      const store = useOnlineDetailStore();
      const dArtist = openOnlineDetail(makeArtistContext({ title: '歌手A' }));
      await enterDetailRoute();
      const stateA = makeState('A');
      openOnlineDetail(makeAlbumContext({ title: '专辑A' }), stateA);

      expect(store.currentDetail?.context.type).toBe('album');

      const frame = store.popDetail();
      expect(frame?.context.type).toBe('artist');
      expect(frame?.state).toEqual(stateA);
      // 返回该帧时用其原始令牌 replace 回 URL
      expect(frame?.d).toBe(dArtist);
      expect(store.currentDetail?.context.title).toBe('歌手A');
    });
  });

  describe('离开详情流清理', () => {
    it('clearDetailFlow 清空帧栈与当前帧，但不触碰搜索/榜单一级缓存', async () => {
      const store = useOnlineDetailStore();
      store.openDetail(makeArtistContext());
      await enterDetailRoute();
      store.openDetail(makeAlbumContext(), makeState('X'));
      store.setTopListsCache({} as any);
      store.setSearchPageCache({} as any);

      store.clearDetailFlow();

      expect(store.currentDetail).toBeNull();
      expect(store.detailStack).toHaveLength(0);
      expect(store.canPopDetail()).toBe(false);
      // 一级页面缓存保留，由调用方按去向决定是否清理
      expect(store.topListsCache).not.toBeNull();
      expect(store.searchPageCache).not.toBeNull();
    });
  });
});
