/**
 * 落雪（LX）插件引擎 —— 适配 lx-music-desktop UserApi 插件格式
 *
 * 核心设计：
 *   插件脚本全部在 Rust 后端 QuickJS 沙箱中隔离执行（plugin_host），
 *   本模块仅作为前端编排层：加载委托 pluginSandboxManager → Tauri 命令，
 *   脚本哈希、HTTP 代理、存储、Cookie 均由 Rust 侧完成
 *
 * 通信机制：
 *   前端 → Rust:  plugin_engine_load_lx / plugin_engine_call 命令
 *   Rust 沙箱内:  globalThis.lx 暴露 EVENT_NAMES / request / send / on / utils
 *   插件 HTTP:   由 Rust HttpBridge 代理并注入 Cookie
 *
 * 多插件隔离：
 *   每个插件独立的 QuickJS Runtime/Context，天然隔离，无共享 globalThis 竞争
 */

import type {PluginSource} from '../types';
import {pluginApi} from './tauri/pluginApi';
import {hostSha256Hex} from './tauri/hostCryptoApi';
import {fetchWithTimeout} from './pluginFetch';
import {
  loadLxInSandbox,
  callSandboxMethod,
  isSandboxReady,
  destroySandbox,
  linkSandboxAlias,
} from './pluginSandboxManager';

// ==================== 常量 ====================

const REQUEST_TIMEOUT = 30000;

// 记录在沙箱中运行的插件 ID 集合
const _sandboxedPlugins = new Set<string>();

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

