/**
 * 设置冲突解决状态（模块级）
 *
 * 类似 toast 的模式：模块级 ref 在任意位置写入，
 * 全局挂载的 SettingsConflictDialog 组件监听并渲染弹窗。
 *
 * 当云端同步检测到本地与云端设置不一致时，
 * 通过此状态弹出对话框让用户选择保留本地或云端。
 *
 * 二级确认支持按类别（设置/歌单/插件）分别选择保留本地或云端。
 */

import { ref } from 'vue';

/** 单个类别的选择：保留本地或保留云端 */
export type CategoryChoice = 'local' | 'cloud';

/** 按类别的同步选择 */
export interface SyncCategoryChoices {
  settings: CategoryChoice;
  playlists: CategoryChoice;
  plugins: CategoryChoice;
}

/** 冲突解决结果：取消 或 按类别的选择 */
export type SettingsConflictChoice = 'cancel' | SyncCategoryChoices;

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

/**
 * 显示设置冲突对话框，返回用户选择
 *
 * 调用方 await 此函数，用户做出选择后 Promise resolve。
 *
 * @param cloudUploadedAt 云端设置的上传时间（用于弹窗中展示）
 */
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

/** 用户做出选择后调用 */
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
