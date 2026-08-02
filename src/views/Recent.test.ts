import { describe, expect, it } from 'vitest';

import recentHeaderSource from '../components/headers/RecentHeader.vue?raw';
import recentSource from './Recent.vue?raw';

describe('recent view tabs', () => {
  it('renders songs only for the songs tab and collections for the other tabs', () => {
    expect(recentSource).toContain('v-if="recentTab === \'songs\'"');
    expect(recentSource).toContain('<RecentCollectionGrid');
    expect(recentSource).toContain('recentAlbumList');
    expect(recentSource).toContain('recentPlaylistList');
  });

  it('keeps song-only actions out of album and playlist tabs', () => {
    expect(recentHeaderSource).toContain('v-if="recentTab === \'songs\'"');
  });
});