function normalizeLxLyricResponse(response: any): {
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

let _logCallback: ((msg: string) => void) | null = null;

function log(msg: string) {
  try { if (_logCallback) { _logCallback(msg); } } catch { /* ignore */ }
}

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
const _g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
if (!_g.__lxPlugins) {
  _g.__lxPlugins = new Map<string, LxPluginState>();
}
const lxPlugins: Map<string, LxPluginState> = _g.__lxPlugins;

// 请求锁：避免插件A的 requestHandler 执行中 globalThis.lx 被插件B覆盖
if (!_g.__lxRequestLock) {
  _g.__lxRequestLock = Promise.resolve();
}
let _requestLock: Promise<unknown> = _g.__lxRequestLock;

// 并发初始化锁：首次播放时歌词获取与URL解析会并发调用 ensureLxPluginInstance，
// 没有此锁时第二个调用会销毁第一个正在 loading 的实例，导致歌词加载失败
if (!_g.__lxEnsureLock) {
  _g.__lxEnsureLock = new Map<string, Promise<LxPluginState | null>>();
}
const _ensureLock: Map<string, Promise<LxPluginState | null>> = _g.__lxEnsureLock;

// 脚本内容缓存：避免同一脚本被反复 fetch
if (!_g.__lxScriptCache) {
  _g.__lxScriptCache = new Map<string, string>();
}
const scriptCache: Map<string, string> = _g.__lxScriptCache;

/** 获取落雪插件脚本（带缓存） */
async function fetchLxPluginScript(filePath: string): Promise<string> {
  // 1. 检查缓存
  const cached = scriptCache.get(filePath);
  if (cached) return cached;

  let script = '';
  if (filePath.startsWith('builtin://')) {
    // 已取消所有内置插件，builtinMap 为空
    const builtinMap: Record<string, string> = {};
    const webPath = builtinMap[filePath];
    if (webPath) {
      try {
        const resp = await fetchWithTimeout(webPath, 5000);
        if (resp.ok) script = await resp.text();
      } catch (e: any) {
        log(`[fetchLxPluginScript] 内置插件 fetch 失败: ${filePath} - ${e?.message}`);
      }
    }
  } else if (filePath.startsWith('http')) {
    // [修复防御]: 远程 URL 必须通过 Tauri 后端代理，浏览器 fetch 会被 CORS 阻止
    try {
      const resp = await pluginApi.pluginHttpRequest('GET', filePath, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      }, undefined, 10000);
      if (resp.status >= 200 && resp.status < 300 && resp.body) script = resp.body;
    } catch (e: any) {
      log(`[fetchLxPluginScript] Tauri 代理获取远程脚本失败: ${filePath} - ${e?.message}`);
    }
  } else if (filePath) {
    try {
      script = await pluginApi.readPluginFile(filePath);
    } catch (e: any) {
      log(`[fetchLxPluginScript] 读取本地文件失败: ${filePath} - ${e?.message}`);
    }
  }

  if (script) {
    scriptCache.set(filePath, script);
  }
  return script;
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

// ==================== 插件加载 ====================

/**
 * 加载落雪 LX 插件脚本（Rust QuickJS 沙箱执行，前端仅编排）
 */
export async function loadLxPluginFromScript(
  script: string,
  uri: string,
): Promise<PluginSource | null> {
  const bytes = new TextEncoder().encode(script);
  if (bytes.length > 2 * 1024 * 1024) {
    log(`插件大小超过 2MB: ${bytes.length} bytes`);
    return null;
  }
  if (script.trim().length === 0) {
    log('插件内容为空');
    return null;
  }

  const scriptInfo = parseLxScriptInfo(script);
  log(`=== 开始加载落雪插件: ${scriptInfo.name || uri} ===`);

  // [修复防御]: 如果已有同 hash 且状态为 ready 的实例，直接复用，避免销毁重建 iframe
  // 之前每次 loadLxPluginFromScript 都会销毁已有实例并重建 iframe，导致 15s 初始化超时被重复触发
  const hash = await hostSha256Hex(script);
  const existingState = lxPlugins.get(hash);
  if (existingState && existingState.status === 'ready' && existingState.source) {
    log(`[loadLxPluginFromScript] 复用已有就绪实例: ${hash}`);
    return existingState.source;
  }
  // 残留状态（loading 或 error）则先销毁
  if (existingState) {
    log(`[loadLxPluginFromScript] 销毁残留实例(非就绪): ${hash}`);
    destroyLxPlugin(hash);
  }

  // ===== Rust QuickJS 沙箱执行插件脚本（唯一路径，禁止回退主线程 eval）=====
  log(`[loadLxPluginFromScript] 沙箱模式加载: ${scriptInfo.name}`);
  try {
    const initInfo = await loadLxInSandbox(hash, script, {
      name: scriptInfo.name,
      version: scriptInfo.version,
      author: scriptInfo.author,
      description: scriptInfo.description,
      homepage: scriptInfo.homepage,
    });

    if (!initInfo?.sources || Object.keys(initInfo.sources).length === 0) {
      log('沙箱: 插件未声明任何源 (sources 为空)');
      return {
        id: hash,
        name: scriptInfo.name || '未知插件',
        format: 'lx',
        version: scriptInfo.version || '',
        author: scriptInfo.author || '',
        description: scriptInfo.description || '插件未声明任何音源',
        filePath: uri,
        importedAt: Date.now(),
        enabled: false,
        sources: [],
      };
    }

    // 创建 LxPluginState（requestHandler/lxApi 恒为 null，请求由 Rust 引擎处理）
    const sandboxState: LxPluginState = {
      source: null as any,
      initInfo,
      status: 'ready',
      requestHandler: null,
      lxApi: null,
      pendingRequests: new Map(),
    };

    const source: PluginSource = {
      id: hash,
      name: scriptInfo.name || '未知插件',
      format: 'lx',
      version: scriptInfo.version || '',
      author: scriptInfo.author || '',
      description: scriptInfo.description || '',
      filePath: uri,
      importedAt: Date.now(),
      enabled: true,
      sources: Object.keys(initInfo.sources),
    };
    sandboxState.source = source;
    lxPlugins.set(hash, sandboxState);
    _sandboxedPlugins.add(hash);

    log(`=== 落雪插件沙箱加载成功: "${source.name}" (sources: ${Object.keys(initInfo.sources).join(',')}) ===`);
    return source;
  } catch (e: any) {
    log(`[loadLxPluginFromScript] 沙箱加载失败，已阻止回退到主线程直接执行: ${e?.message}`);
    throw e;
  }
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

// ==================== 请求方法 ====================

/**
 * 向落雪插件发送请求
 * [修复防御]: 与 lx-music-desktop handleRequest 一致，调用 events.request.call(context, { source, action, info })
 * 关键点：调用前临时设置 globalThis.lx = state.lxApi，确保插件内部 lx.request 可用
 */
export async function lxPluginRequest(
  source: PluginSource,
  action: 'musicUrl' | 'lyric' | 'pic',
  data: { source: string; type?: string; musicInfo: any },
): Promise<any> {
  // ===== 沙箱模式路由：插件在 Web Worker 中隔离执行 =====
  if (_sandboxedPlugins.has(source.id) && isSandboxReady(source.id)) {
    log(`[lxPluginRequest] 沙箱模式调用 ${source.name} ${action} source=${data.source} type=${data.type || '-'}`);
    try {
      const response = await Promise.race([
        callSandboxMethod(source.id, 'request', [{
          source: data.source,
          action,
          info: {
            type: data.type,
            quality: data.type,
            musicInfo: data.musicInfo,
          },
        }], REQUEST_TIMEOUT),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`请求超时(${REQUEST_TIMEOUT / 1000}s)`)), REQUEST_TIMEOUT),
        ),
      ]);

      // 响应格式验证（与直接调用路径一致）
      switch (action) {
        case 'musicUrl': {
          // 部分混淆插件（baka 风格）musicUrl 返回对象 { url, type, ... } 而非纯字符串。
          // 一律提取 url 字符串；但保留原始 shape 打印，避免影响后续加密音源处理。
          let musicUrl = response;
          let reportedType: unknown = data.type;
          if (typeof response === 'object' && response !== null) {
            const rawShape = JSON.stringify(response)?.substring(0, 300);
            console.warn(`[lxPluginRequest] ${source.name} musicUrl 返回对象，提取 url 字段: ${rawShape}`);
            const obj = response as Record<string, any>;
            musicUrl = obj?.url ?? obj?.link ?? obj?.playUrl ?? '';
            if (obj?.type != null) reportedType = obj.type;
          }
          log(`[lxPluginRequest] 沙箱 ${source.name} musicUrl 原始返回: type=${typeof response} len=${typeof response === 'string' ? response.length : 'n/a'} preview=${typeof musicUrl === 'string' ? musicUrl.substring(0, 120) : (response === null ? 'null' : JSON.stringify(response)?.substring(0, 120))}`);
          if (typeof musicUrl !== 'string' || musicUrl.length === 0 || musicUrl.length > 2048 || !/^https?:/.test(musicUrl)) {
            throw new Error('Invalid musicUrl response');
          }
          log(`[lxPluginRequest] 沙箱 ${source.name} musicUrl 成功: ${musicUrl.substring(0, 80)}...`);
          return { source: data.source, action, data: { type: String(reportedType ?? ''), url: musicUrl } };
        }
        case 'lyric':
          return {
            source: data.source, action,
            data: normalizeLxLyricResponse(response),
          };
        case 'pic':
          if (typeof response !== 'string' || response.length > 2048 || !/^https?:/.test(response)) {
            throw new Error('Invalid pic response');
          }
          return { source: data.source, action, data: response };
        default:
          return response;
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : (typeof e === 'string' ? e : String(e || 'unknown error'));
      if (action === 'lyric' && /action\s+not\s+support|not\s+support/i.test(errMsg)) {
        log(`[lxPluginRequest] 沙箱 ${source.name} lyric 不支持，交给后备歌词接口处理`);
        return null;
      }
      log(`[lxPluginRequest] 沙箱模式 ${source.name} ${action} 失败: ${errMsg}`);
      if (action === 'musicUrl' && isSongLevelError(errMsg)) {
        throw new LxSongLevelError(errMsg);
      }
      return null;
    }
  }

  // ===== 直接调用路径（现有逻辑）=====
  const state = lxPlugins.get(source.id);
  if (!state || state.status !== 'ready') {
    log(`[lxPluginRequest] 插件未就绪: ${source.name}`);
    return null;
  }

  // [新方案] 直接调用插件注册的 requestHandler（与 lx-music-desktop handleRequest 一致）
  if (!state.requestHandler) {
    log(`[lxPluginRequest] 插件未注册 requestHandler: ${source.name}`);
    return null;
  }
  if (!state.lxApi) {
    log(`[lxPluginRequest] 插件 lxApi 未保存: ${source.name}`);
    return null;
  }

  // [修复防御]: 用局部变量保存，避免闭包内 TypeScript null 检查失败
  const requestHandler = state.requestHandler;
  const lxApi = state.lxApi;

  // [修复防御]: 用请求锁串行化，避免多插件并发时 globalThis.lx 被覆盖
  // 调用前临时设置 globalThis.lx = lxApi，确保插件内部 lx.request 指向正确的 lxApi
  // (lx-music-desktop 每个插件在独立 BrowserWindow，globalThis.lx 不会冲突；我们共享主窗口，需串行)
  const run = _requestLock.then(async () => {
    const prevLx = (globalThis as any).lx;
    (globalThis as any).lx = lxApi;
    log(`[lxPluginRequest] 调用 ${source.name} ${action} source=${data.source} type=${data.type || '-'}`);
    try {
      const response = await Promise.race([
        Promise.resolve(requestHandler({
          source: data.source,
          action,
          info: {
            type: data.type,
            quality: data.type,
            musicInfo: data.musicInfo,
          },
        })),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`请求超时(${REQUEST_TIMEOUT / 1000}s)`)), REQUEST_TIMEOUT),
        ),
      ]);

      // 构造与 lx-music-desktop handleRequest 一致的返回格式
      switch (action) {
        case 'musicUrl':
          if (typeof response !== 'string' || response.length > 2048 || !/^https?:/.test(response)) {
            throw new Error('Invalid musicUrl response');
          }
          log(`[lxPluginRequest] ${source.name} musicUrl 成功: ${response.substring(0, 80)}...`);
          return {
            source: data.source,
            action,
            data: { type: data.type, url: response },
          };
        case 'lyric':
          return {
            source: data.source,
            action,
            data: normalizeLxLyricResponse(response),
          };
        case 'pic':
          if (typeof response !== 'string' || response.length > 2048 || !/^https?:/.test(response)) {
            throw new Error('Invalid pic response');
          }
          return {
            source: data.source,
            action,
            data: response,
          };
        default:
          return response;
      }
    } finally {
      // [修复防御]: 恢复 globalThis.lx，避免污染其他插件
      // (requestHandler 返回的 Promise resolve 时，插件内部 lx.request 回调已完成)
      (globalThis as any).lx = prevLx;
    }
  });
  // 串行化：无论成功失败都释放锁给下一个请求
  _requestLock = run.then(() => undefined, () => undefined);

  try {
    return await run;
  } catch (e) {
      // [修复防御]: 错误对象可能不是 Error 实例 (插件可能抛出字符串或任意值)
      const errMsg = e instanceof Error ? e.message : (typeof e === 'string' ? e : String(e || 'unknown error'));
      if (action === 'lyric' && /action\s+not\s+support|not\s+support/i.test(errMsg)) {
        log(`[lxPluginRequest] ${source.name} lyric 不支持，交给后备歌词接口处理`);
        return null;
      }
      log(`[lxPluginRequest] ${source.name} ${action} 失败: ${errMsg}`);

      // [歌曲级错误] 当错误表明歌曲本身不可用（不存在/版权限制/VIP 等），
      // 换音质无法解决，抛出 LxSongLevelError 让调用方立即停止音质回退循环，
      // 避免对同一首不可用的歌曲发起 12 次无意义的 HTTP 请求。
      if (action === 'musicUrl' && isSongLevelError(errMsg)) {
        throw new LxSongLevelError(errMsg);
      }

      return null;
  }
}

