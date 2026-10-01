import type { Song } from '../types';

// ==================== 本地曲库匹配 ====================

function normMeta(s: string): string {
  return (s || '').trim().toLowerCase();
}

function isLocalFilePath(path: string): boolean {
  return !!path
    && !path.startsWith('lx://')
    && !path.startsWith('plugin://')
    && !path.startsWith('http://')
    && !path.startsWith('https://');
}

function normalizeDurationSec(duration: number): number {
  if (!duration || duration <= 0) return 0;
  return duration > 1000 ? Math.round(duration / 1000) : Math.round(duration);
}

export interface LibraryMatchIndex {
  byPath: Map<string, Song>;
  byMeta: Map<string, Song[]>;
}

export function buildLibraryMatchIndex(songList: Song[]): LibraryMatchIndex {
  const byPath = new Map<string, Song>();
  const byMeta = new Map<string, Song[]>();
  for (const song of songList) {
    byPath.set(song.path, song);
    const key = `${normMeta(song.title || song.name || '')}|${normMeta(song.artist || '')}`;
    const arr = byMeta.get(key) ?? [];
    arr.push(song);
    byMeta.set(key, arr);
  }
  return { byPath, byMeta };
}

export function resolveLocalPath(index: LibraryMatchIndex, song: Song): string {
  const cloudPath = song.path || '';
  if (!isLocalFilePath(cloudPath)) return cloudPath;
  if (index.byPath.has(cloudPath)) return cloudPath;
  const key = `${normMeta(song.title || song.name || '')}|${normMeta(song.artist || '')}`;
  const candidates = index.byMeta.get(key) ?? [];
  if (candidates.length === 0) return cloudPath;
  if (candidates.length === 1) return candidates[0].path;
  const durationSec = normalizeDurationSec(song.duration || 0);
  if (durationSec <= 0) return candidates[0].path;
  let best: Song | undefined;
  let bestDiff = 5;
  for (const c of candidates) {
    const diff = Math.abs((c.duration || 0) - durationSec);
    if (diff <= bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  return best?.path ?? cloudPath;
}
