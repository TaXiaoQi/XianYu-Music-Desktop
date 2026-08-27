/**
 * 插件更新服务 —— 门面（Facade）。
 *
 * 汇聚 re-export 拆分后的子模块并保留主编排入口 `createPluginUpdateService`，
 * 保持既有消费者（pluginEngineStore 等）的入口路径不变。已拆分的子模块：
 *   - pluginUpdateTypes    类型与依赖接口（叶子）
 *   - pluginUpdateVersion  版本号比较 + MusicFree 脚本信息提取（叶子）
 *   - pluginUpdateCheck    更新检查（订阅清单解析/缓存、checkPluginUpdate）
 *   - pluginUpdateExecute  更新执行（loadPluginFromScript + 替换/迁移用户变量）
 */

export type {
  PluginUpdateCheckResult,
  PluginUpdateServiceDeps,
} from './pluginUpdateTypes';
export {
  compareVersions,
  extractMusicFreeVersion,
  extractMusicFreeSrcUrl,
} from './pluginUpdateVersion';

import type { PluginUpdateServiceDeps } from './pluginUpdateTypes';
import { createPluginUpdateChecker } from './pluginUpdateCheck';
import { createPluginUpdateExecutor } from './pluginUpdateExecute';

/** 主编排：组合检查器与执行器，返回统一的更新服务接口。 */
export const createPluginUpdateService = (deps: PluginUpdateServiceDeps) => ({
  ...createPluginUpdateChecker(deps),
  ...createPluginUpdateExecutor(deps),
});