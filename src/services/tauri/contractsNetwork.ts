/** 网络代理配置（对应 src-tauri/src/netproxy.rs 的 ProxyConfig，字段名与序列化一致） */
export interface NetworkProxyConfigOptions {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
}

/** 网络代理配置视图。密码不回传，只告知是否已设置。 */
export interface NetworkProxyState {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password_set: boolean;
}

export interface NetworkProxyTestResult {
  success: boolean;
  status: number | null;
  elapsed_ms: number;
  error: string | null;
}
