/**
 * 插件沙箱类型定义
 *
 * 插件脚本现由 Rust 后端 QuickJS 引擎执行（plugin_host 模块），
 * 原主线程/Worker 通信协议类型已随 Worker 沙箱一并移除。
 */

/** LX 插件脚本元信息（加载时传给后端引擎） */
export interface LxScriptInfo {
  name: string;
  version: string;
  author: string;
  description: string;
  homepage: string;
}
