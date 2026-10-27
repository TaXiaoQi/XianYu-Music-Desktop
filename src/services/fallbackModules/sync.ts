import { signedRequest } from '../auth/authService';
import { applyServerFallbackConfig, removeLegacyFallbackModuleCache, sanitizeFallbackConfigCache } from './registry';

// ==================== 兜底行为配置服务端同步 ====================
// 启动即拉取一次，之后 30min 轮询；拉取失败保留本地缓存（启动时已验签清理）。
// 服务端返回 { config: <配置 JSON 字符串>, signature: <ed25519 hex> }，
// 客户端验签（xianyu-fallback-config-v1）通过才采纳。

const SYNC_INTERVAL_MS = 30 * 60 * 1000;

let _timerId: ReturnType<typeof setInterval> | null = null;
let _syncing = false;

/// 服务端响应 → (configJson, signature)；未配置（空串）或字段残缺返回 null
const normalizeServerFallbackConfig = (
  raw: unknown,
): { config: string; signature: string } | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const config = String((raw as Record<string, unknown>).config ?? '');
  const signature = String((raw as Record<string, unknown>).signature ?? '').toLowerCase();
  if (!config || !signature) return null;
  return { config, signature };
};

export const syncFallbackModules = async (): Promise<boolean> => {
  if (_syncing) return false;
  _syncing = true;
  try {
    const data = await signedRequest<unknown>('get_fallback_modules', {}, {
      fetchTimeoutMs: 15_000,
      timeoutMs: 18_000,
    });
    const normalized = normalizeServerFallbackConfig(data);
    if (!normalized) {
      // 服务端未配置/字段残缺：保持现状（本地缓存或默认行为）
      return true;
    }
    await applyServerFallbackConfig(normalized.config, normalized.signature);
    return true;
  } catch (error) {
    console.warn('[FallbackConfig] 拉取兜底配置失败（保留本地缓存）:', error);
    return false;
  } finally {
    _syncing = false;
  }
};

export const initFallbackModuleSync = (): void => {
  if (_timerId !== null) return;
  void (async () => {
    removeLegacyFallbackModuleCache();
    await sanitizeFallbackConfigCache();
    void syncFallbackModules();
  })();
  _timerId = setInterval(() => {
    void syncFallbackModules();
  }, SYNC_INTERVAL_MS);
};
