import { ref } from 'vue';

export type BanType = 'account' | 'device';

/** 弹窗用途：ban=账号/设备封禁申诉；session=登录验证失效提示；login=未登录查看他人数据提醒（复用同一套弹窗样式）；beta=内测资格拦截（不可退出） */
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
  /** 调试模拟模式：仅测试页面与流程，提交申诉时不发送服务器 */
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

/** 打开账号/设备封禁提示框（更新提示框样式），返回用户点「确认」后 true */
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

/** 打开「登录验证失败，需要重新登录」提示框，复用封禁弹窗的视觉 */
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

/** 打开「请先登录」提醒弹窗（未登录查看他人数据时），复用登录过期弹窗的视觉 */
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

/**
 * 打开「未获得内测资格」拦截弹窗（内测构建 + 设备不在内测名单时开屏展示）。
 * 全局不可退出：遮罩不可点、无关闭路径，唯一出口是「退出软件」（resolve true）；
 * [pending] 为 false 时「申请资格」在弹窗内联提交内测申请，提交后弹窗保持拦截；
 * [pending] 为 true 时设备已有待审核申请，弹「审核中」提示，仅退出软件一个按钮。
 */
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