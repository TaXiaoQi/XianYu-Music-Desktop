/**
 * 落雪（LX）插件引擎 · 共享底座（叶子模块）。
 *
 * 汇聚各 LX 子模块共用的类型、日志、全局缓存、歌曲级错误、
 * 歌词/音频 URL 规范化、脚本格式检测与头信息解析。
 *
 * 仅依赖外部工具模块（../../types），不依赖 domain 下其它插件引擎子模块，
 * 作为叶子被 lxPluginEngineInstance / lxPluginEngineRequest 共同引用。
 */
import type { PluginSource } from '../../types';

// ==================== 常量 ====================

export const REQUEST_TIMEOUT = 30000;

// 记录在沙箱中运行的 LX 插件 ID 集合（Instance 与 Request 共享）
const _g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
if (!_g.__lxSandboxedPlugins) {
  _g.__lxSandboxedPlugins = new Set<string>();
}
export const _sandboxedPlugins: Set<string> = _g.__lxSandboxedPlugins;

// ==================== 日志 ====================

let _logCallback: ((msg: string) => void) | null = null;

export function log(msg: string) {
  try { if (_logCallback) { _logCallback(msg); } } catch { /* ignore */ }
}

// ==================== 类型 ====================

export interface LxSourceInfo {
  type: 'music';
  name?: string;
  actions: string[];
  qualitys: string[];
}

export interface LxInitInfo {
  sources: Record<string, LxSourceInfo>;
  openDevTools?: boolean;
}

