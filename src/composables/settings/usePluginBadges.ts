import { ref } from 'vue';
import { getStoredPlugins, isBakaPlugin, refreshUserVariableBadges } from '../../services/domain/pluginEngine';

/**
 * 插件列表徽章状态：用户变量徽章 + Baka 插件徽章。
 * 由组件在挂载与插件库版本（pluginsVersion）变化时触发刷新。
 */
export function usePluginBadges() {
  const pluginsWithUserVars = ref<Set<string>>(new Set());
  let badgeRefreshInProgress = false;

  async function refreshUserVarBadges() {
    if (badgeRefreshInProgress) return;
    badgeRefreshInProgress = true;
    try {
      pluginsWithUserVars.value = await refreshUserVariableBadges();
    } finally {
      badgeRefreshInProgress = false;
    }
  }

  const pluginsBakaIds = ref<Set<string>>(new Set());
  let bakaRefreshInProgress = false;

  async function refreshBakaBadges() {
    if (bakaRefreshInProgress) return;
    bakaRefreshInProgress = true;
    try {
      const allPlugins = getStoredPlugins();
      const bakaSet = new Set<string>();
      await Promise.all(
        allPlugins
          .filter((p) => p.format === 'musicfree')
          .map(async (p) => {
            try {
              if (await isBakaPlugin(p)) bakaSet.add(p.id);
            } catch { /* ignore */ }
          }),
      );
      pluginsBakaIds.value = bakaSet;
    } finally {
      bakaRefreshInProgress = false;
    }
  }

  return {
    pluginsWithUserVars,
    pluginsBakaIds,
    refreshUserVarBadges,
    refreshBakaBadges,
  };
}
