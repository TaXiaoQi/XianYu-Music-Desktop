import { describe, expect, it } from 'vitest';

import onlineSongListSource from './OnlineSongList.vue?raw';
import searchSource from '../../views/Search.vue?raw';

describe('online song list header', () => {
  it('keeps song numbering but removes the heading row from online detail lists', () => {
    expect(onlineSongListSource).toContain('{{ index + 1 }}');
    expect(onlineSongListSource).not.toContain('<thead');
  });

  it('uses SongTable as the container for the online track search list', () => {
    // 音乐 tab 使用 SongTable 作为容器，内容仍为在线搜索结果（onlineTrackSongs）
    expect(searchSource).toContain('<SongTable');
    expect(searchSource).toContain('onlineTrackSongs');
    expect(searchSource).not.toContain('myPlaylistsSongs');
    expect(searchSource).not.toContain('<thead');
    expect(searchSource).not.toContain('<th v-if="isLocalSource"');
    expect(searchSource).not.toContain('<td v-if="isLocalSource"');
  });
});
