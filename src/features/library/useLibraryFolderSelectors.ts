import { computed, type ComputedRef, type Ref } from 'vue';

import type { FolderSortMode } from '../../services/storage/playerStorage';
import type { Song } from '../../types';
import { sortItemsByAlphabetIndex } from '../../utils/alphabetIndex';
import {
  compareSongPathsByTrackNumber,
  getSongFileNameLabel,
  getSongTitleLabel,
  isDirectParent,
} from './playerLibraryViewShared';

interface FolderListItem {
  path: string; name: string;
  count: number; firstSongPath: string;
}

interface FolderSelectorDeps {
  watchedFolders: Ref<string[]>; sourceSongPaths: Ref<string[]>; songLookup: ComputedRef<Map<string, Song>>;
  currentFolderFilter: Ref<string>; folderSortMode: Ref<FolderSortMode>;
  folderCustomOrder: Ref<Record<string, string[]>>;
}

// 单个文件夹条目：路径、展示名、直属歌曲数与首个歌曲路径。
const buildFolderListItem = (folderPath: string, containedPaths: string[]): FolderListItem => ({
  name: (folderPath.split(/[/\\]/).pop() || folderPath),
  firstSongPath: containedPaths.length > 0 ? containedPaths[0] : '',
  path: folderPath,
  count: containedPaths.length,
});

// 依据当前排序模式整理文件夹直属歌曲路径列表；未识别模式保持原有顺序。
const sortFolderPaths = (
  mode: FolderSortMode,
  paths: string[],
  lookup: Map<string, Song>,
  folderFilter: string,
  customOrderByFolder: Record<string, string[]>,
): string[] => {
  const pickSong = (path: string) => lookup.get(path);

  if (mode === 'title') {
    return sortItemsByAlphabetIndex(
      paths.filter(path => lookup.has(path)),
      path => getSongTitleLabel(lookup.get(path)!),
    );
  }

  if (mode === 'name') {
    return sortItemsByAlphabetIndex(
      paths.filter(path => lookup.has(path)),
      path => getSongFileNameLabel(lookup.get(path)!),
    );
  }

  if (mode === 'artist') {
    return [...paths].sort((x, y) =>
      (pickSong(x)?.artist || '').localeCompare(pickSong(y)?.artist || '', 'zh-CN'),
    );
  }

  if (mode === 'added_at') {
    return [...paths].sort((x, y) => (pickSong(y)?.added_at || 0) - (pickSong(x)?.added_at || 0));
  }

  if (mode === 'track_number') {
    return [...paths].sort((x, y) => compareSongPathsByTrackNumber(x, y, lookup));
  }

  if (mode === 'custom') {
    const order = customOrderByFolder[folderFilter] || [];
    if (order.length > 0) {
      const rank = new Map(order.map((path, index) => [path, index] as const));
      return [...paths].sort((x, y) =>
        (rank.has(x) ? rank.get(x)! : Number.MAX_SAFE_INTEGER)
        - (rank.has(y) ? rank.get(y)! : Number.MAX_SAFE_INTEGER),
      );
    }
  }

  return [...paths];
};

export function useLibraryFolderSelectors(deps: FolderSelectorDeps) {
  const { watchedFolders, sourceSongPaths, songLookup, currentFolderFilter, folderSortMode, folderCustomOrder } = deps;

  // 把路径序列展开为歌曲列表，跳过查不到的路径。
  const toSongs = (paths: string[]) =>
    paths.flatMap(path => {
      const song = songLookup.value.get(path);
      return song ? [song] : [];
    });

  const sourceSongs = computed(() => toSongs(sourceSongPaths.value));

  const currentFolderSongPaths = computed<string[]>(() => {
    const folderFilter = currentFolderFilter.value;
    if (!folderFilter) {
      return [];
    }

    const directChildren = sourceSongPaths.value.filter(path =>
      isDirectParent(folderFilter, path),
    );

    return sortFolderPaths(
      folderSortMode.value,
      directChildren,
      songLookup.value,
      folderFilter,
      folderCustomOrder.value,
    );
  });

  const folderList = computed<FolderListItem[]>(() => watchedFolders.value.map((folderPath) => {
    const contained = sourceSongPaths.value.filter(path => isDirectParent(folderPath, path));
    return buildFolderListItem(folderPath, contained);
  }));

  const currentFolderSongs = computed(() => toSongs(currentFolderSongPaths.value));

  return { folderList, currentFolderSongPaths, currentFolderSongs, sourceSongs };
}
