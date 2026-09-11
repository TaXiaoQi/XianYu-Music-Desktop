import { useToast } from '../../composables/toast';
import { useSettings } from '../../features/settings/useSettings';
import type { PluginSource } from '../../types';
import { pluginApi } from '../tauri/pluginApi';
import {
  addPluginSource,
  getStoredPlugins,
  loadPluginFromScript,
  persistPluginScriptToDataDir,
} from './pluginEngine';

/** 简单版本号比较：返回 >0 表示 a 更新，<0 表示 b 更新，0 表示相同（与插件设置页同源逻辑） */
function compareVer(a: string, b: string): number {
  const pa = (a || '0').split(/[.-]/).filter(Boolean);
  const pb = (b || '0').split(/[.-]/).filter(Boolean);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i]) || 0;
    const nb = parseInt(pb[i]) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** 从本地文件路径安装单个插件脚本：LX/MusicFree 自动识别加载、副本持久化到数据目录、
    按设置做版本校验。与插件设置页「从文件安装」的核心逻辑同源，供系统「打开方式」
    入口（文件关联/启动参数）复用；Baka 识别由插件设置页挂载时统一重检，此处不标记。 */
export async function installPluginFromPath(
  filePath: string,
): Promise<'installed' | 'skipped'> {
  const { showToast } = useToast();
  const script = await pluginApi.readPluginFile(filePath);
  if (!script || script.trim().length === 0) {
    throw new Error('插件文件为空');
  }

  // 使用 pluginEngine 的 loadPluginFromScript，自动检测格式（LX 或 MusicFree）
  const source: PluginSource | null = await loadPluginFromScript(script, filePath);
  if (!source) {
    throw new Error('插件加载失败');
  }

  // 本地文件安装：保存一份副本到数据目录，避免原文件被移动/删除后插件失效
  const savedPath = await persistPluginScriptToDataDir(source, script);
  if (savedPath) {
    source.filePath = savedPath;
  }

  // 版本校验：检查是否已存在同名插件且版本更高或相同
  const { settings } = useSettings();
  if (!settings.value.plugins.skipVersionCheck) {
    const existing = getStoredPlugins().find(p => p.name === source.name);
    if (existing) {
      const cmp = compareVer(source.version, existing.version);
      if (cmp <= 0) {
        showToast(
          `已存在同名插件 v${existing.version}，新版本 v${source.version} 未高于已安装版本，已跳过`,
          'info',
        );
        return 'skipped';
      }
    }
  }

  addPluginSource(source);
  return 'installed';
}

/** 系统「打开方式」入口：批量导入插件脚本文件（.js/.json），带进度 toast。 */
export async function importPluginScriptsFromPaths(paths: string[]): Promise<void> {
  const { showToast, showProgressToast } = useToast();
  const progress = showProgressToast(`正在导入插件文件 (0/${paths.length})`);
  const names: string[] = [];
  let failCount = 0;

  for (let i = 0; i < paths.length; i++) {
    const fileName = paths[i].split(/[\\/]/).pop() || paths[i];
    progress.update(
      `正在导入 ${fileName} (${i + 1}/${paths.length})`,
      ((i + 1) / paths.length) * 100,
    );
    try {
      const result = await installPluginFromPath(paths[i]);
      if (result === 'installed') {
        names.push(fileName);
        showToast(`成功安装插件: ${fileName}`, 'success');
      }
    } catch (e: any) {
      failCount++;
      showToast(`${fileName}: ${e?.message || '安装失败'}`, 'error');
    }
  }

  if (names.length > 0) {
    progress.complete(
      `成功导入 ${names.length} 个插件: ${names.join(', ')}${failCount > 0 ? `，${failCount} 个失败` : ''}`,
      'success',
    );
  } else if (failCount > 0) {
    progress.fail(`所有插件导入失败 (${failCount} 个)`);
  } else {
    progress.complete('已处理所有插件文件', 'info');
  }
}
