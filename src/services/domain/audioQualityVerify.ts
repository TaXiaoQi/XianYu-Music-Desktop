
import { ALL_QUALITY_KEYS, QUALITY_META } from '../../types';
import type { QualityKey } from '../../types';

const AUDIO_EXT_PATTERN = /^\.(mp3|flac|wav|m4a|aac|ape|ogg|wma)$/;

const LOSSY_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.wma']);

export function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const dot = pathname.lastIndexOf('.');
    if (dot === -1) return '';
    const ext = pathname.slice(dot).toLowerCase();
    return AUDIO_EXT_PATTERN.test(ext) ? ext : '';
  } catch {
    return '';
  }
}

export function isDegradedLossless(quality: QualityKey, url: string): boolean {
  if (!QUALITY_META[quality]?.isLossless) return false;
  const ext = extFromUrl(url);
  if (!ext) return false;
  return LOSSY_EXTENSIONS.has(ext);
}

export function resolveActualQuality(quality: QualityKey, url: string): QualityKey {
  if (!isDegradedLossless(quality, url)) return quality;

  const claimedIdx = ALL_QUALITY_KEYS.indexOf(quality);
  if (claimedIdx <= 0) return quality;

  for (let i = claimedIdx - 1; i >= 0; i--) {
    const candidate = ALL_QUALITY_KEYS[i];
    if (!QUALITY_META[candidate].isLossless) return candidate;
  }

  return quality;
}
