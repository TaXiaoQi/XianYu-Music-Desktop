import type { Song } from '../../types';
import { formatDuration } from '../../utils/format';
import type { usePlaybackActions } from './usePlaybackActions';

export interface PlaySongOptions {
  updateShuffleHistory?: boolean;
  clearShuffleFuture?: boolean;
  preserveQueue?: boolean;
  insertAfterCurrent?: boolean;
  startTime?: number;
  continueStatisticsSession?: boolean;
  forceReplay?: boolean;
  shareLinkPlayback?: boolean;
}

interface CreatePlaybackDomainDeps<
  TPlaySong extends (song: Song, options?: PlaySongOptions) => Promise<unknown>,
  TTogglePlay extends () => Promise<unknown>,
  TNextSong extends () => void,
  TPrevSong extends () => void,
> {
  playSong: TPlaySong;
  togglePlay: TTogglePlay;
  nextSong: TNextSong;
  prevSong: TPrevSong;
  playbackActions: ReturnType<typeof usePlaybackActions>;
}

export const createPlaybackDomain = <
  TPlaySong extends (song: Song, options?: PlaySongOptions) => Promise<unknown>,
  TTogglePlay extends () => Promise<unknown>,
  TNextSong extends () => void,
  TPrevSong extends () => void,
>({
  playSong,
  togglePlay,
  nextSong,
  prevSong,
  playbackActions,
}: CreatePlaybackDomainDeps<TPlaySong, TTogglePlay, TNextSong, TPrevSong>) => ({
  playSong,
  pauseSong: playbackActions.pauseSong,
  togglePlay,
  nextSong,
  prevSong,
  seekTo: playbackActions.seekTo,
  stepSeek: playbackActions.stepSeek,
  playAt: playbackActions.playAt,
  handleSeek: playbackActions.handleSeek,
  handleVolume: playbackActions.handleVolume,
  handleVolumeWheel: playbackActions.handleVolumeWheel,
  toggleMute: playbackActions.toggleMute,
  toggleMode: playbackActions.toggleMode,
  togglePlaylist: playbackActions.togglePlaylist,
  toggleMiniPlaylist: playbackActions.toggleMiniPlaylist,
  closeMiniPlaylist: playbackActions.closeMiniPlaylist,
  toggleComment: playbackActions.toggleComment,
  clearQueue: playbackActions.clearQueue,
  addSongToQueue: playbackActions.addSongToQueue,
  addSongsToQueue: playbackActions.addSongsToQueue,
  addAlbumToQueueTail: playbackActions.addAlbumToQueueTail,
  removeSongFromQueue: playbackActions.removeSongFromQueue,
  reorderQueue: playbackActions.reorderQueue,
  playNext: playbackActions.playNext,
  handleScan: playbackActions.handleScan,
  removeSongFromList: playbackActions.removeSongFromList,
  formatDuration,
});
