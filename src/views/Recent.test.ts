import { describe, expect, it } from 'vitest';

import recentHeaderSource from '../components/headers/RecentHeader.vue?raw';
import recentSource from './Recent.vue?raw';

describe('recent view', () => {
  it('renders songs only without collection tabs', () => {
    expect(recentSource).toContain('<SongTable');
    expect(recentSource).not.toContain('recentTab');
    expect(recentSource).not.toContain('<RecentCollectionGrid');
  });

  it('keeps only song-level actions in the header', () => {
    expect(recentHeaderSource).not.toContain('recentTab');
    expect(recentHeaderSource).toContain('playAll');
    expect(recentHeaderSource).toContain('clearHistory');
    expect(recentHeaderSource).toContain('addAllToQueue');
  });
});
