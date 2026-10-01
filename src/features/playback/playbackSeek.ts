import type { Song } from '../../types';
import type { PreviewClipInfo } from './onlineFailover';

export interface SeekCompletedPayload {
  request_id: number;
  time: number;
}

interface PlaybackSeekDeps {
  getCurrentSong: () => Song | null;
  getCurrentTime: () => number;
  isPlaying: () => boolean;
  isCasting: () => boolean;
  castSeek: (time: number) => Promise<unknown>;
  seekAudio: (payload: { time: number; isPlaying: boolean; requestId: number }) => Promise<unknown>;
  accumulateForSeek: () => void;
  stopPlaybackRuntime: () => void;
  startPlaybackRuntime: () => void;
  reanchorPlaybackClock: (time: number) => void;
  getActivePreviewClip: () => PreviewClipInfo | null;
  setManagedTimeout: (callback: () => void, delay: number) => unknown;
  togglePlay: () => Promise<unknown>;
}

export const createPlaybackSeek = ({
  getCurrentSong,
  getCurrentTime,
  isPlaying,
  isCasting,
  castSeek,
  seekAudio,
  accumulateForSeek,
  stopPlaybackRuntime,
  startPlaybackRuntime,
  reanchorPlaybackClock,
  getActivePreviewClip,
  setManagedTimeout,
  togglePlay,
}: PlaybackSeekDeps) => {
  let latestSeekRequestId = 0;
  let isSeeking = false;

  const seekTo = async (newTime: number) => {
    const song = getCurrentSong();
    if (!song) return;

    accumulateForSeek();

    isSeeking = true;
    stopPlaybackRuntime();
    const trackDuration = song.duration;
    let targetTime = trackDuration > 0
      ? Math.max(0, Math.min(newTime, trackDuration))
      : Math.max(0, newTime);
    const seekPreviewClip = getActivePreviewClip();
    if (seekPreviewClip) {
      targetTime = Math.max(
        seekPreviewClip.start,
        Math.min(targetTime, seekPreviewClip.start + seekPreviewClip.duration - 0.5),
      );
    }
    const requestId = ++latestSeekRequestId;
    reanchorPlaybackClock(targetTime);

    try {
      const offsetSec = (song.cue_start_offset || 0) / 1000;
      const seekClipTime = targetTime + offsetSec - (seekPreviewClip?.start ?? 0);
      if (isCasting()) {
        await castSeek(Math.max(0, seekClipTime));
        isSeeking = false;
      } else {
        await seekAudio({
          time: Math.max(0, seekClipTime),
          isPlaying: isPlaying(),
          requestId,
        });
      }
      reanchorPlaybackClock(targetTime);
      if (isPlaying()) {
        startPlaybackRuntime();
      }
    } catch (error) {
      isSeeking = false;
      if (isPlaying()) {
        startPlaybackRuntime();
      }
      throw error;
    }
  };

  const playAt = async (time: number) => {
    await seekTo(time);
    if (!isPlaying()) {
      setManagedTimeout(() => {
        if (!isPlaying()) {
          void togglePlay().catch(error => console.warn('[Audio] playAt togglePlay failed:', error));
        }
      }, 150);
    }
  };

  const handleSeek = async (event: MouseEvent) => {
    const song = getCurrentSong();
    if (!song) return;

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    await seekTo(progress * song.duration);
  };

  const stepSeek = async (step: number) => {
    if (!getCurrentSong()) return;
    await seekTo(getCurrentTime() + step);
  };

  const handleSeekCompleted = (payload: SeekCompletedPayload) => {
    if (payload.request_id !== latestSeekRequestId) return;

    isSeeking = false;
    const offsetSec = (getCurrentSong()?.cue_start_offset || 0) / 1000;
    const trackTime = Math.max(0, payload.time - offsetSec + (getActivePreviewClip()?.start ?? 0));
    reanchorPlaybackClock(trackTime);
  };

  const isSeekingState = () => isSeeking;

  const invalidateSeek = () => {
    latestSeekRequestId += 1;
    isSeeking = false;
  };

  return {
    seekTo,
    playAt,
    handleSeek,
    stepSeek,
    handleSeekCompleted,
    isSeeking: isSeekingState,
    invalidateSeek,
  };
};
