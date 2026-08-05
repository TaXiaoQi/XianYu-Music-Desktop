import { historyApi } from '../../services/tauri/historyApi';

export const createStatisticsCleanup = () => {
  const removeSongsFromHistoryAndStatistics = (songPaths: string[]) =>
    historyApi.removeSongsFromHistoryAndStatistics(songPaths);

  return {
    removeSongsFromHistoryAndStatistics,
  };
};
