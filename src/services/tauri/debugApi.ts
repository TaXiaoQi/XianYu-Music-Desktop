import { tauriInvoke } from './invoke';

export const debugApi = {
  writeLogExport: (filePath: string, content: string) => (
    tauriInvoke('write_text_file', { content, destPath: filePath })
  ),
};
