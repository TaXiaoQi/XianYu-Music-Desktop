import type {Song} from '../../types';

export interface PlaySongOptions {
  updateShuffleHistory?: boolean;
  clearShuffleFuture?: boolean;
  preserveQueue?: boolean;
  insertAfterCurrent?: boolean;
  startTime?: number;
  continueStatisticsSession?: boolean;
  forceReplay?: boolean;
  shareLinkPlayback?: boolean;
  _sourceSwitchCtx?: {
    originKey: string;
    failedSources: Set<string>;
  };
  _siblingTriedPluginIds?: Set<string>;
}

export type PlaySong = (song: Song, options?: PlaySongOptions) => Promise<void>;
