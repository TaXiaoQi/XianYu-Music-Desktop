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
  /** 获取日/周/总三个周期的听歌时长（秒），用于排行榜分周期上报 */
  getListenDurations: (): Promise<ListenDurations> =>
    tauriInvoke('get_listen_durations'),
  /** 将云端累计总听歌时长合并进本地（取较大值），返回合并后本地总时长与是否被抬高 */
  mergeCloudListenDuration: (totalSeconds: number): Promise<CloudMergeResult> =>
    tauriInvoke('merge_cloud_listen_duration', { totalSeconds }),
  /** 导出本地听歌时长快照（累计听歌时长跨端同步用），返回 JSON 字符串 */
  exportListenSnapshot: (): Promise<string> => tauriInvoke('export_listen_snapshot'),
  /**
   * 将云端听歌时长快照合并进本地。
   * mode 为 'add'（累计相加）或 'max'（取较大值）。
   * 返回合并后本地 total_play_time_ms / total_play_count。
   */
  mergeListenSnapshot: (
    snapshotJson: string,
    mode: 'add' | 'max',
  ): Promise<{ total_play_time_ms: number; total_play_count: number }> =>
    tauriInvoke('merge_listen_snapshot', { snapshotJson, mode }),
  /** 清零本地听歌时长统计（管理端处分） */
  clearListenStats: (): Promise<void> => tauriInvoke('clear_listen_stats'),
  getQualityDistribution: (): Promise<QualityDistribution> =>
    tauriInvoke('get_quality_distribution'),
  getFormatDistribution: (): Promise<FormatDistribution> =>
    tauriInvoke('get_format_distribution'),
  /** 重置所有本地听歌统计数据（播放历史、聚合统计等），从零开始 */
  resetLocalStatistics: (): Promise<void> =>
    tauriInvoke('reset_local_statistics'),
};
