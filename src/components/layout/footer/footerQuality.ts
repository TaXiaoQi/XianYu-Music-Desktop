import type { DownloadQuality, QualityKey, Song } from '../../../types';
import { ALL_QUALITY_KEYS, QUALITY_META } from '../../../types';
import { formatFileSize } from '../../../utils/format';

export type DownloadQualityFallback = 'lower' | 'higher';

export interface QualityOption {
  label: string;
  value: QualityKey;
  description: string;
}

/** 底栏音质缩写：与移动端一致，仅用于紧凑展示。 */
export const QUALITY_ABBR: Record<QualityKey, string> = {
  mgg: 'LQ',
  '128k': '128',
  '192k': '192',
  '320k': 'HQ',
  flac: 'SQ',
  flac24bit: 'HR',
  hires: 'HRA',
  vinyl: 'VL',
  dolby: 'DA',
  atmos: 'AT',
  atmos_plus: 'AT+',
  master: 'MS',
};

/** 全量音质选项，按 rank 升序（低→高）。 */
export const ALL_QUALITY_OPTIONS: QualityOption[] = ALL_QUALITY_KEYS.map(key => ({
  label: QUALITY_META[key].label,
  value: key,
  description: QUALITY_META[key].description,
}));

export const qualityAbbr = (key: QualityKey | null | undefined): string => (
  key ? (QUALITY_ABBR[key] ?? 'HQ') : 'HQ'
);

export const compactFileSize = (bytes: number): string =>
  formatFileSize(bytes).replace(/\s*MB$/, 'M').replace(/\s*GB$/, 'G').replace(/\s*KB$/, 'K');

export const getAudioExtLabel = (key: QualityKey, url?: string): string => {
  if (url) {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      const match = pathname.match(/\.([a-z0-9]+)$/);
      if (match?.[1]) return match[1].toUpperCase();
    } catch {
      const match = url.toLowerCase().match(/\.([a-z0-9]+)(?:[?#]|$)/);
      if (match?.[1]) return match[1].toUpperCase();
    }
  }
  return QUALITY_META[key]?.isLossless ? 'FLAC' : 'MP3';
};

export const localFormatLabel = (song: Song | null): string => {
  if (!song) return '';
  const raw = song.format || song.codec || song.container;
  if (raw) return raw.toUpperCase();
  const ext = song.path.split('.').pop();
  return ext ? ext.toUpperCase() : '';
};

const LOSSLESS_FORMATS = ['flac', 'ape', 'wav', 'alac', 'aiff', 'dsd', 'dff', 'dsf', 'wv', 'wavpack'];

export const localQualityLabel = (song: Song | null): string => {
  if (!song) return 'HQ';
  if (song.bit_depth && song.bit_depth >= 24) return QUALITY_ABBR.flac24bit;
  const fmt = (song.format || song.codec || song.container || '').toLowerCase();
  if (LOSSLESS_FORMATS.some(f => fmt.includes(f))) return QUALITY_ABBR.flac;
  const bitrateKbps = song.bitrate
    ? (song.bitrate > 1000 ? Math.round(song.bitrate / 1000) : song.bitrate)
    : 0;
  if (bitrateKbps >= 320) return QUALITY_ABBR['320k'];
  if (bitrateKbps >= 192) return QUALITY_ABBR['192k'];
  if (bitrateKbps >= 128) return QUALITY_ABBR['128k'];
  if (bitrateKbps > 0) return QUALITY_ABBR.mgg;
  return localFormatLabel(song) || 'HQ';
};

/**
 * 期望下载音质在可用档位中不可用时，按用户回退偏好挑选最接近的档位。
 * 可用档位为空或已包含期望值时原样返回。
 */
export const resolveEffectiveDownloadQuality = (
  preferred: DownloadQuality,
  available: QualityKey[] | null,
  fallbackBehavior: DownloadQualityFallback | undefined,
): DownloadQuality => {
  if (!available || available.length === 0 || available.includes(preferred)) {
    return preferred;
  }

  const behavior = fallbackBehavior ?? 'lower';
  const preferredRank = QUALITY_META[preferred]?.rank ?? QUALITY_META['320k'].rank;
  const sorted = [...available].sort((a, b) => QUALITY_META[a].rank - QUALITY_META[b].rank);

  if (behavior === 'higher') {
    return sorted.find(q => QUALITY_META[q].rank > preferredRank)
      ?? sorted[sorted.length - 1];
  }
  return [...sorted].reverse().find(q => QUALITY_META[q].rank < preferredRank)
    ?? sorted[0];
};
