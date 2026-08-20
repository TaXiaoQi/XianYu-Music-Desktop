import { describe, expect, it } from 'vitest';

import onlineDetailSource from './OnlineDetailView.vue?raw';
import topListsSource from './TopLists.vue?raw';
import searchSource from './Search.vue?raw';
import storeSource from '../features/onlineDetail/store.ts?raw';

describe('在线详情层级缓存生命周期', () => {
  it('歌手详情→专辑详情：进入时保存歌手数据状态（内容+tab+滚动）随上下文入栈', () => {
    expect(onlineDetailSource).toContain('const artistState: ArtistDetailStateCache = {');
    expect(onlineDetailSource).toContain('songs: songs.value,');
    expect(onlineDetailSource).toContain('albums: albums.value,');
    expect(onlineDetailSource).toContain('artistActiveTab: artistActiveTab.value,');
    expect(onlineDetailSource).toContain('scrollTop: detailScrollRef.value?.scrollTop || 0,');
    expect(onlineDetailSource).toContain('setContextWithHistory({');
  });

  it('歌手详情→专辑详情：返回歌手详情时恢复缓存状态并免重搜', () => {
    expect(onlineDetailSource).toContain('const restored = ctx.value?.detailState;');
    expect(onlineDetailSource).toContain('songs.value = restored.songs;');
    expect(onlineDetailSource).toContain('albums.value = restored.albums;');
    expect(onlineDetailSource).toContain('artistActiveTab.value = restored.artistActiveTab as ArtistTabId;');
    expect(onlineDetailSource).toContain('detailScrollRef.value.scrollTop = restored.scrollTop;');
    // 恢复期间抑制 tab 切换触发的重载
    expect(onlineDetailSource).toContain('restoringArtistState');
    expect(onlineDetailSource).toContain('if (restoringArtistState) return;');
  });

  it('store：上下文内嵌 detailState，避免嵌套导航时状态错位', () => {
    expect(storeSource).toContain('detailState?: ArtistDetailStateCache;');
    expect(storeSource).toContain('stateToAttach?: ArtistDetailStateCache');
    expect(storeSource).toContain('contextStack.value.push({ ...context.value, detailState: stateToAttach });');
    expect(storeSource).toContain('clearContextFlow');
  });

  it('离开详情流：按去向清理一级缓存（返回搜索/榜单保留对应缓存，其他销毁）', () => {
    expect(onlineDetailSource).toContain('onlineDetailStore.clearContextFlow();');
    expect(onlineDetailSource).toContain("if (destPath === '/search') {");
    expect(onlineDetailSource).toContain('onlineDetailStore.clearTopListsCache();');
    expect(onlineDetailSource).toContain("} else if (destPath === '/top-lists') {");
    expect(onlineDetailSource).toContain('onlineDetailStore.clearSearchSession();');
  });

  it('榜单页（一级）：进入详情缓存来源+榜单+滚动，返回恢复，离开销毁', () => {
    expect(topListsSource).toContain('const cached = onlineDetailStore.consumeTopListsCache();');
    expect(topListsSource).toContain('restoreFromCache(cached)');
    expect(topListsSource).toContain("if (router.currentRoute.value.path === '/online-detail') {");
    expect(topListsSource).toContain('onlineDetailStore.setTopListsCache({');
    expect(topListsSource).toContain('onlineDetailStore.clearTopListsCache();');
  });

  it('搜索页（一级）：进入详情快照搜索结果+滚动，返回恢复，离开销毁', () => {
    expect(searchSource).toContain('function captureResultsSnapshot(): SearchResultsSnapshot {');
    expect(searchSource).toContain('scrollTop: catalogGridScrollTop.value,');
    expect(searchSource).toContain('function restoreResultsSnapshot(snapshot: SearchResultsSnapshot) {');
    expect(searchSource).toContain('el.scrollTop = snapshot.scrollTop!;');
    expect(searchSource).toContain("if (router.currentRoute.value.path === '/online-detail') {");
    expect(searchSource).toContain('onlineDetailStore.setSearchResultsCache(captureResultsSnapshot());');
    expect(searchSource).toContain('onlineDetailStore.clearSearchSession();');
  });
});
