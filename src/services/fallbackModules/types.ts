
export type FallbackModuleKey =
  | 'lx_search'
  | 'lx_album'
  | 'lx_duration'
  | 'lx_lyric'
  | 'lx_cover'
  | 'plugin_fallback';

export const FALLBACK_MODULE_METHODS: Record<FallbackModuleKey, string[]> = {
  lx_search: ['search'],
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
};

export const FALLBACK_MODULE_NAMES: Record<FallbackModuleKey, string> = {
  lx_search: '落雪歌曲搜索',
  lx_album: '专辑/歌单获取',
  lx_duration: '歌曲时长加载',
  lx_lyric: '逐字歌词解码',
  lx_cover: '歌曲封面提取',
  plugin_fallback: '插件宿主兜底',
};

export interface FallbackModuleImpl {
  version: number;
  [method: string]: unknown;
}

export type FallbackModuleFactory = (ctx: FallbackHostCtx) => FallbackModuleImpl;

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

export interface ServerFallbackModulesPayload {
  modules: ServerFallbackModule[];
}

export interface FallbackHostCtx {
  appVersion: string;

  http: {
    get(url: string, opts?: FallbackHttpOptions): Promise<FallbackHttpResponse>;
    post(url: string, body: unknown, opts?: FallbackHttpOptions): Promise<FallbackHttpResponse>;
  };

  cache: {
    get<T = unknown>(key: string): T | null;
    set(key: string, value: unknown, ttlSeconds?: number): void;
    del(key: string): void;
  };

  log: {
    info(msg: string, data?: unknown): void;
    warn(msg: string, data?: unknown): void;
    error(msg: string, data?: unknown): void;
  };

  config: {
    get(key: string): unknown;
  },

  utils: {
    parseIntervalToSeconds(interval?: string | null): number;
    normalizeQualityKey(raw: unknown): string | null;
    stripHtmlTags(str: unknown): string;
  };
}

export interface FallbackHttpOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface FallbackHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
