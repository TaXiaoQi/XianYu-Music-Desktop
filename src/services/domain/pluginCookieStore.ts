/**
 * 插件 Cookie & Storage —— 后端 QuickJS 引擎存储门面
 *
 * 插件引擎迁至 Rust 后，Cookie/Storage 统一由后端 PluginStore
 * 持久化（app_data_dir/plugin_host_store.json）。旧 localStorage
 * 数据由 pluginSandboxManager 在启动时一次性迁移。
 *
 * 本文件只保留前端直用的 Cookie 头查询（B站取流防盗链等场景）。
 */

import { tauriInvoke } from '../tauri/invoke';

/**
 * 获取 B站相关 Cookie 并构建 Cookie 请求头字符串（异步，查后端存储）。
 *
 * B站插件调用 API 时（api.bilibili.com / www.bilibili.com）会在后端存
 * Cookie，但 CDN 域名（bilivideo.com）与 API 域名不同，URL 域匹配不会
 * 命中。此函数按域名关键字（bilibili）过滤 Cookie，拼成
 * "name1=value1; name2=value2" 格式，供 m4s 下载防盗链使用。
 */
export async function getPluginBilibiliCookies(): Promise<string> {
  try {
    return await tauriInvoke('plugin_engine_cookie_header_for_domain', { domain: 'bilibili' });
  } catch {
    return '';
  }
}
