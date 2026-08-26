import type {Song} from '../../types';

/**
 * 封面状态域：预测「切歌后可能需要立即显示/预载」的封面候选路径。
 *
 * 纯函数，供播放编排在换歌时决定预取哪些缩略图/大图，减少切换时的封面白屏/闪烁。
 */

export interface FullCoverInput {
  song: Song;
  /** 当前临时队列（临时播放列表优先） */
  tempQueue: Song[];
  /** 当前主播放队列 */
  playQueue: Song[];
}

interface ThumbnailInput {
  song: Song;
  /** 临时队列路径（最高优先） */
  tempQueuePaths: string[];
  /** 主播放队列路径 */
  playQueuePaths: string[];
  /** 播放模式：2 = 随机 */
  playMode: number;
  /** 兜底队列来源（随机模式下候选不足时使用） */
  getDisplaySongList: () => Song[];
}

function pushUnique(target: string[], value: string | undefined): void {
  if (!value || target.includes(value)) return;
  target.push(value);
}

/**
 * 预计切到详情页大图时可能需要的封面路径：当前歌 + 临时队列首 + 队列相邻两首。
 * 由调用方决定是否执行 retainFullCoverPaths。
 */
export function likelyFullCoverPaths(input: FullCoverInput): string[] {
  const { song, tempQueue, playQueue } = input;
  const retainedPaths: string[] = [song.path];
  pushUnique(retainedPaths, tempQueue[0]?.path);

  const currentIndex = playQueue.findIndex(item => item.path === song.path);
  if (currentIndex >= 0 && playQueue.length > 1) {
    pushUnique(retainedPaths, playQueue[(currentIndex - 1 + playQueue.length) % playQueue.length]?.path);
    pushUnique(retainedPaths, playQueue[(currentIndex + 1) % playQueue.length]?.path);
  }
  return retainedPaths.slice(0, 4);
}

/**
 * 预计需要的缩略图封面路径：当前歌 + 临时队首 + 队列相邻两首 +（随机模式下）队列随机样本。
 * 供 preloadPriorityCovers 使用。
 */
export function likelyThumbnailPaths(input: ThumbnailInput): string[] {
  const { song, tempQueuePaths, playQueuePaths, playMode, getDisplaySongList } = input;
  const paths: string[] = [];
  pushUnique(paths, song.path);
  pushUnique(paths, tempQueuePaths[0]);

  const currentIndex = playQueuePaths.indexOf(song.path);
  if (currentIndex >= 0 && playQueuePaths.length > 1) {
    pushUnique(paths, playQueuePaths[(currentIndex - 1 + playQueuePaths.length) % playQueuePaths.length]);
    pushUnique(paths, playQueuePaths[(currentIndex + 1) % playQueuePaths.length]);
  }

  if (playMode === 2) {
    const candidatePaths = playQueuePaths.length
      ? playQueuePaths
      : getDisplaySongList().map(s => s.path);
    const randomPaths = candidatePaths
      .filter(p => p !== song.path)
      .slice(0, 5);
    randomPaths.forEach(p => pushUnique(paths, p));
  }
  return paths;
}