import { describe, expect, it } from 'vitest';

import onlineDetailSource from './OnlineDetailView.vue?raw';
import topListsSource from './TopLists.vue?raw';
import searchSource from './Search.vue?raw';
import searchNavigationSource from '../composables/search/useSearchNavigation.ts?raw';
import storeSource from '../features/onlineDetail/store.ts?raw';
import { condense, expectSourceContains, expectSourceNotContains } from '../testing/sourceText';

describe('在线详情层级缓存生命周期', () => {
  it('store：帧栈模型（openDetail/popDetail/clearDetailFlow）+ 统一导航入口', () => {
    expectSourceContains(storeSource, 'const openDetail = (context: OnlineDetailContext, state?: OnlineDetailStateCache): number => {');
    expectSourceContains(storeSource, 'const popDetail = (): OnlineDetailFrame | null => {');
    expectSourceContains(storeSource, 'const clearDetailFlow = () => {');
    expectSourceContains(storeSource, "if (currentDetail.value && router.currentRoute.value.path === '/online-detail') {");
    expectSourceContains(storeSource, 'state ? { ...currentDetail.value, state } : currentDetail.value,');
    expectSourceContains(storeSource, 'const setTopFrameState = (state: OnlineDetailStateCache) => {');
    expectSourceContains(storeSource, 'export function openOnlineDetail(');
  });

  it('任意容器下钻：进入时快照当前容器状态（内容+tab+滚动；用户容器含收藏与歌单）随帧入栈', () => {
    expectSourceContains(onlineDetailSource, 'function captureState(): OnlineDetailStateCache {');
    expectSourceContains(onlineDetailSource, 'songs: songs.value,');
    expectSourceContains(onlineDetailSource, 'albums: albums.value,');
    expectSourceContains(onlineDetailSource, 'activeTab: artistActiveTab.value,');
    expectSourceContains(onlineDetailSource, 'scrollTop: detailScrollRef.value?.scrollTop || 0,');
    expectSourceContains(onlineDetailSource, 'state.userFavorites = viewedFavorites.value;');
    expectSourceContains(onlineDetailSource, 'state.userPlaylists = viewedPlaylists.value;');
  });

  it('流内下钻：pushDetail 压帧（仅带 tab 的歌手/用户容器携带状态快照）+ replace 跳转（不堆积历史条目）', () => {
    expectSourceContains(onlineDetailSource, "const inFlow = router.currentRoute.value.path === '/online-detail';");
    expectSourceContains(onlineDetailSource, "const isStateful = ctx.value?.type === 'artist' || ctx.value?.type === 'user';");
    expectSourceContains(onlineDetailSource, 'const d = openOnlineDetail(context, isStateful ? captureState() : undefined);');
    expectSourceContains(onlineDetailSource, 'lastHandledNavToken = d;');
    expectSourceContains(onlineDetailSource, 'loadFrameFresh(context.type);');
  });

  it('返回：handleBack 显式弹栈恢复（歌手/用户帧还原快照，专辑/歌单帧全新加载即销毁）；栈空才 router.back', () => {
    expectSourceContains(onlineDetailSource, 'if (onlineDetailStore.canPopDetail()) {');
    expectSourceContains(onlineDetailSource, 'const frame = onlineDetailStore.popDetail();');
    expectSourceContains(onlineDetailSource, "frame.state && (frame.context.type === 'artist' || frame.context.type === 'user')");
    expectSourceContains(onlineDetailSource, 'restoreFrame(frame.state);');
    expectSourceContains(onlineDetailSource, 'loadFrameFresh(frame.context.type);');
    expectSourceContains(onlineDetailSource, "query: { type: frame.context.type, d: String(frame.d) },");
    expectSourceContains(onlineDetailSource, 'void router.back();');
  });

  it('对账 watch：外部入口在详情流内打开（未经本地导航处理的 d 变化）时按新帧全新加载；仅歌手/用户补写栈顶帧状态（专辑/歌单离开即销毁不补写）', () => {
    expectSourceContains(onlineDetailSource, 'watch(() => Number(route.query.d ?? 0), (newD) => {');
    expectSourceContains(onlineDetailSource, 'if (newD === lastHandledNavToken) return;');
    expectSourceContains(onlineDetailSource, "const isStateful = ctx.value?.type === 'artist' || ctx.value?.type === 'user';");
    expectSourceContains(onlineDetailSource, 'if (isStateful) onlineDetailStore.setTopFrameState(captureState());');
    expectSourceContains(onlineDetailSource, 'loadFrameFresh(detailType.value);');
  });

  it('返回恢复：内容+tab+滚动整体还原并抑制重载（免重搜防风控）；hasInitialLoad 不翻转保住转场动画', () => {
    expectSourceContains(onlineDetailSource, 'function restoreFrame(state: OnlineDetailStateCache) {');
    expectSourceContains(onlineDetailSource, 'songs.value = state.songs;');
    expectSourceContains(onlineDetailSource, 'albums.value = state.albums;');
    expectSourceContains(onlineDetailSource, 'artistActiveTab.value = state.activeTab as ArtistTabId;');
    expectSourceContains(onlineDetailSource, 'pendingScrollTop = state.scrollTop;');
    expectSourceContains(onlineDetailSource, 'pendingScrollTop = 0;');
    expectSourceContains(onlineDetailSource, 'const handleDetailEnter = () => {');
    expectSourceContains(onlineDetailSource, '@enter="handleDetailEnter"');
    expectSourceContains(onlineDetailSource, '@wheel="cancelPendingScroll"');
    expectSourceContains(onlineDetailSource, 'const cancelPendingScroll = () => {');
    expectSourceContains(onlineDetailSource, 'restoringArtistState = true;');
    expectSourceContains(onlineDetailSource, 'if (restoringArtistState) return;');
    expectSourceContains(onlineDetailSource, 'function resetContentState() {');
    expect(onlineDetailSource.match(/hasInitialLoad\.value = false;/g)).toBeNull();
    expectSourceContains(onlineDetailSource, '<Transition name="detail-slide" mode="out-in" @enter="handleDetailEnter">');
    expectSourceContains(onlineDetailSource, '<Transition name="tab-fade" mode="out-in">');
    expectSourceContains(onlineDetailSource, 'artist-${ctx?.platformId ?? \'\'}-d${navToken}');
    expectSourceContains(onlineDetailSource, 'album-${ctx?.platformId ?? \'\'}-d${navToken}');
    expectSourceContains(onlineDetailSource, 'playlist-${ctx?.platformId ?? \'\'}-d${navToken}');
  });

  it('容器切换取消在途任务，二级容器退出即销毁（滚动记忆键含导航令牌）', () => {
    expectSourceContains(onlineDetailSource, 'function cancelPendingTasks() {');
    expectSourceContains(onlineDetailSource, "const navToken = computed(() => String(route.query.d ?? ''));");
    expectSourceContains(onlineDetailSource, "'::d' + navToken");
  });

  it('差异化：专辑/歌单容器禁用 SongTable 滚动记忆（离开即销毁，返回全新加载不继承旧滚动）；歌手/用户容器保留', () => {
    expectSourceContains(onlineDetailSource, "memory-scope-key=\"'online-detail-album::' + detailMemoryKey + '::d' + navToken\"");
    expectSourceContains(onlineDetailSource, "memory-scope-key=\"'online-detail-playlist::' + detailMemoryKey + '::d' + navToken\"");
    expectSourceContains(onlineDetailSource, ':disable-scroll-memory="true"');
    const condensed = condense(onlineDetailSource);
    const albumBlock = condensed.slice(
      condensed.indexOf(condense("detailType === 'album'")),
      condensed.indexOf(condense("detailType === 'playlist'")),
    );
    expectSourceContains(albumBlock, ':disable-scroll-memory="true"');
    const artistBlock = condensed.slice(
      condensed.indexOf(condense("detailType === 'artist' || detailType === 'user'")),
      condensed.indexOf(condense("detailType === 'album'")),
    );
    expectSourceNotContains(artistBlock, 'disable-scroll-memory');
  });

  it('差异化：@enter 滚动应用对专辑/歌单一律归零（即使待定位置被用户滚动取消），歌手/用户按帧快照恢复', () => {
    expectSourceContains(onlineDetailSource, "const isStateless = detailType.value === 'album' || detailType.value === 'playlist';");
    expectSourceContains(onlineDetailSource, 'const target = isStateless ? 0 : pendingScrollTop;');
    expectSourceContains(onlineDetailSource, 'pendingScrollTop = state.scrollTop;');
    expectSourceContains(onlineDetailSource, 'pendingScrollTop = 0;');
  });

  it('离开详情流：清空帧栈并按去向清理一级缓存（返回搜索/榜单保留对应缓存，其他销毁）', () => {
    expectSourceContains(onlineDetailSource, 'onlineDetailStore.clearDetailFlow();');
    expectSourceContains(onlineDetailSource, "if (dest.path === '/search') {");
    expectSourceContains(onlineDetailSource, "dest.path === '/' && dest.query.view === 'topLists'");
    expectSourceContains(onlineDetailSource, 'onlineDetailStore.clearSearchPageCache();');
    expectSourceContains(onlineDetailSource, 'onlineDetailStore.clearTopListsCache();');
  });

  it('榜单页（一级）：进入详情缓存来源+榜单+滚动，返回恢复，离开销毁', () => {
    expectSourceContains(topListsSource, 'const cached = onlineDetailStore.consumeTopListsCache();');
    expectSourceContains(topListsSource, 'restoreFromCache(cached)');
    expectSourceContains(topListsSource, "if (router.currentRoute.value.path === '/online-detail') {");
    expectSourceContains(topListsSource, 'onlineDetailStore.setTopListsCache({');
    expectSourceContains(topListsSource, 'onlineDetailStore.clearTopListsCache();');
    expectSourceContains(topListsSource, 'openOnlineDetail({');
  });

  it('搜索页（一级）：进入详情快照搜索状态（tab+源+结果+滚动），返回恢复，离开销毁', () => {
    expectSourceContains(searchSource, 'function captureResultsSnapshot(): SearchResultsSnapshot {');
    expectSourceContains(searchSource, 'scrollTop: catalogGridScrollTop.value,');
    expectSourceContains(searchSource, 'function restoreResultsSnapshot(snapshot: SearchResultsSnapshot) {');
    expectSourceContains(searchSource, 'el.scrollTop = snapshot.scrollTop!;');
    expectSourceContains(searchSource, "const cache = onlineDetailStore.consumeSearchPageCache();");
    expectSourceContains(searchSource, "if (router.currentRoute.value.path === '/online-detail') {");
    expectSourceContains(searchSource, 'onlineDetailStore.setSearchPageCache({');
    expectSourceContains(searchSource, 'onlineDetailStore.clearSearchPageCache();');
    expectSourceContains(searchNavigationSource, 'openOnlineDetail(');
  });
});
