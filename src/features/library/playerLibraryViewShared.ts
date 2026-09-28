// 曲库视图共用的纯函数工具集：路径层级判断、艺人 / 专辑元数据归一，
// 以及曲目号相关的稳定排序比较。全部为无副作用函数，供播放器与库两侧复用。
import type {
  AlbumCatalogItem,
  ArtistCatalogItem,
  Song,
} from '../../types';

export type { AlbumCatalogItem as AlbumListItem };
export type { ArtistCatalogItem as ArtistListItem };

/** 统一 Windows / POSIX 分隔符，便于做目录层级比较 */
const toSlashSeparated = (value: string) => value.replace(/\\/g, '/');

/**
 * 判断 childPath 是否为 parentPath 的直接子项（仅一层目录）。
 * 只抹平分隔符差异，不做大小写归一，路径以曲库扫描结果为准。
 */
export function isDirectParent(parentPath: string, childPath: string): boolean {
  if (!parentPath || !childPath) {
    return false;
  }

  const parentDir = toSlashSeparated(parentPath).replace(/\/$/, '');
  const childDir = toSlashSeparated(childPath);
  const boundary = childDir.lastIndexOf('/');

  return boundary >= 0 && childDir.slice(0, boundary) === parentDir;
}

/** 艺人名候选字段：展示用合成字段优先，原始字段兜底 */
const ARTIST_NAME_FIELDS = ['effective_artist_names', 'artist_names'] as const;

/**
 * 取歌曲的艺人名列表：合成字段非空则直接采用，
 * 其次退回原始拆分字段，两者皆空时以主艺人占位。
 */
export function getSongArtistNames(song: Song): string[] {
  for (const field of ARTIST_NAME_FIELDS) {
    const candidates = song[field];
    if (Array.isArray(candidates) && candidates.length > 0) {
      return candidates;
    }
  }

  return [song.artist || 'Unknown'];
}

/** 元数据占位值判定：空白或 “unknown” 都视为无效 */
export function isMeaningfulMetadataValue(value: string | undefined): boolean {
  const text = (value ?? '').trim();
  return text.length > 0 && text.toLowerCase() !== 'unknown';
}

/** 艺人选项归一：去空白、剔除无效名、按首次出现顺序去重 */
export function normalizeArtistOptions(artists: string[] = []): string[] {
  const cleaned = artists.map(name => name.trim()).filter(isMeaningfulMetadataValue);
  return Array.from(new Set(cleaned));
}

/**
 * 右键菜单的“艺人”子菜单项：仅当某个字段能拆出
 * 多于一位艺人时才返回选项，否则交由上级隐藏子菜单。
 */
export function resolveArtistSubmenuOptions(song: Song): string[] {
  const merged = normalizeArtistOptions(song.effective_artist_names);
  if (merged.length > 1) {
    return merged;
  }

  const raw = normalizeArtistOptions(song.artist_names);
  return raw.length > 1 ? raw : [];
}

/** 主展示艺人：依候选顺序取第一个有效名，缺省为空串 */
export function resolvePrimaryArtistName(song: Song): string {
  const candidates = getSongArtistNames(song).map(name => name.trim());
  return candidates.find(isMeaningfulMetadataValue) ?? '';
}

/** 歌曲是否携带任何有效的艺人元数据 */
export function hasSongArtistMetadata(song: Song): boolean {
  const anyListedNameValid = [...song.artist_names, ...song.effective_artist_names]
    .some(isMeaningfulMetadataValue);

  return resolvePrimaryArtistName(song) !== '' || anyListedNameValid;
}

/** 专辑名是否可作为展示值（含 album_key 合成链路的兜底判断） */
export function hasSongAlbumMetadata(song: Song): boolean {
  if (isMeaningfulMetadataValue(song.album)) {
    return true;
  }

  const synthesizedKey = song.album_key?.trim() ?? '';
  return synthesizedKey !== '' && !synthesizedKey.toLowerCase().startsWith('unknown::');
}

/** 精确匹配：歌曲艺人名列表中是否包含指定名字 */
export function songHasArtist(song: Song, artistName: string): boolean {
  return getSongArtistNames(song).includes(artistName);
}

/** 专辑聚合键：优先预计算的 album_key，缺失时按 “专辑::艺人” 拼出 */
export function getSongAlbumKey(song: Song): string {
  if (song.album_key) {
    return song.album_key;
  }

  const albumPart = song.album || 'Unknown';
  const performerPart = song.album_artist || song.artist || 'Unknown';
  return `${albumPart}::${performerPart}`;
}

/** 歌曲是否属于指定专辑聚合键 */
export function matchesAlbumKey(song: Song, albumKey: string): boolean {
  return getSongAlbumKey(song) === albumKey;
}

/** 艺人搜索文本：主艺人 + 专辑艺人 + 全部候选名合并成小写串 */
export function getSongArtistSearchText(song: Song): string {
  const nameSources = [song.artist, song.album_artist, ...getSongArtistNames(song)];
  return nameSources.join(' ').toLowerCase();
}

/** 曲目标题展示值：title 缺失时退回文件名 */
export function getSongTitleLabel(song: Song): string {
  return song.title || song.name;
}

/** 文件名展示值 */
export function getSongFileNameLabel(song: Song): string {
  return song.name;
}

/**
 * 从 “3”、“1/10” 这类字符串里提出首个整数用于排序；
 * 无法解析时返回 null（排序时视为排在末尾）。
 */
export function parseSortIndexValue(value?: string): number | null {
  const digits = value?.trim().match(/\d+/);
  if (!digits) {
    return null;
  }

  const parsed = Number.parseInt(digits[0], 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

/**
 * 可空数值键的比较：缺失值恒排在其后，其余按数值升序。
 * 与曲目号排序的 “无碟号/曲目号沉底” 语义保持一致。
 */
function orderNullableIntegers(left: number | null, right: number | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
}

/**
 * 按曲目号排序路径：碟号优先，其次曲目号，最后以标题（zh-CN）
 * 和路径做稳定兜底，保证无元数据时顺序确定。
 */
export function compareSongPathsByTrackNumber(
  left: string,
  right: string,
  songLookup: Map<string, Song>,
): number {
  const leftEntry = songLookup.get(left);
  const rightEntry = songLookup.get(right);

  const discOrder = orderNullableIntegers(
    parseSortIndexValue(leftEntry?.disc_number),
    parseSortIndexValue(rightEntry?.disc_number),
  );
  if (discOrder !== 0) {
    return discOrder;
  }

  const trackOrder = orderNullableIntegers(
    parseSortIndexValue(leftEntry?.track_number),
    parseSortIndexValue(rightEntry?.track_number),
  );
  if (trackOrder !== 0) {
    return trackOrder;
  }

  const leftTitle = leftEntry ? getSongTitleLabel(leftEntry) : '';
  const rightTitle = rightEntry ? getSongTitleLabel(rightEntry) : '';

  return leftTitle.localeCompare(rightTitle, 'zh-CN') || left.localeCompare(right, 'zh-CN');
}
