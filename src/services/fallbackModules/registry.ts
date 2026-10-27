import { reportError } from '../domain/usageStats';
import { localStore } from '../storage/localStore';
import { tauriInvoke } from '../tauri/invoke';
import {
  isFallbackConfigExpired,
  parseFallbackConfigJson,
  type FallbackRemoteConfig,
} from './types';

// ==================== 兜底行为配置存取（签名配置下发，无可执行代码） ====================
// 服务端下发整包配置 JSON + ed25519 签名；验签通过才缓存并应用到内存。
// 全部逻辑固定在客户端原生实现（Rust builtin），配置只控制链路开关与平台
// 来源，因此无需宿主加载/熔断链路：查询直接读内存，未同步前按默认放行。

const STORAGE_KEY = 'xianyu_fallback_config_v2';
// 旧热修模块缓存（含 JS 代码）不再读取，仅做升级清理
const LEGACY_STORAGE_KEY = 'xianyu_fallback_modules_v1';

// ==================== 降级/异常事件上报（statistics 通道） ====================
// 走 reportError → 服务端 error_log，按 error_type 聚合；上报失败静默，
// 同事件 60s 去重，避免轮询失败时刷屏。

const EVENT_REPORT_DEDUP_MS = 60_000;
const MAX_RECENT_EVENT_REPORTS = 32;
const _recentEventReports = new Map<string, number>();

const reportFallbackEvent = (eventType: string, detail: string): void => {
  const now = Date.now();
  if (_recentEventReports.size > MAX_RECENT_EVENT_REPORTS) {
    for (const [k, t] of _recentEventReports) {
      if (now - t > EVENT_REPORT_DEDUP_MS) _recentEventReports.delete(k);
    }
  }
  const dedupKey = `${eventType}::${detail}`;
  const last = _recentEventReports.get(dedupKey);
  if (last && now - last < EVENT_REPORT_DEDUP_MS) return;
  _recentEventReports.set(dedupKey, now);
  try {
    reportError(eventType, detail);
  } catch {
    // 上报层异常不影响兜底主流程
  }
};

// ==================== 内存态配置 ====================

let _config: FallbackRemoteConfig | null = null;

/// 指定方法是否被服务端配置关闭。配置未同步时默认放行。
export function fallbackMethodDisabled(moduleKey: string, method: string): boolean {
  return _config?.modules[moduleKey]?.disabledMethods.includes(method) ?? false;
}

/// 服务端下发的平台来源白名单与顺序（仅榜单/推荐歌单模块）。
/// 返回 null = 未配置（沿用调用方默认来源）；与调用方来源无交集时也返回
/// null，避免配置把当前页面打空。
export function fallbackModuleSourceOrder(moduleKey: string, wanted: string[]): string[] | null {
  const configured = _config?.modules[moduleKey]?.sources;
  if (!configured || wanted.length === 0) return null;
  const filtered = configured.filter(s => wanted.includes(s));
  return filtered.length > 0 ? filtered : null;
}

// ==================== 缓存读写与应用 ====================

interface FallbackConfigCache {
  config: string;
  signature: string;
  keyId?: string;
}

const readCachedConfig = (): FallbackConfigCache | null => {
  const raw = localStore.getJson<Partial<FallbackConfigCache>>(STORAGE_KEY);
  if (!raw || typeof raw.config !== 'string' || !raw.config) return null;
  if (typeof raw.signature !== 'string' || !raw.signature) return null;
  return {
    config: raw.config,
    signature: raw.signature,
    keyId: typeof raw.keyId === 'string' && raw.keyId ? raw.keyId : undefined,
  };
};

const writeCachedConfig = (config: string, signature: string, keyId?: string): void => {
  try {
    localStore.setJson(STORAGE_KEY, {
      config,
      signature,
      ...(keyId ? { keyId } : {}),
    } satisfies FallbackConfigCache);
  } catch (e) {
    console.warn('[FallbackConfig] 写入本地缓存失败:', e);
  }
};

const clearCachedConfig = (): void => {
  try {
    localStore.remove(STORAGE_KEY);
  } catch { /* 清理失败不影响主流程 */ }
};

