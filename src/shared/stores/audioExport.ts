import { ref, computed } from 'vue';
import { defineStore } from 'pinia';

export const useAudioExportStore = defineStore('audioExport', () => {
  /** 是否正在导出 */
  const isExporting = ref(false);
  /** 导出进度 (0~1) */
  const progress = ref(0);
  /** 导出状态文字 */
  const statusText = ref('就绪');
  /** 导出目录 */
  const exportDirectory = ref(localStorage.getItem('audio_export_dir') || '');
  /** 最后保存的文件路径 */
  const savedFilePath = ref('');
  /** 最后导出的文件名 */
  const lastFileName = ref('');
  /** 导出是否出错 */
  const hasError = ref(false);

  /** 进度百分比 (0~100) */
  const progressPercent = computed(() => Math.round(progress.value * 100));

  /** 设置导出目录并持久化 */
  const setExportDirectory = (dir: string) => {
    exportDirectory.value = dir;
    localStorage.setItem('audio_export_dir', dir);
  };

  /** 开始导出 */
  const startExport = () => {
    isExporting.value = true;
    progress.value = 0;
    hasError.value = false;
    statusText.value = '正在准备...';
  };

  /** 更新进度 */
  const updateProgress = (p: number, text?: string) => {
    progress.value = p;
    if (text) statusText.value = text;
  };

  /** 导出成功 */
  const finishExport = (filePath: string, fileName: string) => {
    isExporting.value = false;
    progress.value = 1;
    hasError.value = false;
    statusText.value = `已导出: ${fileName}`;
    savedFilePath.value = filePath;
    lastFileName.value = fileName;
    // 3 秒后自动隐藏完成状态
    setTimeout(() => {
      if (!isExporting.value && statusText.value.startsWith('已导出')) {
        statusText.value = '就绪';
        progress.value = 0;
      }
    }, 5000);
  };

  /** 导出失败 */
  const failExport = (error: string) => {
    isExporting.value = false;
    hasError.value = true;
    statusText.value = `导出失败: ${error}`;
  };

  /** 重置状态 */
  const reset = () => {
    isExporting.value = false;
    progress.value = 0;
    statusText.value = '就绪';
    hasError.value = false;
  };

  return {
    isExporting,
    progress,
    statusText,
    exportDirectory,
    savedFilePath,
    lastFileName,
    hasError,
    progressPercent,
    setExportDirectory,
    startExport,
    updateProgress,
    finishExport,
    failExport,
    reset,
  };
});
