
import { tauriInvoke } from './invoke';
import type { Song, QualityKey } from '../../types';

export interface PlaybackSessionData {
  currentSongPath: string | null;
  playQueuePaths: string[];
  sourceSongPaths: string[];
  playMode: number;
  volume: number;
  currentPositionSecs: number;
  isPlaying: boolean;
  sessionQualityOverride: string | null;
  queueSongMeta: Record<string, Song>;
  updatedAt: number;
}

export type PlaybackSessionChangedPayload = PlaybackSessionData;

export type PlaybackQueueMetaChangedPayload = Record<string, Song>;

export function buildSessionData(params: {
  currentSongPath: string | null;
  playQueuePaths: string[];
  sourceSongPaths: string[];
  playMode: number;
  volume: number;
  currentPositionSecs: number;
  isPlaying: boolean;
  sessionQualityOverride: QualityKey | null;
  queueSongMeta: Record<string, Song>;
}): PlaybackSessionData {
  return {
    currentSongPath: params.currentSongPath,
    playQueuePaths: params.playQueuePaths,
    sourceSongPaths: params.sourceSongPaths,
    playMode: params.playMode,
    volume: params.volume,
    currentPositionSecs: params.currentPositionSecs,
    isPlaying: params.isPlaying,
    sessionQualityOverride: params.sessionQualityOverride,
    queueSongMeta: params.queueSongMeta,
    updatedAt: Date.now(),
  };
}

export const sessionApi = {
  savePlaybackSession: (session: PlaybackSessionData): Promise<void> =>
    tauriInvoke('save_playback_session', { session }),

  loadPlaybackSession: (): Promise<PlaybackSessionData> =>
    tauriInvoke('load_playback_session'),

  getPlaybackSession: (): Promise<PlaybackSessionData> =>
    tauriInvoke('get_playback_session'),

  updatePlaybackPosition: (positionSecs: number, isPlaying: boolean): Promise<void> =>
    tauriInvoke('update_playback_position', { positionSecs, isPlaying }),

  flushPlaybackSession: (): Promise<void> =>
    tauriInvoke('flush_playback_session'),
};
