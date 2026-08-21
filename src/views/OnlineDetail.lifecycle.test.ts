import { describe, expect, it } from 'vitest';

import onlineDetailSource from './OnlineDetailView.vue?raw';
import topListsSource from './TopLists.vue?raw';
import searchSource from './Search.vue?raw';
import storeSource from '../features/onlineDetail/store.ts?raw';

describe('在线详情层级缓存生命周期', () => {
  it('store：帧栈模型（openDetail/popDetail/clearDetailFlow）+ 统一导航入口', () => {
    expect(storeSource).toContain('const openDetail = (context: OnlineDetailContext, state?: OnlineDetailStateCache): number => {');
    expect(storeSource).toContain('const popDetail = (): OnlineDetailFrame | null => {');
    expect(storeSource).toContain('const clearDetailFlow = () => {');
    // 详情流内下钻：当前帧（连同状态快照）入栈；一级/外部进入：清空帧栈
    expect(storeSource).toContain("if (currentDetail.value && router.currentRoute.value.path === '/online-detail') {");
    expect(storeSource).toContain('state ? { ...currentDetail.value, state } : currentDetail.value,');
    expect(storeSource).toContain('const setTopFrameState = (state: OnlineDetailStateCache) => {');
    expect(storeSource).toContain('export function openOnlineDetail(');
  });

  it('任意容器下钻：进入时快照当前容器状态（内容+tab+滚动；用户容器含收藏与歌单）随帧入栈', () => {
    expect(onlineDetailSource).toContain('function captureState(): OnlineDetailStateCache {');
    expect(onlineDetailSource).toContain('songs: songs.value,');
    expect(onlineDetailSource).toContain('albums: albums.value,');
    expect(onlineDetailSource).toContain('activeTab: artistActiveTab.value,');
    expect(onlineDetailSource).toContain('scrollTop: detailScrollRef.value?.scrollTop || 0,');
    expect(onlineDetailSource).toContain('state.userFavorites = viewedFavorites.value;');
    expect(onlineDetailSource).toContain('state.userPlaylists = viewedPlaylists.value;');
  });

  it('流内下钻：pushDetail 压帧（仅带 tab 的歌手/用户容器携带状态快照）+ replace 跳转（不堆积历史条目）', () => {
    expect(onlineDetailSource).toContain("const inFlow = router.currentRoute.value.path === '/online-detail';");
    // 差异化：专辑/歌单下钻不携带快照（离开即销毁，返回全新加载不继承滚动）
    expect(onlineDetailSource).toContain("const isStateful = ctx.value?.type === 'artist' || ctx.value?.type === 'user';");
    expect(onlineDetailSource).toContain('const d = openOnlineDetail(context, isStateful ? captureState() : undefined);');
    expect(onlineDetailSource).toContain('lastHandledNavToken = d;');
    expect(onlineDetailSource).toContain('loadFrameFresh(context.type);');
  });

  it('返回：handleBack 显式弹栈恢复（歌手/用户帧还原快照，专辑/歌单帧全新加载即销毁）；栈空才 router.back', () => {
    expect(onlineDetailSource).toContain('if (onlineDetailStore.canPopDetail()) {');
    expect(onlineDetailSource).toContain('const frame = onlineDetailStore.popDetail();');
    expect(onlineDetailSource).toContain("frame.state && (frame.context.type === 'artist' || frame.context.type === 'user')");
    expect(onlineDetailSource).toContain('restoreFrame(frame.state);');
    expect(onlineDetailSource).toContain('loadFrameFresh(frame.context.type);');
    expect(onlineDetailSource).toContain("query: { type: frame.context.type, d: String(frame.d) },");
    expect(onlineDetailSource).toContain('void router.back();');
  });

  it('对账 watch：外部入口在详情流内打开（未经本地导航处理的 d 变化）时按新帧全新加载；仅歌手/用户补写栈顶帧状态（专辑/歌单离开即销毁不补写）', () => {
    expect(onlineDetailSource).toContain('watch(() => Number(route.query.d ?? 0), (newD) => {');
    expect(onlineDetailSource).toContain('if (newD === lastHandledNavToken) return;');
    expect(onlineDetailSource).toContain("const isStateful = ctx.value?.type === 'artist' || ctx.value?.type === 'user';");
    expect(onlineDetailSource).toContain('if (isStateful) onlineDetailStore.setTopFrameState(captureState());');
    expect(onlineDetailSource).toContain('loadFrameFresh(detailType.value);');
  });

  it('返回恢复：内容+tab+滚动整体还原并抑制重载（免重搜防风控）；hasInitialLoad 不翻转保住转场动画', () => {
    expect(onlineDetailSource).toContain('function restoreFrame(state: OnlineDetailStateCache) {');
    expect(onlineDetailSource).toContain('songs.value = state.songs;');
    expect(onlineDetailSource).toContain('albums.value = state.albums;');
    expect(onlineDetailSource).toContain('artistActiveTab.value = state.activeTab as ArtistTabId;');
    // 滚动位置不在切换瞬间赋值（离场内容会 clamp），统一在新容器进入时应用
    expect(onlineDetailSource).toContain('pendingScrollTop = state.scrollTop;');
    // 全新容器进入时归零（标 pendingScrollTop，由 @enter 应用，避免同步归零伤及带 tab 的歌手页返回恢复）
    expect(onlineDetailSource).toContain('pendingScrollTop = 0;');
    expect(onlineDetailSource).toContain('const handleDetailEnter = () => {');
    expect(onlineDetailSource).toContain('@enter="handleDetailEnter"');
    // 用户主动滚动时放弃待应用的恢复位置
    expect(onlineDetailSource).toContain('@wheel="cancelPendingScroll"');
    expect(onlineDetailSource).toContain('const cancelPendingScroll = () => {');
    // 恢复期间抑制 tab 切换触发的重载
    expect(onlineDetailSource).toContain('restoringArtistState = true;');
    expect(onlineDetailSource).toContain('if (restoringArtistState) return;');
    // resetContentState 不翻转 hasInitialLoad：内容分支（含 Transition）始终在 DOM 中，
    // 下钻/返回的容器切换走 Transition 动画而非整块卸载重挂
    expect(onlineDetailSource).toContain('function resetContentState() {');
    expect(onlineDetailSource.match(/hasInitialLoad\.value = false;/g)).toBeNull();
    // 容器切换使用顺序转场（先淡出后淡进）
    expect(onlineDetailSource).toContain('<Transition name="detail-slide" mode="out-in" @enter="handleDetailEnter">');
    expect(onlineDetailSource).toContain('<Transition name="tab-fade" mode="out-in">');
    // 分支 key 含导航令牌 d：任意两帧（含同类型/platformId 缺失或相同）key 必不同，
    // 转场与 @enter 滚动应用必定触发，杜绝同类型容器间静默继承滚动位置
    expect(onlineDetailSource).toContain('artist-${ctx?.platformId ?? \'\'}-d${navToken}');
    expect(onlineDetailSource).toContain('album-${ctx?.platformId ?? \'\'}-d${navToken}');
    expect(onlineDetailSource).toContain('playlist-${ctx?.platformId ?? \'\'}-d${navToken}');
  });

  it('容器切换取消在途任务，二级容器退出即销毁（滚动记忆键含导航令牌）', () => {
    expect(onlineDetailSource).toContain('function cancelPendingTasks() {');
    expect(onlineDetailSource).toContain("const navToken = computed(() => String(route.query.d ?? ''));");
    expect(onlineDetailSource).toContain("'::d' + navToken");
  });

  it('差异化：专辑/歌单容器禁用 SongTable 滚动记忆（离开即销毁，返回全新加载不继承旧滚动）；歌手/用户容器保留', () => {
    // 专辑/歌单 SongTable 传 disable-scroll-memory，useListScrollMemory 不保存也不恢复，
    // 杜绝返回时按旧 d 命中上次访问保存的滚动位置（@enter 归零争不过恢复循环的根因）
    expect(onlineDetailSource).toContain("memory-scope-key=\"'online-detail-album::' + detailMemoryKey + '::d' + navToken\"");
    expect(onlineDetailSource).toContain("memory-scope-key=\"'online-detail-playlist::' + detailMemoryKey + '::d' + navToken\"");
    expect(onlineDetailSource).toContain(':disable-scroll-memory="true"');
    // 歌手/用户容器不传该 prop，保留滚动记忆（恢复走帧快照 restoreFrame）
    const albumBlock = onlineDetailSource.slice(
      onlineDetailSource.indexOf("detailType === 'album'"),
      onlineDetailSource.indexOf("detailType === 'playlist'"),
    );
    expect(albumBlock).toContain(':disable-scroll-memory="true"');
    const artistBlock = onlineDetailSource.slice(
      onlineDetailSource.indexOf("detailType === 'artist' || detailType === 'user'"),
      onlineDetailSource.indexOf("detailType === 'album'"),
    );
    expect(artistBlock).not.toContain('disable-scroll-memory');
  });

  it('差异化：@enter 滚动应用对专辑/歌单一律归零（即使待定位置被用户滚动取消），歌手/用户按帧快照恢复', () => {
    // 专辑/歌单"离开即销毁"：进入时 target 固定为 0，不依赖 pendingScrollTop 是否被
    // cancelPendingScroll 置空 —— 杜绝继承上一容器滚动位置；歌手/用户才读 pendingScrollTop
    expect(onlineDetailSource).toContain("const isStateless = detailType.value === 'album' || detailType.value === 'playlist';");
    expect(onlineDetailSource).toContain('const target = isStateless ? 0 : pendingScrollTop;');
    // 歌手/用户分支仍按帧快照恢复（pendingScrollTop 为 0 或快照值）
    expect(onlineDetailSource).toContain('pendingScrollTop = state.scrollTop;');
    expect(onlineDetailSource).toContain('pendingScrollTop = 0;');
  });

  it('离开详情流：清空帧栈并按去向清理一级缓存（返回搜索/榜单保留对应缓存，其他销毁）', () => {
    expect(onlineDetailSource).toContain('onlineDetailStore.clearDetailFlow();');
    expect(onlineDetailSource).toContain("if (dest.path === '/search') {");
    expect(onlineDetailSource).toContain("dest.path === '/' && dest.query.view === 'topLists'");
    expect(onlineDetailSource).toContain('onlineDetailStore.clearSearchPageCache();');
    expect(onlineDetailSource).toContain('onlineDetailStore.clearTopListsCache();');
  });

  it('榜单页（一级）：进入详情缓存来源+榜单+滚动，返回恢复，离开销毁', () => {
    expect(topListsSource).toContain('const cached = onlineDetailStore.consumeTopListsCache();');
    expect(topListsSource).toContain('restoreFromCache(cached)');
    expect(topListsSource).toContain("if (router.currentRoute.value.path === '/online-detail') {");
    expect(topListsSource).toContain('onlineDetailStore.setTopListsCache({');
    expect(topListsSource).toContain('onlineDetailStore.clearTopListsCache();');
    expect(topListsSource).toContain('openOnlineDetail({');
  });

  it('搜索页（一级）：进入详情快照搜索状态（tab+源+结果+滚动），返回恢复，离开销毁', () => {
    expect(searchSource).toContain('function captureResultsSnapshot(): SearchResultsSnapshot {');
    expect(searchSource).toContain('scrollTop: catalogGridScrollTop.value,');
    expect(searchSource).toContain('function restoreResultsSnapshot(snapshot: SearchResultsSnapshot) {');
    expect(searchSource).toContain('el.scrollTop = snapshot.scrollTop!;');
    expect(searchSource).toContain("const cache = onlineDetailStore.consumeSearchPageCache();");
    expect(searchSource).toContain("if (router.currentRoute.value.path === '/online-detail') {");
    expect(searchSource).toContain('onlineDetailStore.setSearchPageCache({');
    expect(searchSource).toContain('onlineDetailStore.clearSearchPageCache();');
    expect(searchSource).toContain('openOnlineDetail(');
  });
});
