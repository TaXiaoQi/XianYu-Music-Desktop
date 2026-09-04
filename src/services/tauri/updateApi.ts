import { tauriInvoke } from './invoke';

export const updateApi = {
  checkUpdateByRust: (owner: string, repo: string) =>
    tauriInvoke('check_update_by_rust', { owner, repo }),
  downloadUpdateFile: (url: string) =>
    tauriInvoke('download_update_file', { url }) as Promise<string>,
  runInstaller: (path: string) =>
    tauriInvoke('run_installer', { path }),
  isStoreBuild: () => tauriInvoke('is_store_build'),
};
