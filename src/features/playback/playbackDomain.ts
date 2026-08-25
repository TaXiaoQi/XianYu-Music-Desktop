import type { Song } from '../../types';
import { formatDuration } from '../../utils/format';
import type { usePlaybackActions } from './usePlaybackActions';

export interface PlaySongOptions {
  updateShuffleHistory?: boolean;
  clearShuffleFuture?: boolean;
  preserveQueue?: boolean;
  insertAfterCurrent?: boolean;
  /** 起播时间（秒），用于按当前进度切换音质后无缝续播 */
  startTime?: number;
  /** 后端重启音频但仍属于同一次用户播放（例如切换音质） */
  continueStatisticsSession?: boolean;
  /** 强制重播同一首歌（例如单曲循环自然结束），但不延续上一轮统计会话 */
  forceReplay?: boolean;
  /** 标记为分享链接深链触发的播放：失败行为走「分享链接播放失败行为」设置 */
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
  playNext: playbackActions.playNext,
  handleScan: playbackActions.handleScan,
  removeSongFromList: playbackActions.removeSongFromList,
  formatDuration,
});
