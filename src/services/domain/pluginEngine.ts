/**
 * 插件引擎 —— 完全基于 MusicFree 插件系统
 *
 * 核心代码来自 MusicFree 项目：
 *   - 插件系统/core/pluginManager/plugin.ts  (Plugin 类 + PluginMethodsWrapper)
 *   - 搜索功能/searchPage/hooks/useSearch.ts  (搜索逻辑)
 *
 * 关键流程（与 MusicFree 完全一致）：
 *   1. 插件源码只允许委托给 Worker 沙箱执行，主线程不再执行插件源码
 *   2. Worker 沙箱内注入受控 npm 包和代理 fetch
 *   3. 执行后从 module.exports 提取插件实例
 *   4. 搜索结果中每个 item 调用 resetMediaItem(_, pluginName) 设置 platform
 *   5. getMediaSource 时传入的 musicItem 就是 resetMediaItem 后的对象
 *
 * 本文件为门面（Facade）：仅聚合 re-export 拆分后的子模块，保持既有
 * 消费者（Search.vue / playerPlayback.ts / downloadService / pluginSync 等）
 * 的入口路径不变。已拆分的子模块：
 *   - pluginEngineBase      共享类型、常量、工具、HTTP 适配、全局缓存（叶子）
 *   - pluginEngineInstance  插件加载、实例缓存、并发控制
 *   - pluginEngineUserVars  用户变量存储/规范化、B 站 Cookie 同步
 *   - pluginEngineCatalog   目录类调用（音乐/歌单/歌手/专辑搜索与详情）
 *   - pluginEngineMedia     内容类调用（播放/歌词/封面/视频/评论）
 *   - pluginEngineStore     存储 CRUD、生命周期、更新、订阅、云同步
 */

export * from './pluginEngineBase';
export * from './pluginEngineInstance';
export * from './pluginEngineUserVars';
export * from './pluginEngineCatalog';
export * from './pluginEngineMedia';
export * from './pluginEngineStore';