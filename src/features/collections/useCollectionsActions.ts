import type { Song } from '../../types';

/** 播放器侧暴露给收藏页的歌单操作能力集合。 */
export interface PlayerPlaylistApi {
  createPlaylist: (playlistName: string, initialSongs?: string[]) => void;
  deletePlaylist: (playlistId: string) => void;
  addToPlaylist: (playlistId: string, songPath: string) => void;
  removeFromPlaylist: (playlistId: string, songPath: string) => void;
  addSongsToPlaylist: (playlistId: string, songPaths: string[], fullSongs?: Song[]) => number;
  viewPlaylist: (playlistId: string) => void;
  getSongsFromPlaylist: (playlistId: string) => Song[];
  openAddToPlaylistDialog: (songPaths: string | string[]) => void;
}

interface CollectionsActionDeps {
  playerPlaylist: PlayerPlaylistApi;
}

/**
 * 收藏页的歌单动作全部转发给播放器模块执行，
 * 本组合函数只负责收敛调用面，让视图层不必直接依赖播放器 store。
 */
export function useCollectionsActions({ playerPlaylist }: CollectionsActionDeps) {
  const playlistApi = playerPlaylist;

  return {
    createPlaylist: (name: string, initialSongs: string[] = []) =>
      playlistApi.createPlaylist(name, initialSongs),
    deletePlaylist: (playlistId: string) => playlistApi.deletePlaylist(playlistId),
    addToPlaylist: (playlistId: string, path: string) => playlistApi.addToPlaylist(playlistId, path),
    removeFromPlaylist: (playlistId: string, path: string) =>
      playlistApi.removeFromPlaylist(playlistId, path),
    addSongsToPlaylist: (playlistId: string, songPaths: string[], fullSongs?: Song[]) =>
      playlistApi.addSongsToPlaylist(playlistId, songPaths, fullSongs),
    viewPlaylist: (playlistId: string) => playlistApi.viewPlaylist(playlistId),
    getSongsFromPlaylist: (playlistId: string) => playlistApi.getSongsFromPlaylist(playlistId),
    openAddToPlaylistDialog: (songPaths: string | string[]) =>
      playlistApi.openAddToPlaylistDialog(songPaths),
  };
}
