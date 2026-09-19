import type {
  BehaviorStats,
  CloudMergeResult,
  FormatDistribution,
  LibraryStats,
  ListenDurations,
  QualityDistribution,
  StatisticsExportResult,
  StatisticsImportPreview,
  StatisticsImportResult,
  TimeRange,
} from './contracts';
import { tauriInvoke } from './invoke';

export type StatisticsImportMode = 'overwrite' | 'merge';

export const statisticsApi = {
  exportStatisticsFile: (defaultFileName: string, includeRecentPlays: boolean) =>
    tauriInvoke('export_statistics_file', {
      options: { defaultFileName, includeRecentPlays },
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
  getListenDurations: (): Promise<ListenDurations> =>
    tauriInvoke('get_listen_durations'),
  mergeCloudListenDuration: (totalSeconds: number): Promise<CloudMergeResult> =>
    tauriInvoke('merge_cloud_listen_duration', { totalSeconds }),
  exportListenSnapshot: (): Promise<string> => tauriInvoke('export_listen_snapshot'),
  mergeListenSnapshot: (
    snapshotJson: string,
    mode: 'add' | 'max',
  ): Promise<{ total_play_time_ms: number; total_play_count: number }> =>
    tauriInvoke('merge_listen_snapshot', { snapshotJson, mode }),
  clearListenStats: (): Promise<void> => tauriInvoke('clear_listen_stats'),
  getQualityDistribution: (): Promise<QualityDistribution> =>
    tauriInvoke('get_quality_distribution'),
  getFormatDistribution: (): Promise<FormatDistribution> =>
    tauriInvoke('get_format_distribution'),
  resetLocalStatistics: (): Promise<void> =>
    tauriInvoke('reset_local_statistics'),
};
