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
  getSubscriptions: () => Array<{ id: string; url: string; name?: string }>;
  addPluginSource: (source: PluginSource) => void;
  removePluginSource: (id: string) => void;
  updatePluginSource: (id: string, updates: Partial<PluginSource>) => void;
  getPluginUserVariableValues: (pluginId: string) => Record<string, string>;
  setPluginUserVariableValues: (pluginId: string, values: Record<string, string>) => void;
  parseLxScriptInfo: (script: string) => { version: string; homepage?: string };
  initLxPlugin: (source: PluginSource) => Promise<boolean>;
  destroyLxPlugin: (id: string) => void;
  /** MusicFree 插件更新后重建实例：沙箱可能仍按旧脚本运行（中途订阅更新场景） */
  reloadPluginInstance?: (pluginId: string) => void;
  /** 云端插件删除（pluginEngineStore 懒加载注入，避免 pluginSync 静态循环依赖）：更新换 id 后清理云端旧版本 */
  deleteCloudPlugins?: (pluginIds: string[]) => Promise<boolean>;
  pluginApi: Pick<typeof pluginApi, 'fetchPluginUrl' | 'readPluginFile'>;
  log: (msg: string) => void;
}