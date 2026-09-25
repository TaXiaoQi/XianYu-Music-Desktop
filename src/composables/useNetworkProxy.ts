import { reactive } from 'vue';

import type { NetworkProxyConfigOptions, NetworkProxyTestResult } from '../services/tauri/contracts';
import { networkApi } from '../services/tauri/networkApi';

/**
 * 网络代理设置的前端视图状态。
 *
 * 这里刻意不做 localStorage 副本：配置的单一事实源在 Rust 侧（`app_data_dir/network-proxy.json`
 * 与 keyring 里的密码），Rust 必须在构造任何 HTTP client 之前读到它，前端存一份只会造成双写分叉。
 *
 * 模块级单例（与 `composables/toast.ts` 同款）：设置页要读写它，「音源」页的插件安装也要据此决定
 * 优先走 Rust 还是浏览器 fetch，两处必须看到同一份状态。
 */
const state = reactive({
  enabled: false,
  host: '',
  port: 0,
  username: '',
  passwordSet: false,
  loaded: false,
});

let loadPromise: Promise<void> | null = null;

const applyView = (view: {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password_set: boolean;
}) => {
  state.enabled = view.enabled;
  state.host = view.host;
  state.port = view.port;
  state.username = view.username;
  state.passwordSet = view.password_set;
  state.loaded = true;
};

/**
 * 读取一次配置（进程内只读一次，之后走缓存）。失败则下次调用重试。
 * 插件安装等「先判断要不要优先走 Rust」的场景应在动作前 await 它。
 */
export function ensureNetworkProxyLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = networkApi
      .getNetworkProxy()
      .then(applyView)
      .catch((error) => {
        loadPromise = null;
        throw error;
      });
  }
  return loadPromise;
}

/** 同步取用：未加载完成时按「未启用代理」处理（即不改变默认行为）。 */
export function isNetworkProxyEnabled(): boolean {
  return state.enabled;
}

export function useNetworkProxy() {
  const currentConfig = (): NetworkProxyConfigOptions => ({
    enabled: state.enabled,
    host: state.host.trim(),
    port: state.port,
    username: state.username.trim(),
  });

  /**
   * 密码三态：用户新输入 > 未填账号时顺手清除 > 其余情况保留已保存的密码。
   * 没填账号就不需要凭据，留着旧的会在 keyring 里沉淀脏数据。
   */
  const resolvePassword = (input: string): string | null => {
    if (input) return input;
    if (!state.username.trim()) return '';
    return null;
  };

  const refresh = async () => {
    loadPromise = null;
    await ensureNetworkProxyLoaded();
  };

  const save = async (passwordInput: string) => {
    await networkApi.setNetworkProxy(currentConfig(), resolvePassword(passwordInput));
    await refresh();
  };

  const test = (passwordInput: string): Promise<NetworkProxyTestResult> =>
    networkApi.testNetworkProxy(currentConfig(), resolvePassword(passwordInput));

  const restart = () => networkApi.restartApp();

  return { state, refresh, save, test, restart };
}
