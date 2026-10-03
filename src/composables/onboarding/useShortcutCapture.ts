// 快捷键录入：捕获、冲突检测与保存设置。
// 自 OnboardingModal.vue 纯搬移，行为保持不变。
import { computed, ref } from 'vue';

import { useToast } from '../toast'; // 实现
import {
  areShortcutBindingsEqual, // 实现
  createDefaultShortcutSettings, // 实现
  formatShortcutBinding, // 实现
  getShortcutBindingFromEvent, // 实现
  isSystemReservedShortcutEvent, // 实现
  shortcutActionLabels, // 实现
  shortcutActionOrder, // 实现
} from '../../features/settings/shortcuts';
import type { ShortcutActionId } from '../../types';
import { useSettings } from '../../features/settings/useSettings'; // 实现

type ShortcutScope = 'local' | 'global'; // 实现
interface CapturingTarget { // 实现
  actionId: ShortcutActionId; // 实现
  scope: ShortcutScope; // 实现
}

export function useShortcutCapture() {
  const { settings, patchSettings } = useSettings(); // 实现
  const { showToast } = useToast(); // 实现

  // --- 快捷键录入 ---
  const capturingTarget = ref<CapturingTarget | null>(null); // 实现

  const shortcutRows = computed(() => // 实现
    shortcutActionOrder.map(actionId => ({ // 实现
      actionId,
      label: shortcutActionLabels[actionId], // 实现
      localBinding: settings.value.shortcuts.local[actionId], // 实现
      globalBinding: settings.value.shortcuts.global[actionId], // 实现
    })),
  );

  const isCapturing = (scope: ShortcutScope, actionId: ShortcutActionId) => // 实现
    capturingTarget.value?.scope === scope && capturingTarget.value.actionId === actionId; // 实现

  const startCapture = (scope: ShortcutScope, actionId: ShortcutActionId) => { // 实现
    capturingTarget.value = { scope, actionId }; // 实现
  };

  const stopCapture = () => { // 实现
    capturingTarget.value = null; // 实现
  };

  const restoreDefaultShortcuts = () => { // 实现
    patchSettings({ shortcuts: createDefaultShortcutSettings() }); // 实现
    stopCapture(); // 实现
    showToast('已恢复默认快捷键', 'success'); // 实现
  };

  const updateShortcut = ( // 实现
    scope: ShortcutScope, // 实现
    actionId: ShortcutActionId, // 实现
    nextBinding: ReturnType<typeof getShortcutBindingFromEvent>, // 实现
  ) => {
    patchSettings({ // 实现
      shortcuts: { // 实现
        ...settings.value.shortcuts, // 实现
        [scope]: {
          ...settings.value.shortcuts[scope], // 实现
          [actionId]: nextBinding,
        },
      },
    });
  };

  const handleShortcutCapture = ( // 实现
    scope: ShortcutScope, // 实现
    actionId: ShortcutActionId, // 实现
    event: KeyboardEvent, // 实现
  ) => {
    if (!isCapturing(scope, actionId)) return; // 实现
    event.preventDefault(); // 实现
    event.stopPropagation(); // 实现

    if (event.key === 'Escape') { // 实现
      stopCapture(); // 实现
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') { // 实现
      updateShortcut(scope, actionId, null); // 实现
      stopCapture(); // 实现
      return;
    }
    if (isSystemReservedShortcutEvent(event)) { // 实现
      showToast('Win 组合键由系统保留，不能作为快捷键', 'error'); // 实现
      return;
    }

    const nextBinding = getShortcutBindingFromEvent(event); // 实现
    if (!nextBinding) return; // 实现

    const conflictActionId = shortcutActionOrder.find( // 实现
      candidate => // 实现
        candidate !== actionId && // 实现
        areShortcutBindingsEqual(settings.value.shortcuts[scope][candidate], nextBinding), // 实现
    );

    if (conflictActionId) { // 实现
      showToast(
        `${shortcutActionLabels[conflictActionId]} 已使用 ${formatShortcutBinding(nextBinding)}`, // 实现
        'error',
      );
      return;
    }

    updateShortcut(scope, actionId, nextBinding); // 实现
    stopCapture(); // 实现
  };

  return {
    capturingTarget,
    shortcutRows,
    isCapturing,
    startCapture,
    stopCapture,
    restoreDefaultShortcuts,
    updateShortcut,
    handleShortcutCapture,
  };
}
