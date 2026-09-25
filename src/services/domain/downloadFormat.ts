import type {
  DownloadFileNameStyle,
  DownloadQuality,
  DownloadQualityFallbackBehavior,
  Song,
  QualityKey,
} from '../../types';
import {
  ALL_QUALITY_KEYS,
  ALL_QUALITY_KEYS_DESC,
  QUALITY_META,
} from '../../types';
import {
  extFromUrl as extFromUrlShared,
} from './audioQualityVerify';

export type LxQuality = QualityKey;

export function qualityToLxCandidates(quality: DownloadQuality): LxQuality[] {
  const q = (quality ?? '320k') as QualityKey;
  const startIdx = ALL_QUALITY_KEYS_DESC.indexOf(q);
  if (startIdx === -1) {
    const fallbackIdx = ALL_QUALITY_KEYS_DESC.indexOf('320k');
    return ALL_QUALITY_KEYS_DESC.slice(fallbackIdx);
  }
  return ALL_QUALITY_KEYS_DESC.slice(startIdx);
}

export function qualityToDownloadCandidates(
  quality: DownloadQuality,
  fallbackBehavior: DownloadQualityFallbackBehavior = 'lower',
): LxQuality[] {
  const q = (quality ?? '320k') as QualityKey;
  const preferredIdx = ALL_QUALITY_KEYS.indexOf(q);
  if (preferredIdx === -1) {
    return qualityToLxCandidates('320k');
  }

  const result: LxQuality[] = [q];
  if (fallbackBehavior === 'higher') {
    for (let i = preferredIdx + 1; i < ALL_QUALITY_KEYS.length; i++) {
      result.push(ALL_QUALITY_KEYS[i]);
    }
  } else {
    for (let i = preferredIdx - 1; i >= 0; i--) {
      result.push(ALL_QUALITY_KEYS[i]);
    }
  }
  return result;
}

export function isDownloadableOnlineSong(
  song: { path?: string; source_type?: string } | null | undefined,
): boolean {
  if (!song) return false;
  const path = song.path ?? '';
  return path.startsWith('lx://') || path.startsWith('plugin://');
}

export function isPluginSong(song: { cue_source_path?: string; path?: string }): boolean {
  const path = song.cue_source_path || song.path || '';
  return path.startsWith('plugin://');
}

export function sanitizeFileName(name: string): string {
  return name
    // 控制字符（\x00-\x1f）正是这里要清理的目标，不能从字符类里去掉
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'download';
}

export const extFromUrl = extFromUrlShared;

export function extFromQuality(quality: LxQuality): string {
  return QUALITY_META[quality]?.isLossless ? '.flac' : '.mp3';
}

export function buildFileNameBase(song: Song, style: DownloadFileNameStyle): string {
  const title = song.title || song.name || '未知歌曲';
  const artist = song.artist || '';
  const album = song.album || '';

  let parts: string[];
  switch (style) {
    case 'title-artist':
      parts = [title, artist];
      break;
    case 'title-artist-album':
      parts = [title, artist, album];
      break;
    case 'artist-title':
    default:
      parts = [artist, title];
      break;
  }

  const joined = parts.map((p) => p.trim()).filter(Boolean).join(' - ');
  return joined || title;
}

export function buildDownloadFileName(
  song: Song,
  url: string,
  hitQuality: LxQuality,
  keepSourceFilename: boolean,
  style: DownloadFileNameStyle = 'artist-title',
): string {
  const ext = extFromUrl(url) || extFromQuality(hitQuality);

  if (keepSourceFilename) {
    try {
      const u = new URL(url);
      const base = u.pathname.split('/').pop() || '';
      if (base && base.includes('.')) {
        return sanitizeFileName(decodeURIComponent(base.slice(0, base.lastIndexOf('.')))) + ext;
      }
    } catch {
      // fallthrough
    }
  }

  return sanitizeFileName(buildFileNameBase(song, style)) + ext;
}