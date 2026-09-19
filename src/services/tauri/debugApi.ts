import { tauriInvoke } from './invoke';
import type { SaveDialogFilterContract } from './downloadApi';

const LOG_EXPORT_FILTER: SaveDialogFilterContract = { name: '日志文件', extensions: ['log', 'txt'] };

export const debugApi = {
  writeLogExport: (defaultFileName: string, content: string) => (
    tauriInvoke('save_text_via_dialog', {
      defaultFileName,
      filter: LOG_EXPORT_FILTER,
      content,
    }) as Promise<string | null>
  ),
};
