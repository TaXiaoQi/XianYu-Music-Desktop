import type { LocationQueryRaw, RouteLocationRaw, Router } from 'vue-router';

/** 需要携带 filter 参数定位内容的首页视图 */
type FilteredHomeView = 'artist' | 'album' | 'playlist';

type HomeViewTarget =
  | { view: 'all' }
  | { view: FilteredHomeView; filter: string }
  | { view: 'folder'; folder?: string }
  | { view: 'statistics' };

type ShellSection =
  | 'home'
  | 'artists'
  | 'albums'
  | 'favorites'
  | 'recent'
  | 'plugins'
  | 'settings'
  | 'auth';

type AppTarget = { section: 'home'; target: HomeViewTarget } | { section: Exclude<ShellSection, 'home'> };

export interface NavReplaceOptions {
  replace?: boolean;
}

/** 各独立分区对应的路由路径（冻结约定，逐字不可改） */
const SECTION_PATHS: Record<Exclude<ShellSection, 'home'>, string> = {
  artists: '/artists',
  albums: '/albums',
  favorites: '/favorites',
  recent: '/recent',
  plugins: '/plugins',
  settings: '/settings',
  auth: '/auth',
};

const HOME_PATH = '/';

const homeAt = (query: LocationQueryRaw): RouteLocationRaw => ({ path: HOME_PATH, query });

const buildHomeLocation = (target: HomeViewTarget): RouteLocationRaw => {
  if (target.view === 'all') {
    return homeAt({ view: 'all' });
  }

  if (target.view === 'folder') {
    const query: LocationQueryRaw = { view: 'folder' };
    if (target.folder) {
      query.folder = target.folder;
    }
    return homeAt(query);
  }

  if (target.view === 'artist' || target.view === 'album' || target.view === 'playlist') {
    return homeAt({ view: target.view, filter: target.filter });
  }

  return homeAt({});
};

export const buildAppLocation = (target: AppTarget): RouteLocationRaw => {
  if (target.section === 'home') {
    return buildHomeLocation(target.target);
  }

  return { path: SECTION_PATHS[target.section] ?? HOME_PATH };
};

export function useHomeNavigation(router: Router) {
  const navigate = (location: RouteLocationRaw, options?: NavReplaceOptions) =>
    options?.replace ? router.replace(location) : router.push(location);

  const openApp = (target: AppTarget, options: NavReplaceOptions = {}) =>
    navigate(buildAppLocation(target), options);

  const openHome = (target: HomeViewTarget, options: NavReplaceOptions = {}) =>
    openApp({ section: 'home', target }, options);

  /** 生成需要 filter 参数定位内容的视图快捷入口 */
  const filteredViewOpener = (view: FilteredHomeView) => (filterValue: string, options?: NavReplaceOptions) =>
    openHome({ view, filter: filterValue }, options);

  const openHomeArtist = filteredViewOpener('artist');
  const openHomeAlbum = filteredViewOpener('album');
  const openHomePlaylist = filteredViewOpener('playlist');

  const openHomeAll = (options?: NavReplaceOptions) => openHome({ view: 'all' }, options);

  const openHomeStatistics = (options?: NavReplaceOptions) =>
    openHome({ view: 'statistics' }, options);

  const openHomeFolder = (folderPath?: string, options?: NavReplaceOptions) =>
    openHome({ view: 'folder', folder: folderPath }, options);

  /** 生成非首页分区的快捷入口 */
  const sectionOpener = (section: Exclude<ShellSection, 'home'>) => (options?: NavReplaceOptions) =>
    navigate({ path: SECTION_PATHS[section] }, options);

  const openArtists = sectionOpener('artists');
  const openAlbums = sectionOpener('albums');
  const openFavorites = sectionOpener('favorites');
  const openRecent = sectionOpener('recent');
  const openPlugins = sectionOpener('plugins');
  const openSettings = sectionOpener('settings');
  const openAuth = sectionOpener('auth');

  return {
    openApp,
    openHome,
    openHomeAll,
    openHomeArtist,
    openHomeAlbum,
    openHomePlaylist,
    openHomeFolder,
    openHomeStatistics,
    openArtists,
    openAlbums,
    openFavorites,
    openRecent,
    openPlugins,
    openSettings,
    openAuth,
  };
}
