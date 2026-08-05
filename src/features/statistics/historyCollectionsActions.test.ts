import { describe, expect, it, vi } from 'vitest';

const { historyFavorites, useCollectionsActions } = vi.hoisted(() => ({
  historyFavorites: {
    isFavorite: vi.fn(),
    toggleFavorite: vi.fn(),
    addToHistory: vi.fn(),
    removeFromHistory: vi.fn(),
    clearHistory: vi.fn(),
    clearFavorites: vi.fn(),
  },
  useCollectionsActions: vi.fn(() => ({ createPlaylist: vi.fn() })),
}));

vi.mock('./playerHistoryFavorites', () => ({
  createPlayerHistoryFavorites: () => historyFavorites,
}));

vi.mock('../collections/useCollectionsActions', () => ({
  useCollectionsActions,
}));

import { createHistoryCollectionsActions } from './historyCollectionsActions';

describe('history collections actions', () => {
  it('combines playlist collection actions with history favorites actions', () => {
    const playerPlaylist = {
      createPlaylist: vi.fn(),
      deletePlaylist: vi.fn(),
      addToPlaylist: vi.fn(),
      removeFromPlaylist: vi.fn(),
      addSongsToPlaylist: vi.fn(),
      viewPlaylist: vi.fn(),
      getSongsFromPlaylist: vi.fn(() => []),
      openAddToPlaylistDialog: vi.fn(),
    };

    const actions = createHistoryCollectionsActions({ playerPlaylist });

    expect(actions).toEqual({
      createPlaylist: expect.any(Function),
      ...historyFavorites,
    });
    expect(useCollectionsActions).toHaveBeenCalledWith({
      playerPlaylist,
    });
  });
});
