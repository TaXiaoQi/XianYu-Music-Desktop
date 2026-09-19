import { tauriInvoke } from './invoke';

export const appApi = {
  clearAllAppData: (confirm = true) => tauriInvoke('clear_all_app_data', { confirm }),
  clearCoverCache: () => tauriInvoke('clear_cover_cache'),
  openExternalProgram: (path: string, args: string[] = []) =>
    tauriInvoke('open_external_program', { path, args }),
  registerExternalProgram: () => tauriInvoke('register_external_program') as Promise<string>,
  consumePendingOpenPaths: () => tauriInvoke('consume_pending_open_paths'),
  consumePendingDeepLinks: () => tauriInvoke('consume_pending_deep_links'),
  openDevtools: () => tauriInvoke('open_devtools'),
  exitApp: () => tauriInvoke('exit_app'),
  getInstallLanguage: () => tauriInvoke('get_install_language'),
  setInstallLanguage: (language: string) =>
    tauriInvoke('set_install_language', { language }),
};
