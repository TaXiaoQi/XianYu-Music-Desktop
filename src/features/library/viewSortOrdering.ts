import type { AlbumDetailSortMode, LocalSortMode, PlaylistSortMode } from '../../services/storage/playerStorage';
import type { Song } from '../../types';
import { compareSongPathsByTrackNumber } from './playerLibraryViewShared';

type TextRule = (song: Song | undefined) => string;

// 文本排序键的取值与空值兜底；比较统一走 zh-CN localeCompare。
const TEXT_RULES: Record<string, TextRule> = {
  title: song => (song?.title || song?.name || ''),
  artist: song => (song?.artist || ''),
  name: song => (song?.name || ''),
};

type NumericField = 'added_at' | 'file_modified_at';

const NUMERIC_RULES: Record<string, { field: NumericField; ascending: boolean }> = {
  added_at: { field: 'added_at', ascending: false },
  added_at_asc: { field: 'added_at', ascending: true },
  file_modified_at: { field: 'file_modified_at', ascending: false },
  file_modified_at_asc: { field: 'file_modified_at', ascending: true },
};

// 按排序键重排路径副本；未识别的模式原样返回。
export const orderPathsBySortMode = (
  paths: string[],
  mode: LocalSortMode | PlaylistSortMode,
  songsById: Map<string, Song>,
): string[] => {
  const ordered = [...paths];

  const textRule = TEXT_RULES[mode];
  if (textRule) {
    ordered.sort((left, right) =>
      textRule(songsById.get(left)).localeCompare(textRule(songsById.get(right)), 'zh-CN'),
    );
    return ordered;
  }

  const numericRule = NUMERIC_RULES[mode];
  if (numericRule) {
    const readValue = (path: string) => songsById.get(path)?.[numericRule.field] || 0;
    ordered.sort((left, right) =>
      numericRule.ascending
        ? readValue(left) - readValue(right)
        : readValue(right) - readValue(left),
    );
  }

  return ordered;
};

// 专辑详情视图：曲目号优先（可反转），其余模式委托通用排序。
export const orderPathsByAlbumDetailMode = (
  paths: string[],
  mode: AlbumDetailSortMode,
  songsById: Map<string, Song>,
): string[] => {
  if (mode === 'track_number' || mode === 'track_number_desc') {
    const direction = mode === 'track_number_desc' ? -1 : 1;
    return [...paths].sort((left, right) =>
      direction * compareSongPathsByTrackNumber(left, right, songsById));
  }

  return orderPathsBySortMode(paths, mode as LocalSortMode, songsById);
};
