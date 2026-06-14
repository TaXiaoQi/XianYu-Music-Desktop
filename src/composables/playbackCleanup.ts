import type { Ref } from 'vue';
import type { Song } from '../types';

interface PlaybackSongRefs {
  playQueue: Ref<Song[]>;
  tempQueue: Ref<Song[]>;
  currentSong: Ref<Song | null>;
}

export const removeSongPathsFromPlaybackState = (
  { playQueue, tempQueue, currentSong }: PlaybackSongRefs,
  paths: Iterable<string>,
) => {
  const removedPaths = new Set(paths);
  if (removedPaths.size === 0) {
    return;
  }

  playQueue.value = playQueue.value.filter(song => !removedPaths.has(song.path));
  tempQueue.value = tempQueue.value.filter(song => !removedPaths.has(song.path));

  if (currentSong.value && removedPaths.has(currentSong.value.path)) {
    currentSong.value = null;
  }
};