export interface LxPluginState {
  source: PluginSource;
  initInfo: LxInitInfo | null;
  status: 'loading' | 'ready' | 'error';
  errorMessage?: string;
  requestHandler: ((data: any) => any) | null;  // [新方案] 插件注册的 request 处理器
  lxApi: any;  // [修复防御] 保存 globalThis.lx 对象引用，供 lxPluginRequest 调用时临时设置
  pendingRequests: Map<string, {
    resolve: (data: any) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
}

// ==================== 插件实例缓存 ====================

// 挂载到 window 防止 Vite HMR 重置缓存
if (!_g.__lxPlugins) {
  _g.__lxPlugins = new Map<string, LxPluginState>();
}
export const lxPlugins: Map<string, LxPluginState> = _g.__lxPlugins;

// ==================== 通用工具 ====================

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

/**
 * 规范化插件返回的 musicUrl：
 * 1. 部分插件返回 JSON 字符串（含 url 字段），尝试解析提取
 * 2. 部分插件返回 `http://...`（反引号包裹），去除首尾反引号
 * 返回清洗后的 URL，无效返回 null
 */
export function normalizeLxMusicUrl(response: unknown): string | null {
  let musicUrl: unknown = response;
  if (typeof response === 'object' && response !== null) {
    const obj = response as Record<string, any>;
    musicUrl = obj?.url ?? obj?.link ?? obj?.playUrl ?? '';
  } else if (typeof response === 'string' && /^\s*\{/.test(response)) {
    try {
      const parsed = JSON.parse(response);
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, any>;
        const extracted = obj?.url ?? obj?.link ?? obj?.playUrl ?? '';
        if (extracted) musicUrl = extracted;
      }
    } catch { /* 保持原样 */ }
  }
  if (typeof musicUrl !== 'string') return null;
  const cleaned = musicUrl.trim().replace(/^`+/, '').replace(/`+$/, '');
  if (cleaned.length === 0 || cleaned.length > 2048 || !/^https?:/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

export function normalizeLxLyricResponse(response: any): {
  lyric: string;
  tlyric: string | null;
  rlyric: string | null;
  lxlyric: string | null;
  yrc: string | null;
  qrc: string | null;
  eslrc: string | null;
} {
  if (typeof response !== 'object' || response === null) {
    throw new Error('lyric response is not an object');
  }

  const lyric = pickString(response.lyric, response.rawLrc, response.lrc);
  const tlyric = pickString(response.tlyric, response.translation, response.translateLyric);
  const rlyric = pickString(response.rlyric, response.romanization);
  const lxlyric = pickString(response.lxlyric);
  const yrc = pickString(response.yrc);
  const qrc = pickString(response.qrc);
  // 有些 LX 插件把逐字歌词放在 eslrc（Enhanced LRC）字段，而非 yrc/qrc/lxlyric。
  // 若此处不捕获，buildLxLyricsRaw 会丢掉逐字内容，回退到普通 LRC，导致无逐字。
  const eslrc = pickString(response.eslrc, response.enhancedLrc, response.enh_lrc);

  // [诊断] 输出插件返回的歌词字段，便于定位逐字歌词缺失问题
  const keyList = Object.keys(response).join(',');
  log(`[normalizeLxLyricResponse] 插件返回字段 keys=[${keyList}] lyric=${lyric.length} lxlyric=${lxlyric.length} yrc=${yrc.length} qrc=${qrc.length} eslrc=${eslrc.length}`);
  if (lxlyric) log(`[normalizeLxLyricResponse] lxlyric 预览: ${lxlyric.substring(0, 200)}`);
  if (yrc) log(`[normalizeLxLyricResponse] yrc 预览: ${yrc.substring(0, 200)}`);
  if (qrc) log(`[normalizeLxLyricResponse] qrc 预览: ${qrc.substring(0, 200)}`);
  if (eslrc) log(`[normalizeLxLyricResponse] eslrc 预览: ${eslrc.substring(0, 200)}`);
  // lyric 也可能是逐字来源（内嵌 <offset,duration> 或 yrc 风格标记），单独预览便于诊断
  if (!lxlyric && !yrc && !qrc && !eslrc && lyric) {
    log(`[normalizeLxLyricResponse] lyric 预览: ${lyric.substring(0, 200)}`);
  }

  if (!lyric && !lxlyric && !yrc && !qrc && !eslrc) {
    throw new Error(`lyric response missing or empty: ${JSON.stringify(response).substring(0, 100)}`);
  }
  if (lyric.length > 51200 || lxlyric.length > 51200 || yrc.length > 51200 || qrc.length > 51200 || eslrc.length > 51200) {
    throw new Error('lyric response too large');
  }

  return {
    lyric,
    tlyric: tlyric.length < 51200 ? tlyric : null,
    rlyric: rlyric.length < 51200 ? rlyric : null,
    lxlyric: lxlyric.length < 51200 ? lxlyric : null,
    yrc: yrc.length < 51200 ? yrc : null,
    qrc: qrc.length < 51200 ? qrc : null,
    eslrc: eslrc.length < 51200 ? eslrc : null,
  };
}

// ==================== 歌曲级错误 ====================

/**
 * 歌曲级错误：表示歌曲本身不可用（不存在、版权限制、需要 VIP 等），
 * 换音质无法解决，播放循环应立即停止尝试其他音质。
 */
export class LxSongLevelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LxSongLevelError';
  }
}

/**
 * 检测错误消息是否为歌曲级错误（换音质无法解决）。
 * 匹配 LX 插件常见的歌曲级错误模式：
 * - "歌曲不存在" / "歌曲已下架"
 * - "版权" + ("限制" | "保护" | "原因")
 * - "需要登录" / "需登录"
 * - "地区限制"
 * - "VIP" / "会员" 歌曲限制
 */
const SONG_LEVEL_ERROR_PATTERNS = [
  /歌曲不存在/i,
  /歌曲已下架/i,
  /已?下架/i,
  /版权.{0,4}(限制|保护|原因)/i,
  /需要?登录/i,
  /地区限制/i,
  /需要?\s*(VIP|会员|付费)/i,
  /VIP歌曲/i,
  /会员歌曲/i,
  /付费歌曲/i,
  /无版权/i,
  /暂无版权/i,
];

export function isSongLevelError(message: string): boolean {
  return SONG_LEVEL_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

// ==================== 脚本格式检测 ====================

export function isLxPluginScript(script: string): boolean {
  const trimmed = script.trim();

  // [修复防御]: MusicFree 格式特征检测（优先级最高）
  // MusicFree 插件必须包含 module.exports 或 exports.default
  const hasMusicFreeExport = /\bmodule\.exports\s*[.=]/.test(trimmed) ||
    /\bexports\s*\.\s*default\s*=/.test(trimmed);
  // MusicFree 插件通常有 platform 和 search 方法
  const hasMusicFreePlatform = /\bplatform\s*[=:]\s*['"]/.test(trimmed);
  const hasMusicFreeSearch = /\bsearch\s*[=:]\s*function|\.search\s*=\s*(async\s+)?\(/.test(trimmed);

  if (hasMusicFreeExport || (hasMusicFreePlatform && hasMusicFreeSearch)) return false;

  // LX 格式特征检测（包括混淆后的插件）
  // 1. 明文调用 lx.on / lx.send
  if (/\blx\s*\.\s*(on|send)\s*\(/.test(trimmed)) return true;
  // 2. 明文引用 EVENT_NAMES.request
  if (/EVENT_NAMES\s*\.\s*request/.test(trimmed)) return true;
  // 3. 混淆插件通过 globalThis.lx 访问（包括 globalThis['lx']、globalThis.lx 等）
  if (/globalThis\s*\[\s*['"]lx['"]\s*]/.test(trimmed)) return true;
  if (/globalThis\s*\.\s*lx\b/.test(trimmed)) return true;
  // 4. 混淆插件可能在解构时引用 globalThis.lx（如 const { EVENT_NAMES } = globalThis.lx）
  if (/globalThis/.test(trimmed) && /\bEVENT_NAMES\b/.test(trimmed)) return true;

  // ===== 重度混淆插件增强检测 =====
  // 此类插件用自定义 VM 解释器 + unicode 转义隐藏 LX API 特征，明文特征全部失效。
  // 5. LX 服务端下发配置（lx-music-desktop 特有，混淆插件常以明文保留）
  if (/SERVER_SCRIPT_CONFIG/.test(trimmed)) return true;
  // 6. unicode 转义的 SCRIPT_MD5（\u0053\u0043\u0052\u0049\u0050\u0054\u005f\u004d\u0044\u0035，
  //    lx-music-desktop 注入的脚本 MD5 全局变量，混淆插件用它做环境校验）
  if (/\\u0053\\u0043\\u0052\\u0049\\u0050\\u0054\\u005f\\u004d\\u0044\\u0035/.test(trimmed)) return true;
  // 7. unicode 转义的 lx（\u006c\u0078）与 globalThis（\u0067\u006c\u006f\u0062\u0061\u006c\u0054\u0068\u0069\u0073）
  //    组合出现，说明插件通过 globalThis.lx 访问 LX API
  if (/\\u006c\\u0078/.test(trimmed) && /\\u0067\\u006c\\u006f\\u0062\\u0061\\u006c\\u0054\\u0068\\u0069\\u0073/.test(trimmed)) return true;

  return false;
}

export function parseLxScriptInfo(script: string): {
  name: string; version: string; author: string; description: string; homepage: string;
} {
  const result = /^\/\*[\S|\s]+?\*\//.exec(script);
  if (!result) return { name: '', version: '', author: '', description: '', homepage: '' };

  const header = result[0];
  const infoArr = header.split(/\r?\n/);
  const rxp = /^\s?\*\s?@(\w+)\s(.+)$/;
  const infos: Record<string, string> = {};
  for (const line of infoArr) {
    const m = rxp.exec(line);
    if (!m) continue;
    infos[m[1]] = m[2].trim();
  }

  return {
    name: (infos.name || '').substring(0, 24),
    version: (infos.version || '').substring(0, 36),
    author: (infos.author || '').substring(0, 56),
    description: (infos.description || '').substring(0, 36),
    homepage: (infos.homepage || '').substring(0, 1024),
  };
}