import type { PluginSource } from '../../types';
import type { PluginUpdateCheckResult, PluginUpdateServiceDeps } from './pluginUpdateTypes';

export function createPluginUpdateExecutor(deps: PluginUpdateServiceDeps) {
  const {
    loadPluginFromScript,
    addPluginSource,
    removePluginSource,
    getPluginUserVariableValues,
    setPluginUserVariableValues,
    destroyLxPlugin,
    initLxPlugin,
    log,
  } = deps;

  const performPluginUpdate = async (
    source: PluginSource,
    checkResult: PluginUpdateCheckResult,
  ): Promise<{ success: boolean; newSource: PluginSource | null; message: string }> => {
    if (!checkResult.newScript) {
      return { success: false, newSource: null, message: '无新脚本可更新' };
    }

    try {
      const newSource = await loadPluginFromScript(checkResult.newScript, checkResult.updateUrl);
      if (!newSource) {
        return { success: false, newSource: null, message: '新脚本加载失败' };
      }

      newSource.enabled = source.enabled;
      newSource.sortOrder = source.sortOrder;

      const oldUserVars = getPluginUserVariableValues(source.id);

      if (newSource.id !== source.id) {
        removePluginSource(source.id);
      }

      addPluginSource(newSource);

      if (newSource.id !== source.id && Object.keys(oldUserVars).length > 0) {
        setPluginUserVariableValues(newSource.id, oldUserVars);
        log(`[performPluginUpdate] 已迁移用户变量: ${source.id.substring(0, 16)}... → ${newSource.id.substring(0, 16)}... keys=[${Object.keys(oldUserVars).join(',')}]`);
      }

      if (newSource.format === 'lx' && newSource.enabled) {
        destroyLxPlugin(source.id);
        await initLxPlugin(newSource);
      }

      log(`[performPluginUpdate] ${source.name} 更新成功: ${source.version} → ${newSource.version}`);
      return { success: true, newSource, message: `${source.name} 已更新到 ${newSource.version}` };
    } catch (e: any) {
      log(`[performPluginUpdate] ${source.name} 更新失败: ${e?.message || e}`);
      return { success: false, newSource: null, message: `更新失败: ${e?.message || e}` };
    }
  };

  return { performPluginUpdate };
}