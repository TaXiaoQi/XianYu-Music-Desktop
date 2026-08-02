import { describe, expect, it } from 'vitest';

import mainShellSource from '../components/layout/MainShell.vue?raw';
import sidebarSource from '../components/layout/Sidebar.vue?raw';
import routerSource from '../router/index.ts?raw';
import searchSource from './Search.vue?raw';

describe('Search page lifecycle', () => {
  it('does not keep the main search page alive after navigation', () => {
    expect(mainShellSource).toContain('<KeepAlive include="Home">');
    expect(mainShellSource).not.toContain('include="Home,Search"');
    expect(routerSource).toContain("{ path: '/search', name: 'Search', component: Search }");
  });

  it('cleans up pending search work when the page is destroyed', () => {
    expect(searchSource).toContain('onBeforeUnmount(() => {');
    expect(searchSource).toContain('searchAbortController?.abort();');
    expect(searchSource).toContain('clearTimeout(searchDebounceTimer);');
    expect(searchSource).toContain('playbackStore.tempQueue = [];');
    expect(searchSource).not.toContain('onDeactivated(() => {');
  });

  it('clears the shared main search query when navigating from the sidebar', () => {
    expect(sidebarSource).toContain('const handleOpenHomeView = () => {');
    expect(sidebarSource).toContain('const handleSidebarSelect = (key: SidebarItemKey) => {');
    expect(sidebarSource).toContain('const handleSidebarPlaylistClick = (event: MouseEvent, id: string) => {');
    expect(sidebarSource.match(/setSearch\(''\);/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sidebarSource).toContain('@playlistClick="handleSidebarPlaylistClick"');
  });
});
