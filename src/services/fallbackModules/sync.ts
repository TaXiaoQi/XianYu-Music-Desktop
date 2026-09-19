import { signedRequest } from '../auth/authService';
import { tauriInvoke } from '../tauri/invoke';
import { applyServerFallbackModules, sanitizeFallbackModuleCache } from './registry';
import type { ServerFallbackModule } from './types';

const SYNC_INTERVAL_MS = 30 * 60 * 1000;

let _timerId: number | null = null;
let _syncing = false;

const verifyModuleSignature = async (item: ServerFallbackModule): Promise<boolean> => {
  try {
    const ok = await tauriInvoke('verify_fallback_module_signature', {
      moduleKey: item.moduleKey,
      version: item.version,
      code: item.code,
      signature: item.signature,
    });
    return ok === true;
  } catch (error) {
    console.warn(`[FallbackModule] ${item.moduleKey} 验签命令不可用，按未通过处理:`, error);
    return false;
  }
};

const normalizeModule = (raw: unknown): ServerFallbackModule | null => {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const moduleKey = typeof item.moduleKey === 'string' ? item.moduleKey : '';
  const code = typeof item.code === 'string' ? item.code : '';
  const version = Number(item.version);
  const digest = typeof item.digest === 'string' ? item.digest.toLowerCase() : '';
  const signature = typeof item.signature === 'string' ? item.signature.toLowerCase() : '';
  if (!moduleKey || !code || !Number.isFinite(version) || version < 1 || !digest) return null;
  if (!signature) return null;
  return {
    moduleKey: moduleKey as ServerFallbackModule['moduleKey'],
    version,
    digest,
    code,
    signature,
    name: typeof item.name === 'string' ? item.name : undefined,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
  };
};

export const syncFallbackModules = async (): Promise<boolean> => {
  if (_syncing) return false;
  _syncing = true;
  try {
    const data = await signedRequest<Record<string, unknown>>('get_fallback_modules', {}, {
      fetchTimeoutMs: 15_000,
      timeoutMs: 18_000,
    });
    const rawList = Array.isArray(data?.modules) ? (data.modules as unknown[]) : [];
    const modules: ServerFallbackModule[] = [];
    for (const raw of rawList) {
      const item = normalizeModule(raw);
      if (!item) continue;
      const verified = await verifyModuleSignature(item);
      if (!verified) {
        console.warn(`[FallbackModule] 模块 ${item.moduleKey} v${item.version} 签名校验失败，已丢弃（回退内置实现）`);
        continue;
      }
      modules.push(item);
    }
    applyServerFallbackModules(modules);
    return true;
  } catch (error) {
    console.warn('[FallbackModule] 拉取兜底模块失败（保留本地缓存）:', error);
    await sanitizeFallbackModuleCache();
    return false;
  } finally {
    _syncing = false;
  }
};

export const initFallbackModuleSync = (): void => {
  if (_timerId !== null) return;
  void (async () => {
    await sanitizeFallbackModuleCache();
    void syncFallbackModules();
  })();
  _timerId = window.setInterval(() => {
    void syncFallbackModules();
  }, SYNC_INTERVAL_MS);
};
