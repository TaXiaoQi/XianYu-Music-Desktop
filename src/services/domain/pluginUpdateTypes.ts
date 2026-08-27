import type { PluginSource } from '../../types';
import type { pluginApi } from '../tauri/pluginApi';

export interface PluginUpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  newVersion: string;
  newScript: string | null;
  updateUrl: string;
}

export interface PluginUpdateServiceDeps {
  ensurePluginInstance: (source: PluginSource) => Promise<{ instance: any } | null>;
  loadPluginFromScript: (script: string, filePath: string) => Promise<PluginSource | null>;
  getStoredPlugins: () => PluginSource[];
  /** 已保存的订阅清单（供订阅型插件的版本比对）。 */
  getSubscriptions: () => Array<{ id: string; url: string; name?: string }>;
  addPluginSource: (source: PluginSource) => void;
  removePluginSource: (id: string) => void;
  updatePluginSource: (id: string, updates: Partial<PluginSource>) => void;
  getPluginUserVariableValues: (pluginId: string) => Record<string, string>;
  setPluginUserVariableValues: (pluginId: string, values: Record<string, string>) => void;
  parseLxScriptInfo: (script: string) => { version: string; homepage?: string };
  initLxPlugin: (source: PluginSource) => Promise<boolean>;
  destroyLxPlugin: (id: string) => void;
  pluginApi: Pick<typeof pluginApi, 'fetchPluginUrl' | 'readPluginFile'>;
  log: (msg: string) => void;
}