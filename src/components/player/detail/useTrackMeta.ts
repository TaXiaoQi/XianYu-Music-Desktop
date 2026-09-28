import { computed, type Ref } from 'vue';
import type { Song, SongDetail } from '../../../types';

export interface TrackMetaRow {
  label: string;
  value: string;
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** 把字节数折算成人类可读的体积文案 */
const humanizeSize = (bytes: number | undefined) => {
  if (!bytes || bytes <= 0) {
    return '';
  }

  let scaled = bytes;
  let unitAt = 0;
  while (scaled >= 1024 && unitAt < SIZE_UNITS.length - 1) {
    scaled /= 1024;
    unitAt += 1;
  }

  const digits = scaled >= 100 || unitAt === 0 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)} ${SIZE_UNITS[unitAt]}`;
};

/**
 * 歌词区上方的曲目元信息行（歌手/专辑/音质/风格/年份/大小）。
 * 本地元数据（SongDetail）优先，曲目自身字段兜底，空值行整体剔除。
 */
export function useTrackMeta(song: Ref<Song | null>, detail: Ref<SongDetail | null>) {
  const rows = computed<TrackMetaRow[]>(() => {
    const track = song.value;
    if (!track) {
      return [];
    }

    const enriched = detail.value;
    const pairs: Array<[string, string]> = [
      ['歌手', track.artist],
      ['专辑', track.album],
      ['音质', track.bitrate ? `${track.sample_rate}Hz / ${track.bitrate}kbps` : 'Standard'],
    ];

    const style = enriched?.genre || track.genre;
    if (style) {
      pairs.push(['风格', style]);
    }

    const releasedAt = enriched?.year || track.year;
    if (releasedAt) {
      pairs.push(['年份', releasedAt]);
    }

    if (enriched?.file_size) {
      pairs.push(['大小', humanizeSize(enriched.file_size)]);
    }

    return pairs
      .filter(([, value]) => Boolean(value))
      .map(([label, value]) => ({ label, value }));
  });

  return { rows };
}
