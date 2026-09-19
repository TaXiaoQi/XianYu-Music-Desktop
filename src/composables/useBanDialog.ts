import { ref } from 'vue';

export type BanType = 'account' | 'device';

export type BanDialogMode = 'ban' | 'session' | 'login' | 'beta' | 'betaPending';

export interface BanDialogMeta {
  ciyuanxiId: string;
  nickname: string;
}

export interface BanDialogState {
  visible: boolean;
  mode: BanDialogMode;
  banType: BanType;
  reason: string;
  ciyuanxiId: string;
  nickname: string;
  debug: boolean;
  resolver: ((confirmed: boolean) => void) | null;
}

const banDialogState = ref<BanDialogState>({
  visible: false,
  mode: 'ban',
  banType: 'account',
  reason: '',
  ciyuanxiId: '',
  nickname: '',
  debug: false,
  resolver: null,
});

export function showBanDialog(
  banType: BanType,
  reason: string,
  meta: BanDialogMeta = { ciyuanxiId: '', nickname: '' },
  options: { debug?: boolean } = {},
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    banDialogState.value = {
      visible: true,
      mode: 'ban',
      banType,
      reason,
      ciyuanxiId: meta.ciyuanxiId || '',
      nickname: meta.nickname || '',
      debug: options.debug === true,
      resolver: resolve,
    };
  });
}

export function showSessionExpiredDialog(
  reason = '登录状态已失效，请重新登录账号以继续使用。',
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    banDialogState.value = {
      visible: true,
      mode: 'session',
      banType: 'account',
      reason: reason || '登录状态已失效，请重新登录账号以继续使用。',
      ciyuanxiId: '',
      nickname: '',
      debug: false,
      resolver: resolve,
    };
  });
}

export function showLoginRequiredDialog(
  reason = '请先登录账号，登录后即可查看该用户的收藏与歌单。',
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    banDialogState.value = {
      visible: true,
      mode: 'login',
      banType: 'account',
      reason: reason || '请先登录账号，登录后即可查看该用户的收藏与歌单。',
      ciyuanxiId: '',
      nickname: '',
      debug: false,
      resolver: resolve,
    };
  });
}

export function showBetaGateDialog(pending = false): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    banDialogState.value = {
      visible: true,
      mode: pending ? 'betaPending' : 'beta',
      banType: 'account',
      reason: '',
      ciyuanxiId: '',
      nickname: '',
      debug: false,
      resolver: resolve,
    };
  });
}

export function resolveBanDialog(confirmed: boolean): void {
  const state = banDialogState.value;
  state.resolver?.(confirmed);
  banDialogState.value = {
    visible: false,
    mode: state.mode,
    banType: state.banType,
    reason: '',
    ciyuanxiId: '',
    nickname: '',
    debug: false,
    resolver: null,
  };
}

export function useBanDialog() {
  return {
    banDialogState,
    resolveBanDialog,
  };
}