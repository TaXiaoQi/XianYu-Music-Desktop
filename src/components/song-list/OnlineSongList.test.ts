import { describe, expect, it } from 'vitest';

import onlineSongListSource from './OnlineSongList.vue?raw';
import searchSource from '../../views/Search.vue?raw';

describe('online song list header', () => {
  it('keeps song numbering but removes the heading row from online detail lists', () => {
    expect(onlineSongListSource).toContain('{{ index + 1 }}');
    expect(onlineSongListSource).not.toContain('<thead');
  });

  it('shows the search result heading row only for the local source', () => {
    expect(searchSource).toContain('<thead v-if="isLocalSource"');
    expect(searchSource).not.toContain('<th v-if="isLocalSource"');
    expect(searchSource).not.toContain('<td v-if="isLocalSource"');
  });
});
