import type { Song } from '../../types';

interface PlayerPlaylistApi {
  createPlaylist: (name: string, initialSongs?: string[]) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (playlistId: string, path: string) => void;
  removeFromPlaylist: (playlistId: string, path: string) => void;
  addSongsToPlaylist: (playlistId: string, songPaths: string[]) => number;
  viewPlaylist: (id: string) => void;
  getSongsFromPlaylist: (playlistId: string) => Song[];
  openAddToPlaylistDialog: (songPaths: string | string[]) => void;
}

interface PlayerHistoryFavoritesApi {
  isFavorite: (song: Song | null) => boolean;
  toggleFavorite: (song: Song) => void;
  addToHistory: (song: Song) => Promise<unknown>;
  removeFromHistory: (songPaths: string[]) => Promise<unknown>;
  clearHistory: () => Promise<unknown>;
  clearFavorites: () => void;
}

interface UseCollectionsActionsOptions {
  playerPlaylist: PlayerPlaylistApi;
  playerHistoryFavorites: PlayerHistoryFavoritesApi;
}

export function useCollectionsActions({
  playerPlaylist,
  playerHistoryFavorites,
}: UseCollectionsActionsOptions) {
  const createPlaylist = (name: string, initialSongs: string[] = []) =>
    playerPlaylist.createPlaylist(name, initialSongs);
  const deletePlaylist = (id: string) => playerPlaylist.deletePlaylist(id);
  const addToPlaylist = (playlistId: string, path: string) => playerPlaylist.addToPlaylist(playlistId, path);
  const removeFromPlaylist = (playlistId: string, path: string) => playerPlaylist.removeFromPlaylist(playlistId, path);
  const addSongsToPlaylist = (playlistId: string, songPaths: string[]) =>
    playerPlaylist.addSongsToPlaylist(playlistId, songPaths);
  const viewPlaylist = (id: string) => playerPlaylist.viewPlaylist(id);
  const getSongsFromPlaylist = (playlistId: string) => playerPlaylist.getSongsFromPlaylist(playlistId);
  const openAddToPlaylistDialog = (songPaths: string | string[]) => playerPlaylist.openAddToPlaylistDialog(songPaths);
  const isFavorite = (song: Song | null) => playerHistoryFavorites.isFavorite(song);
  const toggleFavorite = (song: Song) => playerHistoryFavorites.toggleFavorite(song);
  const addToHistory = (song: Song) => playerHistoryFavorites.addToHistory(song);
  const removeFromHistory = (songPaths: string[]) => playerHistoryFavorites.removeFromHistory(songPaths);
  const clearHistory = () => playerHistoryFavorites.clearHistory();
  const clearFavorites = () => playerHistoryFavorites.clearFavorites();

  return {
    createPlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    addSongsToPlaylist,
    viewPlaylist,
    getSongsFromPlaylist,
    openAddToPlaylistDialog,
    isFavorite,
    toggleFavorite,
    addToHistory,
    removeFromHistory,
    clearHistory,
    clearFavorites,
  };
}
