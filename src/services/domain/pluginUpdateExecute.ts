import type { PluginSource } from '../../types';
import type { PluginUpdateCheckResult, PluginUpdateServiceDeps } from './pluginUpdateTypes';
import { readPluginIdAliases, writePluginIdAliases } from './pluginEngineBase';

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
        // id 变更入别名表：收藏/播放队列存的旧 pluginId 仍可换算到现行
        // 插件（来源标签、播放 heal 都依赖 id 匹配）；链尾若也是旧键则
        // 压缩成直达，防环限深
        const aliases = { ...readPluginIdAliases() };
        for (const [k, v] of Object.entries(aliases)) {
          if (v === source.id) delete aliases[k];
        }
        aliases[source.id] = newSource.id;
        writePluginIdAliases(aliases);
      }

      addPluginSource(newSource);

      if (newSource.format !== 'lx') {
        // MusicFree 插件：实例/沙箱可能已按旧脚本懒加载，更新后必须重建，
        // 否则本次会话内继续用旧脚本（如酷狗旧版歌单详情 30 首截断）
        deps.reloadPluginInstance?.(source.id);
        if (newSource.id !== source.id) deps.reloadPluginInstance?.(newSource.id);
      }

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