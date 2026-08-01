import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * 下载状态 store（跨组件共享）
 *
 * 底栏下载按钮和右键菜单下载共用此 store，
 * 确保任意入口触发下载时，底栏下载 UI 都能联动展示「下载中」动画。
 */
export const useDownloadStore = defineStore('download', () => {
  /** 是否正在下载 */
  const isDownloading = ref(false);
  /** 正在下载的歌曲 path（用于底栏判断是否是当前播放歌曲） */
  const downloadingSongPath = ref<string | null>(null);
  /** 下载进度（0-100，预留） */
  const progress = ref(0);

  const beginDownload = (songPath: string) => {
    isDownloading.value = true;
    downloadingSongPath.value = songPath;
    progress.value = 0;
  };

  const setProgress = (percent: number) => {
    progress.value = percent;
  };

  const endDownload = () => {
    isDownloading.value = false;
    downloadingSongPath.value = null;
    progress.value = 0;
  };

  return {
    isDownloading,
    downloadingSongPath,
    progress,
    beginDownload,
    setProgress,
    endDownload,
  };
});
