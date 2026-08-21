/**
 * VST3/CLAP 原生插件宿主 store
 *
 * 职责（与音效 store 同构的持久化体系）：
 * - 机架配置的唯一前端数据源：启动时从本地恢复并推送 Rust 共享机架，
 *   之后任一变更（防抖）同步 set_rack + 持久化；
 * - 实时参数：setSlotParameter 走 plugin_host_set_parameter 参数队列
 *   （下一个 process 块生效），同时回写本地配置保证重启后一致；
 * - 编辑器窗口状态：监听 plugin-host-editor-closed 事件维护打开键集合；
 * - 音频线程错误：轮询 take_process_error 并 toast 透出（仅在有活动槽位时轮询）。
 */

import { defineStore } from 'pinia';
import { computed, reactive, ref, watch } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { localStore } from '../../services/storage/localStore';
import { playerStorage, playerStorageKeys } from '../../services/storage/playerStorage';
import { useToast } from '../../composables/toast';
import {
  PLUGIN_HOST_EDITOR_CLOSED_EVENT,
  closeEditor,
  editorStates,
  openEditor,
  scanPlugins,
  setParameter,
  setRack,
  takeProcessError,
} from '../../services/tauri/pluginHostApi';
import type {
  PluginHostRackConfig,
  PluginHostRackSlotConfig,
  PluginHostScanEntry,
} from '../../services/tauri/contracts';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const isSlotShape = (value: unknown): value is PluginHostRackSlotConfig => {
  if (!value || typeof value !== 'object') return false;
  const slot = value as Partial<PluginHostRackSlotConfig>;
  return typeof slot.format === 'string'
    && typeof slot.uniqueId === 'string'
    && typeof slot.path === 'string'
    && typeof slot.name === 'string';
};

const normalizeRackConfig = (value: unknown): PluginHostRackConfig | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PluginHostRackConfig>;
  if (!Array.isArray(raw.slots)) return null;
  const slots = raw.slots.filter(isSlotShape).map(slot => ({
    format: slot.format,
    uniqueId: slot.uniqueId,
    path: slot.path,
    name: slot.name,
    vendor: typeof slot.vendor === 'string' ? slot.vendor : '',
    enabled: slot.enabled === true,
    params: Object.fromEntries(
      Object.entries(slot.params ?? {})
        .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
        .map(([k, v]) => [String(k), clamp01(v as number)]),
    ),
  }));
  return { masterEnabled: raw.masterEnabled === true, slots };
};

const slotKey = (format: string, uniqueId: string) => `${format}::${uniqueId}`;

