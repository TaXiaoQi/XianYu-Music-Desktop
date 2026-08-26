import { describe, expect, it } from 'vitest';

import {
  deriveLxAlbumResults,
  deriveLxArtistResults,
  normalizeLxPlaylistResults,
  type LxSearchResultItem,
} from './lxMusicSdk';
import searchSource from '../../views/Search.vue?raw';

function song(overrides: Partial<LxSearchResultItem>): LxSearchResultItem {
  return {
    name: 'Song',
    singer: 'Artist',
    albumName: 'Album',
    albumId: 'album-1',
    songmid: 'song-1',
    source: 'wy',
    interval: '03:00',
    img: 'https://example.com/cover.jpg',
    types: [],
    _types: {},
    ...overrides,
  };
}

describe('LX catalog search adapters', () => {
  it('splits and deduplicates artists from LX track metadata', () => {
    const result = deriveLxArtistResults([
      song({ singer: 'Alice、Bob' }),
      song({ singer: 'Alice' }),
    ]);

    expect(result.map(item => item.name)).toEqual(['Alice', 'Bob']);
    expect(result[0].songCount).toBe(2);
  });

  it('deduplicates albums by source album id', () => {
    const result = deriveLxAlbumResults([
      song({ songmid: 'song-1' }),
      song({ songmid: 'song-2' }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'Album', artist: 'Artist', songCount: 2 });
  });

  it('normalizes playlist fields returned by different LX providers', () => {
    const result = normalizeLxPlaylistResults('kg', [
      {
        specialid: 42,
        specialname: '<em>Daily Mix</em>',
        img: 'https://example.com/list.jpg',
        nickname: 'Creator',
        song_count: 18,
        play_count: 99,
      },
    ]);

    expect(result[0]).toMatchObject({
      id: 'kg:playlist:42',
      title: 'Daily Mix',
      artist: 'Creator',
      trackCount: 18,
      playCount: 99,
    });
  });

  it('accepts Kuwo uppercase ids and upgrades protocol-relative covers', () => {
    const result = normalizeLxPlaylistResults('kw', [{
      ID: 'kw-list',
      NAME: 'Kuwo List',
      PIC: '//img.example.com/list.jpg',
      SONGNUM: '20',
    }]);

    expect(result[0]).toMatchObject({
      id: 'kw:playlist:kw-list',
      coverUrl: 'https://img.example.com/list.jpg',
      trackCount: 20,
    });
  });

  it('routes LX artist, album, and playlist tabs through catalog search', () => {
    expect(searchSource).toContain("lxCatalogSearch(source.lxSourceId, query, 'artist', 1)");
    expect(searchSource).toContain("lxCatalogSearch(source.lxSourceId, query, 'album', 1)");
    expect(searchSource).toContain("lxCatalogSearch(source.lxSourceId, query, 'playlist', 1)");
    expect(searchSource).not.toContain('该类型搜索功能开发中');
  });
});
