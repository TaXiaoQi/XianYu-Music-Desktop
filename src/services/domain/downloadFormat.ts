/**
 * 在线下载服务 · 格式化叶子模块。
 *
 * 汇聚纯函数：统一音质档位、候选音质生成（按回退方向）、在线歌曲协议判定、
 * 文件名清洗 / 样式拼接 / 扩展名推断。零插件依赖，同时被
 * downloadQualityResolver / downloadExecutor 复用。
 */
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

/** 统一音质档位（兼容 LX / MF）：插件支持多少，就显示多少 */
export type LxQuality = QualityKey;

/**
 * 从目标音质向下降级，生成候选音质列表（用于自动回退）。
 * 基于 ALL_QUALITY_KEYS_DESC（12 档从高到低），从目标音质位置开始截取下半段。
 * 例：选 'master' → [master, atmos_plus, atmos, dolby, vinyl, hires, flac24bit, flac, 320k, 192k, 128k, mgg]
 *     选 '320k' → [320k, 192k, 128k, mgg]
 *     选 'flac'  → [flac, 320k, 192k, 128k, mgg]
 */
export function qualityToLxCandidates(quality: DownloadQuality): LxQuality[] {
  const q = (quality ?? '320k') as QualityKey;
  const startIdx = ALL_QUALITY_KEYS_DESC.indexOf(q);
  if (startIdx === -1) {
    // 未知音质：从 320k 开始向下降级
    const fallbackIdx = ALL_QUALITY_KEYS_DESC.indexOf('320k');
    return ALL_QUALITY_KEYS_DESC.slice(fallbackIdx);
  }
  return ALL_QUALITY_KEYS_DESC.slice(startIdx);
}

/** 按下载设置的回退方向生成候选音质列表 */
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

/** 判断是否为可下载的在线歌曲（lx:// 或 plugin:// 协议） */
export function isDownloadableOnlineSong(
  song: { path?: string; source_type?: string } | null | undefined,
): boolean {
  if (!song) return false;
  const path = song.path ?? '';
  return path.startsWith('lx://') || path.startsWith('plugin://');
}

/** 判断歌曲是否走 plugin:// 协议（MusicFree 插件音源） */
export function isPluginSong(song: { cue_source_path?: string; path?: string }): boolean {
  const path = song.cue_source_path || song.path || '';
  return path.startsWith('plugin://');
}

/** 清洗文件名中的非法字符（Windows 与跨平台通用）——前端回退实现，权威实现在 Rust */
export function sanitizeFileName(name: string): string {
  return name
    // eslint-disable-next-line no-control-regex -- 控制字符在文件名中非法，需主动剔除
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'download';
}

/**
 * 从 URL 推断文件扩展名（含点，如 ".flac"）；失败返回空串。
 * 复用 audioQualityVerify 的实现，与播放侧共用同一套判定。
 */
export const extFromUrl = extFromUrlShared;

/** 根据命中的落雪档位推断扩展名兜底 */
export function extFromQuality(quality: LxQuality): string {
  return QUALITY_META[quality]?.isLossless ? '.flac' : '.mp3';
}

/** 按样式拼接文件名主体（不含扩展名）——前端回退实现，权威实现在 Rust */
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

/** 构造下载文件名（不含目录）——前端回退实现，权威实现在 Rust */
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