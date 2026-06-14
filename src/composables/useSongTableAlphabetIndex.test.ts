import { ref, type Ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FolderNode, Song } from '../types';
import { usePlaybackStore } from '../features/playback/store';
import { useSongTableAlphabetIndex } from './useSongTableAlphabetIndex';

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>();
  return {
    ...actual,
    onUnmounted: vi.fn(),
  };
});

const makeSong = (path: string): Song => ({
  path,
  name: path.split('/').pop() || 'demo.flac',
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
});

const mountAlphabetIndex = (currentViewMode: Ref<string>) => {
  const songs = ref([makeSong('/music/demo.flac'), makeSong('/music/next.flac')]);
  const result = useSongTableAlphabetIndex({
    songs,
    scrollTop: ref(144),
    containerHeight: ref(600),
    containerRef: ref(null),
    rootRef: ref(null),
    routePath: ref('/'),
    currentViewMode,
    localSortMode: ref('title'),
    folderSortMode: ref('title'),
    activeRootPath: ref(null),
    currentFolderFilter: ref(''),
    folderTree: ref<FolderNode[]>([]),
    refreshFolder: async () => undefined,
    expandFolderPath: async () => undefined,
  });

  return {
    result,
    unmount: () => undefined,
  };
};

describe('useSongTableAlphabetIndex', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it.each(['playlist', 'artist', 'album'])(
    'shows scroll-to-top button in %s detail view after scrolling past the first row',
    (viewMode) => {
      const { result, unmount } = mountAlphabetIndex(ref(viewMode));

      expect(result.showScrollToTopButton.value).toBe(true);

      unmount();
    },
  );

  it.each(['playlist', 'artist', 'album'])(
    'keeps locate-current-song available in %s detail view when the current song is in the list',
    (viewMode) => {
      usePlaybackStore().currentSong = makeSong('/music/demo.flac');

      const { result, unmount } = mountAlphabetIndex(ref(viewMode));

      expect(result.canLocateCurrentSong.value).toBe(true);

      unmount();
    },
  );
});
