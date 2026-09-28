import { ref, watch } from 'vue';
import type { Ref } from 'vue';

const SYNC_WATCH_OPTIONS = { flush: 'sync' } as const;

export function useScopedBatchSelection(activeScope: Ref<string>) {
  const batchModeEnabled = ref(false);
  const markedPaths = ref<Set<string>>(new Set<string>());

  const resetMarkedPaths = () => {
    markedPaths.value = new Set<string>();
  };

  watch(batchModeEnabled, isEnabled => {
    if (!isEnabled) {
      resetMarkedPaths();
    }
  }, SYNC_WATCH_OPTIONS);

  watch(activeScope, () => {
    batchModeEnabled.value = false;
    resetMarkedPaths();
  }, SYNC_WATCH_OPTIONS);

  return { isBatchMode: batchModeEnabled, selectedPaths: markedPaths, clearSelection: resetMarkedPaths };
}
