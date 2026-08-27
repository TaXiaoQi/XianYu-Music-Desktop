/**
 * Baka 插件引擎 —— BakaMusic 系列插件独立管理器（门面）。
 *
 * 本文件为门面（Facade）：仅聚合 re-export 拆分后的子模块，并组合形成单例，
 * 保持既有消费者（pluginEngineMedia / pluginEngineCatalog / pluginEngineInstance
 * 及 bakaPluginManager.test.ts）的入口路径不变。已拆分的子模块：
 *   - bakaPluginManagerBase      类型、日志、音质回退映射、URL 清洗/预检、
 *                                歌词格式检测、落雪式重试（叶子）
 *   - bakaPluginManagerCore      共享状态（检测/媒体源缓存、并发去重）、
 *                                插件检测、音质查询、实例获取与沙箱代理（核心基类）
 *   - bakaPluginManagerMedia     播放 URL / 歌词 / 评论 / 封面 / 详情页 URL 获取
 *   - bakaPluginManagerCatalog   搜索 / 专辑 / 歌单 / 歌手详情、榜单、推荐歌单、导入
 *
 * 职责：
 *   1. 检测 Baka 插件（通过 supportedQualities 字段 / 作者名）
 *   2. 管理音质回退（newToLegacyQualityMap）
 *   3. 获取播放 URL（getMediaSource，带新→旧音质回退）
 *   4. 获取歌词（getLyric，支持所有 Baka 歌词格式）
 *   5. 获取评论 / 封面 / 详情页 URL
 *   6. 搜索（music/album/artist/sheet）与专辑/歌单/歌手详情、榜单、导入
 *
 * 所有方法调用通过 pluginSandboxManager 的 RPC 机制委托到 Worker 沙箱执行，
 * 主线程只负责编排逻辑和结果映射。
 */
export * from './bakaPluginManagerBase';
export * from './bakaPluginManagerCore';
export * from './bakaPluginManagerMedia';
export * from './bakaPluginManagerCatalog';
import { BakaPluginCatalog } from './bakaPluginManagerCatalog';

/**
 * Baka 插件管理器（单例）
 * 组合链：BakaPluginCore（状态/检测）→ BakaPluginMedia（媒体）→ BakaPluginCatalog（目录/搜索）。
 */
class BakaPluginManagerClass extends BakaPluginCatalog {}

// ==================== 单例导出 ====================

export const BakaPluginManager = new BakaPluginManagerClass();