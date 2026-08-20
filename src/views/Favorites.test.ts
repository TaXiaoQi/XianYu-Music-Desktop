import { describe, expect, it } from 'vitest';

import favoritesHeaderSource from '../components/headers/FavoritesHeader.vue?raw';
import favoritesSource from './Favorites.vue?raw';

describe('favorites view', () => {
  it('switches between songs and collection tabs', () => {
    expect(favoritesSource).toContain('favTab === \'songs\'');
    expect(favoritesSource).toContain('favTab === \'playlists\'');
    expect(favoritesSource).toContain('<FavoriteCollectionsGrid');
    expect(favoritesSource).toContain('favoritePlaylistEntries');
    expect(favoritesSource).toContain('favoriteAlbumEntries');
  });

  it('exposes song-level actions only for the songs tab', () => {
    expect(favoritesHeaderSource).toContain('favTab === \'songs\'');
    expect(favoritesHeaderSource).toContain("favTab = 'songs'");
    expect(favoritesHeaderSource).toContain("favTab = 'playlists'");
    expect(favoritesHeaderSource).toContain("favTab = 'albums'");
  });
});
