import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useCollectionsStore } from '../collections/store';
import { useLibraryStore } from './store';
import { createLibrarySortingActions } from './librarySortingActions';

describe('library sorting actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('updates custom library ordering and switches sort mode to custom', () => {
    const libraryStore = useLibraryStore();
    const actions = createLibrarySortingActions();

    libraryStore.localSortMode = 'title';
    libraryStore.folderSortMode = 'name';

    actions.updateLocalOrder(['song-b', 'song-a']);
    actions.updateFolderOrder('C:\\Music', ['folder-song-b', 'folder-song-a']);

    expect(libraryStore.localCustomOrder).toEqual(['song-b', 'song-a']);
    expect(libraryStore.localSortMode).toBe('custom');
    expect(libraryStore.folderCustomOrder).toEqual({
      'C:\\Music': ['folder-song-b', 'folder-song-a'],
    });
    expect(libraryStore.folderSortMode).toBe('custom');
  });

  it('updates playlist sort mode through collections store', () => {
    const collectionsStore = useCollectionsStore();
    const actions = createLibrarySortingActions();

    actions.setPlaylistSortMode('added_at_asc');

    expect(collectionsStore.playlistSortMode).toBe('added_at_asc');
  });
});
