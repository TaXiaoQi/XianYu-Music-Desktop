/**
 * VST3/CLAP 原生插件宿主 API 服务层
 *
 * 封装 Rust plugin_host 模块的 Tauri command 通信：
 * 扫描 / 机架配置 / 参数元数据与实时值 / 预设 / 原生编辑器窗口 / 处理错误透出。
 */

import { tauriInvoke } from './invoke';
import type {
  PluginHostEditorStateEntry,
  PluginHostParameterEntry,
  PluginHostParameterValueEntry,
  PluginHostPresetEntry,
  PluginHostRackConfig,
  PluginHostScanEntry,
} from './contracts';

/** 编辑器关闭通知事件名（payload: { format, uniqueId }）。 */
export const PLUGIN_HOST_EDITOR_CLOSED_EVENT = 'plugin-host-editor-closed';

/** 扫描标准插件目录（用户级 + 系统级 VST3/CLAP）+ 自定义目录，dlopen 级重操作。 */
export async function scanPlugins(extraDirs: string[]): Promise<PluginHostScanEntry[]> {
  return tauriInvoke('plugin_host_scan_plugins', { dirs: extraDirs });
}

/** 读取当前机架配置。 */
export async function getRack(): Promise<PluginHostRackConfig> {
  return tauriInvoke('plugin_host_get_rack');
}

/** 写入机架配置并同步共享机架（槽位集合变化重建链、参数差异实时下发）。 */
export async function setRack(config: PluginHostRackConfig): Promise<void> {
  return tauriInvoke('plugin_host_set_rack', { config });
}

/** 读取插件参数元数据（优先活动实例，否则临时加载 + 内存缓存）。 */
export async function getPluginParameters(
  format: string,
  uniqueId: string,
  path: string,
): Promise<PluginHostParameterEntry[]> {
  return tauriInvoke('plugin_host_get_plugin_parameters', { format, uniqueId, path });
}

/** 读取参数当前值 + 插件原生格式化文本（编辑器打开时轮询用）。 */
export async function getParameterValues(
  format: string,
  uniqueId: string,
  path: string,
): Promise<PluginHostParameterValueEntry[]> {
  return tauriInvoke('plugin_host_get_parameter_values', { format, uniqueId, path });
}

/** 实时设置单个参数（写配置持久 + 活动实例参数队列，下一个 process 块生效）。 */
export async function setParameter(
  format: string,
  uniqueId: string,
  index: number,
  value: number,
): Promise<void> {
  return tauriInvoke('plugin_host_set_parameter', { format, uniqueId, index, value });
}

/** 读取工厂预设列表（VST3 IUnitInfo 程序列表；CLAP 无工厂预设协议，恒空）。 */
export async function getPluginPresets(
  format: string,
  uniqueId: string,
  path: string,
): Promise<PluginHostPresetEntry[]> {
  return tauriInvoke('plugin_host_get_plugin_presets', { format, uniqueId, path });
}

/** 加载工厂预设（活动实例实时下发；未加载时收获参数进配置，下次起播生效）。 */
export async function loadPreset(
  format: string,
  uniqueId: string,
  path: string,
  presetNumber: number,
): Promise<void> {
  return tauriInvoke('plugin_host_load_preset', { format, uniqueId, path, presetNumber });
}

/** 打开插件原生编辑器窗口（Win32 专用线程；owner 主窗口 Z 序）。 */
export async function openEditor(
  format: string,
  uniqueId: string,
  title: string,
): Promise<void> {
  return tauriInvoke('plugin_host_open_editor', { format, uniqueId, title });
}

/** 关闭插件编辑器窗口（不阻塞等待）。 */
export async function closeEditor(format: string, uniqueId: string): Promise<void> {
  return tauriInvoke('plugin_host_close_editor', { format, uniqueId });
}

/** 当前打开的编辑器列表（前端恢复状态用）。 */
export async function editorStates(): Promise<PluginHostEditorStateEntry[]> {
  return tauriInvoke('plugin_host_editor_states');
}

/** 取走音频线程上报的一次性处理错误（读后即清，供 toast 透出）。 */
export async function takeProcessError(): Promise<string | null> {
  return tauriInvoke('plugin_host_take_process_error');
}
