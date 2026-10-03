import { signedRequest } from '../auth/authService';
import { tauriInvoke } from '../tauri/invoke';
import { useSettingsStore } from '../../features/settings/store';
import { watch } from 'vue';
import { applyServerFallbackModules, prewarmFallbackModules, sanitizeFallbackModuleCache } from './registry';
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
    prewarmFallbackModules();
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
    prewarmFallbackModules();
    void syncFallbackModules();
  })();
  _timerId = window.setInterval(() => {
    void syncFallbackModules();
  }, SYNC_INTERVAL_MS);
};

// ==================== 兜底模块配置快照推送 ====================

const CONFIG_PUSH_DEBOUNCE_MS = 500;
// 推送失败重试：1s → 2s → 4s，共 3 次尝试，仍失败才放弃（等下次设置变化或重启）
const CONFIG_PUSH_MAX_RETRIES = 3;
const CONFIG_PUSH_RETRY_BASE_MS = 1000;

let _configWatchInstalled = false;
let _pushInFlight = false;
let _pushPending = false;

/// 与 Rust update_config 的哈希口径一致：对原始 JSON 字符串取 sha256-hex
const computeConfigHash = async (configJson: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(configJson));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
};

const pushFallbackModuleConfig = (): void => {
  // 上一轮重试尚未结束：只记待推标记，结束后按最新设置补推一次
  if (_pushInFlight) {
    _pushPending = true;
    return;
  }
  _pushInFlight = true;
  void (async () => {
    try {
      const store = useSettingsStore();
      for (let attempt = 1; ; attempt += 1) {
        // 每次尝试重取最新快照，重试期间设置再变也不会推出旧配置
        const configJson = JSON.stringify(store.settings);
        try {
          await tauriInvoke('fallback_module_update_config', { configJson });
          return;
        } catch (error) {
          if (attempt >= CONFIG_PUSH_MAX_RETRIES) {
            console.error(`[FallbackModule] 推送兜底模块配置失败（已重试 ${CONFIG_PUSH_MAX_RETRIES} 次，等待下次设置变化或重启）:`, error);
            return;
          }
          const delay = CONFIG_PUSH_RETRY_BASE_MS * 2 ** (attempt - 1);
          console.warn(`[FallbackModule] 推送兜底模块配置失败，${delay}ms 后重试（第 ${attempt + 1}/${CONFIG_PUSH_MAX_RETRIES} 次）:`, error);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } finally {
      _pushInFlight = false;
      if (_pushPending) {
        _pushPending = false;
        pushFallbackModuleConfig();
      }
    }
  })();
};

/// 启动对账：比对前端当前设置与 Rust 已存配置的 hash，不一致才重推。
/// 覆盖「上次推送失败后 Rust 侧配置缺失/漂移」的场景；查询失败则直接推送兜底。
const reconcileFallbackModuleConfig = async (): Promise<void> => {
  try {
    const store = useSettingsStore();
    const localHash = await computeConfigHash(JSON.stringify(store.settings));
    const remoteHash = await tauriInvoke('fallback_module_config_hash');
    if (localHash === remoteHash) return;
    console.info('[FallbackModule] 配置对账不一致，重新推送');
  } catch (error) {
    console.warn('[FallbackModule] 配置对账查询失败，直接推送兜底:', error);
  }
  pushFallbackModuleConfig();
};

/// 启动时对账推送一次，之后设置变化（深比较，500ms 防抖）整包推。
/// 需在 pinia 初始化完成后调用。
export const installFallbackModuleConfigWatch = (): void => {
  if (_configWatchInstalled) return;
  _configWatchInstalled = true;
  void reconcileFallbackModuleConfig();
  const store = useSettingsStore();
  let timer: number | null = null;
  watch(
    () => store.settings,
    () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        pushFallbackModuleConfig();
      }, CONFIG_PUSH_DEBOUNCE_MS);
    },
    { deep: true },
  );
};
