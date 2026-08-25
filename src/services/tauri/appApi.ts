import { tauriInvoke } from './invoke';

export const appApi = {
  clearAllAppData: (confirm = true) => tauriInvoke('clear_all_app_data', { confirm }),
  clearCoverCache: () => tauriInvoke('clear_cover_cache'),
  openExternalProgram: (path: string, args: string[] = []) =>
    tauriInvoke('open_external_program', { path, args }),
  consumePendingOpenPaths: () => tauriInvoke('consume_pending_open_paths'),
  consumePendingDeepLinks: () => tauriInvoke('consume_pending_deep_links'),
  openDevtools: () => tauriInvoke('open_devtools'),
  exitApp: () => tauriInvoke('exit_app'),
  /** 读取安装时选择的应用语言码（zh-CN / zh-TW / en-US），读不到返回 null。 */
  getInstallLanguage: () => tauriInvoke('get_install_language'),
  /** 把主程序当前语言同步到注册表，使卸载器语言跟随主程序当前语言。 */
  setInstallLanguage: (language: string) =>
    tauriInvoke('set_install_language', { language }),
};
