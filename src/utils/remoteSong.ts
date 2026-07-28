import { LX_SOURCE_NAMES, type LxSourceId } from '../services/lxMusicSdk';

export const isRemoteSong = (song: { path?: string; source_type?: string } | null | undefined) =>
  song?.source_type === 'remote' || song?.path?.startsWith('remote://') === true;

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
