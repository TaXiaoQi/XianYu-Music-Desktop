import { useCollectionsActions } from '../collections/useCollectionsActions';
import type { PlayerPlaylistApi } from '../collections/useCollectionsActions';
import { createPlayerHistoryFavorites } from './playerHistoryFavorites';

interface CreateHistoryCollectionsActionsOptions {
  playerPlaylist: PlayerPlaylistApi;
}

export const createHistoryCollectionsActions = ({
  playerPlaylist,
}: CreateHistoryCollectionsActionsOptions) => {
  const historyFavorites = createPlayerHistoryFavorites();
  const collectionsActions = useCollectionsActions({
    playerPlaylist,
  });

  return {
    ...collectionsActions,
    ...historyFavorites,
  };
};