export async function lxPluginGetMusicUrl(
  source: PluginSource, sourceKey: string, songInfo: any, quality: string = '320k',
): Promise<{ type: string; url: string } | null> {
  const result = await lxPluginRequest(source, 'musicUrl', { source: sourceKey, type: quality, musicInfo: songInfo });
  // [修复防御]: lxPluginRequest 返回 iframe 原始格式 { source, action, data: {...} }，需解包 data
  return result?.data ?? result ?? null;
}

export async function lxPluginGetLyric(
  source: PluginSource, sourceKey: string, songInfo: any,
): Promise<{
  lyric: string;
  tlyric: string | null;
  rlyric: string | null;
  lxlyric: string | null;
  yrc: string | null;
  qrc: string | null;
  eslrc: string | null;
} | null> {
  const result = await lxPluginRequest(source, 'lyric', { source: sourceKey, musicInfo: songInfo });
  // [修复防御]: lxPluginRequest 现在返回 { source, action, data: { lyric, tlyric, rlyric, lxlyric, yrc, qrc, eslrc } }
  // data 层已由 lxPluginRequest 的 lyric 分支构造，无需额外解包
  if (!result?.data) return null;
  return result.data as {
    lyric: string;
    tlyric: string | null;
    rlyric: string | null;
    lxlyric: string | null;
    yrc: string | null;
    qrc: string | null;
    eslrc: string | null;
  };
}

