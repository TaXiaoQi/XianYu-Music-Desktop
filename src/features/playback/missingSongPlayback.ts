import type { Ref } from 'vue';

import { playbackApi } from '../../services/tauri/playbackApi';
import type { Song } from '../../types';
import type { createPlayerPlayback } from './playerPlayback';

interface CreateMissingSongPlaybackDeps {
  currentSong: Ref<Song | null>;
  currentSongPath: Ref<string | null>;
  isPlaying: Ref<boolean>;
  isSongLoaded: Ref<boolean>;
  currentCover: Ref<string>;
  currentCoverFull: Ref<string>;
  currentTime: Ref<number>;
  getPlayerPlayback: () => ReturnType<typeof createPlayerPlayback>;
}

export const createMissingSongPlayback = ({
  currentSong,
  currentSongPath,
  isPlaying,
  isSongLoaded,
  currentCover,
  currentCoverFull,
  currentTime,
  getPlayerPlayback,
}: CreateMissingSongPlaybackDeps) => {
  const stopPlaybackForMissingSong = async () => {
    await playbackApi.stopAudio().catch(async () => {
      await playbackApi.pauseAudio().catch(() => {});
    });
    getPlayerPlayback().stopPlaybackRuntime();
    isPlaying.value = false;
    isSongLoaded.value = false;
    currentSong.value = null;
    currentSongPath.value = null;
    currentTime.value = 0;
    currentCover.value = '';
    currentCoverFull.value = '';
  };

  return {
    stopPlaybackForMissingSong,
  };
};
