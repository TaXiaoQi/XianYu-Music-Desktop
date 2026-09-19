
import { tauriInvoke } from './invoke';
import type {
  PluginHostEditorStateEntry,
  PluginHostParameterEntry,
  PluginHostParameterValueEntry,
  PluginHostPresetEntry,
  PluginHostRackConfig,
  PluginHostScanEntry,
} from './contracts';

export const PLUGIN_HOST_EDITOR_CLOSED_EVENT = 'plugin-host-editor-closed';

export async function scanPlugins(extraDirs: string[], disabledPaths?: string[]): Promise<PluginHostScanEntry[]> {
  return tauriInvoke('plugin_host_scan_plugins', { dirs: extraDirs, disabledPaths: disabledPaths ?? [] });
}

export async function getRack(): Promise<PluginHostRackConfig> {
  return tauriInvoke('plugin_host_get_rack');
}

export async function setRack(config: PluginHostRackConfig): Promise<void> {
  return tauriInvoke('plugin_host_set_rack', { config });
}

export async function getPluginParameters(
  format: string,
  uniqueId: string,
  path: string,
): Promise<PluginHostParameterEntry[]> {
  return tauriInvoke('plugin_host_get_plugin_parameters', { format, uniqueId, path });
}

export async function getParameterValues(
  format: string,
  uniqueId: string,
  path: string,
): Promise<PluginHostParameterValueEntry[]> {
  return tauriInvoke('plugin_host_get_parameter_values', { format, uniqueId, path });
}

export async function setParameter(
  format: string,
  uniqueId: string,
  index: number,
  value: number,
): Promise<void> {
  return tauriInvoke('plugin_host_set_parameter', { format, uniqueId, index, value });
}

export async function getPluginPresets(
  format: string,
  uniqueId: string,
  path: string,
): Promise<PluginHostPresetEntry[]> {
  return tauriInvoke('plugin_host_get_plugin_presets', { format, uniqueId, path });
}

export async function loadPreset(
  format: string,
  uniqueId: string,
  path: string,
  presetNumber: number,
): Promise<void> {
  return tauriInvoke('plugin_host_load_preset', { format, uniqueId, path, presetNumber });
}

export async function openEditor(
  format: string,
  uniqueId: string,
  title: string,
): Promise<void> {
  return tauriInvoke('plugin_host_open_editor', { format, uniqueId, title });
}

export async function closeEditor(format: string, uniqueId: string): Promise<void> {
  return tauriInvoke('plugin_host_close_editor', { format, uniqueId });
}

export async function editorStates(): Promise<PluginHostEditorStateEntry[]> {
  return tauriInvoke('plugin_host_editor_states');
}

export async function takeProcessError(): Promise<string | null> {
  return tauriInvoke('plugin_host_take_process_error');
}