export async function lxPluginGetPic(
  source: PluginSource, sourceKey: string, songInfo: any,
): Promise<string | null> {
  const result = await lxPluginRequest(source, 'pic', { source: sourceKey, musicInfo: songInfo });
  // [修复防御]: pic 的 data 直接是 URL 字符串
  return result?.data ?? result ?? null;
}

/**
 * 获取 LX 插件的脚本内容（用于云端同步上传）
 * 优先从 scriptCache 读取，没有则通过 fetchLxPluginScript 重新获取。
 * @param sourceId 插件 ID
 * @param fallbackFilePath 当插件未加载到 lxPlugins 时，使用此 filePath 作为回退
 */
export async function getLxPluginScript(sourceId: string, fallbackFilePath?: string): Promise<string | null> {
  const state = lxPlugins.get(sourceId);
  // 优先使用调用方持久化的 filePath（`getPluginScript` 传入 `source.filePath`）。
  // 本地导入的插件经 persistPluginScriptToDataDir 后，该路径指向数据目录备份副本；
  // 而内存中 lxPlugins 的 filePath 仍是 loadPluginFromScript 时留下的原始导入文件位置。
  // 若按内存路径走，账号同步/备份会读取原导入文件——原文件被移动/删除时同步即失败，
  // 且违背"导入后以备份副本为准"的初衷。
  const memoryPath = state?.source?.filePath ?? '';
  const persistPath = fallbackFilePath?.trim() ?? '';
  const filePath = persistPath || memoryPath;
  if (!filePath) return null;

  if (persistPath && memoryPath && persistPath !== memoryPath) {
    log(`[getLxPluginScript] ${sourceId.slice(0, 8)}… 持久化路径(备份) ${persistPath} 与内存路径(原文件) ${memoryPath} 不一致，优先读取备份`);
  }

  // 1. 优先从脚本缓存读取（备份路径未命中时退回内存路径的缓存）
  const cached = scriptCache.get(filePath)
    || (memoryPath && scriptCache.get(memoryPath) ? scriptCache.get(memoryPath) : undefined);
  if (cached) return cached;

  // 2. 缓存未命中，按"持久化路径 → 内存路径"依次读取
  for (const p of new Set([filePath, memoryPath].filter(Boolean))) {
    try {
      const script = await fetchLxPluginScript(p as string);
      if (script) return script;
    } catch { /* 尝试下一个路径 */ }
  }
  return null;
}

