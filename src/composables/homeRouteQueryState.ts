import type { LocationQuery, LocationQueryRaw } from 'vue-router';

/** 首页路由上承载视图状态的受控 query 参数名（冻结约定，逐字不可改） */
export const HOME_URL_PARAMS = ['view', 'filter', 'folder'] as const;

export type HomeUrlParam = (typeof HOME_URL_PARAMS)[number];

/** 只需一个 query 参数即可成页的视图 */
const SINGLE_PARAM_VIEWS = ['all', 'statistics', 'leaderboard', 'dailyRecommend', 'topLists'];

/** 需要携带 filter 参数定位内容的视图 */
const FILTERED_VIEWS = ['artist', 'album', 'playlist'];

/** 未携带任何受控参数时落入的默认视图 */
export const IDLE_HOME_VIEW = 'statistics';

export interface RoutedHomeState {
  viewMode: string;
  filter: string;
  folder: string;
}

/** query 值可能是数组或 null，仅取首个字符串段 */
export const firstQueryText = (value: unknown): string => {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' ? candidate : '';
};

/** 路由上是否显式携带了任一首页受控参数 */
export const carriesHomeParams = (query: LocationQuery): boolean =>
  HOME_URL_PARAMS.some((key) => query[key] !== undefined);

/** 无显式参数时的兜底状态 */
export const idleHomeState = (): RoutedHomeState => ({
  viewMode: IDLE_HOME_VIEW,
  filter: '',
  folder: '',
});

/** 把路由 query 翻译成首页内部视图状态 */
export const readRoutedHomeState = (query: LocationQuery): RoutedHomeState => {
  const rawView = firstQueryText(query.view);
  const rawFilter = firstQueryText(query.filter);
  const rawFolder = firstQueryText(query.folder);

  if (rawView === 'folder') {
    return { viewMode: 'folder', filter: '', folder: rawFolder };
  }

  if ((FILTERED_VIEWS as readonly string[]).includes(rawView) && rawFilter) {
    return { viewMode: rawView, filter: rawFilter, folder: '' };
  }

  if ((SINGLE_PARAM_VIEWS as readonly string[]).includes(rawView) && rawView !== IDLE_HOME_VIEW) {
    return { viewMode: rawView, filter: '', folder: '' };
  }

  return idleHomeState();
};

/** 把首页内部视图状态序列化回路由 query（statistics 视图不带参数） */
export const buildHomeQueryFromState = (
  viewMode: string,
  filter: string,
  folder: string,
): LocationQueryRaw => {
  if (viewMode === 'folder') {
    return folder ? { view: 'folder', folder } : { view: 'folder' };
  }

  if ((FILTERED_VIEWS as readonly string[]).includes(viewMode) && filter) {
    return { view: viewMode, filter };
  }

  if ((SINGLE_PARAM_VIEWS as readonly string[]).includes(viewMode) && viewMode !== IDLE_HOME_VIEW) {
    return { view: viewMode };
  }

  return {};
};

/** 仅比较三个受控参数，忽略透传的其余 query */
export const sameControlledHomeQuery = (
  left: LocationQuery | LocationQueryRaw,
  right: LocationQuery | LocationQueryRaw,
): boolean =>
  firstQueryText(left.view) === firstQueryText(right.view) &&
  firstQueryText(left.filter) === firstQueryText(right.filter) &&
  firstQueryText(left.folder) === firstQueryText(right.folder);
