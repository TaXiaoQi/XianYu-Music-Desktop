import { ref } from 'vue';

export type ProfileLimitDialogTarget = 'nickname' | 'avatar' | 'ban';

export type BanType = 'account' | 'device';

export interface ProfileLimitDialogState {
  visible: boolean;
  target: ProfileLimitDialogTarget;
  blocked: boolean;
  message: string;
  banType: BanType;
  resolver: ((confirmed: boolean) => void) | null;
}

const profileLimitDialogState = ref<ProfileLimitDialogState>({
  visible: false,
  target: 'nickname',
  blocked: false,
  message: '',
  banType: 'account',
  resolver: null,
});

export function showProfileLimitDialog(
  target: ProfileLimitDialogTarget,
  options: { blocked?: boolean; message?: string; banType?: BanType } = {},
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    profileLimitDialogState.value = {
      visible: true,
      target,
      blocked: options.blocked === true,
      message: options.message || '',
      banType: options.banType || 'account',
      resolver: resolve,
    };
  });
}

/** 封禁提示：复用头像提示框 UI，展示账号/设备被封禁及原因 */
export function showBanDialog(banType: BanType, reason: string): Promise<boolean> {
  return showProfileLimitDialog('ban', { blocked: true, message: reason, banType });
}

export function resolveProfileLimitDialog(confirmed: boolean): void {
  const state = profileLimitDialogState.value;
  state.resolver?.(confirmed);
  profileLimitDialogState.value = {
    visible: false,
    target: state.target,
    blocked: false,
    message: '',
    banType: 'account',
    resolver: null,
  };
}

export function useProfileLimitDialog() {
  return {
    profileLimitDialogState,
    resolveProfileLimitDialog,
  };
}
