import type { Song } from '../types';
import { useLibraryCollections } from '../features/collections/useLibraryCollections';

interface CreatePlayerHistoryFavoritesDeps {
  legacyPlayerHistoryKey: string;
}

export const createPlayerHistoryFavorites = ({
  legacyPlayerHistoryKey: _legacyPlayerHistoryKey,
}: CreatePlayerHistoryFavoritesDeps) => {
  const libraryCollections = useLibraryCollections();

  const isFavorite = (song: Song | null) => {
    if (!song) return false;
    return libraryCollections.isFavorite(song.path);
  };

  const toggleFavorite = (song: Song) => {
    libraryCollections.toggleFavorite(song.path);
  };

  const addToHistory = async (song: Song) => {
    await libraryCollections.addToHistory(song);
  };

  const removeFromHistory = async (songPaths: string[]) => {
    await libraryCollections.removeFromHistory(songPaths);
  };

  const clearHistory = async () => {
    await libraryCollections.clearHistory();
  };

  const clearFavorites = () => {
    libraryCollections.clearFavorites();
  };

  return {
    isFavorite,
    toggleFavorite,
    addToHistory,
    removeFromHistory,
    clearHistory,
    clearFavorites,
  };
};
