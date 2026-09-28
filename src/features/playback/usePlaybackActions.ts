import type { Ref } from 'vue';

import type { Song } from '../../types';
import { useLibraryStore } from '../library/store';
import { useToast } from '../../composables/toast';

import {
  albumQueuedHint,
  buildAlbumKey,
  NO_ALBUM_SONGS_HINT,
  orderAlbumSongs,
  UNNAMED_ALBUM_LABEL,
} from './albumQueue';

/** playSong 可携带的播放意图参数，全部可选。 */
interface PlaySongRequest {
  updateShuffleHistory?: boolean; clearShuffleFuture?: boolean;
  preserveQueue?: boolean; insertAfterCurrent?: boolean;
  startTime?: number;
  continueStatisticsSession?: boolean; forceReplay?: boolean;
}

interface PlaybackBridge {
  playSong(song: Song, options?: PlaySongRequest): unknown;
  pauseSong(): Promise<unknown>;
  togglePlay(): Promise<unknown>;
  seekTo(newTime: number): Promise<unknown>;
  playAt(position: number): Promise<unknown>;
  handleSeek(event: MouseEvent): Promise<unknown>;
  stepSeek(offset: number): Promise<unknown>;
}

interface QueueBridge {
  toggleMode(): void;
  playNext(song: Song): void;
  nextSong(): void;
  prevSong(): void;
  clearQueue(): Promise<unknown>;
  removeSongFromQueue(song: Song): void;
  reorderQueue(fromIndex: number, toIndex: number): void;
  addSongToQueue(song: Song): void;
  addSongsToQueue(songs: Song[]): void;
}

interface UiShellBridge {
  handleVolume(event: Event): Promise<unknown>;
  handleVolumeWheel(event: WheelEvent): Promise<unknown>;
  toggleMute(): Promise<unknown>;
  togglePlaylist(): void;
  toggleMiniPlaylist(): void;
  closeMiniPlaylist(): void;
  toggleComment(): void;
  handleScan(): Promise<unknown>;
  removeSongFromList(song: Song): Promise<unknown>;
}

interface PlaybackActionWiring {
  currentSong: Ref<Song | null>; playMode: Ref<number>;
  getPlayerPlayback: () => PlaybackBridge;
  getPlayerQueue: () => QueueBridge;
  playerUiShell: UiShellBridge;
}

const SINGLE_TRACK_LOOP = 1;

export function usePlaybackActions(wiring: PlaybackActionWiring) {
  const { currentSong, playMode, getPlayerPlayback, getPlayerQueue, playerUiShell } = wiring;

  // 单曲循环时「自动下一首」等价于强制重播当前曲目。
  const replayActiveForLoopMode = (): boolean => {
    const activeSong = currentSong.value;
    if (playMode.value !== SINGLE_TRACK_LOOP || !activeSong) { return false; }
    void Promise.resolve(getPlayerPlayback().playSong(activeSong, { forceReplay: true }))
      .catch((reason: unknown) => console.warn('[Audio] 单曲循环重播失败:', reason));
    return true;
  };

  function handleAutoNext() {
    if (replayActiveForLoopMode()) { return; }
    getPlayerQueue().nextSong();
  }

  function playSong(song: Song, options?: PlaySongRequest) { return getPlayerPlayback().playSong(song, options); }
  function pauseSong() { return getPlayerPlayback().pauseSong(); }
  function togglePlay() { return getPlayerPlayback().togglePlay(); }
  function seekTo(newTime: number) { return getPlayerPlayback().seekTo(newTime); }
  function playAt(position: number) { return getPlayerPlayback().playAt(position); }
  function handleSeek(event: MouseEvent) { return getPlayerPlayback().handleSeek(event); }
  function stepSeek(offset: number) { return getPlayerPlayback().stepSeek(offset); }

  function nextSong() { return getPlayerQueue().nextSong(); }
  function prevSong() { return getPlayerQueue().prevSong(); }
  function toggleMode() { return getPlayerQueue().toggleMode(); }
  function playNext(song: Song) { return getPlayerQueue().playNext(song); }
  function addSongToQueue(song: Song) { return getPlayerQueue().addSongToQueue(song); }
  function addSongsToQueue(songs: Song[]) { return getPlayerQueue().addSongsToQueue(songs); }
  function removeSongFromQueue(song: Song) { return getPlayerQueue().removeSongFromQueue(song); }
  function reorderQueue(fromIndex: number, toIndex: number) { return getPlayerQueue().reorderQueue(fromIndex, toIndex); }
  function clearQueue() { return getPlayerQueue().clearQueue(); }

  function handleVolume(event: Event) { return playerUiShell.handleVolume(event); }
  function handleVolumeWheel(event: WheelEvent) { return playerUiShell.handleVolumeWheel(event); }
  function toggleMute() { return playerUiShell.toggleMute(); }
  function togglePlaylist() { return playerUiShell.togglePlaylist(); }
  function toggleMiniPlaylist() { return playerUiShell.toggleMiniPlaylist(); }
  function closeMiniPlaylist() { return playerUiShell.closeMiniPlaylist(); }
  function toggleComment() { return playerUiShell.toggleComment(); }
  function handleScan() { return playerUiShell.handleScan(); }
  function removeSongFromList(song: Song) { return playerUiShell.removeSongFromList(song); }

  // 把某首歌所属的整张专辑按碟号/音轨顺序追加到播放队列末尾。
  function addAlbumToQueueTail(song: Song) {
    if (!song) { return; }
    const toaster = useToast();
    const libraryVault = useLibraryStore();
    const albumKey = buildAlbumKey(song);

    const albumMembers = libraryVault.canonicalSongs.filter(
      (candidate) => buildAlbumKey(candidate) === albumKey,
    );
    if (albumMembers.length === 0) {
      toaster.showToast(NO_ALBUM_SONGS_HINT, 'info');
      return;
    }

    getPlayerQueue().addSongsToQueue(orderAlbumSongs(albumMembers));
    toaster.showToast(albumQueuedHint(song.album || UNNAMED_ALBUM_LABEL), 'success');
  }

  const actionBundle = {
    handleAutoNext,
    playSong, pauseSong, togglePlay,
    seekTo, playAt, handleSeek, stepSeek,
    nextSong, prevSong, toggleMode,
    playNext, addSongToQueue, addSongsToQueue, removeSongFromQueue, reorderQueue, clearQueue,
    handleVolume, handleVolumeWheel, toggleMute,
    togglePlaylist, toggleMiniPlaylist, closeMiniPlaylist, toggleComment,
    handleScan, removeSongFromList,
    addAlbumToQueueTail,
  };

  return actionBundle;
}
