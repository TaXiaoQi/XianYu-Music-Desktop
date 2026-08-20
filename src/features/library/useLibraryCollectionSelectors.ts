import { computed, type ComputedRef, type Ref } from 'vue';

import type { Song } from '../../types';

interface UseLibraryCollectionSelectorsOptions {
  favoritePaths: Ref<string[]>;
  songLookup: ComputedRef<Map<string, Song>>;
}

export function useLibraryCollectionSelectors({
  favoritePaths,
  songLookup,
}: UseLibraryCollectionSelectorsOptions) {
  const favoriteSongPaths = computed(() => {
    return favoritePaths.value.filter(path => songLookup.value.has(path));
  });

  const favoriteSongList = computed(() =>
    favoriteSongPaths.value
      .map(path => songLookup.value.get(path))
      .filter((song): song is Song => !!song),
  );

  return {
    favoriteSongPaths,
    favoriteSongList,
  };
}
