import { computed, watch, type Ref } from 'vue';

import type { Song } from '../types';
import { compareByAlphabetIndex } from '../utils/alphabetIndex';

interface AlbumEntry {
  key: string;
  name: string;
  count: number;
  artist: string;
  firstSongPath: string;
}

interface UseHomeArtistAlbumsOptions {
  localFilterCondition: Ref<string>;
  filterCondition: Ref<string>;
  librarySongs: Ref<Song[]>;
  albumSortMode: Ref<'count' | 'name' | 'artist' | 'custom'>;
  albumCustomOrder: Ref<string[]>;
  preloadCovers: (paths: string[]) => void;
}

/** 取歌曲实际归属的歌手名集合：优先用清洗后的多名信息，否则回退到原始歌手字段 */
function resolveArtistNames(song: Song): string[] {
  const explicitNames = song.effective_artist_names;
  if (explicitNames && explicitNames.length > 0) {
    return explicitNames;
  }
  return song.artist_names || [song.artist];
}

export function useHomeArtistAlbums(options: UseHomeArtistAlbumsOptions) {
  const {
    localFilterCondition,
    filterCondition,
    librarySongs,
    albumSortMode,
    albumCustomOrder,
    preloadCovers,
  } = options;

  type EntryComparator = (left: AlbumEntry, right: AlbumEntry) => number;

  /**
   * 把曲库中属于指定歌手的歌曲按专辑聚合：
   * 以 album_key 为唯一标识，缺失时用"专辑名::专辑歌手"拼接兜底。
   */
  const collectAlbumEntries = (artistName: string): AlbumEntry[] => {
    const grouped = new Map<string, AlbumEntry>();

    librarySongs.value.forEach((song) => {
      if (!resolveArtistNames(song).includes(artistName)) {
        return;
      }

      const entryKey =
        song.album_key
        || `${song.album || 'Unknown'}::${song.album_artist || song.artist || 'Unknown'}`;
      const existed = grouped.get(entryKey);
      if (existed) {
        existed.count += 1;
        return;
      }

      grouped.set(entryKey, {
        key: entryKey,
        name: song.album || 'Unknown',
        count: 1,
        artist: song.album_artist || song.artist || 'Unknown',
        firstSongPath: song.path,
      });
    });

    return Array.from(grouped.values());
  };

  /** 依据当前排序模式返回相应的比较器，未识别的模式按播放数量降序处理 */
  const pickComparator = (mode: string): EntryComparator => {
    switch (mode) {
      case 'name':
        return (left, right) => compareByAlphabetIndex(left.name, right.name);
      case 'custom': {
        const rankOfKey = new Map(albumCustomOrder.value.map((key, index) => [key, index]));
        const rankOf = (entry: AlbumEntry): number =>
          rankOfKey.get(entry.key) ?? Number.MAX_SAFE_INTEGER;
        return (left, right) => rankOf(left) - rankOf(right);
      }
      case 'artist': {
        const byArtist = (left: AlbumEntry, right: AlbumEntry): number => {
          const diff = compareByAlphabetIndex(left.artist, right.artist);
          return diff !== 0 ? diff : compareByAlphabetIndex(left.name, right.name);
        };
        return byArtist;
      }
      default:
        return (left, right) =>
          right.count - left.count || compareByAlphabetIndex(left.artist, right.artist);
    }
  };

  const artistAlbumList = computed<AlbumEntry[]>(() => {
    const activeArtist = localFilterCondition.value || filterCondition.value;
    if (!activeArtist) {
      return [] as AlbumEntry[];
    }

    const entries = collectAlbumEntries(activeArtist);
    entries.sort(pickComparator(albumSortMode.value));
    return entries;
  });

  // 专辑列表一旦变化，就预加载各专辑封面的首曲路径
  watch(
    artistAlbumList,
    (albums) => {
      const coverPaths = albums.map((album) => album.firstSongPath).filter(Boolean);
      preloadCovers(coverPaths);
    },
    { immediate: true },
  );

  return {
    artistAlbumList,
  };
}
