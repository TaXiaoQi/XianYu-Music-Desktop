import { tauriInvoke } from './invoke';

export const debugApi = {
  writeLogExport: (filePath: string, content: string) => (
    tauriInvoke('save_download_lyrics', { content, destPath: filePath })
  ),
};
