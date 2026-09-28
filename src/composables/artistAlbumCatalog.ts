import type { Song } from '../types';
import { compareByAlphabetIndex } from '../utils/alphabetIndex';

/** 歌手页的专辑条目：同一专辑的歌曲聚合为一行 */
export interface AlbumCatalogEntry {
  /** 专辑唯一键（album_key，缺失时用「专辑名::专辑歌手」兜底） */
  key: string;
  /** 专辑名 */
  name: string;
  /** 专辑内的歌曲数量 */
  count: number;
  /** 专辑歌手 */
  artist: string;
  /** 专辑内首次出现歌曲的路径（用于封面预载） */
  firstSongPath: string;
}

export type AlbumSortMode = 'count' | 'name' | 'artist' | 'custom';

/** 专辑条目比较器 */
type EntryComparator = (one: AlbumCatalogEntry, another: AlbumCatalogEntry) => number;

/** 判断歌曲是否归属指定歌手：优先清洗后的多名结果，回退原始歌手字段 */
function songMatchesArtist(song: Song, artistName: string): boolean {
  const namePool = song.effective_artist_names?.length
    ? song.effective_artist_names
    : song.artist_names ?? [song.artist];
  return namePool.includes(artistName);
}

/** 生成专辑唯一键：优先 album_key，缺失时以「专辑名::专辑歌手」拼接 */
function deriveAlbumKey(song: Song): string {
  const assembled = `${song.album || 'Unknown'}::${song.album_artist || song.artist || 'Unknown'}`;
  return song.album_key || assembled;
}

/**
 * 把曲库歌曲聚合成指定歌手的专辑条目：
 * 同一专辑仅保留首次出现歌曲的路径，并累计歌曲数量。
 */
export function groupSongsIntoAlbumEntries(
  songs: readonly Song[],
  artistName: string,
): AlbumCatalogEntry[] {
  const buckets = new Map<string, AlbumCatalogEntry>();

  songs
    .filter((song) => songMatchesArtist(song, artistName))
    .forEach((song) => {
      const albumKey = deriveAlbumKey(song);
      const known = buckets.get(albumKey);
      buckets.set(
        albumKey,
        known
          ? { ...known, count: known.count + 1 }
          : {
              key: albumKey,
              name: song.album || 'Unknown',
              count: 1,
              artist: song.album_artist || song.artist || 'Unknown',
              firstSongPath: song.path,
            },
      );
    });

  return [...buckets.values()];
}

/** 依据排序模式构造条目比较器；未识别的模式按数量降序兜底 */
export function makeAlbumEntryComparator(
  mode: AlbumSortMode,
  customOrder: readonly string[],
): EntryComparator {
  if (mode === 'name') {
    return (one, another) => compareByAlphabetIndex(one.name, another.name);
  }

  if (mode === 'custom') {
    const positionOfKey = new Map(customOrder.map((key, position) => [key, position]));
    const positionOf = ({ key }: AlbumCatalogEntry) =>
      positionOfKey.get(key) ?? Number.MAX_SAFE_INTEGER;
    return (one, another) => positionOf(one) - positionOf(another);
  }

  if (mode === 'artist') {
    return (one, another) =>
      compareByAlphabetIndex(one.artist, another.artist)
      || compareByAlphabetIndex(one.name, another.name);
  }

  return (one, another) =>
    another.count - one.count || compareByAlphabetIndex(one.artist, another.artist);
}
