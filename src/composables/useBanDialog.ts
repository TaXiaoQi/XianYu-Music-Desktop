import { ref } from 'vue';

export type BanType = 'account' | 'device';

export interface BanDialogMeta {
  ciyuanxiId: string;
  nickname: string;
}

export interface BanDialogState {
  visible: boolean;
  banType: BanType;
  reason: string;
  ciyuanxiId: string;
  nickname: string;
  resolver: ((confirmed: boolean) => void) | null;
}

const banDialogState = ref<BanDialogState>({
  visible: false,
  banType: 'account',
  reason: '',
  ciyuanxiId: '',
  nickname: '',
  resolver: null,
});

/** 打开账号/设备封禁提示框（更新提示框样式），返回用户点「确认」后 true */
export function showBanDialog(
  banType: BanType,
  reason: string,
  meta: BanDialogMeta = { ciyuanxiId: '', nickname: '' },
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    banDialogState.value = {
      visible: true,
      banType,
      reason,
      ciyuanxiId: meta.ciyuanxiId || '',
      nickname: meta.nickname || '',
      resolver: resolve,
    };
  });
}

export function resolveBanDialog(confirmed: boolean): void {
  const state = banDialogState.value;
  state.resolver?.(confirmed);
  banDialogState.value = {
    visible: false,
    banType: state.banType,
    reason: '',
    ciyuanxiId: '',
    nickname: '',
    resolver: null,
  };
}

export function useBanDialog() {
  return {
    banDialogState,
    resolveBanDialog,
  };
}