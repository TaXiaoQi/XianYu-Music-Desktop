import { tauriInvoke } from './invoke';
import type { NetworkProxyConfigOptions } from './contracts';

/**
 * 网络代理设置。配置的单一事实源在 Rust 侧（app_data_dir/network-proxy.json + keyring 密码），
 * 前端不另存一份，避免双写分叉。
 */
export const networkApi = {
  getNetworkProxy: () => tauriInvoke('get_network_proxy'),
  /**
   * `password`: `null` = 保留已保存的密码；`''` = 清除；其他 = 设置为该值。
   */
  setNetworkProxy: (config: NetworkProxyConfigOptions, password: string | null) =>
    tauriInvoke('set_network_proxy', { config, password }),
  testNetworkProxy: (config: NetworkProxyConfigOptions, password: string | null) =>
    tauriInvoke('test_network_proxy', { config, password }),
  /** 重启应用：代理等「进程内 client 已固化」的设置需要重启才能对全部请求生效。 */
  restartApp: () => tauriInvoke('restart_app'),
/**
 * 通用 GET 文本，走 Rust。给那些原本用浏览器 fetch、因而无法被网络代理覆盖的调用点使用。
 * 返回原始响应（含状态码）；非 2xx 由调用方自行判断。
 */
getTextViaRust: (url: string, timeoutMs?: number) =>
  tauriInvoke('plugin_http_request', { method: 'GET', url, timeout: timeoutMs ?? null }),
};
