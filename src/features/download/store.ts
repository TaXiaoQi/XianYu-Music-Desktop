import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useDownloadStore = defineStore('download', () => {
  const isDownloading = ref(false);
  const downloadingSongPath = ref<string | null>(null);
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
