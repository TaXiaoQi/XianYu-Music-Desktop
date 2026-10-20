// 快捷键录入：捕获、冲突检测与保存设置。
// 自 OnboardingModal.vue 纯搬移，行为保持不变。
import { computed, ref } from 'vue';

import { useToast } from '../toast';
import {
  areShortcutBindingsEqual,
  createDefaultShortcutSettings,
  formatShortcutBinding,
  getShortcutBindingFromEvent,
  isSystemReservedShortcutEvent,
  shortcutActionLabels,
  shortcutActionOrder,
} from '../../features/settings/shortcuts';
import type { ShortcutActionId } from '../../types';
import { useSettings } from '../../features/settings/useSettings';

type ShortcutScope = 'local' | 'global';
interface CapturingTarget {
  actionId: ShortcutActionId;
  scope: ShortcutScope;
}

export function useShortcutCapture() {
  const { settings, patchSettings } = useSettings();
  const { showToast } = useToast();

  // --- 快捷键录入 ---
  const capturingTarget = ref<CapturingTarget | null>(null);

  const shortcutRows = computed(() =>
    shortcutActionOrder.map(actionId => ({
      actionId,
      label: shortcutActionLabels[actionId],
      localBinding: settings.value.shortcuts.local[actionId],
      globalBinding: settings.value.shortcuts.global[actionId],
    })),
  );

  const isCapturing = (scope: ShortcutScope, actionId: ShortcutActionId) =>
    capturingTarget.value?.scope === scope && capturingTarget.value.actionId === actionId;

  const startCapture = (scope: ShortcutScope, actionId: ShortcutActionId) => {
    capturingTarget.value = { scope, actionId };
  };

  const stopCapture = () => {
    capturingTarget.value = null;
  };

  const restoreDefaultShortcuts = () => {
    patchSettings({ shortcuts: createDefaultShortcutSettings() });
    stopCapture();
    showToast('已恢复默认快捷键', 'success');
  };

  const updateShortcut = (
    scope: ShortcutScope,
    actionId: ShortcutActionId,
    nextBinding: ReturnType<typeof getShortcutBindingFromEvent>,
  ) => {
    patchSettings({
      shortcuts: {
        ...settings.value.shortcuts,
        [scope]: {
          ...settings.value.shortcuts[scope],
          [actionId]: nextBinding,
        },
      },
    });
  };

  const handleShortcutCapture = (
    scope: ShortcutScope,
    actionId: ShortcutActionId,
    event: KeyboardEvent,
  ) => {
    if (!isCapturing(scope, actionId)) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      stopCapture();
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      updateShortcut(scope, actionId, null);
      stopCapture();
      return;
    }
    if (isSystemReservedShortcutEvent(event)) {
      showToast('Win 组合键由系统保留，不能作为快捷键', 'error');
      return;
    }

    const nextBinding = getShortcutBindingFromEvent(event);
    if (!nextBinding) return;

    const conflictActionId = shortcutActionOrder.find(
      candidate =>
        candidate !== actionId &&
        areShortcutBindingsEqual(settings.value.shortcuts[scope][candidate], nextBinding),
    );

    if (conflictActionId) {
      showToast(
        `${shortcutActionLabels[conflictActionId]} 已使用 ${formatShortcutBinding(nextBinding)}`,
        'error',
      );
      return;
    }

    updateShortcut(scope, actionId, nextBinding);
    stopCapture();
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
