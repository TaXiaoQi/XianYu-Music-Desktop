import { ref } from 'vue';

export interface DeleteAccountDialogState {
  visible: boolean;
  resolver: ((confirmed: boolean) => void) | null;
}

const deleteAccountDialogState = ref<DeleteAccountDialogState>({
  visible: false,
  resolver: null,
});

/**
 * 打开注销账号弹窗（统一弹窗样式），返回用户点「确认注销」后 true
 */
export function showDeleteAccountDialog(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    deleteAccountDialogState.value = {
      visible: true,
      resolver: resolve,
    };
  });
}

export function resolveDeleteAccountDialog(confirmed: boolean): void {
  const state = deleteAccountDialogState.value;
  state.resolver?.(confirmed);
  deleteAccountDialogState.value = {
    visible: false,
    resolver: null,
  };
}

export function useDeleteAccountDialog() {
  return {
    deleteAccountDialogState,
    resolveDeleteAccountDialog,
  };
}
