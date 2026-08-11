import { ref } from 'vue';

export type ProfileLimitDialogTarget = 'nickname' | 'avatar';

export interface ProfileLimitDialogState {
  visible: boolean;
  target: ProfileLimitDialogTarget;
  blocked: boolean;
  message: string;
  resolver: ((confirmed: boolean) => void) | null;
}

const profileLimitDialogState = ref<ProfileLimitDialogState>({
  visible: false,
  target: 'nickname',
  blocked: false,
  message: '',
  resolver: null,
});

export function showProfileLimitDialog(
  target: ProfileLimitDialogTarget,
  options: { blocked?: boolean; message?: string } = {},
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    profileLimitDialogState.value = {
      visible: true,
      target,
      blocked: options.blocked === true,
      message: options.message || '',
      resolver: resolve,
    };
  });
}

export function resolveProfileLimitDialog(confirmed: boolean): void {
  const state = profileLimitDialogState.value;
  state.resolver?.(confirmed);
  profileLimitDialogState.value = {
    visible: false,
    target: state.target,
    blocked: false,
    message: '',
    resolver: null,
  };
}

export function useProfileLimitDialog() {
  return {
    profileLimitDialogState,
    resolveProfileLimitDialog,
  };
}
