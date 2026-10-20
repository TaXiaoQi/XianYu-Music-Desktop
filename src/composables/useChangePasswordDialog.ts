import { ref } from 'vue';

interface ChangePasswordDialogState {
  visible: boolean;
  resolver: ((confirmed: boolean) => void) | null;
}

const changePasswordDialogState = ref<ChangePasswordDialogState>({
  visible: false,
  resolver: null,
});

export function showChangePasswordDialog(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    changePasswordDialogState.value = {
      visible: true,
      resolver: resolve,
    };
  });
}

function resolveChangePasswordDialog(confirmed: boolean): void {
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
