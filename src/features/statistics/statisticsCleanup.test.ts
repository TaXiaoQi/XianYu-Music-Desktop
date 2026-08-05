import { beforeEach, describe, expect, it, vi } from 'vitest';

const { historyApi } = vi.hoisted(() => ({
  historyApi: {
    removeSongsFromHistoryAndStatistics: vi.fn(),
  },
}));

vi.mock('../../services/tauri/historyApi', () => ({
  historyApi,
}));

import { createStatisticsCleanup } from './statisticsCleanup';

describe('statistics cleanup', () => {
  beforeEach(() => {
    historyApi.removeSongsFromHistoryAndStatistics.mockReset();
  });

  it('removes history and statistics for song paths', () => {
    const cleanup = createStatisticsCleanup();
    const songPaths = ['C:\\Music\\removed.flac'];

    cleanup.removeSongsFromHistoryAndStatistics(songPaths);

    expect(historyApi.removeSongsFromHistoryAndStatistics).toHaveBeenCalledWith(songPaths);
  });
});