export async function ensureLxPluginInstance(source: PluginSource): Promise<LxPluginState | null> {
  // [修复防御]: 禁用的插件不自动初始化
  if (!source.enabled) {
    log(`[ensureLxPluginInstance] 插件已禁用，跳过: ${source.name}`);
    return null;
  }
  const state = lxPlugins.get(source.id);
  if (state && state.status === 'ready') return state;

  // [修复防御]: 并发初始化锁 —— 同一插件的并发调用共享同一个初始化 Promise，
  // 避免两个调用同时进入 loadLxPluginFromScript 导致互相销毁 loading 实例
  const existing = _ensureLock.get(source.id);
  if (existing) {
    log(`[ensureLxPluginInstance] 等待已存在的初始化 Promise: ${source.name}`);
    return existing;
  }

  const initPromise = (async () => {
    log(`落雪插件实例未缓存，重新加载: ${source.name} (${source.filePath})`);
    try {
      // [修复防御]: 使用带缓存的 fetchLxPluginScript，避免同一脚本被反复 fetch
      const script = await fetchLxPluginScript(source.filePath);

      if (script) {
        const result = await loadLxPluginFromScript(script, source.filePath);
        // [修复防御]: 用 source.id 也缓存一份，确保后续 lxPluginRequest 能找到
        if (result && result.id !== source.id) {
          const newState = lxPlugins.get(result.id);
          if (newState) {
            lxPlugins.set(source.id, newState);
            // [修复] 重新加载得到的 hash 与外部存储的 source.id 可能不一致，
            // 若不把 source.id 也标记为沙箱并注册别名，lxPluginRequest 会走
            // 直接调用路径（沙箱实例 requestHandler 为 null），导致直链解析静默失败。
            if (_sandboxedPlugins.has(result.id)) {
              _sandboxedPlugins.add(source.id);
              linkSandboxAlias(source.id, result.id);
            }
          }
        }
      }

      return lxPlugins.get(source.id) || null;
    } catch (e) {
      log(`落雪插件重新加载失败: ${source.name} ${e}`);
      return null;
    } finally {
      // 初始化完成（成功或失败）后清除锁，允许后续重试
      _ensureLock.delete(source.id);
    }
  })();

  _ensureLock.set(source.id, initPromise);
  return initPromise;
}

