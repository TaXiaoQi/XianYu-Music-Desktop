import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';

import { useCoverCache } from '../../../composables/useCoverCache';
import { useLibraryStore } from '../../../features/library/store';
import {
  compareSongPathsByTrackNumber,
  getSongFileNameLabel,
  getSongTitleLabel,
  isDirectParent,
} from '../../../features/library/playerLibraryViewShared';
import { sortItemsByAlphabetIndex } from '../../../utils/alphabetIndex';
import type { FolderNode, Song } from '../../../types';

/**
 * Folder tile data: figures out which track lends the folder its artwork
 * (first track under the current folder sort mode, falling back to the
 * node's pinned cover track) and keeps the resolved thumbnail URL.
 */
export function useFolderTreeContent(node: () => FolderNode) {
  const libraryStore = useLibraryStore();
  const { sourceSongPaths, songLookup, folderSortMode, folderCustomOrder } = storeToRefs(libraryStore);
  const { loadCover } = useCoverCache();

  const zhCompare = (left: string, right: string) => left.localeCompare(right, 'zh-CN');

  const songTitle = (path: string) => getSongTitleLabel(songLookup.value.get(path) as Song) || '';
  const songFileName = (path: string) => getSongFileNameLabel(songLookup.value.get(path) as Song);
  const songArtist = (path: string) => songLookup.value.get(path)?.artist || '';
  const songAddedAt = (path: string) => songLookup.value.get(path)?.added_at || 0;

  const directPaths = computed(() => sourceSongPaths.value.filter((path) => isDirectParent(node().path, path)));

  const alphabetized = (labelOf: (path: string) => string) =>
    sortItemsByAlphabetIndex(
      directPaths.value.filter((path) => songLookup.value.has(path)),
      (path) => labelOf(path),
    );

  const applyPinnedOrder = (paths: string[]) => {
    const pinned = folderCustomOrder.value[node().path] || [];
    if (pinned.length === 0) return paths;
    const rank = new Map(pinned.map((path, position) => [path, position]));
    const rankOf = (path: string) => rank.get(path) ?? Number.MAX_SAFE_INTEGER;
    return [...paths].sort((left, right) => rankOf(left) - rankOf(right));
  };

  const orderedPaths = computed<string[]>(() => {
    const paths = directPaths.value;
    if (paths.length === 0) return [];

    switch (folderSortMode.value) {
      case 'title':
        return alphabetized(songTitle);
      case 'name':
        return alphabetized(songFileName);
      case 'artist':
        return [...paths].sort(
          (left, right) => zhCompare(songArtist(left), songArtist(right)) || zhCompare(songTitle(left), songTitle(right)),
        );
      case 'added_at':
        return [...paths].sort(
          (left, right) => songAddedAt(right) - songAddedAt(left) || zhCompare(songTitle(left), songTitle(right)),
        );
      case 'added_at_asc':
        return [...paths].sort(
          (left, right) => songAddedAt(left) - songAddedAt(right) || zhCompare(songTitle(left), songTitle(right)),
        );
      case 'track_number':
        return [...paths].sort((left, right) => compareSongPathsByTrackNumber(left, right, songLookup.value));
      case 'custom':
        return applyPinnedOrder(paths);
      default:
        return paths;
    }
  });

  const coverCandidate = computed(() => orderedPaths.value[0] || node().cover_song_path || '');

  const coverUrl = ref('');
  let coverEpoch = 0;

  const refreshCover = async () => {
    const epoch = ++coverEpoch;
    if (!coverCandidate.value) {
      coverUrl.value = '';
      return;
    }
    try {
      const resolved = await loadCover(coverCandidate.value);
      if (epoch !== coverEpoch) return;
      coverUrl.value = resolved || '';
    } catch {
      if (epoch !== coverEpoch) return;
      coverUrl.value = '';
    }
  };

  onMounted(refreshCover);
  watch(
    () => [
      coverCandidate.value,
      folderSortMode.value,
      JSON.stringify(folderCustomOrder.value[node().path] || []),
    ],
    refreshCover,
  );

  return { coverUrl };
}
