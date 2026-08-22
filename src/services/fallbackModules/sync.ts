/**
 * 兜底模块服务端同步：拉取 → 校验 digest → 写入缓存（下次使用生效）。
 *
 * 复用账号 API 的签名通道（signedRequest，与 get_latest_version 同级公开端点），
 * 启动时拉取一次，之后每 30 分钟轮询；所有失败静默（保留本地缓存）。
 */
import { signedRequest } from '../auth/authService';
import { applyServerFallbackModules } from './registry';
import type { ServerFallbackModule } from './types';

const SYNC_INTERVAL_MS = 30 * 60 * 1000;

let _timerId: number | null = null;
let _syncing = false;

const toHex = (bytes: Uint8Array): string => {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
};

/** SHA-256 hex 摘要（小写），Web Crypto 在 Tauri WebView 中可用 */
const sha256Hex = async (text: string): Promise<string> => {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
};

const normalizeModule = (raw: unknown): ServerFallbackModule | null => {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const moduleKey = typeof item.moduleKey === 'string' ? item.moduleKey : '';
  const code = typeof item.code === 'string' ? item.code : '';
  const version = Number(item.version);
  const digest = typeof item.digest === 'string' ? item.digest.toLowerCase() : '';
  if (!moduleKey || !code || !Number.isFinite(version) || version < 1 || !digest) return null;
  return {
    moduleKey: moduleKey as ServerFallbackModule['moduleKey'],
    version,
    digest,
    code,
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
      // 完整性校验：摘要不匹配的模块直接丢弃，避免传输损坏/被篡改的代码进入缓存
      try {
        const actualDigest = await sha256Hex(item.code);
        if (actualDigest !== item.digest) {
          console.warn(`[FallbackModule] 模块 ${item.moduleKey} v${item.version} digest 校验失败，已丢弃`);
          continue;
        }
      } catch {
        console.warn(`[FallbackModule] 模块 ${item.moduleKey} digest 计算失败，已丢弃`);
        continue;
      }
      modules.push(item);
    }
    applyServerFallbackModules(modules);
    return true;
  } catch (error) {
    console.warn('[FallbackModule] 拉取兜底模块失败（保留本地缓存）:', error);
    return false;
  } finally {
    _syncing = false;
  }
};

/** 启动同步调度：立即拉取一次 + 定时轮询。仅主窗口调用 */
export const initFallbackModuleSync = (): void => {
  if (_timerId !== null) return;
  void syncFallbackModules();
  _timerId = window.setInterval(() => {
    void syncFallbackModules();
  }, SYNC_INTERVAL_MS);
};
