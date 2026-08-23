/**
 * 兜底模块系统类型契约
 *
 * 桌面端把音源兜底行为（落雪搜索、专辑/歌单获取、时长补齐、逐字歌词、
 * 封面提取、插件宿主兜底等）抽离为固定 key 的功能模块：
 * - 内置默认实现 = 现有函数本体（lxMusicSdk / lxLyricFetcher / qqHostSearchFallback 等）；
 * - 服务器可通过后台「兜底管理」下发新实现覆盖内置行为，格式为一段 JS：
 *   函数体接收 ctx（宿主能力注入），返回 { version, 方法名(args) {...} }。
 *
 * 生效语义（与版本更新一致）：启动/定时拉取 → 校验 digest → 写入本地缓存，
 * 当前正在执行的调用不受影响，下一次调用（下一首/下一次进入页面）用新实现。
 */

/** 模块 key：服务端与客户端共同约定的固定标识 */
export type FallbackModuleKey =
  | 'lx_search'        // 落雪歌曲搜索
  | 'lx_album'         // 专辑搜索 + 专辑曲目
  | 'lx_duration'      // 时长批量补齐
  | 'lx_lyric'         // 逐字歌词获取/解码
  | 'lx_cover'         // 封面提取
  | 'plugin_fallback'; // QQ 等插件的宿主兜底

/** 各模块需要实现的方法名（缺失的方法自动回落内置实现） */
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

/** 下发模块代码执行后返回的实现对象 */
export interface FallbackModuleImpl {
  version: number;
  [method: string]: unknown;
}

/** 下发模块代码格式：new Function('ctx', code)(ctx) 得到 FallbackModuleImpl */
export type FallbackModuleFactory = (ctx: FallbackHostCtx) => FallbackModuleImpl;

/** 本地缓存的单个模块条目 */
export interface CachedFallbackModule {
  version: number;
  /** sha256 hex，用于校验下发代码完整性 */
  digest: string;
  code: string;
  name?: string;
  updatedAt?: string;
}

/** 本地缓存整体结构 */
export interface FallbackModuleCache {
  /** 上次成功拉取时间（ms） */
  fetchedAt: number;
  modules: Partial<Record<FallbackModuleKey, CachedFallbackModule>>;
}

/** 服务端 get_fallback_modules 返回的模块条目 */
export interface ServerFallbackModule {
  moduleKey: FallbackModuleKey;
  name?: string;
  version: number;
  digest: string;
  code: string;
  updatedAt?: string;
}

/** 服务端 get_fallback_modules 返回结构 */
export interface ServerFallbackModulesPayload {
  modules: ServerFallbackModule[];
}

/**
 * 宿主注入给下发代码的 ctx（能力白名单）。
 * 下发代码不能 import 内部模块，只能通过 ctx 访问网络/缓存/日志/配置。
 * 该接口一旦发布只增不改，保证旧客户端能跑新脚本。
 */
export interface FallbackHostCtx {
  appVersion: string;

  http: {
    /** 经 Rust 代理的 GET 请求（绕过 CORS） */
    get(url: string, opts?: FallbackHttpOptions): Promise<FallbackHttpResponse>;
    /** 经 Rust 代理的 POST 请求，body 为对象时自动 JSON 序列化 */
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
    /** 读取用户设置（只读，dot 路径如 'audio.autoSwitchSourceOnFailure'） */
    get(key: string): unknown;
  };

  utils: {
    /** "04:30" → 270 */
    parseIntervalToSeconds(interval?: string | null): number;
    /** 任意音质标识归一化为 QualityKey */
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
