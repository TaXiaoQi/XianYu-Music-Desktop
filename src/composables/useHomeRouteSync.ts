import { watch } from 'vue';
import type { Ref } from 'vue';
import type { LocationQueryRaw, RouteLocationNormalizedLoaded, Router } from 'vue-router';
import type { FolderNode as FolderNodeShape } from '../types';
import {
  HOME_URL_PARAMS,
  IDLE_HOME_VIEW,
  buildHomeQueryFromState,
  carriesHomeParams,
  readRoutedHomeState,
  sameControlledHomeQuery,
} from './homeRouteQueryState';
import { findDeepestOwningRoot, toRootPaths } from './libraryRootOwnership';

const EMPTY_FILTER = '';

interface HomeRouteSyncOptions {
  route: RouteLocationNormalizedLoaded; router: Router;
  currentViewMode: Ref<string>; filterCondition: Ref<string>; currentFolderFilter: Ref<string>;
  activeRootPath: Ref<string | null>; folderTree: Ref<FolderNodeShape[]>; searchQuery: Ref<string>;
}

/** 收藏/最近播放等独立路由映射到的共享导航模式 */
const COLLECTION_ROUTE_MODES: Record<string, 'favorites' | 'recent'> = {
  '/favorites': 'favorites',
  '/recent': 'recent',
};

/** 触发入站同步的路由片段 */
const inboundRouteSources = (route: RouteLocationNormalizedLoaded) => [
  () => route.path, () => route.query.view, () => route.query.filter, () => route.query.folder,
];

/**
 * 首页路由与内部视图状态的双向同步：
 * 入站方向把路由翻译成状态，出站方向把状态回写成路由。
 */
export function useHomeRouteSync(options: HomeRouteSyncOptions) {
  const { route, router, currentViewMode, filterCondition, currentFolderFilter, activeRootPath, folderTree } =
    options;

  const clearFilterCondition = () => {
    filterCondition.value = EMPTY_FILTER;
  };

  /** folder 视图入站时：补全缺省目录并定位其归属根 */
  const adoptFolderRouteState = (routedFolder: string) => {
    const targetFolder =
      routedFolder || currentFolderFilter.value || folderTree.value[0]?.path || '';

    if (targetFolder) {
      currentFolderFilter.value = targetFolder;
    }

    const owningRoot = findDeepestOwningRoot(toRootPaths(folderTree.value), targetFolder);
    if (owningRoot) {
      activeRootPath.value = owningRoot;
    }
  };

  // 入站同步：路由变化 → 首页内部状态
  const applyInboundState = () => {
    const collectionMode = COLLECTION_ROUTE_MODES[route.path];
    if (collectionMode) {
      currentViewMode.value = collectionMode;
      clearFilterCondition();
      return;
    }

    if (route.path !== '/') {
      return;
    }

    if (!carriesHomeParams(route.query)) {
      currentViewMode.value = IDLE_HOME_VIEW;
      clearFilterCondition();
      return;
    }

    const inbound = readRoutedHomeState(route.query);
    currentViewMode.value = inbound.viewMode;
    filterCondition.value = inbound.filter;

    if (inbound.viewMode === 'folder') {
      adoptFolderRouteState(inbound.folder);
    }
  };

  /** 出站同步：首页状态 → 路由（受控参数实际变化时才 replace） */
  const pushStateIntoRoute = () => {
    if (route.path !== '/') {
      return;
    }

    const passthroughQuery: LocationQueryRaw = {};
    for (const [key, value] of Object.entries(route.query)) {
      if (!(HOME_URL_PARAMS as readonly string[]).includes(key)) {
        passthroughQuery[key] = value;
      }
    }

    const outgoingQuery: LocationQueryRaw = {
      ...passthroughQuery,
      ...buildHomeQueryFromState(currentViewMode.value, filterCondition.value, currentFolderFilter.value),
    };

    if (sameControlledHomeQuery(route.query, outgoingQuery)) {
      return;
    }

    void router.replace({ path: '/', query: outgoingQuery });
  };

  watch(inboundRouteSources(route), applyInboundState, { immediate: true });
  watch([() => route.path, currentViewMode, filterCondition, currentFolderFilter], pushStateIntoRoute, { immediate: true });
}
