import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

import type { Song } from '../../types';
import { useLibraryStore } from './store';
import { useNavigationStore } from '../../shared/stores/navigation';
import { useLibraryAllSongPathCache } from '../../composables/useLibraryAllSongPathCache';
import { usePlayerLibraryView } from './usePlayerLibraryView';

const invokeBridge = vi.hoisted(() => ({ tauriInvoke: vi.fn() }));

vi.mock('../../services/tauri/invoke', () => ({ tauriInvoke: invokeBridge.tauriInvoke }));

const settleMacroTasks = () => new Promise<void>((release) => setTimeout(release, 0));

const manualPromise = <T>() => {
  let settle!: (value: T) => void;
  const settled = new Promise<T>((resolve) => { settle = resolve; });
  return { settled, settle };
};

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    path: '/music/demo.flac', name: 'demo.flac', title: 'Demo',
    artist: 'Artist', artist_names: ['Artist'], effective_artist_names: ['Artist'],
    album: 'Album', album_artist: 'Artist', album_key: 'album::artist',
    is_various_artists_album: false, collapse_artist_credits: false, duration: 180,
    added_at: 1,
    ...overrides,
  };
}

const twoSongFixture = () => [
  makeSong({ path: '/music/first.flac', title: 'First' }),
  makeSong({ path: '/music/second.flac', title: 'Second' }),
];

const pathCacheApi = useLibraryAllSongPathCache;

const openAllSongsView = () => {
  const navigation = useNavigationStore();
  const library = useLibraryStore();
  navigation.currentViewMode = 'all';
  library.localSortMode = 'title';
  return { navigation, library };
};

describe('usePlayerLibraryView first-import refresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    pathCacheApi().clearLibraryAllSongPathCache();

    invokeBridge.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'get_library_song_paths_for_all_view') {
        return [...useLibraryStore().canonicalSongPaths];
      }
      return [];
    });
  });

  it('refreshes the all view once songs land in a previously empty library', async () => {
    openAllSongsView();

    const view = usePlayerLibraryView();
    await settleMacroTasks();

    expect(view.displaySongList.value).toEqual([]);

    const importedSong = makeSong();
    pathCacheApi().clearLibraryAllSongPathCache();
    useLibraryStore().librarySongs = [importedSong];
    await vi.waitFor(() => { expect(view.displaySongList.value.map(song => song.path)).toEqual([importedSong.path]); });
  });

  it('ignores all-view path results that arrive after the library has moved on', async () => {
    const { library } = openAllSongsView();
    const [firstSong, secondSong] = twoSongFixture();
    const pendingPaths = manualPromise<string[]>();

    library.librarySongs = [firstSong];
    invokeBridge.tauriInvoke.mockImplementationOnce(async () => pendingPaths.settled);

    const view = usePlayerLibraryView();
    await settleMacroTasks();

    library.patchLibrarySongs({ songs: [secondSong], deleted_paths: [] });
    pendingPaths.settle([firstSong.path]);

    await vi.waitFor(() => { expect(view.displaySongList.value.map(song => song.path)).toEqual([firstSong.path, secondSong.path]); });
  });

  it('drops fallback paths whose songs no longer resolve in the lookup', async () => {
    const { navigation, library } = openAllSongsView();
    const [firstSong, secondSong] = twoSongFixture();
    const pendingPaths = manualPromise<string[]>();

    library.librarySongs = [firstSong, secondSong];
    invokeBridge.tauriInvoke.mockResolvedValueOnce([firstSong.path, secondSong.path]);

    const view = usePlayerLibraryView();
    await vi.waitFor(() => { expect(view.displaySongList.value.map(song => song.path)).toEqual([firstSong.path, secondSong.path]); });

    navigation.currentViewMode = 'statistics'; await nextTick();
    invokeBridge.tauriInvoke.mockImplementationOnce(async () => pendingPaths.settled);
    library.patchLibrarySongs({ songs: [], deleted_paths: [secondSong.path] });
    navigation.currentViewMode = 'all'; await nextTick();

    await vi.waitFor(() => {
      expect(() => view.displaySongList.value.map(song => song.path)).not.toThrow();
      expect(view.displaySongList.value.map(song => song.path)).toEqual([firstSong.path]);
    });
  });
});
