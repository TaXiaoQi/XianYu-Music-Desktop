import { ref, watch, type Ref, type WatchSource } from 'vue';
import type { RenameConfig, RenameOperation, RenamePreview } from '../../../services/tauri/contracts';
import { toolboxApi } from '../../../services/tauri/toolboxApi';

// ===== 各向导步骤推送给 SettingsToolbox 的状态快照（对外事件契约，字段名不可改动）=====

export interface PreprocessNotice {
  targetPath: string;
  isScanning: boolean;
  hasScanned: boolean;
  removeTrackPrefix: boolean;
  items: Array<{
    originalName: string;
    newName: string;
  }>;
}

export interface TaggingNotice {
  targetPath: string;
  musicTagPath: string;
  isLaunching: boolean;
  hasLaunched: boolean;
}

export interface RenameNotice {
  targetPath: string;
  template: string;
  isScanning: boolean;
  hasScanned: boolean;
  items: Array<{
    originalName: string;
    newName: string;
  }>;
  skippedCount: number;
}

export interface RefreshNotice {
  targetPath: string;
  isRefreshing: boolean;
  refreshed: boolean;
}

// ===== 通用工具 =====

/** 任一依赖变化时（含首次挂载）把最新快照推给父级，对应各步骤的 preview-change 事件。 */
export function mirrorToParent(
  sources: WatchSource<unknown>[],
  notify: () => void,
  deep = false,
): void {
  watch(sources, notify, { immediate: true, deep });
}

/** 包一层异步任务：执行期间点亮 busy 标记，无论成败最终熄灭。 */
export async function withBusyFlag(flag: Ref<boolean>, job: () => Promise<void>): Promise<void> {
  flag.value = true;
  try {
    await job();
  } finally {
    flag.value = false;
  }
}

// ===== 预览/应用 重命名引擎（Step1 与 Step3 共用）=====

interface SweepVoice {
  say: (text: string, tone: 'success' | 'error') => void;
  doneText: (count: number) => string;
  /** Step1 需要“旧扫描作废”的竞态保护；Step3 的扫描由按钮手动触发，无需。 */
  raceGuard: boolean;
  /** 扫描失败时是否清空旧结果（Step1 清空，Step3 保留旧结果）。 */
  clearOnScanError: boolean;
}

export function useRenameSweep(voice: SweepVoice) {
  const rows = ref<RenamePreview[]>([]);
  const probing = ref(false);
  const committing = ref(false);
  const probed = ref(false);
  let ticket = 0;

  const isLatest = (mine: number) => !voice.raceGuard || mine === ticket;

  /** 清空扫描结果并复位状态（目标目录被清空时使用）。 */
  const blank = () => {
    rows.value = [];
    probed.value = false;
    probing.value = false;
  };

  const sweep = async (root: string, cfg: RenameConfig) => {
    const mine = voice.raceGuard ? ++ticket : 0;
    probing.value = true;

    try {
      const found = await toolboxApi.previewRename(root, cfg);

      if (!isLatest(mine)) {
        return;
      }

      rows.value = found;
      probed.value = true;
    } catch (err) {
      if (!isLatest(mine)) {
        return;
      }

      console.error(err);
      if (voice.clearOnScanError) {
        rows.value = [];
        probed.value = false;
      }
      voice.say(`扫描失败: ${err}`, 'error');
    } finally {
      if (isLatest(mine)) {
        probing.value = false;
      }
    }
  };

  const commit = async (pick: RenamePreview[], proceed: () => void) => {
    committing.value = true;

    try {
      const ops: RenameOperation[] = pick.map((row) => ({
        original_path: row.original_path,
        new_name: row.new_name,
      }));

      const touched = await toolboxApi.applyRename(ops);
      voice.say(voice.doneText(touched), 'success');
      proceed();
    } catch (err) {
      console.error(err);
      voice.say(`应用修改失败: ${err}`, 'error');
    } finally {
      committing.value = false;
    }
  };

  return { rows, probing, committing, probed, blank, sweep, commit };
}
