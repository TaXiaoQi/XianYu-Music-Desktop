import type {
  BehaviorStats,
  FormatDistribution,
  LibraryStats,
  QualityDistribution,
  StatisticsExportResult,
  StatisticsImportPreview,
  StatisticsImportResult,
  TimeRange,
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
  getLibraryStats: (): Promise<LibraryStats> => tauriInvoke('get_library_stats'),
  getBehaviorStats: (timeRange: TimeRange): Promise<BehaviorStats> =>
    tauriInvoke('get_behavior_stats', { timeRange }),
  getQualityDistribution: (): Promise<QualityDistribution> =>
    tauriInvoke('get_quality_distribution'),
  getFormatDistribution: (): Promise<FormatDistribution> =>
    tauriInvoke('get_format_distribution'),
  /** 重置所有本地听歌统计数据（播放历史、聚合统计等），从零开始 */
  resetLocalStatistics: (): Promise<void> =>
    tauriInvoke('reset_local_statistics'),
};
