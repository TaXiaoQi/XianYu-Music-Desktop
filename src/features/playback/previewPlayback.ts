import type { Song } from '../../types';
import {
  extractPluginTrackId,
  fetchQishuiPreviewInfo,
  formatPreviewClock,
  isQishuiPluginPath,
  type PreviewClipInfo,
} from './onlineFailover';

interface PreviewPlaybackDeps {
  getCurrentSong: () => Song | null;
  getCurrentTime: () => number;
  reanchorPlaybackClock: (time: number) => void;
  patchCurrentSong: (song: Song) => void;
  patchQueueSongMeta: (path: string, patch: Partial<Song>) => void;
  showToast: (message: string, type: 'info') => void;
}

export const createPreviewPlayback = ({
  getCurrentSong,
  getCurrentTime,
  reanchorPlaybackClock,
  patchCurrentSong,
  patchQueueSongMeta,
  showToast,
}: PreviewPlaybackDeps) => {
  let activePreviewClip: PreviewClipInfo | null = null;
  let previewClipPath = '';
  let previewDetectedPath = '';

  const handlePreviewClipDetected = async (song: Song, actualDuration: number) => {
    previewDetectedPath = song.path;
    const trackId = isQishuiPluginPath(song.path) ? extractPluginTrackId(song.path) : '';
    const previewInfo = trackId ? await fetchQishuiPreviewInfo(trackId) : null;

    if (getCurrentSong()?.path !== song.path) return;

    if (previewInfo && Math.abs(previewInfo.duration - actualDuration) <= 3) {
      activePreviewClip = { start: previewInfo.start, duration: actualDuration };
      previewClipPath = song.path;
      reanchorPlaybackClock(previewInfo.start + getCurrentTime());
      showToast(
        `「${song.title?.trim() || song.name.replace(/\.[^/.]+$/, '')}」为 VIP 试听片段（${Math.round(actualDuration)} 秒，${formatPreviewClock(previewInfo.start)} 起），完整播放请配置插件登录或更换音源`,
        'info',
      );
      return;
    }

    activePreviewClip = { start: 0, duration: actualDuration };
    previewClipPath = song.path;
    const flooredDuration = Math.floor(actualDuration);
    if (song.duration !== flooredDuration) {
      const nextSong = { ...song, duration: flooredDuration };
      patchCurrentSong(nextSong);
      patchQueueSongMeta(song.path, { duration: flooredDuration });
    }
    reanchorPlaybackClock(Math.min(getCurrentTime(), actualDuration));
    showToast(
      `当前音源仅为试听片段（约 ${flooredDuration} 秒），完整播放请更换音源或配置插件登录`,
      'info',
    );
  };

  return {
    getActivePreviewClip: () => activePreviewClip,
    setActivePreviewClip: (clip: PreviewClipInfo | null) => { activePreviewClip = clip; },
    getPreviewPath: () => previewClipPath,
    setPreviewPath: (path: string) => { previewClipPath = path; },
    getPreviewDetectedPath: () => previewDetectedPath,
    setPreviewDetectedPath: (path: string) => { previewDetectedPath = path; },
    handlePreviewClipDetected,
  };
};
