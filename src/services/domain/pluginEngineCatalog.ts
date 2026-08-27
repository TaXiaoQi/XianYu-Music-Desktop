/**
 * 插件引擎 · 目录/搜索操作（门面 Facade）。
 *
 * 汇聚 re-export 拆分后的子模块，保持所有既有消费者（pluginEngine /
 * Search / OnlineDetailView 等）的入口路径不变。已拆分的子模块：
 *   - pluginCatalogShared  共享工具与类型（retryOnEmpty / 搜索诊断 / 歌手/专辑结果）
 *   - pluginCatalogSearch  搜索组（音乐/歌单/歌手/专辑，含 QQ 宿主兜底）
 *   - pluginCatalogDetails 详情组（榜单/歌单详情/收藏夹导入/歌手作品/专辑/音质）
 *
 * 音乐/歌单/歌手/专辑搜索、榜单、歌单详情、收藏夹导入、歌手作品/专辑、
 * 歌手简介、专辑歌曲等「目录类」插件调用。仅依赖 pluginEngineBase /
 * pluginEngineInstance 与外部工具模块，作为叶子被 pluginEngine 门面消费。
 */

export * from './pluginCatalogShared';
export * from './pluginCatalogSearch';
export * from './pluginCatalogDetails';