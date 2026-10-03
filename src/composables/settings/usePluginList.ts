import { computed, ref } from 'vue';
import type { PluginSource } from '../../types';
import { getStoredPlugins, togglePlugin } from '../../services/domain/pluginEngine';
import { useToast } from '../toast';
import { getPluginSubTag } from '../../utils/remoteSong';

/**
 * 已安装插件列表状态：排序/搜索过滤/刷新、全量启停、统计文案与付费订阅品牌标签。
 */
export function usePluginList() {
  const { showToast } = useToast();

  const plugins = ref<PluginSource[]>(getStoredPlugins());
  const searchQuery = ref('');
  const isPluginBusy = ref(false);

  function sortPlugins(list: PluginSource[]): PluginSource[] {
    return [...list].sort((a, b) => {
      const sa = a.sortOrder ?? 0;
      const sb = b.sortOrder ?? 0;
      if (sa !== sb) return sa - sb;
      return list.indexOf(a) - list.indexOf(b);
    });
  }
  const filteredPlugins = computed(() => {
    const keyword = searchQuery.value.trim().toLowerCase();
    const sorted = sortPlugins(plugins.value);
    if (!keyword) return sorted;
    return sorted.filter((p) =>
      p.name.toLowerCase().includes(keyword) ||
      p.sources.join(',').toLowerCase().includes(keyword) ||
      (p.author?.toLowerCase().includes(keyword) ?? false)
    );
  });

  function refreshPluginList() {
    plugins.value = getStoredPlugins();
  }

  const pluginStatsLabel = computed(() => {
    const total = plugins.value.length;
    const enabled = plugins.value.filter((p) => p.enabled).length;
    return `共 ${total} 个插件，已启用 ${enabled} 个`;
  });

  const allPluginsEnabled = computed(() => {
    return plugins.value.length > 0 && plugins.value.every((p) => p.enabled);
  });

  async function handleToggleAllPlugins() {
    const targetEnabled = !allPluginsEnabled.value;
    isPluginBusy.value = true;
    let successCount = 0;
    let failCount = 0;
    for (const plugin of plugins.value) {
      if (plugin.enabled === targetEnabled) continue;
      const result = await togglePlugin(plugin.id);
      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }
    }
    refreshPluginList();
    isPluginBusy.value = false;
    if (failCount === 0) {
      showToast(`已${targetEnabled ? '启用' : '禁用'} ${successCount} 个插件`, 'success');
    } else {
      showToast(`已${targetEnabled ? '启用' : '禁用'} ${successCount} 个，${failCount} 个失败`, 'error');
    }
  }

  // 付费订阅来源品牌标签（付费聆澜/付费ikun，无来源名回落「付费」），随插件列表联动
  const subBrandLabelById = computed(() => {
    const map = new Map<string, string>();
    for (const p of plugins.value) {
      const tag = getPluginSubTag(p);
      if (tag) map.set(p.id, tag.label === '付费' ? '付费' : `付费${tag.label}`);
    }
    return map;
  });

  return {
    plugins,
    searchQuery,
    isPluginBusy,
    sortPlugins,
    filteredPlugins,
    refreshPluginList,
    pluginStatsLabel,
    allPluginsEnabled,
    handleToggleAllPlugins,
    subBrandLabelById,
  };
}
