/**
 * 插件 Store
 *
 * 管理已安装插件列表、当前选中插件、搜索类型等状态。
 */

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { PluginInfo, PluginSearchType } from '../../types/plugin';
import { pluginApi } from '../../services/tauri/pluginApi';

export const usePluginsStore = defineStore('plugins', () => {
  /** 所有已安装的插件 */
  const plugins = ref<PluginInfo[]>([]);
  /** 插件列表是否已加载过 */
  const loaded = ref(false);
  /** 当前选中的插件 ID */
  const activePluginId = ref<string | null>(null);
  /** 当前选中的搜索类型 */
  const activeSearchType = ref<PluginSearchType>('track');

  /** 已启用的插件（仅这些会出现在插件选择列表中） */
  const enabledPlugins = computed(() => plugins.value.filter(p => p.enabled));

  /** 当前选中的插件对象 */
  const activePlugin = computed<PluginInfo | null>(
    () => enabledPlugins.value.find(p => p.id === activePluginId.value) ?? null,
  );

  /** 加载已安装的插件列表 */
  const loadPlugins = async (force = false) => {
    if (loaded.value && !force) return;
    const list = await pluginApi.getInstalledPlugins();
    plugins.value = list;
    loaded.value = true;
    // 默认选中第一个已启用的插件
    if (!activePluginId.value || !enabledPlugins.value.some(p => p.id === activePluginId.value)) {
      activePluginId.value = enabledPlugins.value[0]?.id ?? null;
    }
  };

  /** 切换当前选中的插件 */
  const setActivePlugin = (pluginId: string) => {
    activePluginId.value = pluginId;
  };

  /** 切换搜索类型 */
  const setActiveSearchType = (type: PluginSearchType) => {
    activeSearchType.value = type;
  };

  /** 设置插件启用状态 */
  const setPluginEnabled = async (pluginId: string, enabled: boolean) => {
    const plugin = plugins.value.find(p => p.id === pluginId);
    if (!plugin) return;
    plugin.enabled = enabled;
    await pluginApi.setPluginEnabled(pluginId, enabled);
    // 若禁用的是当前选中插件，自动切回第一个启用的
    if (!enabled && activePluginId.value === pluginId) {
      activePluginId.value = enabledPlugins.value[0]?.id ?? null;
    }
  };

  return {
    plugins,
    enabledPlugins,
    activePlugin,
    activePluginId,
    activeSearchType,
    loaded,
    loadPlugins,
    setActivePlugin,
    setActiveSearchType,
    setPluginEnabled,
  };
});
