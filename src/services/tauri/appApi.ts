import { tauriInvoke } from './invoke';

export const appApi = {
  clearAllAppData: () => tauriInvoke('clear_all_app_data'),
  clearCoverCache: () => tauriInvoke('clear_cover_cache'),
  openExternalProgram: (path: string, args: string[] = []) =>
    tauriInvoke('open_external_program', { path, args }),
  consumePendingOpenPaths: () => tauriInvoke('consume_pending_open_paths'),
};
