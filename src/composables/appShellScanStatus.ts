import { computed, type Ref } from 'vue';
import type { LibraryScanProgress } from '../types';

type ScanProgressSource = Ref<LibraryScanProgress | null | undefined>;

const PERCENT_FLOOR = 6;
const PERCENT_CEILING = 100;
const PERCENT_WHEN_TOTAL_UNKNOWN = 8;
const DEFAULT_SCAN_CAPTION = '扫描音乐库';

const SCAN_PHASE_CAPTIONS = new Map<string, string>([
  ['collecting', '扫描文件'],
  ['parsing', '解析元数据'],
  ['writing', '写入音乐库'],
  ['complete', '扫描完成'],
  ['error', '扫描失败'],
]);

/**
 * 把音乐库扫描进度折算成外壳需要的三个展示量：
 * 百分比（带上下限钳制）、阶段文案、多文件夹进度文案。
 */
export function createLibraryScanStatus(progress: ScanProgressSource) {
  const percent = computed(() => {
    const snapshot = progress.value;
    if (!snapshot) {
      return 0;
    }
    if (snapshot.total <= 0) {
      return PERCENT_WHEN_TOTAL_UNKNOWN;
    }
    const rawPercent = (snapshot.current / snapshot.total) * 100;
    return Math.min(PERCENT_CEILING, Math.max(PERCENT_FLOOR, rawPercent));
  });

  const phaseLabel = computed(() => {
    const caption = SCAN_PHASE_CAPTIONS.get(progress.value?.phase ?? '');
    return caption ?? DEFAULT_SCAN_CAPTION;
  });

  const folderLabel = computed(() => {
    const snapshot = progress.value;
    if (!snapshot || snapshot.folder_total <= 1) {
      return '';
    }
    return `文件夹 ${snapshot.folder_index}/${snapshot.folder_total}`;
  });

  return {
    percent,
    phaseLabel,
    folderLabel,
  };
}
