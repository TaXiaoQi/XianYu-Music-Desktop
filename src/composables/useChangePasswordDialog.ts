import { ref } from 'vue';

export interface ChangePasswordDialogState {
  visible: boolean;
  resolver: ((confirmed: boolean) => void) | null;
}

const changePasswordDialogState = ref<ChangePasswordDialogState>({
  visible: false,
  resolver: null,
});

/**
 * 打开修改密码弹窗（统一弹窗样式），返回用户点「确认修改」后 true
 */
export function showChangePasswordDialog(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    changePasswordDialogState.value = {
      visible: true,
      resolver: resolve,
    };
  });
}

export function resolveChangePasswordDialog(confirmed: boolean): void {
  const state = changePasswordDialogState.value;
  state.resolver?.(confirmed);
  changePasswordDialogState.value = {
    visible: false,
    resolver: null,
  };
}

export function useChangePasswordDialog() {
  return {
    changePasswordDialogState,
    resolveChangePasswordDialog,
  };
}
