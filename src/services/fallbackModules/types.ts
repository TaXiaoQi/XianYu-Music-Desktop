
export type FallbackModuleKey =
  | 'lx_search'
  | 'lx_toplist'
  | 'lx_recommend_sheets'
  | 'lx_album'
  | 'lx_duration'
  | 'lx_lyric'
  | 'lx_cover'
  | 'plugin_fallback'
  | 'playlist_import';

export const FALLBACK_MODULE_METHODS: Record<FallbackModuleKey, string[]> = {
  lx_search: ['search'],
  lx_toplist: ['getTopLists', 'getTopListDetail'],
  lx_recommend_sheets: ['getRecommendSheetTags', 'getRecommendSheetsByTag'],
  lx_album: ['searchAlbums', 'getAlbumSongs'],
  lx_duration: ['batchTrackInterval'],
  lx_lyric: ['fetchLyric'],
  lx_cover: ['extractCoverUrl'],
  plugin_fallback: [
    'isQqMusicPluginSource',
    'hostSearchFallback',
    'hostAlbumSearchFallback',
    'hostAlbumSongsFallback',
    'isQqTrialMediaUrl',
    'fillSongDurations',
  ],
  playlist_import: [
    'getListDetailKg',
    'getListDetailWy',
    'getListDetailTx',
    'getListDetailKw',
    'getListDetailMg',
    'getListDetailQishui',
  ],
};

export interface CachedFallbackModule {
  version: number;
  digest: string;
  code: string;
  signature?: string;
  name?: string;
  updatedAt?: string;
}

export interface FallbackModuleCache {
  fetchedAt: number;
  modules: Partial<Record<FallbackModuleKey, CachedFallbackModule>>;
}

export interface ServerFallbackModule {
  moduleKey: FallbackModuleKey;
  name?: string;
  version: number;
  digest: string;
  code: string;
  signature: string;
  updatedAt?: string;
}
