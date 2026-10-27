// 兜底行为配置（服务端签名下发）共享类型。
//
// 服务端只下发配置 JSON（各元数据链路的开关/平台来源），不含任何可执行代码；
// 客户端 ed25519 验签（fallback_verify.rs，消息 xianyu-fallback-config-v1）通过
// 后才采纳，全部逻辑固定在客户端原生实现中。模块 key 与服务端约定一致；
// 未知 key / 未知方法在解析时忽略，新增 key 需两端同步。

export const kFallbackModuleLxLyric = 'lx_lyric';
export const kFallbackModuleLxToplist = 'lx_toplist';
export const kFallbackModuleLxRecommendSheets = 'lx_recommend_sheets';
export const kFallbackModulePluginFallback = 'plugin_fallback';
export const kFallbackModulePlaylistImport = 'playlist_import';

/// 各模块客户端已知的方法白名单（disabledMethods 之外的方法名忽略）
export const FALLBACK_MODULE_METHODS: Record<string, string[]> = {
  [kFallbackModuleLxLyric]: ['fetchLyric'],
  [kFallbackModuleLxToplist]: ['getTopLists', 'getTopListDetail'],
  [kFallbackModuleLxRecommendSheets]: [
    'getRecommendSheetTags',
    'getRecommendSheetsByTag',
  ],
  [kFallbackModulePluginFallback]: [
    'hostSearchFallback',
    'hostAlbumSearchFallback',
    'hostAlbumSongsFallback',
    'fillSongDurations',
  ],
  [kFallbackModulePlaylistImport]: [
    'getListDetailKg',
    'getListDetailWy',
    'getListDetailTx',
    'getListDetailKw',
    'getListDetailMg',
    'getListDetailQishui',
  ],
};

/// 允许经 params.sources 下发平台来源的模块（wy/kg/kw/tx 子集）
const FALLBACK_MODULE_SOURCE_KEYS = new Set<string>([
  kFallbackModuleLxToplist,
  kFallbackModuleLxRecommendSheets,
]);

const KNOWN_SOURCE_KEYS = new Set(['wy', 'kg', 'kw', 'tx']);

/// 单模块配置：version 用于服务端版本追踪，客户端行为只看开关与参数
export interface FallbackModuleConfig {
  version: number;
  /// 服务端要求关闭的链路方法（命中后该链路返回空，不再走原生实现）
  disabledMethods: string[];
  /// 平台来源白名单与顺序（仅榜单/推荐歌单模块生效；undefined = 不调整）
  sources?: string[];
}

/// 解析后的整包兜底配置
export interface FallbackRemoteConfig {
  version: number;
  modules: Record<string, FallbackModuleConfig>;
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/// 解析服务端配置 JSON；结构非法/字段残缺返回 null，未知 key 与方法忽略。
export function parseFallbackConfigJson(raw: string): FallbackRemoteConfig | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return null;
  }
  const root = asObject(decoded);
  if (!root) return null;
  const version = Number(root.version);
  if (!Number.isFinite(version) || version < 1) return null;
  const rawModules = asObject(root.modules);
  if (!rawModules) return null;

  const modules: Record<string, FallbackModuleConfig> = {};
  for (const [key, rawValue] of Object.entries(rawModules)) {
    const knownMethods = FALLBACK_MODULE_METHODS[key];
    const m = asObject(rawValue);
    if (!knownMethods || !m) continue;

    const disabled: string[] = [];
    if (Array.isArray(m.disabledMethods)) {
      for (const method of m.disabledMethods) {
        const name = String(method);
        if (knownMethods.includes(name)) disabled.push(name);
      }
    }

    let sources: string[] | undefined;
    if (FALLBACK_MODULE_SOURCE_KEYS.has(key)) {
      const params = asObject(m.params);
      if (params && Array.isArray(params.sources)) {
        const valid = params.sources.map(s => String(s)).filter(s => KNOWN_SOURCE_KEYS.has(s));
        // 至少保留一个有效来源才采纳，避免空列表把整条链路打空
        if (valid.length > 0) sources = valid;
      }
    }

    modules[key] = {
      version: Number.isFinite(Number(m.version)) ? Number(m.version) : 0,
      disabledMethods: disabled,
      sources,
    };
  }
  return { version, modules };
}
