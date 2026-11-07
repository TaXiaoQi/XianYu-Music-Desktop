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
import { isUnsupportedQualityError } from './pluginEngineBase';

const _g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {} as any);
if (!_g.__lxRequestLock) {
  _g.__lxRequestLock = Promise.resolve();
}
let _requestLock: Promise<unknown> = _g.__lxRequestLock;

const _picUnsupportedPluginIds = new Set<string>();

// ==================== 确定性失败负缓存（与移动端/手表端一致） ====================
// 封 IP / 插件实例缺失等重试注定同样失败的错误：按插件记 60s 冷却，任一成功
// 响应即解除；平台/档位级能力缺失（卡密不支持该平台或音质）按组合记 60s 冷却。
// 仅作用于 musicUrl：歌词/封面与音质阶梯无关，能力缺失不代表歌词也被拒。
// 此前每首歌会按音质阶梯 × 兜底插件逐级重打数百次（2.0.6-beta7 反馈根因）。
const _deterministicBannedUntil = new Map<string, number>();
const _capabilityBannedUntil = new Map<string, number>();
const DETERMINISTIC_BAN_TTL_MS = 60 * 1000;
const CAPABILITY_BAN_TTL_MS = 60 * 1000;

function isDeterministicFailureMessage(msg: string): boolean {
  return /block\s*ip|插件实例不存在/i.test(msg);
}

// 平台级能力缺失（该平台所有档位都不可用）
function isPlatformUnsupportedMessage(msg: string): boolean {
  return /不支持该平台|未开放平台/i.test(msg);
}

function isDeterministicBanned(pluginId: string): boolean {
  const until = _deterministicBannedUntil.get(pluginId);
  if (until === undefined) return false;
  if (Date.now() > until) {
    _deterministicBannedUntil.delete(pluginId);
    return false;
  }
  return true;
}

function clearDeterministicBan(pluginId: string): void {
  _deterministicBannedUntil.delete(pluginId);
}

function isCapabilityBanned(pluginId: string, platform: string, quality: string): boolean {
  const now = Date.now();
  for (const [key, until] of _capabilityBannedUntil) {
    if (now > until) _capabilityBannedUntil.delete(key);
  }
  if (_capabilityBannedUntil.has(`${pluginId}|${platform}`)) return true;
  if (quality && _capabilityBannedUntil.has(`${pluginId}|${platform}|${quality}`)) return true;
  return false;
}

function markDeterministicFailure(pluginId: string, msg: string): void {
  if (!isDeterministicFailureMessage(msg)) return;
  if (isDeterministicBanned(pluginId)) return;
  _deterministicBannedUntil.set(pluginId, Date.now() + DETERMINISTIC_BAN_TTL_MS);
  const brief = msg.length > 40 ? `${msg.substring(0, 40)}…` : msg;
  console.warn(`[plugin] ${pluginId} 确定性失败（${brief}），${DETERMINISTIC_BAN_TTL_MS / 1000} 秒内跳过该插件`);
}

function markCapabilityFailure(pluginId: string, platform: string, quality: string, msg: string): void {
  if (!platform) return;
  // 平台级优先判定：卡密类报错常写「不支持该平台或音质」，两者都能匹配，
  // 按平台级处理（该平台全部档位短路），档位级仅兜纯音质报错
  const key = isPlatformUnsupportedMessage(msg)
    ? `${pluginId}|${platform}`
    : quality && (isUnsupportedQualityError(msg) || /无此音质/i.test(msg))
      ? `${pluginId}|${platform}|${quality}`
      : '';
  if (!key || _capabilityBannedUntil.has(key)) return;
  _capabilityBannedUntil.set(key, Date.now() + CAPABILITY_BAN_TTL_MS);
  const brief = msg.length > 40 ? `${msg.substring(0, 40)}…` : msg;
  console.warn(`[plugin] ${pluginId} 能力缺失（${brief}），${CAPABILITY_BAN_TTL_MS / 1000} 秒内跳过同平台/档位请求`);
}

function isActionNotSupported(errMsg: string): boolean {
  return /action\s+not\s+support|not\s+support/i.test(errMsg);
}

async function lxPluginRequest(
  source: PluginSource,
  action: 'musicUrl' | 'lyric' | 'pic',
  data: { source: string; type?: string; musicInfo: any },
): Promise<any> {
  // 确定性失败负缓存短路（仅 musicUrl），与移动端/手表端一致
  if (action === 'musicUrl' &&
      (isDeterministicBanned(source.id) ||
        isCapabilityBanned(source.id, data.source || '', data.type || ''))) {
    log(`[lxPluginRequest] ${source.name} musicUrl 短路：失败冷却中 (${data.source}/${data.type || '-'})`);
    return null;
  }
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

      // 请求成功说明插件实例存活且链路可用：解除插件级确定性失败冷却
      clearDeterministicBan(source.id);

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
      if (action === 'lyric' && isActionNotSupported(errMsg)) {
        log(`[lxPluginRequest] 沙箱 ${source.name} lyric 不支持，交给后备歌词接口处理`);
        return null;
      }
      if (action === 'pic' && isActionNotSupported(errMsg)) {
        _picUnsupportedPluginIds.add(source.id);
        log(`[lxPluginRequest] 沙箱 ${source.name} pic 不支持，后续跳过插件封面请求`);
        return null;
      }
      console.error(`[lxPluginRequest] 沙箱模式 ${source.name} ${action} 失败: ${errMsg}`);
      log(`[lxPluginRequest] 沙箱模式 ${source.name} ${action} 失败: ${errMsg}`);
      // 失败记账（仅 musicUrl）：命中确定性/能力型特征才生效，60s 冷却内同请求短路
      if (action === 'musicUrl') {
        markDeterministicFailure(source.id, errMsg);
        markCapabilityFailure(source.id, data.source || '', data.type || '', errMsg);
      }
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
    const result = await run;
    // 请求成功说明插件实例存活且链路可用：解除插件级确定性失败冷却
    clearDeterministicBan(source.id);
    return result;
  } catch (e) {
      const errMsg = e instanceof Error ? e.message : (typeof e === 'string' ? e : String(e || 'unknown error'));
      if (action === 'lyric' && isActionNotSupported(errMsg)) {
        log(`[lxPluginRequest] ${source.name} lyric 不支持，交给后备歌词接口处理`);
        return null;
      }
      if (action === 'pic' && isActionNotSupported(errMsg)) {
        _picUnsupportedPluginIds.add(source.id);
        log(`[lxPluginRequest] ${source.name} pic 不支持，后续跳过插件封面请求`);
        return null;
      }
      log(`[lxPluginRequest] ${source.name} ${action} 失败: ${errMsg}`);

      // 失败记账（仅 musicUrl）：命中确定性/能力型特征才生效，60s 冷却内同请求短路
      if (action === 'musicUrl') {
        markDeterministicFailure(source.id, errMsg);
        markCapabilityFailure(source.id, data.source || '', data.type || '', errMsg);
      }

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
  if (_picUnsupportedPluginIds.has(source.id)) return null;
  const result = await lxPluginRequest(source, 'pic', { source: sourceKey, musicInfo: songInfo });
  return result?.data ?? result ?? null;
}