
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

export const createPluginUpdateService = (deps: PluginUpdateServiceDeps) => ({
  ...createPluginUpdateChecker(deps),
  ...createPluginUpdateExecutor(deps),
});