export const usePluginHostStore = defineStore('pluginHost', () => {
  const { showToast } = useToast();

  // ===== 机架配置（唯一数据源）=====
  const rackConfig = reactive<PluginHostRackConfig>({ masterEnabled: false, slots: [] });

  // ===== 扫描结果 =====
  const scannedPlugins = ref<PluginHostScanEntry[]>([]);
  const isScanning = ref(false);
  const hasScanned = ref(false);

  // ===== 编辑器窗口状态 =====
  const openEditorKeys = ref<Set<string>>(new Set());

  const hasActiveSlots = computed(() =>
    rackConfig.masterEnabled && rackConfig.slots.some(s => s.enabled));

  // ===== [持久化] 启动恢复 + 推送后端 =====
  let restored = false;
  try {
    const saved = playerStorage.readObject<Record<string, unknown>>(playerStorageKeys.pluginHostRack);
    const normalized = normalizeRackConfig(saved);
    if (normalized) {
      rackConfig.masterEnabled = normalized.masterEnabled;
      rackConfig.slots.splice(0, rackConfig.slots.length, ...normalized.slots);
    }
  } catch (err) {
    console.warn('[pluginHostStore] 恢复机架配置失败（使用默认值）:', err);
  }
  restored = true;
  if (rackConfig.slots.length > 0 || rackConfig.masterEnabled) {
    setRack({ ...rackConfig, slots: rackConfig.slots.map(s => ({ ...s, params: { ...s.params } })) })
      .catch(err => console.warn('[pluginHostStore] 启动同步机架配置失败:', err));
  }

  // ===== [持久化] 变更时同步后端 + 保存（防抖）=====
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  const snapshotConfig = (): PluginHostRackConfig => ({
    masterEnabled: rackConfig.masterEnabled,
    slots: rackConfig.slots.map(s => ({ ...s, params: { ...s.params } })),
  });

  watch(rackConfig, () => {
    if (!restored) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const config = snapshotConfig();
      setRack(config).catch(err => {
        console.warn('[pluginHostStore] 同步机架配置失败:', err);
      });
      try {
        localStore.setJson(playerStorageKeys.pluginHostRack, config);
      } catch (err) {
        console.warn('[pluginHostStore] 保存机架配置失败:', err);
      }
    }, 200);
  }, { deep: true });

  // ===== 音频线程错误轮询（仅有活动槽位时）=====
  let errorPollTimer: ReturnType<typeof setInterval> | null = null;
  const pollProcessError = async () => {
    if (!hasActiveSlots.value) return;
    try {
      const message = await takeProcessError();
      if (message) showToast(message, 'error');
    } catch {
      // 后端不可用（如非 Tauri 环境）时静默
    }
  };
  const ensureErrorPolling = () => {
    if (errorPollTimer || !hasActiveSlots.value) return;
    errorPollTimer = setInterval(() => { void pollProcessError(); }, 4000);
  };
  const stopErrorPolling = () => {
    if (errorPollTimer) {
      clearInterval(errorPollTimer);
      errorPollTimer = null;
    }
  };
  watch(hasActiveSlots, active => {
    if (active) {
      ensureErrorPolling();
      void pollProcessError();
    } else {
      stopErrorPolling();
    }
  }, { immediate: true });

  // ===== 编辑器关闭事件（store 与应用同生命周期，无需注销监听）=====
  void listen<{ format: string; uniqueId: string }>(PLUGIN_HOST_EDITOR_CLOSED_EVENT, event => {
    const key = slotKey(event.payload.format, event.payload.uniqueId);
    const next = new Set(openEditorKeys.value);
    next.delete(key);
    openEditorKeys.value = next;
  }).catch(() => {});

  /** 恢复当前后端编辑器状态（设置页挂载时调用）。 */
  const refreshEditors = async () => {
    try {
      const states = await editorStates();
      openEditorKeys.value = new Set(states.map(s => slotKey(s.format, s.uniqueId)));
    } catch {
      // 非 Windows 平台等场景忽略
    }
  };

  // ===== 扫描 =====
  const scan = async () => {
    if (isScanning.value) return;
    isScanning.value = true;
    try {
      scannedPlugins.value = await scanPlugins();
      hasScanned.value = true;
    } catch (err) {
      console.warn('[pluginHostStore] 插件扫描失败:', err);
      showToast(`插件扫描失败: ${err}`, 'error');
    } finally {
      isScanning.value = false;
    }
  };

  // ===== 机架操作 =====
  const setMasterEnabled = (enabled: boolean) => {
    rackConfig.masterEnabled = enabled;
  };

  const findSlotIndex = (format: string, uniqueId: string) =>
    rackConfig.slots.findIndex(s => s.format === format && s.uniqueId === uniqueId);

  const isSlotInRack = (format: string, uniqueId: string) => findSlotIndex(format, uniqueId) >= 0;

  const addSlot = (entry: PluginHostScanEntry) => {
    if (isSlotInRack(entry.format, entry.uniqueId)) return;
    rackConfig.slots.push({
      format: entry.format,
      uniqueId: entry.uniqueId,
      path: entry.path,
      name: entry.name,
      vendor: entry.vendor,
      enabled: true,
      params: {},
    });
    if (!rackConfig.masterEnabled) rackConfig.masterEnabled = true;
  };

  const removeSlot = (format: string, uniqueId: string) => {
    const index = findSlotIndex(format, uniqueId);
    if (index < 0) return;
    const key = slotKey(format, uniqueId);
    void closeEditor(format, uniqueId).catch(() => {});
    const next = new Set(openEditorKeys.value);
    next.delete(key);
    openEditorKeys.value = next;
    rackConfig.slots.splice(index, 1);
  };

  const toggleSlot = (format: string, uniqueId: string) => {
    const index = findSlotIndex(format, uniqueId);
    if (index < 0) return;
    rackConfig.slots[index].enabled = !rackConfig.slots[index].enabled;
  };

  /** 移动槽位顺序（direction: -1 向上 / 1 向下）。 */
  const moveSlot = (format: string, uniqueId: string, direction: -1 | 1) => {
    const index = findSlotIndex(format, uniqueId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= rackConfig.slots.length) return;
    const [slot] = rackConfig.slots.splice(index, 1);
    rackConfig.slots.splice(target, 0, slot);
  };

  /**
   * 实时设置单个参数：本地配置回写（持久 + 防抖 set_rack 兜底）+
   * plugin_host_set_parameter 参数队列（下一个 process 块生效）。
   */
  const setSlotParameter = async (
    format: string,
    uniqueId: string,
    index: number,
    value: number,
  ) => {
    const slotIndex = findSlotIndex(format, uniqueId);
    if (slotIndex < 0) return;
    const normalized = clamp01(value);
    rackConfig.slots[slotIndex].params[String(index)] = normalized;
    try {
      await setParameter(format, uniqueId, index, normalized);
    } catch (err) {
      showToast(`参数设置失败: ${err}`, 'error');
    }
  };

  /** 参数值被后端（预设加载/编辑器）改动后的批量回写（不触发逐参数实时队列）。 */
  const applySlotParams = (
    format: string,
    uniqueId: string,
    params: Record<number, number>,
  ) => {
    const slotIndex = findSlotIndex(format, uniqueId);
    if (slotIndex < 0) return;
    for (const [index, value] of Object.entries(params)) {
      rackConfig.slots[slotIndex].params[String(index)] = clamp01(value);
    }
  };

  // ===== 编辑器操作 =====
  const openSlotEditor = async (format: string, uniqueId: string, title: string) => {
    try {
      await openEditor(format, uniqueId, title);
      const next = new Set(openEditorKeys.value);
      next.add(slotKey(format, uniqueId));
      openEditorKeys.value = next;
    } catch (err) {
      showToast(`打开插件编辑器失败: ${err}`, 'error');
    }
  };

  const closeSlotEditor = async (format: string, uniqueId: string) => {
    const key = slotKey(format, uniqueId);
    const next = new Set(openEditorKeys.value);
    next.delete(key);
    openEditorKeys.value = next;
    try {
      await closeEditor(format, uniqueId);
    } catch (err) {
      console.warn('[pluginHostStore] 关闭编辑器失败:', err);
    }
  };

  const isEditorOpen = (format: string, uniqueId: string) =>
    openEditorKeys.value.has(slotKey(format, uniqueId));

  return {
    // 状态
    rackConfig,
    scannedPlugins,
    isScanning,
    hasScanned,
    hasActiveSlots,
    // 扫描
    scan,
    // 机架
    setMasterEnabled,
    isSlotInRack,
    addSlot,
    removeSlot,
    toggleSlot,
    moveSlot,
    // 参数
    setSlotParameter,
    applySlotParams,
    // 编辑器
    openSlotEditor,
    closeSlotEditor,
    isEditorOpen,
    refreshEditors,
  };
});
