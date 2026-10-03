import type {Song} from '../../types';

/**
 * 播放前的预加载调度：歌词播放器预热、历史记录写入。
 *
 * 这两件事都必须在「不阻塞起播」的前提下延后执行，
 * 因此统一走 requestIdleCallback，不支持时退化为受控定时器。
 */

export interface PreloadSchedulingDeps {
  isMainWindowLowPower: () => boolean;
  preloadLyricPlayer: () => Promise<unknown>;
  setManagedTimeout: (handler: () => void, timeout: number) => unknown;
  addToHistory: (song: Song) => void | Promise<void>;
}

const getIdleCallback = (): ((cb: () => void, opts?: {timeout: number}) => unknown) | undefined =>
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (window.requestIdleCallback.bind(window) as (cb: () => void, opts?: {timeout: number}) => unknown)
    : undefined;

/** 仅在线音源（lx:// / plugin://）需要预热歌词播放器，本地歌不预热。 */
export const isOnlineLyricPath = (song: Song): boolean => {
  const songPath = song.cue_source_path || song.path;
  return songPath.startsWith('lx://') || songPath.startsWith('plugin://');
};

export const createPreloadScheduling = ({
  isMainWindowLowPower,
  preloadLyricPlayer,
  setManagedTimeout,
  addToHistory,
}: PreloadSchedulingDeps) => {
  const scheduleLyricsPlayerPreload = (song: Song) => {
    if (!isOnlineLyricPath(song)) {
      return;
    }

    const preload = () => {
      if (!isMainWindowLowPower()) {
        void preloadLyricPlayer().catch(() => {});
      }
    };

    const requestIdle = getIdleCallback();
    if (requestIdle) {
      requestIdle(preload, { timeout: 1500 });
    } else {
      setManagedTimeout(preload, 0);
    }
  };

  const scheduleAddToHistory = (song: Song) => {
    const idle = getIdleCallback();

    if (idle) {
      idle(() => addToHistory(song), { timeout: 2000 });
    } else {
      setManagedTimeout(() => {
        void addToHistory(song);
      }, 500);
    }
  };

  return {
    scheduleLyricsPlayerPreload,
    scheduleAddToHistory,
  };
};
