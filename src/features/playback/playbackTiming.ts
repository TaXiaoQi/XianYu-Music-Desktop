import type {PreviewClipInfo} from './onlineFailover';
import {isOnlineStreamPath} from './onlineFailover';


export interface PlaybackProgressPayload {
  position: number;
  duration: number;
  is_playing: boolean;
}

export const LOW_POWER_PROGRESS_UPDATE_MS = 1000;

export interface StallAutoNextInput {
  song: { path: string; duration: number };
  rawTime: number;
  lastRawProgress: number;
  stalledProgressTicks: number;
  activePreviewClip: PreviewClipInfo | null;
}

export interface StallAutoNextResult {
  stalledProgressTicks: number;
  shouldAutoAdvance: boolean;
}

export function evaluateStallAutoNext(input: StallAutoNextInput): StallAutoNextResult {
  const { song, rawTime, lastRawProgress, stalledProgressTicks, activePreviewClip } = input;

  if (rawTime <= 0 || Math.abs(rawTime - lastRawProgress) >= 0.05) {
    return { stalledProgressTicks: 0, shouldAutoAdvance: false };
  }

  const ticks = stalledProgressTicks + 1;
  const unknownDuration = !song.duration || song.duration <= 0;
  const nearEnd = activePreviewClip
    ? rawTime >= activePreviewClip.duration - 3
    : song.duration > 0 && rawTime >= song.duration - 3;
  const requiredStalledTicks = isOnlineStreamPath(song.path) ? 12 : 4;

  if (ticks >= requiredStalledTicks && (unknownDuration || nearEnd)) {
    return { stalledProgressTicks: 0, shouldAutoAdvance: true };
  }
  return { stalledProgressTicks: ticks, shouldAutoAdvance: false };
}