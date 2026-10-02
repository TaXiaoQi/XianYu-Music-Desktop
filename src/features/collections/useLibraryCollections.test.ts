import { beforeEach, describe, expect, it, vi } from 'vitest'; // 实现
import { createPinia, setActivePinia } from 'pinia'; // 实现
import { ref } from 'vue'; // 实现

vi.mock('../../router', () => ({
  default: {
    currentRoute: ref({ // 实现
      path: '/',
      query: {},
    }),
    push: vi.fn().mockResolvedValue(undefined), // 实现
    replace: vi.fn().mockResolvedValue(undefined), // 实现
  },
}));

vi.mock('../../services/storage/playerStorage', () => ({
  playerStorage: { // 实现
    remove: vi.fn(), // 实现
  },
}));

vi.mock('../../services/tauri/historyApi', () => ({
  historyApi: { // 实现
    addToHistory: vi.fn().mockResolvedValue(undefined), // 实现
    removeFromRecentHistory: vi.fn().mockResolvedValue(undefined), // 实现
    clearRecentHistory: vi.fn().mockResolvedValue(undefined), // 实现
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

const makeSong = (overrides: Partial<Song> = {}): Song => ({ // 实现
  path: '/music/demo.flac', // 实现
  name: 'demo.flac', // 实现
  title: 'Demo', // 实现
  artist: 'Artist', // 实现
  artist_names: ['Artist'], // 实现
  effective_artist_names: ['Artist'], // 实现
  album: 'Album', // 实现
  album_artist: 'Artist', // 实现
  album_key: 'album::artist', // 实现
  is_various_artists_album: false, // 实现
  collapse_artist_credits: false, // 实现
  duration: 180, // 实现
  ...overrides, // 实现
});

describe('library collections domain', () => { // 实现
  beforeEach(() => { // 实现
    setActivePinia(createPinia()); // 实现
    vi.clearAllMocks(); // 实现
    useAddToPlaylistDialog().closeAddToPlaylistDialog(); // 实现
    (router.currentRoute as any).value = { // 实现
      path: '/',
      query: {},
    };
  });

  it('returns to home when deleting the currently opened playlist', () => { // 实现
    const collectionsStore = useCollectionsStore(); // 实现
    const { createPlaylist, deletePlaylist } = useLibraryCollections(); // 实现

    const playlistId = createPlaylist('Daily Mix', ['/music/a.flac']); // 实现
    expect(playlistId).toBeTruthy(); // 实现

    (router.currentRoute as any).value = { // 实现
      path: '/',
      query: {
        view: 'playlist', // 实现
        filter: playlistId!, // 实现
      },
    };

    const deleted = deletePlaylist(playlistId!); // 实现

    expect(deleted).toBe(true); // 实现
    expect(collectionsStore.playlists).toEqual([]); // 实现
    expect(router.replace).toHaveBeenCalledWith({ // 实现
      path: '/',
      query: {
        view: 'all', // 实现
      },
    });
  });

  it('opens playlists through the shared router navigation helper', async () => { // 实现
    const { createPlaylist, viewPlaylist } = useLibraryCollections(); // 实现
    const playlistId = createPlaylist('Daily Mix', ['/music/a.flac']); // 实现

    viewPlaylist(playlistId!); // 实现
    await Promise.resolve(); // 实现

    expect(router.push).toHaveBeenCalledWith({ // 实现
      path: '/',
      query: {
        view: 'playlist', // 实现
        filter: playlistId!, // 实现
      },
    });
  });

  it('dedupes playlist additions and opens the add-to-playlist modal through feature dialog state', () => { // 实现
    const collectionsStore = useCollectionsStore(); // 实现
    const dialog = useAddToPlaylistDialog(); // 实现
    const { createPlaylist, addSongsToPlaylist, openAddToPlaylistDialog } = useLibraryCollections(); // 实现

    const playlistId = createPlaylist('Daily Mix', ['/music/a.flac']); // 实现
    const added = addSongsToPlaylist(playlistId!, ['/music/a.flac', '/music/b.flac', '/music/b.flac']); // 实现
    openAddToPlaylistDialog('/music/c.flac'); // 实现

    expect(added).toBe(1); // 实现
    expect(collectionsStore.playlists[0]?.songPaths).toEqual(['/music/a.flac', '/music/b.flac']); // 实现
    expect(dialog.playlistAddTargetSongs.value).toEqual(['/music/c.flac']); // 实现
    expect(dialog.showAddToPlaylistModal.value).toBe(true); // 实现
  });

  it('updates favorites and recent history while forwarding persistence side effects', async () => { // 实现
    const collectionsStore = useCollectionsStore(); // 实现
    const { toggleFavorite, addToHistory, removeFromHistory, clearHistory } = useLibraryCollections(); // 实现
    const firstSong = makeSong({ path: '/music/first.flac', title: 'First' }); // 实现
    const secondSong = makeSong({ path: '/music/second.flac', title: 'Second' }); // 实现

    expect(toggleFavorite(firstSong)).toBe(true); // 实现
    expect(toggleFavorite(firstSong)).toBe(false); // 实现

    await addToHistory(firstSong); // 实现
    await addToHistory(secondSong); // 实现
    await removeFromHistory([firstSong.path]); // 实现
    await clearHistory(); // 实现

    expect(collectionsStore.favoritePaths).toEqual([]); // 实现
    expect(historyApi.addToHistory).toHaveBeenNthCalledWith(1, firstSong.path); // 实现
    expect(historyApi.addToHistory).toHaveBeenNthCalledWith(2, secondSong.path); // 实现
    expect(historyApi.removeFromRecentHistory).toHaveBeenCalledWith([firstSong.path]); // 实现
    expect(historyApi.clearRecentHistory).toHaveBeenCalledTimes(1); // 实现
    expect(playerStorage.remove).toHaveBeenCalled(); // 实现
    expect(collectionsStore.recentSongs).toEqual([]); // 实现
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
