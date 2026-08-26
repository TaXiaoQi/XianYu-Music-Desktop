/**
 * 兜底模块服务端同步：拉取 → ed25519 验签 → 写入缓存（下次使用生效）。
 *
 * 复用账号 API 的签名通道（signedRequest，与 get_latest_version 同级公开端点），
 * 启动时拉取一次，之后每 30 分钟轮询；所有失败静默（保留本地缓存）。
 *
 * 安全模型：服务器私钥对 (moduleKey|version|code) 签名，客户端内嵌公钥验签通过才允许执行。
 * 无法仅依赖 HTTPS + 自算 digest（digest 与代码同源下发，不具防篡改作用），
 * 故以 Rust `verify_fallback_module_signature` 的验签结果作为唯一准入依据。
 */
import { signedRequest } from '../auth/authService';
import { tauriInvoke } from '../tauri/invoke';
import { applyServerFallbackModules, sanitizeFallbackModuleCache } from './registry';
import type { ServerFallbackModule } from './types';

const SYNC_INTERVAL_MS = 30 * 60 * 1000;

let _timerId: number | null = null;
let _syncing = false;

/** RUST：对 (moduleKey|version|code) 做 ed25519 验签，签名有效返回 true */
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

/** 单次同步。失败静默返回 false，由调用方决定重试节奏 */
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
      // 安全准入：ed25519 验签通过才允许执行；验签失败/缺签名的模块直接丢弃，
      // 防止被改动的代码进入缓存（digest 与代码同源下发，不具防篡改作用，故不再依赖它）。
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
    // 同步失败继续沿用本地缓存，此时必须清洗缓存：清掉被篡改/无签名的条目，防止赖着执行
    await sanitizeFallbackModuleCache();
    return false;
  } finally {
    _syncing = false;
  }
};

/** 启动同步调度：先清洗本地缓存防篡改，再立即拉取一次 + 定时轮询。仅主窗口调用 */
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
