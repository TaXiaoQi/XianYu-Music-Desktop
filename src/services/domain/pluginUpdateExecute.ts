import type { PluginSource } from '../../types';
import type { PluginUpdateCheckResult, PluginUpdateServiceDeps } from './pluginUpdateTypes';

/**
 * 执行插件更新：重新加载新脚本并替换旧插件。
 */
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

      // 插件 ID 使用脚本 SHA-256。Baka/MusicFree 插件更新后脚本内容变化会导致 ID 变化，
      // 而用户变量值按插件 ID 存储。删除旧插件前先取出旧值，安装新插件后迁移到新 ID，
      // 避免 QQ音乐[L2] 等插件的 SOURCE_API_KEY 在更新后丢失。
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