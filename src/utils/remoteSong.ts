import { LX_SOURCE_NAMES, type LxSourceId } from '../services/lxMusicSdk';

export const isRemoteSong = (song: { path?: string; source_type?: string } | null | undefined) =>
  song?.source_type === 'remote' || song?.path?.startsWith('remote://') === true;

/**
 * 把 lx 音源的 interval 时长字符串解析为秒数。
 *
 * 支持 "mm:ss"、"hh:mm:ss" 以及纯秒数字符串（如 "263"）。无法解析时返回 0。
 *
 * 在线歌走 Rust 内核播放后，后端不回传真实时长，进度条显示与点击跳转都依赖前端提供的
 * song.duration。搜索结果构造 Song 时若不填 duration（旧代码硬编码为 0），会导致进度条
 * 不动、点击进度条无法跳转。此函数用于从 interval 还原 duration。
 */
export const parseIntervalToSeconds = (interval?: string | null): number => {
  if (!interval) return 0;
  const parts = interval.trim().split(':').map(part => parseInt(part, 10));
  if (parts.length === 0 || parts.some(n => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

/**
 * 获取歌曲的来源标签。
 *
 * 落雪音源歌曲（`lx://<source>/<songmid>`）返回对应的音源名称（如"小蜗音乐"），
 * 其他远程歌曲（WebDAV 等）返回"远程"。
 */
export const getSongSourceLabel = (
  song: { path?: string; source_type?: string } | null | undefined,
): string => {
  const path = song?.path;
  if (path?.startsWith('lx://')) {
    const sourceId = path.slice('lx://'.length).split('/')[0] as LxSourceId;
    return LX_SOURCE_NAMES[sourceId] ?? '在线';
  }

  return '远程';
};
