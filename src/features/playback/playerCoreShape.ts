type UnionToIntersection<T> = (
  T extends unknown ? (value: T) => void : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never;

export const createPlayerCoreState = <TStateParts extends object[]>(
  ...stateParts: TStateParts
): UnionToIntersection<TStateParts[number]> =>
  Object.assign({}, ...stateParts) as UnionToIntersection<TStateParts[number]>;

export const createPlayerCoreViews = <TViews extends { currentViewSongs: unknown }>(
  views: TViews,
): TViews & { displaySongList: TViews['currentViewSongs'] } => ({
  ...views,
  displaySongList: views.currentViewSongs,
});

export const createLifecycleDomain = (
  init: () => void,
  formatTimeAgo: (timestamp: number) => string,
) => ({
  init,
  formatTimeAgo,
});

interface CreateAppShellDomainDeps<
  TPlayQueue,
  TMiniMode,
  TPlayerDetail,
  TMiniPlaylist,
  TPlaylist,
  TVolumePopover,
  THandleExternalPaths,
  TLibraryScanProgress,
> {
  init: () => void;
  playQueue: TPlayQueue;
  isMiniMode: TMiniMode;
  showPlayerDetail: TPlayerDetail;
  showMiniPlaylist: TMiniPlaylist;
  showPlaylist: TPlaylist;
  closeMiniPlaylist: () => void;
  showVolumePopover: TVolumePopover;
  handleExternalPaths: THandleExternalPaths;
  libraryScanProgress: TLibraryScanProgress;
}

export const createAppShellDomain = <
  TPlayQueue,
  TMiniMode,
  TPlayerDetail,
  TMiniPlaylist,
  TPlaylist,
  TVolumePopover,
  THandleExternalPaths,
  TLibraryScanProgress,
>({
  init,
  playQueue,
  isMiniMode,
  showPlayerDetail,
  showMiniPlaylist,
  showPlaylist,
  closeMiniPlaylist,
  showVolumePopover,
  handleExternalPaths,
  libraryScanProgress,
}: CreateAppShellDomainDeps<
  TPlayQueue,
  TMiniMode,
  TPlayerDetail,
  TMiniPlaylist,
  TPlaylist,
  TVolumePopover,
  THandleExternalPaths,
  TLibraryScanProgress
>) => ({
  init,
  playQueue,
  isMiniMode,
  showPlayerDetail,
  showMiniPlaylist,
  showPlaylist,
  closeMiniPlaylist,
  showVolumePopover,
  handleExternalPaths,
  libraryScanProgress,
});

export const createLegacyPlayerApi = <TDomains extends object[]>(
  ...domains: TDomains
): UnionToIntersection<TDomains[number]> =>
  Object.assign({}, ...domains) as UnionToIntersection<TDomains[number]>;
