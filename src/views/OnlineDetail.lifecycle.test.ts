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

  it('流内下钻：pushDetail 压帧（携带状态快照）+ replace 跳转（不堆积历史条目），并显式按新帧加载', () => {
    expect(onlineDetailSource).toContain("const inFlow = router.currentRoute.value.path === '/online-detail';");
    expect(onlineDetailSource).toContain('const d = openOnlineDetail(context, captureState());');
    expect(onlineDetailSource).toContain('lastHandledNavToken = d;');
    expect(onlineDetailSource).toContain('loadFrameFresh(context.type);');
  });

  it('返回：handleBack 显式弹栈恢复（不依赖浏览器历史），replace 回该帧原导航令牌；栈空才 router.back', () => {
    expect(onlineDetailSource).toContain('if (onlineDetailStore.canPopDetail()) {');
    expect(onlineDetailSource).toContain('const frame = onlineDetailStore.popDetail();');
    expect(onlineDetailSource).toContain('restoreFrame(frame.state);');
    expect(onlineDetailSource).toContain('loadFrameFresh(frame.context.type);');
    expect(onlineDetailSource).toContain("query: { type: frame.context.type, d: String(frame.d) },");
    expect(onlineDetailSource).toContain('void router.back();');
  });

  it('对账 watch：外部入口在详情流内打开（未经本地导航处理的 d 变化）时补写栈顶帧状态并按新帧全新加载', () => {
    expect(onlineDetailSource).toContain('watch(() => Number(route.query.d ?? 0), (newD) => {');
    expect(onlineDetailSource).toContain('if (newD === lastHandledNavToken) return;');
    expect(onlineDetailSource).toContain('onlineDetailStore.setTopFrameState(captureState());');
    expect(onlineDetailSource).toContain('loadFrameFresh(detailType.value);');
  });

  it('返回恢复：内容+tab+滚动整体还原并抑制重载（免重搜防风控）；hasInitialLoad 不翻转保住转场动画', () => {
    expect(onlineDetailSource).toContain('function restoreFrame(state: OnlineDetailStateCache) {');
    expect(onlineDetailSource).toContain('songs.value = state.songs;');
    expect(onlineDetailSource).toContain('albums.value = state.albums;');
    expect(onlineDetailSource).toContain('artistActiveTab.value = state.activeTab as ArtistTabId;');
    // 滚动位置不在切换瞬间赋值（离场内容会 clamp），统一在新容器进入时应用
    expect(onlineDetailSource).toContain('pendingScrollTop = state.scrollTop;');
    // 全新容器进入时归零，杜绝残留上一容器的滚动位置
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
  });

  it('容器切换取消在途任务，二级容器退出即销毁（滚动记忆键含导航令牌）', () => {
    expect(onlineDetailSource).toContain('function cancelPendingTasks() {');
    expect(onlineDetailSource).toContain("const navToken = computed(() => String(route.query.d ?? ''));");
    expect(onlineDetailSource).toContain("'::d' + navToken");
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
