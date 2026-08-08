import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

vi.mock('../../router', () => ({
  default: {
    currentRoute: ref({
      path: '/',
      query: {},
    }),
    push: vi.fn().mockResolvedValue(undefined),
    replace: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/storage/playerStorage', () => ({
  playerStorage: {
    remove: vi.fn(),
  },
}));

vi.mock('../../services/tauri/historyApi', () => ({
  historyApi: {
    addToHistory: vi.fn().mockResolvedValue(undefined),
    removeFromRecentHistory: vi.fn().mockResolvedValue(undefined),
    clearRecentHistory: vi.fn().mockResolvedValue(undefined),
  },
}));

import { playerStorage } from '../../services/storage/playerStorage';
import { historyApi } from '../../services/tauri/historyApi';
import router from '../../router';
import type { Song } from '../../types';
import { useAddToPlaylistDialog } from './addToPlaylistDialog';
import { useCollectionsStore } from './store';
import { useLibraryStore } from '../library/store';
import { useLibraryCollections } from './useLibraryCollections';

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  path: '/music/demo.flac',
  name: 'demo.flac',
  title: 'Demo',
  artist: 'Artist',
  artist_names: ['Artist'],
  effective_artist_names: ['Artist'],
  album: 'Album',
  album_artist: 'Artist',
  album_key: 'album::artist',
  is_various_artists_album: false,
  collapse_artist_credits: false,
  duration: 180,
  ...overrides,
});

describe('library collections domain', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    useAddToPlaylistDialog().closeAddToPlaylistDialog();
    (router.currentRoute as any).value = {
      path: '/',
      query: {},
    };
  });

  it('returns to home when deleting the currently opened playlist', () => {
    const collectionsStore = useCollectionsStore();
    const { createPlaylist, deletePlaylist } = useLibraryCollections();

    const playlistId = createPlaylist('Daily Mix', ['/music/a.flac']);
    expect(playlistId).toBeTruthy();

    (router.currentRoute as any).value = {
      path: '/',
      query: {
        view: 'playlist',
        filter: playlistId!,
      },
    };

    const deleted = deletePlaylist(playlistId!);

    expect(deleted).toBe(true);
    expect(collectionsStore.playlists).toEqual([]);
    expect(router.replace).toHaveBeenCalledWith({
      path: '/',
      query: {
        view: 'all',
      },
    });
  });

  it('opens playlists through the shared router navigation helper', async () => {
    const { createPlaylist, viewPlaylist } = useLibraryCollections();
    const playlistId = createPlaylist('Daily Mix', ['/music/a.flac']);

    viewPlaylist(playlistId!);
    await Promise.resolve();

    expect(router.push).toHaveBeenCalledWith({
      path: '/',
      query: {
        view: 'playlist',
        filter: playlistId!,
      },
    });
  });

  it('dedupes playlist additions and opens the add-to-playlist modal through feature dialog state', () => {
    const collectionsStore = useCollectionsStore();
    const dialog = useAddToPlaylistDialog();
    const { createPlaylist, addSongsToPlaylist, openAddToPlaylistDialog } = useLibraryCollections();

    const playlistId = createPlaylist('Daily Mix', ['/music/a.flac']);
    const added = addSongsToPlaylist(playlistId!, ['/music/a.flac', '/music/b.flac', '/music/b.flac']);
    openAddToPlaylistDialog('/music/c.flac');

    expect(added).toBe(1);
    expect(collectionsStore.playlists[0]?.songPaths).toEqual(['/music/a.flac', '/music/b.flac']);
    expect(dialog.playlistAddTargetSongs.value).toEqual(['/music/c.flac']);
    expect(dialog.showAddToPlaylistModal.value).toBe(true);
  });

  it('updates favorites and recent history while forwarding persistence side effects', async () => {
    const collectionsStore = useCollectionsStore();
    const { toggleFavorite, addToHistory, removeFromHistory, clearHistory } = useLibraryCollections();
    const firstSong = makeSong({ path: '/music/first.flac', title: 'First' });
    const secondSong = makeSong({ path: '/music/second.flac', title: 'Second' });

    expect(toggleFavorite(firstSong)).toBe(true);
    expect(toggleFavorite(firstSong)).toBe(false);

    await addToHistory(firstSong);
    await addToHistory(secondSong);
    await removeFromHistory([firstSong.path]);
    await clearHistory();

    expect(collectionsStore.favoritePaths).toEqual([]);
    expect(historyApi.addToHistory).toHaveBeenNthCalledWith(1, firstSong.path);
    expect(historyApi.addToHistory).toHaveBeenNthCalledWith(2, secondSong.path);
    expect(historyApi.removeFromRecentHistory).toHaveBeenCalledWith([firstSong.path]);
    expect(historyApi.clearRecentHistory).toHaveBeenCalledTimes(1);
    expect(playerStorage.remove).toHaveBeenCalled();
    expect(collectionsStore.recentSongs).toEqual([]);
  });

  it('persists online song metadata into recent history and extra song pool', async () => {
    const collectionsStore = useCollectionsStore();
    const libraryStore = useLibraryStore();
    const { addToHistory } = useLibraryCollections();
    const onlineSong = makeSong({
      path: 'lx://kg/abc123',
      name: 'Online Song',
      title: 'Online Song',
      artist: 'Online Artist',
    });

    await addToHistory(onlineSong);

    expect(collectionsStore.recentSongs.map(item => item.path)).toEqual([onlineSong.path]);
    expect(collectionsStore.recentSongMeta[onlineSong.path]).toMatchObject({ path: onlineSong.path });
    expect(libraryStore.getSongByPath(onlineSong.path)).toMatchObject({ path: onlineSong.path });
    expect(historyApi.addToHistory).toHaveBeenCalledWith(onlineSong.path);
  });

  it('keeps extra song metadata when a removed recent song is still favorited', async () => {
    const collectionsStore = useCollectionsStore();
    const libraryStore = useLibraryStore();
    const { toggleFavorite, addToHistory, removeFromHistory } = useLibraryCollections();
    const onlineSong = makeSong({
      path: 'lx://kg/shared',
      name: 'Shared Online',
      title: 'Shared Online',
      artist: 'Online Artist',
    });

    expect(toggleFavorite(onlineSong)).toBe(true);
    await addToHistory(onlineSong);
    await removeFromHistory([onlineSong.path]);

    // recent 元信息被清理，但仍被收藏，extraSong 不应被误删
    expect(collectionsStore.recentSongMeta[onlineSong.path]).toBeUndefined();
    expect(collectionsStore.recentSongs).toEqual([]);
    expect(libraryStore.getSongByPath(onlineSong.path)).toMatchObject({ path: onlineSong.path });
  });

  it('drops extra song metadata when a removed recent song is not favorited', async () => {
    const collectionsStore = useCollectionsStore();
    const libraryStore = useLibraryStore();
    const { addToHistory, removeFromHistory } = useLibraryCollections();
    const onlineSong = makeSong({
      path: 'lx://kg/orphan',
      name: 'Orphan Online',
      title: 'Orphan Online',
    });

    await addToHistory(onlineSong);
    await removeFromHistory([onlineSong.path]);

    expect(collectionsStore.recentSongMeta[onlineSong.path]).toBeUndefined();
    expect(libraryStore.getSongByPath(onlineSong.path)).toBeNull();
  });
});
