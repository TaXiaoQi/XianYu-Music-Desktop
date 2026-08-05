import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const { historyApi, playerStorage } = vi.hoisted(() => ({
  historyApi: {
    getRecentHistory: vi.fn(),
    importRecentHistory: vi.fn(),
  },
  playerStorage: {
    readHistory: vi.fn(),
    readRecentOnlineHistory: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('../../services/tauri/historyApi', () => ({
  historyApi,
}));

vi.mock('../../services/storage/playerStorage', () => ({
  playerStorage,
}));

import { useCollectionsStore } from '../collections/store';
import { createHistoryRestore } from './historyRestore';

describe('history restore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    historyApi.getRecentHistory.mockReset();
    historyApi.importRecentHistory.mockReset();
    playerStorage.readHistory.mockReset();
    playerStorage.readRecentOnlineHistory.mockReset();
    playerStorage.remove.mockReset();
  });

  it('restores merged backend and online recent history', async () => {
    const collectionsStore = useCollectionsStore();
    playerStorage.readHistory.mockReturnValue([]);
    playerStorage.readRecentOnlineHistory.mockReturnValue([
      { path: 'lx://online', playedAt: 3000 },
    ]);
    historyApi.getRecentHistory.mockResolvedValue([
      { songPath: 'C:\\Music\\local.flac', playedAt: 2000 },
    ]);

    await createHistoryRestore({ legacyHistoryKey: 'player_history' }).restoreRecentHistory();

    expect(collectionsStore.recentSongs).toEqual([
      { path: 'lx://online', playedAt: 3000 },
      { path: 'C:\\Music\\local.flac', playedAt: 2000 },
    ]);
    expect(playerStorage.remove).toHaveBeenCalledWith('player_history');
    expect(historyApi.importRecentHistory).not.toHaveBeenCalled();
  });

  it('falls back to legacy history and imports it into backend history', async () => {
    const collectionsStore = useCollectionsStore();
    playerStorage.readHistory.mockReturnValue([
      { path: 'C:\\Music\\legacy.flac', playedAt: 5000 },
    ]);
    playerStorage.readRecentOnlineHistory.mockReturnValue([]);
    historyApi.getRecentHistory.mockResolvedValue([]);
    historyApi.importRecentHistory.mockResolvedValue(undefined);

    await createHistoryRestore({ legacyHistoryKey: 'player_history' }).restoreRecentHistory();

    expect(collectionsStore.recentSongs).toEqual([
      { path: 'C:\\Music\\legacy.flac', playedAt: 5000 },
    ]);
    expect(historyApi.importRecentHistory).toHaveBeenCalledWith([
      { songPath: 'C:\\Music\\legacy.flac', playedAt: 5 },
    ]);
    expect(playerStorage.remove).toHaveBeenCalledWith('player_history');
  });
});
