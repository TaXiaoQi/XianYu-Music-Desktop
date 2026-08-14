import { ref } from 'vue';

export interface CiyuanxiDialogState {
  visible: boolean;
  /** 当前弦予号（只读展示） */
  oldId: string;
  /** 调试模拟模式：仅测试弹窗与流程，不发送服务器 */
  debug: boolean;
  resolver: ((confirmed: boolean) => void) | null;
}

const ciyuanxiDialogState = ref<CiyuanxiDialogState>({
  visible: false,
  oldId: '',
  debug: false,
  resolver: null,
});

/**
 * 打开修改弦予号弹窗（统一弹窗样式），返回用户点「确认修改」后 true
 *
 * @param oldId 当前弦予号
 * @param options.debug 调试模式：仅模拟，不调用真实 API
 */
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