import { ref } from 'vue';

export type ProfileLimitDialogTarget = 'nickname' | 'avatar';

export interface ProfileLimitDialogState {
  visible: boolean;
  target: ProfileLimitDialogTarget;
  resolver: ((confirmed: boolean) => void) | null;
}

const profileLimitDialogState = ref<ProfileLimitDialogState>({
  visible: false,
  target: 'nickname',
  resolver: null,
});

export function showProfileLimitDialog(target: ProfileLimitDialogTarget): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    profileLimitDialogState.value = {
      visible: true,
      target,
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
    resolver: null,
  };
}

export function useProfileLimitDialog() {
  return {
    profileLimitDialogState,
    resolveProfileLimitDialog,
  };
}
