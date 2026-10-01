import {listen as tauriListen} from '@tauri-apps/api/event';
import type {Ref} from 'vue';
import type {Song} from '../../types';
import {evaluateStallAutoNext, LOW_POWER_PROGRESS_UPDATE_MS, type PlaybackProgressPayload} from './playbackTiming';
import type {PreviewClipInfo} from './onlineFailover';

export interface PlaybackRuntimeDeps {
  currentSong: Ref<Song | null>;
  currentTime: Ref<number>;
  isPlaying: Ref<boolean>;
  isSongLoaded: Ref<boolean>;
  isMainWindowLowPower: Ref<boolean>;
  isSeeking: () => boolean;
  isCasting: () => boolean;
  getCastPosition: () => number;
  getCastDuration: () => number;
  patchSongDuration: (song: Song, duration: number) => void;
  getActivePreviewClip: () => PreviewClipInfo | null;
  setActivePreviewClip: (clip: PreviewClipInfo | null) => void;
  getPreviewPath: () => string;
  setPreviewPath: (path: string) => void;
  getPreviewDetectedPath: () => string;
  setPreviewDetectedPath: (path: string) => void;
  onPreviewDetected: (song: Song, duration: number) => void | Promise<void>;
  onAutoNext: () => void;
  flushStatistics: () => void;
  startStatisticsSession: () => void;
  listen?: typeof tauriListen;
}

export interface PlaybackRuntimeController {
  reanchor: (time: number) => void;
  start: () => void;
  stop: () => void;
  dispose: () => void;
  resetProgressTracking: () => void;
  getAnchorTime: () => number;
}

export function createPlaybackRuntime(deps: PlaybackRuntimeDeps): PlaybackRuntimeController {
  const listen = deps.listen ?? tauriListen;
  let progressFrameId: number | null = null;
  let progressTimerId: ReturnType<typeof setTimeout> | null = null;
  let progressUnlisten: (() => void) | null = null;
  let progressListeningActive = false;
  let periodicFlushTimerId: ReturnType<typeof setInterval> | null = null;
  let playbackAnchorTime = 0;
  let playbackStartOffset = 0;
  let lastRawProgress = -1;
  let stalledProgressTicks = 0;

  const reanchor = (time: number) => {
    playbackAnchorTime = performance.now();
    playbackStartOffset = time;
    deps.currentTime.value = time;
  };

  const stop = () => {
    if (progressFrameId !== null) {
      cancelAnimationFrame(progressFrameId);
      progressFrameId = null;
    }
    if (progressTimerId !== null) {
      clearTimeout(progressTimerId);
      progressTimerId = null;
    }
    progressListeningActive = false;
    progressUnlisten?.();
    progressUnlisten = null;
    if (periodicFlushTimerId !== null) {
      clearInterval(periodicFlushTimerId);
      periodicFlushTimerId = null;
    }
  };

  const start = () => {
    stop();
    reanchor(deps.currentTime.value);

    const scheduleUpdate = (update: FrameRequestCallback) => {
      if (deps.isMainWindowLowPower.value) {
        progressTimerId = setTimeout(() => {
          progressTimerId = null;
          update(performance.now());
        }, LOW_POWER_PROGRESS_UPDATE_MS);
      } else {
        progressFrameId = requestAnimationFrame(update);
      }
    };

    const update = () => {
      if (!deps.currentSong.value || !deps.isPlaying.value) return;
      if (deps.isCasting()) {
        deps.currentTime.value = deps.getCastPosition();
        const duration = deps.getCastDuration();
        const song = deps.currentSong.value;
        if (duration > 0.5 && song && (!song.duration || song.duration <= 0)) {
          deps.patchSongDuration(song, Math.floor(duration));
        }
      } else if (deps.isSongLoaded.value) {
        deps.currentTime.value = playbackStartOffset + (performance.now() - playbackAnchorTime) / 1000;
      } else {
        reanchor(playbackStartOffset);
      }

      const clip = deps.getActivePreviewClip();
      const song = deps.currentSong.value;
      const endTime = clip ? clip.start + clip.duration : song?.duration ?? 0;
      if (endTime > 0 && deps.currentTime.value >= endTime - 0.3) {
        deps.onAutoNext();
        return;
      }
      scheduleUpdate(update);
    };

    scheduleUpdate(update);
    periodicFlushTimerId = setInterval(() => {
      if (deps.isPlaying.value && deps.currentSong.value) {
        deps.flushStatistics();
        deps.startStatisticsSession();
      }
    }, 30_000);

    progressListeningActive = true;
    listen<PlaybackProgressPayload>('playback:progress', (event) => {
      if (!progressListeningActive || !deps.isPlaying.value || deps.isSeeking() || deps.isCasting()) return;
      const {position: rawTime, duration} = event.payload;
      const clip = deps.getActivePreviewClip();
      if (clip && duration > 0 && Math.abs(duration - clip.duration) > 3) {
        deps.setActivePreviewClip(null);
        deps.setPreviewPath('');
        deps.setPreviewDetectedPath('');
      }
      const currentClip = deps.getActivePreviewClip();
      const offsetSec = (deps.currentSong.value?.cue_start_offset || 0) / 1000;
      const adjustedTime = Math.max(0, rawTime - offsetSec + (currentClip?.start ?? 0));
      if (Math.abs(adjustedTime - deps.currentTime.value) > 0.05) reanchor(adjustedTime);

      const songForPreview = deps.currentSong.value;
      if (
        songForPreview
        && deps.getPreviewDetectedPath() !== songForPreview.path
        && (songForPreview.path.startsWith('plugin://') || songForPreview.path.startsWith('lx://'))
        && duration > 0
        && songForPreview.duration > 0
        && duration < songForPreview.duration - 3
      ) {
        void deps.onPreviewDetected(songForPreview, duration);
      }

      const song = deps.currentSong.value;
      if (song) {
        const result = evaluateStallAutoNext({
          song,
          rawTime,
          lastRawProgress,
          stalledProgressTicks,
          activePreviewClip: deps.getActivePreviewClip(),
        });
        stalledProgressTicks = result.stalledProgressTicks;
        if (result.shouldAutoAdvance) {
          deps.onAutoNext();
          return;
        }
      } else {
        stalledProgressTicks = 0;
      }
      lastRawProgress = rawTime;

      const songForDuration = deps.currentSong.value;
      if (songForDuration && (!songForDuration.duration || songForDuration.duration <= 0) && duration > 0) {
        deps.patchSongDuration(songForDuration, Math.floor(duration));
      }
    }).then(unlisten => {
      if (!progressListeningActive) unlisten();
      else progressUnlisten = unlisten;
    }).catch(() => {});
  };

  const resetProgressTracking = () => {
    lastRawProgress = -1;
    stalledProgressTicks = 0;
  };

  const dispose = () => {
    stop();
    playbackAnchorTime = 0;
    playbackStartOffset = 0;
    resetProgressTracking();
  };

  return {reanchor, start, stop, dispose, resetProgressTracking, getAnchorTime: () => playbackStartOffset};
}
