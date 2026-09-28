import type { Song } from '../../types';

export const NO_ALBUM_SONGS_HINT = '未找到该专辑的歌曲';
export const UNNAMED_ALBUM_LABEL = '未知专辑';

const UNKNOWN_ALBUM_NAME = 'Unknown';
const ALBUM_KEY_GLUE = '::';
const FIRST_DISC_HINT = 1;
const UNRANKED_TRACK_HINT = Number.POSITIVE_INFINITY;

const zhTitleOrder = (left: string, right: string) => left.localeCompare(right, 'zh-CN');

/** 专辑归属键：优先取预生成的 album_key，缺失时按「专辑名::专辑艺术家」现算。 */
export const buildAlbumKey = (song: Song): string => {
  if (song.album_key) { return song.album_key; }
  const albumName = song.album || UNKNOWN_ALBUM_NAME;
  const albumOwner = song.album_artist || song.artist || UNKNOWN_ALBUM_NAME;
  return [albumName, albumOwner].join(ALBUM_KEY_GLUE);
};

/** 解析碟号/音轨序数：数字原样用，字符串取前导数字，取不到落到缺省值。 */
const readTrackOrdinal = (raw: string | number | undefined | null, missingHint: number): number => {
  if (typeof raw === 'number') { return raw; }
  if (typeof raw !== 'string') { return missingHint; }
  const leadingDigits = /^\d+/.exec(raw.trim());
  if (!leadingDigits) { return missingHint; }
  const parsed = Number.parseInt(leadingDigits[0], 10);
  return Number.isFinite(parsed) ? parsed : missingHint;
};

const compareWithinAlbum = (left: Song, right: Song): number => {
  const discGap = readTrackOrdinal(left.disc_number, FIRST_DISC_HINT) - readTrackOrdinal(right.disc_number, FIRST_DISC_HINT);
  if (discGap !== 0) { return discGap; }

  const trackGap = readTrackOrdinal(left.track_number, UNRANKED_TRACK_HINT) - readTrackOrdinal(right.track_number, UNRANKED_TRACK_HINT);
  if (trackGap !== 0) { return trackGap; }

  const titleOf = (song: Song) => song.title || song.name || '';
  return zhTitleOrder(titleOf(left), titleOf(right)) || zhTitleOrder(left.path, right.path);
};

/** 同专辑内排序：碟号 → 音轨号 → 标题（中文 collation）→ 路径。 */
export const orderAlbumSongs = (songs: Song[]): Song[] => [...songs].sort(compareWithinAlbum);

export const albumQueuedHint = (albumName: string): string => `已将专辑《${albumName}》添加到播放队尾`;
