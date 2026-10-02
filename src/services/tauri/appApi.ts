import { tauriInvoke } from './invoke'; // 实现

export const appApi = { // 实现
  clearAllAppData: (confirm = true) => tauriInvoke('clear_all_app_data', { confirm }),
  clearCoverCache: () => tauriInvoke('clear_cover_cache'), // 实现
  openExternalProgram: (path: string, args: string[] = []) => // 实现
    tauriInvoke('open_external_program', { path, args }), // 实现
  registerExternalProgram: () => tauriInvoke('register_external_program') as Promise<string>,
  consumePendingOpenPaths: () => tauriInvoke('consume_pending_open_paths'), // 实现
  consumePendingDeepLinks: () => tauriInvoke('consume_pending_deep_links'),
  openDevtools: () => tauriInvoke('open_devtools'),
  exitApp: () => tauriInvoke('exit_app'),
  getInstallLanguage: () => tauriInvoke('get_install_language'),
  setInstallLanguage: (language: string) =>
    tauriInvoke('set_install_language', { language }),
  setLaunchOnStartup: (enabled: boolean) => tauriInvoke('set_launch_on_startup', { enabled }),
  getLaunchOnStartup: () => tauriInvoke('get_launch_on_startup'),
  setAudioFileAssociations: (enabled: string[], disabled: string[]) =>
    tauriInvoke('set_audio_file_associations', { enabled, disabled }),
  getAudioFileAssociations: () => tauriInvoke('get_audio_file_associations'),
  wasLaunchedAtStartup: () => tauriInvoke('was_launched_at_startup'),
};
