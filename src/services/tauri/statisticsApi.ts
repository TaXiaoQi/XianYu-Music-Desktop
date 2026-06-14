import type {
  StatisticsExportResult,
  StatisticsImportPreview,
  StatisticsImportResult,
} from './contracts';
import { tauriInvoke } from './invoke';

export type StatisticsImportMode = 'overwrite' | 'merge';

export const statisticsApi = {
  exportStatisticsFile: (filePath: string, includeRecentPlays: boolean) =>
    tauriInvoke('export_statistics_file', {
      options: { filePath, includeRecentPlays },
    }) as Promise<StatisticsExportResult>,
  previewStatisticsImport: (filePath: string) =>
    tauriInvoke('preview_statistics_import', {
      options: { filePath },
    }) as Promise<StatisticsImportPreview>,
  importStatisticsFile: (
    filePath: string,
    mode: StatisticsImportMode,
    continueDuplicateImport = false,
  ) =>
    tauriInvoke('import_statistics_file', {
      options: {
        filePath,
        mode,
        continueDuplicateImport,
      },
    }) as Promise<StatisticsImportResult>,
};