/// 双公钥槽位验签（Tauri 命令返回 { valid, key_unknown }）。
/// keyId 已知 → 仅对该槽位严格验签；缺失/未知 → 遍历槽位，
/// 签名有效且 keyId 未知时 keyUnknown=true（采纳并上报事件）。
const verifyConfigSignature = async (
  configJson: string,
  signature: string,
  keyId?: string,
): Promise<{ valid: boolean; keyUnknown: boolean }> => {
  try {
    const result = await tauriInvoke('verify_fallback_config_signature', {
      configJson,
      signature,
      keyId: keyId ?? null,
    });
    return { valid: result?.valid === true, keyUnknown: result?.key_unknown === true };
  } catch (error) {
    console.warn('[FallbackConfig] 验签命令不可用，按未通过处理:', error);
    return { valid: false, keyUnknown: false };
  }
};

const applyConfig = (parsed: FallbackRemoteConfig): void => {
  _config = parsed;
  console.info(`[FallbackConfig] 应用配置 v${parsed.version}，模块数=${Object.keys(parsed.modules).length}`);
};

/// 启动/同步前清理：验签不过、解析失败或已过期的缓存直接清除（签名密钥
/// 轮换、拉取失败后调用），回退全部默认行为。
export async function sanitizeFallbackConfigCache(): Promise<void> {
  const cached = readCachedConfig();
  if (!cached) return;
  const verify = await verifyConfigSignature(cached.config, cached.signature, cached.keyId);
  if (!verify.valid) {
    clearCachedConfig();
    _config = null;
    console.warn('[FallbackConfig] 缓存配置验签失败，已清除（回退默认行为）');
    return;
  }
  const parsed = parseFallbackConfigJson(cached.config);
  if (!parsed || isFallbackConfigExpired(parsed)) {
    clearCachedConfig();
    _config = null;
    console.warn('[FallbackConfig] 缓存配置解析失败/已过期，已清除（回退默认行为）');
    return;
  }
  _config = parsed;
}

/// 服务端下发的整包配置（config JSON + 签名 [+ keyId]）验签后应用并缓存。
/// 验签失败/解析失败/已过期均丢弃并清除旧缓存（fail closed：过期处理等同
/// 验签失败，回退客户端默认行为）；签名有效但 keyId 不在客户端已知槽位时
/// 照常采纳，并上报 FallbackConfigKeyUnknown（疑似新公钥上线或密钥降级）。
export async function applyServerFallbackConfig(
  configJson: string,
  signature: string,
  keyId?: string,
): Promise<void> {
  if (!configJson || !signature) return;
  const verify = await verifyConfigSignature(configJson, signature, keyId);
  if (!verify.valid) {
    console.warn('[FallbackConfig] 服务端配置验签失败，已丢弃（回退默认行为）');
    reportFallbackEvent('FallbackConfigVerifyFail', '配置验签失败已丢弃');
    clearCachedConfig();
    _config = null;
    return;
  }
  if (verify.keyUnknown) {
    console.warn(
      `[FallbackConfig] 配置签名有效但 keyId=${keyId ?? ''} 不在客户端已知槽位，已采纳并上报（疑似新公钥上线/密钥降级）`,
    );
    reportFallbackEvent('FallbackConfigKeyUnknown', `keyId=${keyId ?? ''} 不在已知槽位`);
  }
  const parsed = parseFallbackConfigJson(configJson);
  if (!parsed || isFallbackConfigExpired(parsed)) {
    console.warn('[FallbackConfig] 配置解析失败/已过期，已丢弃（回退默认行为）');
    reportFallbackEvent('FallbackConfigVerifyFail', '配置解析失败/已过期已丢弃');
    clearCachedConfig();
    _config = null;
    return;
  }
  writeCachedConfig(configJson, signature, keyId);
  applyConfig(parsed);
}

/// 旧版热修模块缓存清理：v1 缓存存的是下发 JS 代码，升级到配置化后不再
/// 读取，启动时一次性清掉，避免残留可执行代码落盘。
export function removeLegacyFallbackModuleCache(): void {
  try {
    localStore.remove(LEGACY_STORAGE_KEY);
  } catch { /* 清理失败不影响主流程 */ }
}