/** 销毁落雪插件实例 */
export function destroyLxPlugin(sourceId: string) {
  // 沙箱模式清理：销毁 Worker
  if (_sandboxedPlugins.has(sourceId)) {
    _sandboxedPlugins.delete(sourceId);
    destroySandbox(sourceId).catch(() => {});
  }

  const state = lxPlugins.get(sourceId);
  if (!state) return;
  // [修复防御]: 清理所有待处理请求，避免 resolve/reject 泄漏
  for (const [key, pending] of state.pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Plugin destroyed'));
    state.pendingRequests.delete(key);
  }
  // [新方案] 清理 requestHandler
  state.requestHandler = null;
  state.lxApi = null;  // [修复防御] 清理 lxApi 引用，避免销毁后仍能调用
  state.status = 'error';
  state.initInfo = null;
  lxPlugins.delete(sourceId);
  log(`落雪插件已销毁: ${sourceId}`);
}

// ==================== 插件启用时初始化 ====================

/**
 * 启用落雪插件时调用 —— 读取脚本并直接 eval 初始化
 * 与 lx-music-desktop setUserApi → createWindow → initEnv 流程一致
 */
export async function initLxPlugin(source: PluginSource): Promise<boolean> {
  // 已就绪则直接返回
  const existing = lxPlugins.get(source.id);
  if (existing && existing.status === 'ready') return true;

  // 有残留状态则先销毁
  if (existing) {
    destroyLxPlugin(source.id);
  }

  log(`[initLxPlugin] 开始初始化: ${source.name} (${source.filePath})`);

  try {
    // [修复防御]: 使用带缓存的 fetchLxPluginScript，避免同一脚本被反复 fetch
    const script = await fetchLxPluginScript(source.filePath);

    if (!script) {
      log(`[initLxPlugin] 无法读取脚本: ${source.filePath}`);
      return false;
    }

    const result = await loadLxPluginFromScript(script, source.filePath);
    // [修复防御]: 区分真正初始化成功（sources 非空）和 fallback（初始化失败但允许导入）
    if (result && result.sources && result.sources.length > 0) {
      // [修复防御]: 用 source.id（localStorage 中的旧 hash）也缓存一份
      // loadLxPluginFromScript 用 SHA256(script) 作为 key，如果脚本内容变化，新 hash 与旧 source.id 不同
      // 导致后续 ensureLxPluginInstance/lxPluginRequest 通过 source.id 找不到缓存
      if (result.id !== source.id) {
        const newState = lxPlugins.get(result.id);
        if (newState) {
          lxPlugins.set(source.id, newState);
          if (_sandboxedPlugins.has(result.id)) {
            _sandboxedPlugins.add(source.id);
            linkSandboxAlias(source.id, result.id);
          }
        }
      }
      log(`[initLxPlugin] 初始化成功: ${source.name}`);
      return true;
    } else {
      log(`[initLxPlugin] 初始化失败: ${source.name} (sources 为空)`);
      return false;
    }
  } catch (e: any) {
    log(`[initLxPlugin] 初始化异常: ${source.name} - ${e?.message}`);
    return false;
  }
}
