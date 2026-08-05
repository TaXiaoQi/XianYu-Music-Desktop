import type { HistoryItem } from '../../types';
import { playerStorage } from '../../services/storage/playerStorage';
import { historyApi } from '../../services/tauri/historyApi';
import { useCollectionsStore } from '../collections/store';

const RECENT_HISTORY_LIMIT = 200;

interface CreateHistoryRestoreOptions {
  legacyHistoryKey: string;
}

const mergeRecentHistory = (
  primary: HistoryItem[],
  secondary: HistoryItem[],
): HistoryItem[] => {
  const merged = new Map<string, number>();
  [...primary, ...secondary].forEach((item) => {
    if (!item?.path) {
      return;
    }
    const existing = merged.get(item.path);
    if (existing === undefined || item.playedAt > existing) {
      merged.set(item.path, item.playedAt);
    }
  });

  return Array.from(merged.entries())
    .map(([path, playedAt]) => ({ path, playedAt }))
    .sort((left, right) => right.playedAt - left.playedAt)
    .slice(0, RECENT_HISTORY_LIMIT);
};

export const createHistoryRestore = ({
  legacyHistoryKey,
}: CreateHistoryRestoreOptions) => {
  const collectionsStore = useCollectionsStore();

  const restoreRecentHistory = async () => {
    const legacyHistory = playerStorage.readHistory(legacyHistoryKey);
    const onlineHistory = playerStorage.readRecentOnlineHistory();

    try {
      const records = await historyApi.getRecentHistory(RECENT_HISTORY_LIMIT);
      if (records.length > 0 || onlineHistory.length > 0) {
        const backendHistory = records.map(record => ({
          path: record.songPath,
          playedAt: record.playedAt,
        }));
        collectionsStore.setRecentSongs(mergeRecentHistory(backendHistory, onlineHistory));

        if (collectionsStore.recentSongs.length > 0) {
          playerStorage.remove(legacyHistoryKey);
          return;
        }
      }
    } catch (error) {
      console.warn('get_recent_history failed:', error);
    }

    if (legacyHistory.length === 0 && onlineHistory.length === 0) {
      collectionsStore.setRecentSongs([]);
      return;
    }

    collectionsStore.setRecentSongs(
      mergeRecentHistory(legacyHistory, onlineHistory),
    );

    const importedEntries = legacyHistory.map(item => ({
      songPath: item.path,
      playedAt: Math.floor(item.playedAt / 1000),
    }));

    try {
      await historyApi.importRecentHistory(importedEntries);
      playerStorage.remove(legacyHistoryKey);
    } catch (error) {
      console.warn('import_recent_history failed:', error);
    }
  };

  return {
    restoreRecentHistory,
  };
};
