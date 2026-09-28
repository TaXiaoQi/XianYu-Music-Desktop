import { storeToRefs } from 'pinia';

import { usePlayerCore } from './playerCore';
import { usePlaybackStore } from './store';
import { useUiStore } from '../../shared/stores/ui';

export const usePlaybackController = () => {
  const coreBridges = usePlayerCore();
  const transport = coreBridges.playbackDomain;
  const shell = coreBridges.windowDomain;

  const playbackVault = usePlaybackStore();
  const uiVault = useUiStore();
  const playbackState = storeToRefs(playbackVault);
  const uiState = storeToRefs(uiVault);

  const dismissPlayerDetail = () => { uiState.showPlayerDetail.value = false; };

  // 正在播放的内容快照：曲目、封面、音质与会话级覆盖、每日推荐标记。
  const nowPlayingSnapshot = {
    currentSong: playbackState.currentSong,
    currentCover: playbackState.currentCover,
    currentCoverPath: playbackState.currentCoverPath,
    currentCoverFull: playbackState.currentCoverFull,
    currentAvailableQualities: playbackState.currentAvailableQualities,
    currentPlayingQuality: playbackState.currentPlayingQuality,
    sessionQualityOverride: playbackState.sessionQualityOverride,
    setSessionQualityOverride: playbackVault.setSessionQualityOverride,
    dailyRecommendPaths: playbackVault.dailyRecommendPaths,
    markDailyRecommendPaths: playbackVault.markDailyRecommendPaths,
  };

  // 传输层可观察状态。
  const transportSnapshot = {
    isPlaying: playbackState.isPlaying,
    volume: playbackState.volume,
    currentTime: playbackState.currentTime,
    playMode: playbackState.playMode,
    activeOutputMode: playbackState.activeOutputMode,
    playQueue: playbackState.playQueue,
  };

  // 界面浮层开关与取色结果。
  const overlaySnapshot = {
    showPlaylist: uiState.showPlaylist,
    showPlayerDetail: uiState.showPlayerDetail,
    showQueue: uiState.showQueue,
    showComment: uiState.showComment,
    dominantColors: uiState.dominantColors,
  };

  // 播放域命令转发。
  const playbackCommands = {
    playSong: transport.playSong, pauseSong: transport.pauseSong, togglePlay: transport.togglePlay,
    nextSong: transport.nextSong, prevSong: transport.prevSong,
    seekTo: transport.seekTo, stepSeek: transport.stepSeek,
    handleVolume: transport.handleVolume, handleVolumeWheel: transport.handleVolumeWheel, toggleMute: transport.toggleMute,
    toggleMode: transport.toggleMode, togglePlaylist: transport.togglePlaylist,
    clearQueue: transport.clearQueue, addSongToQueue: transport.addSongToQueue, addSongsToQueue: transport.addSongsToQueue,
    removeSongFromQueue: transport.removeSongFromQueue, reorderQueue: transport.reorderQueue,
    playNext: transport.playNext, formatDuration: transport.formatDuration,
  };

  // 窗口域命令转发。
  const windowCommands = {
    togglePlayerDetail: shell.togglePlayerDetail, toggleQueue: shell.toggleQueue, toggleComment: shell.toggleComment,
    toggleAlwaysOnTop: shell.toggleAlwaysOnTop, closePlayerDetail: dismissPlayerDetail,
  };

  const controllerApi = {
    ...nowPlayingSnapshot,
    ...transportSnapshot,
    ...overlaySnapshot,
    ...playbackCommands,
    ...windowCommands,
  };

  return controllerApi;
};
