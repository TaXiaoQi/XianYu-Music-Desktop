import type { Song } from '../types';
import { useLibraryCollections } from '../features/collections/useLibraryCollections';

export const createPlayerPlaylist = () => {
  const libraryCollections = useLibraryCollections();

  const createPlaylist = (name: string, initialSongs: string[] = []) => {
    libraryCollections.createPlaylist(name, initialSongs);
  };

  const deletePlaylist = (id: string) => {
    libraryCollections.deletePlaylist(id);
  };

  const addToPlaylist = (playlistId: string, path: string) => {
    libraryCollections.addToPlaylist(playlistId, path);
  };

  const removeFromPlaylist = (playlistId: string, path: string) => {
    libraryCollections.removeFromPlaylist(playlistId, path);
  };

  const addSongsToPlaylist = (playlistId: string, songPaths: string[]): number => {
    return libraryCollections.addSongsToPlaylist(playlistId, songPaths);
  };

  const viewPlaylist = (id: string) => {
    libraryCollections.viewPlaylist(id);
  };

  const getSongsFromPlaylist = (playlistId: string): Song[] => {
    return libraryCollections.getSongsFromPlaylist(playlistId);
  };

  const openAddToPlaylistDialog = (songPaths: string | string[]) => {
    libraryCollections.openAddToPlaylistDialog(songPaths);
  };

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
};
