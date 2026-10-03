import { ref } from 'vue';
import type { PluginSource } from '../../types';
import {
  checkAllPluginUpdates,
  checkPluginUpdate,
  performPluginUpdate,
  type PluginUpdateCheckResult,
} from '../../services/domain/pluginEngine';
import { useToast } from '../toast';

interface UsePluginUpdatesOptions {
  refreshPluginList: () => void;
}

/**
 * 插件更新流程：单个插件检查/执行更新、批量检查全部插件更新。
 */
export function usePluginUpdates(options: UsePluginUpdatesOptions) {
  const { refreshPluginList } = options;
  const { showToast } = useToast();

  const updateCheckResults = ref<Map<string, PluginUpdateCheckResult>>(new Map());
  const checkingUpdates = ref(false);
  const updatingPluginId = ref<string | null>(null);

  async function handleUpdatePlugin(plugin: PluginSource) {
    const cached = updateCheckResults.value.get(plugin.id);
    if (cached?.hasUpdate && cached.newScript) {
      updatingPluginId.value = plugin.id;
      try {
        const result = await performPluginUpdate(plugin, cached);
        if (result.success) {
          showToast(`${plugin.name} 已更新到 v${cached.newVersion}`, 'success');
          updateCheckResults.value.delete(plugin.id);
          await refreshPluginList();
        } else {
          showToast(result.message || '更新失败', 'error');
        }
      } catch (e: any) {
        showToast(`更新失败: ${e?.message || e}`, 'error');
      } finally {
        updatingPluginId.value = null;
      }
      return;
    }

    updatingPluginId.value = plugin.id;
    try {
      const result = await checkPluginUpdate(plugin);
      if (!result) {
        showToast(`${plugin.name} 无可用更新源`, 'info');
      } else if (result.hasUpdate) {
        updateCheckResults.value.set(plugin.id, result);
        showToast(`${plugin.name} 发现新版本 v${result.newVersion}，再次点击更新`, 'info');
      } else {
        showToast(`${plugin.name} 已是最新版本`, 'info');
      }
    } catch (e: any) {
      showToast(`检查更新失败: ${e?.message || e}`, 'error');
    } finally {
      updatingPluginId.value = null;
    }
  }

  async function handleCheckAllUpdates() {
    if (checkingUpdates.value) return;
    checkingUpdates.value = true;
    try {
      const results = await checkAllPluginUpdates();
      updateCheckResults.value = results;
      let updateCount = 0;
      for (const [, result] of results) {
        if (result.hasUpdate) updateCount++;
      }
      if (updateCount > 0) {
        showToast(`发现 ${updateCount} 个插件可更新`, 'info');
      } else {
        showToast('所有插件均为最新版本', 'info');
      }
      await refreshPluginList();
    } catch (e: any) {
      showToast(`批量检查失败: ${e?.message || e}`, 'error');
    } finally {
      checkingUpdates.value = false;
    }
  }

  return {
    updateCheckResults,
    checkingUpdates,
    updatingPluginId,
    handleUpdatePlugin,
    handleCheckAllUpdates,
  };
}
