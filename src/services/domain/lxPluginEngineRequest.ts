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

const _g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
if (!_g.__lxRequestLock) {
  _g.__lxRequestLock = Promise.resolve();
}
let _requestLock: Promise<unknown> = _g.__lxRequestLock;

export async function lxPluginRequest(
  source: PluginSource,
  action: 'musicUrl' | 'lyric' | 'pic',
  data: { source: string; type?: string; musicInfo: any },
): Promise<any> {
  // ===== 沙箱模式路由：插件在 Web Worker 中隔离执行 =====
  const _inSandboxSet = _sandboxedPlugins.has(source.id);
  const _sandboxReady = isSandboxReady(source.id);
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

      switch (action) {
        case 'musicUrl': {
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

  if (!state.requestHandler) {
    log(`[lxPluginRequest] 插件未注册 requestHandler: ${source.name}`);
    return null;
  }
  if (!state.lxApi) {
    log(`[lxPluginRequest] 插件 lxApi 未保存: ${source.name}`);
    return null;
  }

  const requestHandler = state.requestHandler;
  const lxApi = state.lxApi;

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
      (globalThis as any).lx = prevLx;
    }
  });
  _requestLock = run.then(() => undefined, () => undefined);

  try {
    return await run;
  } catch (e) {
      const errMsg = e instanceof Error ? e.message : (typeof e === 'string' ? e : String(e || 'unknown error'));
      if (action === 'lyric' && /action\s+not\s+support|not\s+support/i.test(errMsg)) {
        log(`[lxPluginRequest] ${source.name} lyric 不支持，交给后备歌词接口处理`);
        return null;
      }
      log(`[lxPluginRequest] ${source.name} ${action} 失败: ${errMsg}`);

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
  return result?.data ?? result ?? null;
}