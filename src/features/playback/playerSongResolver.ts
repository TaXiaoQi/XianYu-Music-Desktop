import type { Song } from '../../types';
import { useLibraryStore } from '../library/store';
import { usePlaybackStore } from './store';

export const createSongLookup = (fallbackSongs: Song[] = []) => {
  const libraryStore = useLibraryStore();
  const playbackStore = usePlaybackStore();
  const lookup = new Map<string, Song>();

  for (const song of fallbackSongs) {
    if (song?.path && !lookup.has(song.path)) {
      lookup.set(song.path, song);
    }
  }

  const activeSongs = [
    ...(playbackStore.playQueue || []),
    ...(playbackStore.tempQueue || []),
    ...(playbackStore.currentSong ? [playbackStore.currentSong] : []),
  ];
  for (const song of activeSongs) {
    if (song?.path && !lookup.has(song.path)) {
      lookup.set(song.path, song);
    }
  }

  libraryStore.canonicalSongs.forEach((song) => {
    lookup.set(song.path, song);
  });

  return lookup;
};

export const resolveSongsFromPaths = (paths: string[], fallbackSongs: Song[] = []) => {
  const libraryStore = useLibraryStore();
  return libraryStore.resolveSongsByPaths(paths, fallbackSongs);
};
