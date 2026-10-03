import type {Song} from '../../types';
import type {PlaySongOptions} from './playerPlaybackTypes';

/**
 * 播放请求的纯逻辑与判定。
 *
 * 这里只放不触碰响应式状态、不发起副作用的函数：既能被 playSong 复用，
 * 也能被单测直接覆盖。任何需要 await 或写 store 的逻辑都不要放进来。
 */

export const getSmtcTitle = (song: Song): string =>
  song.title?.trim() || song.name.replace(/\.[^/.]+$/, '');

export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const isSameCurrentlyPlayingSong = (
  song: Song,
  previousSong: Song | null,
  isPlaying: boolean,
  options: PlaySongOptions,
): boolean =>
  !!previousSong
  && previousSong.path === song.path
  && isPlaying
  && !options.continueStatisticsSession
  && options.startTime === undefined
  && !options.forceReplay
  && !options._sourceSwitchCtx;

export const isQualitySwitchRequest = (
  song: Song,
  previousSong: Song | null,
  options: PlaySongOptions,
): boolean =>
  !!options.continueStatisticsSession
  && !!previousSong
  && previousSong.path === song.path;

export const isOriginalOnlinePath = (audioFilePath: string): boolean =>
  audioFilePath.startsWith('lx://') || audioFilePath.startsWith('plugin://');

export const shouldStopPreviousAudioBeforeOnlineResolve = (
  audioFilePath: string,
  isPlaying: boolean,
  storeIsPlaying: boolean,
  previousSong: Song | null,
  song: Song,
  qualitySwitch: boolean,
): boolean =>
  isOriginalOnlinePath(audioFilePath)
  && (isPlaying || storeIsPlaying)
  && (previousSong?.path !== song.path || qualitySwitch);

export const shouldFadeOnSwitch = (
  fadeEnabled: boolean,
  isPlaying: boolean,
  previousSong: Song | null,
  song: Song,
): boolean =>
  fadeEnabled
  && isPlaying
  && !!previousSong
  && previousSong.path !== song.path;

export const buildQueueWithInsertedSong = (
  song: Song,
  previousSong: Song | null,
  queue: Song[],
): Song[] => {
  if (previousSong?.path === song.path) {
    return queue.length > 0 ? [...queue] : [song];
  }

  const queueWithoutSong = queue.filter(item => item.path !== song.path);

  if (!previousSong) {
    return [song];
  }

  const baseQueue = queueWithoutSong.length > 0 ? queueWithoutSong : [previousSong];
  const currentIndex = baseQueue.findIndex(item => item.path === previousSong.path);

  if (currentIndex === -1) {
    return [previousSong, song, ...baseQueue];
  }

  return [
    ...baseQueue.slice(0, currentIndex + 1),
    song,
    ...baseQueue.slice(currentIndex + 1),
  ];
};

/**
 * 把预览片段（汽水等）的请求时间夹回片段自身区间，
 * 避免把整曲时间轴上的进度塞进只能播几十秒的片段里。
 */
export const clampResumeTimeToPreviewClip = (
  resumeTime: number,
  activeClip: {start: number; duration: number} | null,
): number => {
  if (!activeClip) return resumeTime;
  return Math.max(
    activeClip.start,
    Math.min(resumeTime, activeClip.start + activeClip.duration - 1),
  );
};

/**
 * 请求是否已被更新的播放请求取代 / 是否已切到别的歌。
 * 所有异步回调都靠它做竞态守卫。
 */
export const isStaleRequest = (
  requestId: number,
  currentPlayRequestId: number,
  currentSongPath: string | undefined,
  songPath: string,
): boolean =>
  requestId !== currentPlayRequestId || currentSongPath !== songPath;
