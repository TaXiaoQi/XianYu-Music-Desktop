import { describe, expect, it, vi } from 'vitest';

import { historyApi as historyApiModule } from './historyApi';

// 拦截 invoke 收口层，核对命令名与载荷是否原样透传。
const { callTauriDouble } = vi.hoisted(() => ({
  callTauriDouble: vi.fn(),
}));

vi.mock('./invoke', () => ({ tauriInvoke: callTauriDouble }));

describe('historyApi 与后端命令的对接', () => {
  it('removeSongsFromHistoryAndStatistics 按原样转发命令名与 songPaths 载荷', () => {
    callTauriDouble.mockReset();
    const removedPaths = ['C:\\Music\\removed.flac'];
    const { removeSongsFromHistoryAndStatistics } = historyApiModule;

    removeSongsFromHistoryAndStatistics(removedPaths);

    expect(callTauriDouble).toHaveBeenCalledWith('remove_songs_from_history_and_statistics', {
      songPaths: removedPaths,
    });
  });
});
