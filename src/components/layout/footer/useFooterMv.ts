import { watch, type Ref } from 'vue';

import {
  useBilibiliVideoBackground,
  supportsMusicVideo,
  probeMvFor,
  probeQueueMvs,
  mvProbeVerdict,
} from '../../../composables/useBilibiliVideoBackground';
import type { Song } from '../../../types';

interface FooterMvDeps {
  currentSong: Ref<Song | null>;
  getPlayQueue: () => Song[];
  getPlayMode: () => number;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  /** MV 开关展开时收起底栏工具弹层。 */
  closeFooterTools: () => void;
}

/**
 * 底栏 MV 背景视频接线：开关、状态透出，以及起播/切歌时的可用性探测
 * 与「MV 开启中切歌」的停/续判断。
 */
export const useFooterMv = ({
  currentSong,
  getPlayQueue,
  getPlayMode,
  showToast,
  closeFooterTools,
}: FooterMvDeps) => {
  const videoBackground = useBilibiliVideoBackground();
  const mvActive = videoBackground.requested;
  const mvLoading = videoBackground.loading;
  const mvPhase = videoBackground.phase;
  const mvBufferedSec = videoBackground.bufferedSec;
  const mvVideoActive = videoBackground.active;
  const mvSupport = supportsMusicVideo;

  const toggleMv = async () => {
    if (!currentSong.value) return;
    closeFooterTools();
    try {
      await videoBackground.toggle(currentSong.value);
    } catch (e: any) {
      console.warn('[MV] 切换失败:', e?.message || e);
      showToast(e?.message || 'MV 打开失败', 'error');
    }
  };

  watch(
    () => currentSong.value?.path,
    (path) => {
      if (!path) {
        void videoBackground.stop();
        return;
      }
      // 起播/切歌后静默探测当前歌与队列后续 4 首的 MV 可用性
      // （真实解析结论决定 MV 入口显隐，与移动端一致）。
      const cur = currentSong.value;
      if (cur) {
        void probeMvFor(cur);
        const q = getPlayQueue() || [];
        const idx = q.findIndex((s: Song) => s.path === cur.path);
        if (idx >= 0 && q.length > 1 && getPlayMode() !== 1) {
          const upcoming: Song[] = [];
          for (let k = 1; k <= 4; k++) upcoming.push(q[(idx + k) % q.length]);
          void probeQueueMvs(upcoming);
        }
      }
      if (!videoBackground.requested.value) return;
      const song = currentSong.value!;
      // MV 开启中切歌：只有「探测明确无 MV」才停；未探测的交给 start 内部
      // 解析自行验证，避免探测未完成时误停正在播放的 MV。
      if (mvProbeVerdict(song) === false) {
        void videoBackground.stop();
        return;
      }
      videoBackground.start(song).catch(() => {});
    },
  );

  return {
    videoBackground,
    mvActive,
    mvLoading,
    mvPhase,
    mvBufferedSec,
    mvVideoActive,
    mvSupport,
    toggleMv,
  };
};
