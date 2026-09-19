export * from './bakaPluginManagerBase';
export * from './bakaPluginManagerCore';
export * from './bakaPluginManagerMedia';
export * from './bakaPluginManagerCatalog';
import { BakaPluginCatalog } from './bakaPluginManagerCatalog';

class BakaPluginManagerClass extends BakaPluginCatalog {}

// ==================== 单例导出 ====================

export const BakaPluginManager = new BakaPluginManagerClass();