import { ref } from 'vue';

export interface CiyuanxiDialogState {
  visible: boolean;
  oldId: string;
  debug: boolean;
  resolver: ((confirmed: boolean) => void) | null;
}

const ciyuanxiDialogState = ref<CiyuanxiDialogState>({
  visible: false,
  oldId: '',
  debug: false,
  resolver: null,
});

export function showCiyuanxiDialog(
  oldId: string,
  options: { debug?: boolean } = {},
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    ciyuanxiDialogState.value = {
      visible: true,
      oldId: oldId || '',
      debug: options.debug === true,
      resolver: resolve,
    };
  });
}

export function resolveCiyuanxiDialog(confirmed: boolean): void {
  const state = ciyuanxiDialogState.value;
  state.resolver?.(confirmed);
  ciyuanxiDialogState.value = {
    visible: false,
    oldId: '',
    debug: false,
    resolver: null,
  };
}

export function useCiyuanxiDialog() {
  return {
    ciyuanxiDialogState,
    resolveCiyuanxiDialog,
  };
}