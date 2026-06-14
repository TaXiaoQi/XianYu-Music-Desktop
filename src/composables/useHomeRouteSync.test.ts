import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  effectScope,
  nextTick,
  reactive,
  ref,
} from 'vue';
import type {
  LocationQuery,
  RouteLocationNormalizedLoaded,
  Router,
} from 'vue-router';

import type { FolderNode } from '../types';
import { useHomeRouteSync } from './useHomeRouteSync';
import { useHomeViewState } from './useHomeViewState';

const makeFolderNode = (
  path: string,
  overrides: Partial<FolderNode> = {},
): FolderNode => ({
  name: path.split('/').pop() || path,
  path,
  children: [],
  child_count: 0,
  children_loaded: true,
  song_count: 0,
  cover_song_path: null,
  is_expanded: false,
  ...overrides,
});

const createRoute = (
  path: string,
  query: LocationQuery = {},
) => reactive({
  path,
  query,
}) as RouteLocationNormalizedLoaded;

describe('useHomeRouteSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps home state normalized while allowing kept-alive home to resume into folder mode', async () => {
    const route = createRoute('/artists');
    const router = {
      replace: vi.fn().mockResolvedValue(undefined),
    } as unknown as Router;

    const currentViewMode = ref('artist');
    const filterCondition = ref('Existing Artist');
    const currentFolderFilter = ref('');
    const activeRootPath = ref<string | null>(null);
    const folderTree = ref([
      makeFolderNode('/music/library'),
    ]);
    const searchQuery = ref('persistent query');
    const isManagementMode = ref(false);

    const appShellScope = effectScope();
    appShellScope.run(() => {
      useHomeRouteSync({
        route,
        router,
        currentViewMode,
        filterCondition,
        currentFolderFilter,
        activeRootPath,
        folderTree,
        searchQuery,
      });
    });

    let homeState!: ReturnType<typeof useHomeViewState>;
    const homeScope = effectScope();
    homeScope.run(() => {
      homeState = useHomeViewState({
        currentViewMode,
        filterCondition,
        isManagementMode,
      });
    });

    expect(homeState.localViewMode.value).toBe('artist');

    homeScope.pause();
    Object.assign(route, {
      path: '/',
      query: {
        view: 'folder',
        folder: '/music/library/live',
      },
    });

    await nextTick();

    expect(currentViewMode.value).toBe('folder');
    expect(filterCondition.value).toBe('');
    expect(currentFolderFilter.value).toBe('/music/library/live');
    expect(activeRootPath.value).toBe('/music/library');
    expect(searchQuery.value).toBe('persistent query');
    expect(homeState.localViewMode.value).toBe('artist');
    expect(router.replace).not.toHaveBeenCalled();

    homeScope.resume();
    await nextTick();

    expect(homeState.localViewMode.value).toBe('folder');

    homeScope.stop();
    appShellScope.stop();
  });

  it('fills in the first root folder when folder view query omits the folder path', async () => {
    const route = createRoute('/', { view: 'folder' });
    const router = {
      replace: vi.fn().mockResolvedValue(undefined),
    } as unknown as Router;

    const currentViewMode = ref('all');
    const filterCondition = ref('');
    const currentFolderFilter = ref('');
    const activeRootPath = ref<string | null>(null);
    const folderTree = ref([
      makeFolderNode('/music/root-a'),
      makeFolderNode('/music/root-b'),
    ]);
    const searchQuery = ref('persistent query');

    const scope = effectScope();
    scope.run(() => {
      useHomeRouteSync({
        route,
        router,
        currentViewMode,
        filterCondition,
        currentFolderFilter,
        activeRootPath,
        folderTree,
        searchQuery,
      });
    });

    await nextTick();

    expect(currentViewMode.value).toBe('folder');
    expect(currentFolderFilter.value).toBe('/music/root-a');
    expect(activeRootPath.value).toBe('/music/root-a');
    expect(searchQuery.value).toBe('persistent query');
    expect(router.replace).toHaveBeenCalledWith({
      path: '/',
      query: {
        view: 'folder',
        folder: '/music/root-a',
      },
    });

    scope.stop();
  });

  it('resets stale home state without clearing the active search when returning to plain home from a non-home route', async () => {
    const route = createRoute('/artists');
    const router = {
      replace: vi.fn().mockResolvedValue(undefined),
    } as unknown as Router;

    const currentViewMode = ref('folder');
    const filterCondition = ref('');
    const currentFolderFilter = ref('/music/root-a/live');
    const activeRootPath = ref<string | null>('/music/root-a');
    const folderTree = ref([
      makeFolderNode('/music/root-a'),
    ]);
    const searchQuery = ref('persistent query');

    const scope = effectScope();
    scope.run(() => {
      useHomeRouteSync({
        route,
        router,
        currentViewMode,
        filterCondition,
        currentFolderFilter,
        activeRootPath,
        folderTree,
        searchQuery,
      });
    });

    Object.assign(route, {
      path: '/',
      query: {},
    });

    await nextTick();

    expect(currentViewMode.value).toBe('all');
    expect(filterCondition.value).toBe('');
    expect(currentFolderFilter.value).toBe('/music/root-a/live');
    expect(activeRootPath.value).toBe('/music/root-a');
    expect(searchQuery.value).toBe('persistent query');
    expect(router.replace).not.toHaveBeenCalled();

    scope.stop();
  });

  it('maps favorites and recent routes into the shared navigation state', async () => {
    const route = createRoute('/favorites');
    const router = {
      replace: vi.fn().mockResolvedValue(undefined),
    } as unknown as Router;

    const currentViewMode = ref('folder');
    const filterCondition = ref('playlist-id');
    const currentFolderFilter = ref('/music/root-a/live');
    const activeRootPath = ref<string | null>('/music/root-a');
    const folderTree = ref([
      makeFolderNode('/music/root-a'),
    ]);
    const searchQuery = ref('persistent query');

    const scope = effectScope();
    scope.run(() => {
      useHomeRouteSync({
        route,
        router,
        currentViewMode,
        filterCondition,
        currentFolderFilter,
        activeRootPath,
        folderTree,
        searchQuery,
      });
    });

    await nextTick();

    expect(currentViewMode.value).toBe('favorites');
    expect(filterCondition.value).toBe('');
    expect(searchQuery.value).toBe('persistent query');
    expect(router.replace).not.toHaveBeenCalled();

    Object.assign(route, {
      path: '/recent',
      query: {},
    });

    await nextTick();

    expect(currentViewMode.value).toBe('recent');
    expect(filterCondition.value).toBe('');
    expect(searchQuery.value).toBe('persistent query');
    expect(router.replace).not.toHaveBeenCalled();

    scope.stop();
  });
});
