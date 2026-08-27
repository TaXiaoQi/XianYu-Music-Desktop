/**
 * 落雪（LX）插件引擎 · 请求路由。
 *
 * 向 LX 插件发送 musicUrl / lyric / pic 请求（沙箱模式优先，
 * 兼容直接调用路径），并为上层提供三个便捷封装。依赖 lxPluginEngineBase
 * 与 pluginSandboxManager（callSandboxMethod / isSandboxReady）。
 */
import type { PluginSource } from '../../types';
import {
  callSandboxMethod,
  isSandboxReady,
} from './pluginSandboxManager';
import {
  _sandboxedPlugins,
  LxSongLevelError,
  isSongLevelError,
  log,
  lxPlugins,
  normalizeLxLyricResponse,
  normalizeLxMusicUrl,
  REQUEST_TIMEOUT,
} from './lxPluginEngineBase';

// 请求锁：避免插件A的 requestHandler 执行中 globalThis.lx 被插件B覆盖（挂到 globalThis 防 HMR 重置）
const _g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
if (!_g.__lxRequestLock) {
  _g.__lxRequestLock = Promise.resolve();
}
let _requestLock: Promise<unknown> = _g.__lxRequestLock;

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
  const _inSandboxSet = _sandboxedPlugins.has(source.id);
  const _sandboxReady = isSandboxReady(source.id);
  // 播放传入的 source.id 可能与脚本内容 hash 不一致，导致 _sandboxedPlugins 缺登记，
  // 从而误走直接路径（沙箱实例 requestHandler 为 null）而静默失败。
  // 因此以后端沙箱实例是否就绪为准强制走沙箱，并在进入时补登记。
  if (_inSandboxSet || _sandboxReady) {
    if (!_inSandboxSet) {
      _sandboxedPlugins.add(source.id);
      console.warn(`[lxPluginRequest] ${source.name} id=${source.id} 沙箱集合缺登记，已补登记并走沙箱`);
    }
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
          let reportedType: unknown = data.type;
          if (typeof response === 'object' && response !== null) {
            const rawShape = JSON.stringify(response)?.substring(0, 300);
            console.warn(`[lxPluginRequest] ${source.name} musicUrl 返回对象，提取 url 字段: ${rawShape}`);
            const obj = response as Record<string, any>;
            if (obj?.type != null) reportedType = obj.type;
          } else if (typeof response === 'string' && /^\s*\{/.test(response)) {
            try {
              const parsed = JSON.parse(response);
              if (parsed && typeof parsed === 'object' && (parsed as Record<string, any>)?.type != null) {
                reportedType = (parsed as Record<string, any>).type;
              }
            } catch { /* 忽略 */ }
          }
          const musicUrl = normalizeLxMusicUrl(response);
          log(`[lxPluginRequest] 沙箱 ${source.name} musicUrl 原始返回: type=${typeof response} len=${typeof response === 'string' ? response.length : 'n/a'} preview=${musicUrl ?? (response === null ? 'null' : JSON.stringify(response)?.substring(0, 120))}`);
          if (!musicUrl) {
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
      console.error(`[lxPluginRequest] 沙箱模式 ${source.name} ${action} 失败: ${errMsg}`);
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
        case 'musicUrl': {
          const musicUrl = normalizeLxMusicUrl(response);
          if (!musicUrl) {
            throw new Error('Invalid musicUrl response');
          }
          log(`[lxPluginRequest] ${source.name} musicUrl 成功: ${musicUrl.substring(0, 80)}...`);
          return {
            source: data.source,
            action,
            data: { type: data.type, url: musicUrl },
          };
        }
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