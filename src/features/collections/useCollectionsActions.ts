import type { Song } from '../../types';

export interface PlayerPlaylistApi {
  createPlaylist: (name: string, initialSongs?: string[]) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (playlistId: string, path: string) => void;
  removeFromPlaylist: (playlistId: string, path: string) => void;
  addSongsToPlaylist: (playlistId: string, songPaths: string[], fullSongs?: Song[]) => number;
  viewPlaylist: (id: string) => void;
  getSongsFromPlaylist: (playlistId: string) => Song[];
  openAddToPlaylistDialog: (songPaths: string | string[]) => void;
}

interface UseCollectionsActionsOptions {
  playerPlaylist: PlayerPlaylistApi;
}

export function useCollectionsActions({
  playerPlaylist,
}: UseCollectionsActionsOptions) {
  const createPlaylist = (name: string, initialSongs: string[] = []) =>
    playerPlaylist.createPlaylist(name, initialSongs);
  const deletePlaylist = (id: string) => playerPlaylist.deletePlaylist(id);
  const addToPlaylist = (playlistId: string, path: string) => playerPlaylist.addToPlaylist(playlistId, path);
  const removeFromPlaylist = (playlistId: string, path: string) => playerPlaylist.removeFromPlaylist(playlistId, path);
  const addSongsToPlaylist = (playlistId: string, songPaths: string[], fullSongs?: Song[]) =>
    playerPlaylist.addSongsToPlaylist(playlistId, songPaths, fullSongs);
  const viewPlaylist = (id: string) => playerPlaylist.viewPlaylist(id);
  const getSongsFromPlaylist = (playlistId: string) => playerPlaylist.getSongsFromPlaylist(playlistId);
  const openAddToPlaylistDialog = (songPaths: string | string[]) => playerPlaylist.openAddToPlaylistDialog(songPaths);

  return {
    createPlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    addSongsToPlaylist,
    viewPlaylist,
    getSongsFromPlaylist,
    openAddToPlaylistDialog,
  };
}
