import type { Song } from '../../types';
import type { PlaySongOptions } from './playbackDomain';
import type { createPlayerPlayback } from './playerPlayback';
import type { createPlayerQueue } from './playerQueue';

interface CreatePlaybackCoreActionsDeps {
  getPlayerPlayback: () => ReturnType<typeof createPlayerPlayback>;
  getPlayerQueue: () => ReturnType<typeof createPlayerQueue>;
}

export const createPlaybackCoreActions = ({
  getPlayerPlayback,
  getPlayerQueue,
}: CreatePlaybackCoreActionsDeps) => {
  const playSong = (song: Song, options: PlaySongOptions = {}) =>
    getPlayerPlayback().playSong(song, options);

  const togglePlay = () =>
    getPlayerPlayback().togglePlay();

  const nextSong = () => {
    getPlayerQueue().nextSong();
  };

  const prevSong = () => {
    getPlayerQueue().prevSong();
  };

  const seekTo = (time: number) =>
    getPlayerPlayback().seekTo(time);

  const stopPlayback = () =>
    getPlayerPlayback().stopPlaybackRuntime();

  return {
    playSong,
    togglePlay,
    nextSong,
    prevSong,
    seekTo,
    stopPlayback,
  };
};
