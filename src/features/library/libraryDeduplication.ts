import type { Song } from '../../types';

export const dedupePaths = (paths: string[]) =>
  Array.from(new Set(paths.map(path => path.trim()).filter(Boolean)));

export const dedupeSongs = (songs: Song[]) => {
  const seen = new Set<string>();

  return songs.filter(song => {
    if (seen.has(song.path)) {
      return false;
    }

    seen.add(song.path);
    return true;
  });
};
