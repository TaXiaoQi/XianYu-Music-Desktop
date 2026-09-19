import type { QualityKey, Song } from '../../types';
import { normalizeQualityKey } from '../../types';
import { downloadApi } from '../tauri/downloadApi';

export function parseQualitySizeText(size: unknown): number | null {
  if (typeof size === 'number') return size > 0 ? Math.floor(size) : null;
  if (typeof size !== 'string') return null;
  const s = size.trim().toLowerCase();
  if (!s || s === '0' || s === '未知' || s === 'unknown' || s === '--' || s === '-') return null;
  const m = /^([\d.]+)\s*([kmgt]?b?)$/.exec(s);
  if (!m) return null;
  const v = Number.parseFloat(m[1]);
  if (!Number.isFinite(v) || v <= 0) return null;
  const unit = m[2];
  const mult = unit === 'k' || unit === 'kb'
    ? 1024
    : unit === 'm' || unit === 'mb'
      ? 1024 * 1024
      : unit === 'g' || unit === 'gb'
        ? 1024 * 1024 * 1024
        : unit === 't' || unit === 'tb'
          ? 1024 * 1024 * 1024 * 1024
          : 1;
  return Math.round(v * mult);
}

export function readQualitySizeFromMeta(song: Song, quality: QualityKey): number | null {
  const scan = (raw: unknown): number | null => {
    if (!raw || typeof raw !== 'object') return null;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (normalizeQualityKey(k) !== quality) continue;
      const size = (v && typeof v === 'object')
        ? (v as Record<string, unknown>).size
        : undefined;
      const bytes = parseQualitySizeText(size);
      if (bytes != null) return bytes;
    }
    return null;
  };
  const rawData = (song as any).rawData;
  if (rawData && typeof rawData === 'object') {
    const r = scan((rawData as any).qualities);
    if (r != null) return r;
  }
  const direct = scan((song as any).qualities);
  if (direct != null) return direct;
  const lx = scan((song as any)._types);
  if (lx != null) return lx;
  if (rawData && typeof rawData === 'object') {
    return scan((rawData as any)._types);
  }
  return null;
}

export async function probeSizesForKeys(
  song: Song,
  keys: QualityKey[],
  urlFor: (q: QualityKey) => string | undefined,
  onSize: (q: QualityKey, bytes: number) => void,
): Promise<void> {
  await Promise.all(keys.map(async (q) => {
    const url = urlFor(q);
    if (url) {
      try {
        const info = await downloadApi.probeUrlSize(url);
        if (typeof info?.size === 'number' && info.size > 0) {
          onSize(q, info.size);
          return;
        }
      } catch (e: any) {
        console.warn(`[QualitySize] ${q} 体积探测失败:`, e?.message || e);
      }
    }
    const meta = readQualitySizeFromMeta(song, q);
    if (meta != null) onSize(q, meta);
  }));
}
