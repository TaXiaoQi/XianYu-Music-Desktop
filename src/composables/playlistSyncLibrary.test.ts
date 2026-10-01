import { describe, expect, it } from 'vitest';
import { buildLibraryMatchIndex, resolveLocalPath } from './playlistSyncLibrary';
import type { Song } from '../types';

const song = (path: string, title: string, artist: string, duration: number): Song =>
  ({ path, title, name: title, artist, duration } as Song);

describe('playlist sync library matching', () => {
  it('prefers an exact local path', () => {
    const local = song('C:/Music/song.mp3', 'Song', 'Artist', 180);
    const index = buildLibraryMatchIndex([local]);

    expect(resolveLocalPath(index, local)).toBe(local.path);
  });

  it('matches cloud paths by metadata and duration', () => {
    const first = song('C:/Music/first.mp3', 'Song', 'Artist', 180);
    const second = song('C:/Music/second.mp3', 'Song', 'Artist', 240);
    const index = buildLibraryMatchIndex([first, second]);

    expect(resolveLocalPath(index, song('remote://song', 'Song', 'Artist', 240))).toBe(second.path);
  });

  it('keeps non-local cloud paths unchanged', () => {
    const index = buildLibraryMatchIndex([]);

    expect(resolveLocalPath(index, song('lx://song', 'Song', 'Artist', 180))).toBe('lx://song');
  });
});
