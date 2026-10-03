import type {Song} from '../../types';
import {likelyFullCoverPaths, likelyThumbnailPaths} from './coverState';

/**
 * 播放前的封面准备：决定要保留哪些大图、要预载哪些缩略图。
 *
 * 只做「路径集合计算 + 保留声明」，实际 IO 仍由调用方发起，
 * 以便 playSong 继续掌控 requestId 守卫。
 */

export interface CoverPreparationDeps {
  showPlayerDetail: () => boolean;
  tempQueue: () => Song[];
  playQueue: () => Song[];
  tempQueuePaths: () => string[];
  playQueuePaths: () => string[];
  playMode: () => number;
  getDisplaySongList: () => Song[];
  retainFullCoverPaths: (paths: string[]) => void;
}

export const createCoverPreparation = ({
  showPlayerDetail,
  tempQueue,
  playQueue,
  tempQueuePaths,
  playQueuePaths,
  playMode,
  getDisplaySongList,
  retainFullCoverPaths,
}: CoverPreparationDeps) => {
  const prepareDetailFullCovers = (song: Song): string[] => {
    if (!showPlayerDetail()) {
      return [];
    }

    const retainedPaths = likelyFullCoverPaths({
      song,
      tempQueue: tempQueue(),
      playQueue: playQueue(),
    });
    retainFullCoverPaths(retainedPaths);
    return retainedPaths;
  };

  const getLikelyThumbnailPaths = (song: Song) =>
    likelyThumbnailPaths({
      song,
      tempQueuePaths: tempQueuePaths(),
      playQueuePaths: playQueuePaths(),
      playMode: playMode(),
      getDisplaySongList,
    });

  return {
    prepareDetailFullCovers,
    getLikelyThumbnailPaths,
  };
};
