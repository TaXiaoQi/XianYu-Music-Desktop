import { describe, expect, it } from 'vitest';
import { isRemoteSong } from './remoteSong';

describe('isRemoteSong', () => {
  it('returns true for songs marked as remote by source_type', () => {
    expect(isRemoteSong({ path: 'C:/Music/demo.flac', source_type: 'remote' })).toBe(true);
  });

  it('returns true for remote uri songs without source_type', () => {
    expect(isRemoteSong({ path: 'remote://source/demo.flac' })).toBe(true);
  });

  it('returns false for local songs', () => {
    expect(isRemoteSong({ path: 'C:/Music/demo.flac', source_type: 'local' })).toBe(false);
  });
});
