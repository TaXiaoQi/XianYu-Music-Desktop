import { computed, type Ref } from 'vue';

import type { AlbumCatalogItem, ArtistCatalogItem } from '../../types';
import { compareByAlphabetIndex } from '../../utils/alphabetIndex';
import type { AlbumSortMode, ArtistSortMode } from '../../services/storage/playerStorage';
import type { AlbumListItem, ArtistListItem } from './playerLibraryViewShared';

interface CatalogSelectorDeps {
  artistCatalog: Ref<ArtistCatalogItem[]>; albumCatalog: Ref<AlbumCatalogItem[]>; searchQuery: Ref<string>;
  artistSortMode: Ref<ArtistSortMode>; albumSortMode: Ref<AlbumSortMode>;
  artistCustomOrder: Ref<string[]>; albumCustomOrder: Ref<string[]>;
}

// 把自定义顺序表编译成"键 → 位次"的查询函数，未登记的键排在最后。
const rankByOrder = (order: string[]) => {
  const positions = new Map(order.map((key, index) => [key, index] as const));
  return (key: string) => (positions.has(key) ? positions.get(key)! : Number.MAX_SAFE_INTEGER);
};

// 按艺人目录的排序模式整理列表：名称 / 自定义 / 其余按热度。
const applyArtistSort = (items: ArtistListItem[], mode: ArtistSortMode, customOrder: string[]) => {
  if (mode === 'name') {
    return [...items].sort((a, b) => compareByAlphabetIndex(a.name, b.name));
  }
  if (mode === 'custom') {
    const rank = rankByOrder(customOrder);
    return [...items].sort((a, b) => rank(a.name) - rank(b.name));
  }
  return [...items].sort((a, b) => b.count - a.count || compareByAlphabetIndex(a.name, b.name));
};

// 按专辑目录的排序模式整理列表：名称 / 自定义 / 数量 / 默认按艺人再专辑名。
const applyAlbumSort = (items: AlbumListItem[], mode: AlbumSortMode, customOrder: string[]) => {
  if (mode === 'name') {
    return [...items].sort((a, b) => compareByAlphabetIndex(a.name, b.name));
  }
  if (mode === 'custom') {
    const rank = rankByOrder(customOrder);
    return [...items].sort((a, b) => rank(a.key) - rank(b.key));
  }
  if (mode === 'count') {
    return [...items].sort((a, b) => b.count - a.count || compareByAlphabetIndex(a.artist, b.artist));
  }
  return [...items].sort((a, b) => {
    const byArtist = compareByAlphabetIndex(a.artist, b.artist);
    return byArtist !== 0 ? byArtist : compareByAlphabetIndex(a.name, b.name);
  });
};

// 通用文本过滤：候选字段任一包含关键词即保留；空关键词原样返回。
const filterByText = <T>(items: T[], rawQuery: string, fieldsOf: (item: T) => string[]) => {
  const keyword = rawQuery.trim().toLowerCase();
  if (!keyword) {
    return items;
  }
  return items.filter(item =>
    fieldsOf(item).some(field => (field || '').toLowerCase().includes(keyword)),
  );
};

export function useLibraryCatalogSelectors(deps: CatalogSelectorDeps) {
  const { artistCatalog, albumCatalog, searchQuery, artistSortMode, albumSortMode, artistCustomOrder, albumCustomOrder } = deps;

  const artistList = computed<ArtistListItem[]>(() =>
    applyArtistSort(artistCatalog.value, artistSortMode.value, artistCustomOrder.value),
  );

  const albumList = computed<AlbumListItem[]>(() =>
    applyAlbumSort(albumCatalog.value, albumSortMode.value, albumCustomOrder.value),
  );

  const filteredArtistList = computed(() =>
    filterByText(artistList.value, searchQuery.value, artist => [artist.name]),
  );

  const filteredAlbumList = computed(() =>
    filterByText(albumList.value, searchQuery.value, album => [album.name, album.artist]),
  );

  return { artistList, albumList, filteredArtistList, filteredAlbumList };
}
