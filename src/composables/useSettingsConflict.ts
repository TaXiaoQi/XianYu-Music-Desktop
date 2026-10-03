
import { ref } from 'vue';
import type { SettingsConflictChoice } from '../services/domain/sync/settingsSyncService';

// 冲突分支类型以 settingsSyncService 为准（UI 弹窗端口实现该协议）
export type {
  SettingsChoiceValue as CategoryChoice,
  SettingsCategoryChoices as SyncCategoryChoices,
  SettingsConflictChoice,
} from '../services/domain/sync/settingsSyncService';

export interface SettingsConflictState {
  visible: boolean;
  localTimestamp: number;
  cloudTimestamp: number;
  resolver: ((choice: SettingsConflictChoice) => void) | null;
}

const conflictState = ref<SettingsConflictState>({
  visible: false,
  localTimestamp: 0,
  cloudTimestamp: 0,
  resolver: null,
});

export function showSettingsConflict(
  cloudUploadedAt?: string,
): Promise<SettingsConflictChoice> {
  return new Promise<SettingsConflictChoice>((resolve) => {
    conflictState.value = {
      visible: true,
      localTimestamp: Date.now(),
      cloudTimestamp: cloudUploadedAt ? new Date(cloudUploadedAt).getTime() : Date.now(),
      resolver: resolve,
    };
  });
}

export function resolveSettingsConflict(choice: SettingsConflictChoice): void {
  const state = conflictState.value;
  if (state.resolver) {
    state.resolver(choice);
  }
  conflictState.value = {
    visible: false,
    localTimestamp: 0,
    cloudTimestamp: 0,
    resolver: null,
  };
}

export function useSettingsConflict() {
  return {
    conflictState,
    resolveSettingsConflict,
  };
}
