import { computed, ref } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useToast } from './toast';
import { performPluginUpdate } from '../services/domain/pluginEngineStore';
import { getStoredPlugins } from '../services/domain/pluginEngineBase';
import { isLxPluginScript } from '../services/domain/lxPluginEngineBase';
import { fetchWithTimeout } from '../services/domain/pluginFetch';
import { pluginApi } from '../services/tauri/pluginApi';

/** 与 Rust 侧 PLUGIN_LX_UPDATE_ALERT_EVENT 对应 */
export const LX_UPDATE_ALERT_EVENT = 'plugin-lx-update-alert';

export interface LxUpdateAlert {
  pluginId: string;
  pluginName: string;
  log: string;
  updateUrl: string | null;
}

interface LxUpdateAlertPayload {
  pluginId?: unknown;
  log?: unknown;
  updateUrl?: unknown;
}

// 模块级单例状态（与 useNicknameChangeNotification 同模式）
const queue = ref<LxUpdateAlert[]>([]);
const isApplyingUpdate = ref(false);
const seenFingerprints = new Set<string>();
let started = false;

const lxUpdateAlertVisible = computed(() => queue.value.length > 0);
const currentLxUpdateAlert = computed(() => queue.value[0] ?? null);

function fingerprintOf(payload: { pluginId: string; log: string; updateUrl: string | null }): string {
  return `${payload.pluginId}|${payload.log}|${payload.updateUrl ?? ''}`;
}

function handleLxUpdateAlertPayload(raw: unknown): void {
  const payload = (raw ?? {}) as LxUpdateAlertPayload;
  const pluginId = typeof payload.pluginId === 'string' ? payload.pluginId : '';
  const log = typeof payload.log === 'string' ? payload.log.trim() : '';
  const updateUrl = typeof payload.updateUrl === 'string' && payload.updateUrl ? payload.updateUrl : null;
  if (!log || !pluginId) return;

  const fp = fingerprintOf({ pluginId, log, updateUrl });
  if (seenFingerprints.has(fp)) return;
  seenFingerprints.add(fp);

  const pluginName = getStoredPlugins().find(p => p.id === pluginId)?.name ?? '';
  queue.value.push({ pluginId, pluginName, log, updateUrl });
}

/** 监听 Rust 插件引擎转发来的 LX 插件自报更新事件 */
export async function startLxUpdateAlertListener(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await listen(LX_UPDATE_ALERT_EVENT, (event) => {
      handleLxUpdateAlertPayload(event.payload);
    });
  } catch (error) {
    started = false;
    console.error('[LxUpdateAlert] 注册事件监听失败:', error);
  }
}

/** 「稍后」：仅关闭当前弹窗，同内容本会话不再重复弹出 */
export function dismissLxUpdateAlert(): void {
  queue.value.shift();
}

/**
 * 「立即更新」：拉取 updateUrl 脚本并原位替换插件（对齐 LX 原生行为）。
 * 内容不是脚本或插件已被移除时，回退为打开更新页。
 */
export async function confirmLxUpdateAlert(): Promise<void> {
  const alert = currentLxUpdateAlert.value;
  if (!alert || isApplyingUpdate.value) return;
  if (!alert.updateUrl) {
    dismissLxUpdateAlert();
    return;
  }

  isApplyingUpdate.value = true;
  const toast = useToast();
  try {
    let script: string | null = null;
    try {
      const resp = await fetchWithTimeout(alert.updateUrl, 10_000);
      if (resp.ok) script = await resp.text();
    } catch { /* 浏览器 fetch 失败走 Tauri 侧 */ }
    if (!script) {
      try { script = await pluginApi.fetchPluginUrl(alert.updateUrl); } catch { /* ignore */ }
    }

    const source = getStoredPlugins().find(p => p.id === alert.pluginId);
    if (!script || !isLxPluginScript(script) || !source) {
      // 内容非脚本 / 插件已被移除 → 打开更新页（LX 原生 updateUrl 行为）
      try { await openUrl(alert.updateUrl); } catch { /* ignore */ }
      dismissLxUpdateAlert();
      return;
    }

    const result = await performPluginUpdate(source, {
      hasUpdate: true,
      currentVersion: source.version,
      newVersion: '',
      newScript: script,
      updateUrl: alert.updateUrl,
    });
    toast.showToast(result.message, result.success ? 'success' : 'error');
    if (result.success) dismissLxUpdateAlert();
  } finally {
    isApplyingUpdate.value = false;
  }
}

export function useLxUpdateAlert() {
  return {
    lxUpdateAlertVisible,
    currentLxUpdateAlert,
    isApplyingLxUpdate: isApplyingUpdate,
    startLxUpdateAlertListener,
    dismissLxUpdateAlert,
    confirmLxUpdateAlert,
  };
}
