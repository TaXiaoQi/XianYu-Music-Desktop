import { describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Song } from '../../types';
import { useLibraryStore } from './store';

// 缺省歌曲样例：字段与后端返回的数据规格一致，用例可按需覆盖。
const SONG_SAMPLE = { path: '/music/demo.flac', name: 'demo.flac', title: 'Demo', artist: 'Artist', artist_names: ['Artist'], effective_artist_names: ['Artist'], album: 'Album', album_artist: 'Artist', album_key: 'album::artist', is_various_artists_album: false, collapse_artist_credits: false, duration: 180 };

const buildSong = (overrides: Partial<Song> = {}): Song => ({ ...SONG_SAMPLE, ...overrides });

describe('library store', () => {
  // 每个用例都从全新的 pinia 容器开始，避免状态串扰。
  const freshStore = () => {
    setActivePinia(createPinia());
    return useLibraryStore();
  };

  it('increments data version when canonical songs are changed through the legacy setter', () => {
    const store = freshStore();
    const baseline = store.libraryDataVersion;

    store.librarySongs = [buildSong()];

    expect(store.libraryDataVersion).toBeGreaterThan(baseline);
  });
});
