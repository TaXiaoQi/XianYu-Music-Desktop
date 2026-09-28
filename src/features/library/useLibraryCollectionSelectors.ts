// 收藏集合选择器：把用户收藏的路径序列收敛成可展示的两条派生序列——
// 先按曲目索引过滤出仍真实存在的路径，再把路径逐条还原为曲目实体。
import { computed } from 'vue';

import type { ComputedRef, Ref } from 'vue';
import type { Song } from '../../types';

interface CollectionSelectorInputs {
  /** 用户收藏的路径序列，可能混有已从曲库移除的陈旧路径 */
  readonly favoritePaths: Ref<string[]>;
  /** path → 曲目实体的索引，用于甄别与还原 */
  readonly songLookup: ComputedRef<Map<string, Song>>;
}

// 依原始顺序保留能在曲目索引中命中的收藏路径。
function retainIndexedPaths(paths: string[], index: Map<string, Song>): string[] {
  return paths.filter(path => index.has(path));
}

// 将路径序列逐条还原为曲目实体；索引中查不到的路径直接跳过。
function restoreSongsFromPaths(paths: string[], index: Map<string, Song>): Song[] {
  const restored: Song[] = [];
  for (const path of paths) {
    const hit = index.get(path);
    if (hit) {
      restored.push(hit);
    }
  }
  return restored;
}

export function useLibraryCollectionSelectors(inputs: CollectionSelectorInputs) {
  const { favoritePaths, songLookup } = inputs;

  const favoriteSongPaths = computed(() => retainIndexedPaths(favoritePaths.value, songLookup.value));

  const favoriteSongList = computed(() => restoreSongsFromPaths(favoriteSongPaths.value, songLookup.value));

  return { favoriteSongPaths, favoriteSongList };
}
