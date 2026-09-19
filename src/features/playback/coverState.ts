import type {Song} from '../../types';


export interface FullCoverInput {
  song: Song;
  tempQueue: Song[];
  playQueue: Song[];
}

interface ThumbnailInput {
  song: Song;
  tempQueuePaths: string[];
  playQueuePaths: string[];
  playMode: number;
  getDisplaySongList: () => Song[];
}

function pushUnique(target: string[], value: string | undefined): void {
  if (!value || target.includes(value)) return;
  target.push(value);
}

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