/**
 * 落雪（LX）插件引擎 —— 适配 lx-music-desktop UserApi 插件格式
 *
 * 核心设计：
 *   插件脚本全部在 Rust 后端 QuickJS 沙箱中隔离执行（plugin_host），
 *   本模块仅作为前端编排层：加载委托 pluginSandboxManager → Tauri 命令，
 *   脚本哈希、HTTP 代理、存储、Cookie 均由 Rust 侧完成
 *
 * 通信机制：
 *   前端 → Rust:  plugin_engine_load_lx / plugin_engine_call 命令
 *   Rust 沙箱内:  globalThis.lx 暴露 EVENT_NAMES / request / send / on / utils
 *   插件 HTTP:   由 Rust HttpBridge 代理并注入 Cookie
 *
 * 多插件隔离：
 *   每个插件独立的 QuickJS Runtime/Context，天然隔离，无共享 globalThis 竞争
 *
 * 本文件为门面（Facade）：仅聚合 re-export 拆分后的子模块，保持既有消费者
 * （Search.vue / downloadService / lxUrlResolver / bakaPluginManager 等）的
 * 入口路径不变。已拆分的子模块：
 *   - lxPluginEngineBase        类型、日志、全局缓存、歌曲级错误、规范化工具、
 *                               脚本格式检测与头信息解析（叶子）
 *   - lxPluginEngineInstance    脚本读取/缓存、实例加载、并发锁、销毁与启用初始化
 *   - lxPluginEngineRequest     请求路由（musicUrl / lyric / pic）与上层便捷封装
 */

export * from './lxPluginEngineBase';
export * from './lxPluginEngineInstance';
export * from './lxPluginEngineRequest';