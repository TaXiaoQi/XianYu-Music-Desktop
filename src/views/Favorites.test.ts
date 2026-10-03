import { describe, it } from 'vitest';

import favoritesHeaderSource from '../components/headers/FavoritesHeader.vue?raw';
import favoritesSource from './Favorites.vue?raw';
import { expectSourceContains } from '../testing/sourceText';

describe('favorites view', () => {
  it('switches between songs and collection tabs', () => {
    expectSourceContains(favoritesSource, 'favTab === \'songs\'');
    expectSourceContains(favoritesSource, 'favTab === \'playlists\'');
    expectSourceContains(favoritesSource, '<FavoriteCollectionsGrid');
    expectSourceContains(favoritesSource, 'favoritePlaylistEntries');
    expectSourceContains(favoritesSource, 'favoriteAlbumEntries');
  });

  it('exposes song-level actions only for the songs tab', () => {
    expectSourceContains(favoritesHeaderSource, 'favTab === \'songs\'');
    expectSourceContains(favoritesHeaderSource, "favTab = 'songs'");
    expectSourceContains(favoritesHeaderSource, "favTab = 'playlists'");
    expectSourceContains(favoritesHeaderSource, "favTab = 'albums'");
  });
});
