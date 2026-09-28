import { describe, expect, it } from 'vitest';

import type { Song } from '../types';
import { shouldShowPlayerFooter } from './appShellFooterState';

/** 组装测试曲目：字段取值与真实 Song 结构保持一致 */
const buildSong = (path: string): Song => ({
  path,
  name: 'demo.flac', title: 'Demo', artist: 'Artist',
  artist_names: ['Artist'], effective_artist_names: ['Artist'],
  album: 'Album', album_artist: 'Artist', album_key: 'album::artist',
  is_various_artists_album: false, collapse_artist_credits: false,
  duration: 180,
});

describe('player footer visibility state', () => {
  it('keeps the footer visible for an external song playing outside the library queue', () => {
    expect(shouldShowPlayerFooter([], buildSong('C:\\Downloads\\demo.flac'))).toBe(true);
  });
});
