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

  // ===== 扫描结果（持久化记忆） =====
  const scannedPlugins = ref<PluginHostScanEntry[]>([]);
  const isScanning = ref(false);
  const hasScanned = ref(false);
  const currentScanningPath = ref<string>('');
  const timeoutPluginPath = ref<string>('');

  // 从本地恢复上一次成功扫描的插件列表
  try {
    const saved = localStore.getJson<PluginHostScanEntry[]>('plugin_host_scanned_plugins');
    if (Array.isArray(saved) && saved.length > 0) {
      scannedPlugins.value = saved;
      hasScanned.value = true;
    }
  } catch (err) {
    console.warn('[pluginHostStore] 恢复已扫描插件列表失败:', err);
  }

  const persistScannedPlugins = () => {
    try {
      localStore.setJson('plugin_host_scanned_plugins', scannedPlugins.value);
    } catch (err) {
      console.warn('[pluginHostStore] 保存已扫描插件列表失败:', err);
    }
  };

  // ===== 禁用/黑名单插件路径列表（跳过崩溃/超时插件） =====
  const disabledPluginPaths = ref<string[]>([]);
  try {
    const saved = playerStorage.readStringArray('plugin_host_disabled_paths');
    if (saved) disabledPluginPaths.value = saved;
  } catch (err) {
    console.warn('[pluginHostStore] 恢复禁用插件列表失败:', err);
  }
  const persistDisabledPaths = () => {
    try {
      localStore.setJson('plugin_host_disabled_paths', disabledPluginPaths.value);
    } catch (err) {
      console.warn('[pluginHostStore] 保存禁用插件列表失败:', err);
    }
  };

  const disablePluginPath = (path: string) => {
    const clean = path.trim();
    if (!clean) return;
    if (!disabledPluginPaths.value.some(p => p.toLowerCase() === clean.toLowerCase())) {
      disabledPluginPaths.value.push(clean);
      persistDisabledPaths();
      showToast(`已跳过并禁用插件: ${clean.split(/[\/\\]/).pop()}`, 'info');
    }
  };

  // ===== 自定义扫描目录（持久化，扫描时传给后端合并） =====
  const extraDirs = ref<string[]>([]);
  try {
    const saved = playerStorage.readStringArray(playerStorageKeys.pluginHostExtraDirs);
    if (saved) extraDirs.value = saved;
  } catch (err) {
    console.warn('[pluginHostStore] 恢复自定义插件目录失败（使用默认值）:', err);
  }
  const persistExtraDirs = () => {
    try {
      localStore.setJson(playerStorageKeys.pluginHostExtraDirs, extraDirs.value);
    } catch (err) {
      console.warn('[pluginHostStore] 保存自定义插件目录失败:', err);
    }
  };

  // ===== 已从机架移除的插件（扫描时不再自动加入）=====
  const dismissedRackKeys = ref<Set<string>>(new Set());
  try {
    const saved = localStore.getJson<string[]>('plugin_host_dismissed_rack');
    if (Array.isArray(saved)) dismissedRackKeys.value = new Set(saved);
  } catch (err) {
    console.warn('[pluginHostStore] 恢复已移除插件列表失败:', err);
  }
  const persistDismissed = () => {
    try {
      localStore.setJson('plugin_host_dismissed_rack', [...dismissedRackKeys.value]);
    } catch (err) {
      console.warn('[pluginHostStore] 保存已移除插件列表失败:', err);
    }
  };
  const dismissedCount = computed(() => dismissedRackKeys.value.size);

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
  // 保持"扫描结果即机架"的一致性：把已扫描插件并入机架（默认停用），已移除的不再出现
  mergeScannedIntoRack();
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

  const syncRackNow = async () => {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    const config = snapshotConfig();
    try {
      await setRack(config);
      localStore.setJson(playerStorageKeys.pluginHostRack, config);
    } catch (err) {
      console.warn('[pluginHostStore] 同步/保存机架配置失败:', err);
    }
  };

  watch(rackConfig, () => {
    if (!restored) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      void syncRackNow();
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

  // ===== 实时扫描监听 =====
  let scanTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  const resetScanTimer = () => {
    if (scanTimeoutTimer) {
      clearTimeout(scanTimeoutTimer);
      scanTimeoutTimer = null;
    }
  };

  void listen<PluginHostScanEntry>('plugin-host-scan-item', event => {
    resetScanTimer();
    const entry = event.payload;
    if (!scannedPlugins.value.some(p => p.format === entry.format && p.uniqueId === entry.uniqueId)) {
      scannedPlugins.value.push(entry);
      persistScannedPlugins();
    }
  }).catch(() => {});

  void listen<string>('plugin-host-scan-current', event => {
    const path = event.payload;
    currentScanningPath.value = path;
    resetScanTimer();
    // 如果单个插件处理时间超过 4000ms，触发超时弹窗询问
    scanTimeoutTimer = setTimeout(() => {
      if (isScanning.value && currentScanningPath.value === path) {
        timeoutPluginPath.value = path;
      }
    }, 4000);
  }).catch(() => {});

  // ===== 扫描 =====
  const scan = async (options?: { forceFullRescan?: boolean }) => {
    if (isScanning.value) return;
    isScanning.value = true;
    currentScanningPath.value = '';
    timeoutPluginPath.value = '';

    // 如果是强制全新重扫，则清空；否则在现有记忆的基础上增量扫描
    if (options?.forceFullRescan) {
      scannedPlugins.value = [];
    }
    resetScanTimer();
    try {
      const results = await scanPlugins(extraDirs.value, disabledPluginPaths.value);
      scannedPlugins.value = results;
      hasScanned.value = true;
      persistScannedPlugins();
      mergeScannedIntoRack();
    } catch (err) {
      console.warn('[pluginHostStore] 插件扫描失败:', err);
      showToast(`插件扫描失败: ${err}`, 'error');
    } finally {
      resetScanTimer();
      isScanning.value = false;
      currentScanningPath.value = '';
    }
  };

  /** 把扫描到的插件自动并入机架（默认停用）；已在机架或已移除的不重复添加。 */
  function mergeScannedIntoRack() {
    let changed = false;
    for (const entry of scannedPlugins.value) {
      const key = slotKey(entry.format, entry.uniqueId);
      if (dismissedRackKeys.value.has(key)) continue;
      if (rackConfig.slots.some(s => s.format === entry.format && s.uniqueId === entry.uniqueId)) continue;
      rackConfig.slots.push({
        format: entry.format,
        uniqueId: entry.uniqueId,
        path: entry.path,
        name: entry.name,
        vendor: entry.vendor,
        enabled: false,
        params: {},
      });
      changed = true;
    }
    return changed;
  }

  /** 恢复所有已移除插件（清空移除记录并重新并入机架）。 */
  const restoreDismissed = () => {
    if (dismissedRackKeys.value.size === 0) return;
    dismissedRackKeys.value.clear();
    persistDismissed();
    mergeScannedIntoRack();
  };

  // ===== 自定义目录管理 =====
  const addExtraDir = (path: string) => {
    const dir = path.trim();
    if (!dir || extraDirs.value.includes(dir)) return;
    extraDirs.value.push(dir);
    persistExtraDirs();
    void scan();
  };

  const removeExtraDir = (path: string) => {
    const index = extraDirs.value.indexOf(path);
    if (index < 0) return;
    extraDirs.value.splice(index, 1);
    persistExtraDirs();
    void scan();
  };

  // ===== 机架操作 =====
  const setMasterEnabled = (enabled: boolean) => {
    rackConfig.masterEnabled = enabled;
  };

  const findSlotIndex = (format: string, uniqueId: string) =>
    rackConfig.slots.findIndex(s => s.format === format && s.uniqueId === uniqueId);

  const removeSlot = (format: string, uniqueId: string) => {
    const index = findSlotIndex(format, uniqueId);
    if (index < 0) return;
    const key = slotKey(format, uniqueId);
    void closeEditor(format, uniqueId).catch(() => {});
    const next = new Set(openEditorKeys.value);
    next.delete(key);
    openEditorKeys.value = next;
    rackConfig.slots.splice(index, 1);
    dismissedRackKeys.value.add(key);
    persistDismissed();
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

  /** 拖拽排序：把 from 索引的槽位移动到 to 索引。 */
  const reorderSlot = (from: number, to: number) => {
    const count = rackConfig.slots.length;
    if (from < 0 || to < 0 || from >= count || to >= count || from === to) return;
    const [slot] = rackConfig.slots.splice(from, 1);
    rackConfig.slots.splice(to, 0, slot);
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
      // 立即刷新并把机架配置输入 Rust 共享机架，避免防抖延迟导致打开编辑器时后端找不到槽位/产生死锁
      await syncRackNow();
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
    extraDirs,
    dismissedCount,
    currentScanningPath,
    timeoutPluginPath,
    disabledPluginPaths,
    // 扫描 & 禁用黑名单
    scan,
    disablePluginPath,
    mergeScannedIntoRack,
    restoreDismissed,
    // 自定义目录
    addExtraDir,
    removeExtraDir,
    // 机架
    setMasterEnabled,
    syncRackNow,
    removeSlot,
    toggleSlot,
    moveSlot,
    reorderSlot,
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
