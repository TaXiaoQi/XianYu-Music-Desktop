import { ref } from 'vue';

export interface ToastMessage {
  id: number;
  text: string;
  type?: 'success' | 'error' | 'info';
  /** 进度（0-100）；非 null 时显示进度条且不自动消失 */
  progress?: number | null;
}

export interface ToastHandle {
  /** 更新文字与进度（0-100） */
  update: (text: string, progress: number) => void;
  /** 以指定状态结束提示，3 秒后自动关闭 */
  complete: (text: string, type?: 'success' | 'error' | 'info') => void;
  /** 以失败状态结束提示 */
  fail: (text: string) => void;
  /** 立即关闭（complete/fail 之后调用无效） */
  close: () => void;
}

const toasts = ref<ToastMessage[]>([]);
let nextId = 0;

export function useToast() {
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = nextId++;
    toasts.value.push({ id, text, type });
    setTimeout(() => {
      toasts.value = toasts.value.filter(t => t.id !== id);
    }, 3000);
  };

  /** 显示持续型进度提示（不自动消失），批量任务循环中调用 handle.update 推进进度 */
  const showProgressToast = (text: string): ToastHandle => {
    const id = nextId++;
    toasts.value.push({ id, text, type: 'info', progress: 0 });
    const find = () => toasts.value.find(t => t.id === id);
    const remove = () => {
      toasts.value = toasts.value.filter(t => t.id !== id);
    };
    let finished = false;
    return {
      update(nextText: string, progress: number) {
        const t = find();
        if (t && !finished) {
          t.text = nextText;
          t.progress = Math.min(100, Math.max(0, Math.round(progress)));
        }
      },
      complete(finalText: string, type: 'success' | 'error' | 'info' = 'success') {
        if (finished) return;
        finished = true;
        const t = find();
        if (t) {
          t.text = finalText;
          t.type = type;
          t.progress = null;
        }
        setTimeout(remove, 3000);
      },
      fail(finalText: string) {
        this.complete(finalText, 'error');
      },
      close() {
        if (finished) return;
        finished = true;
        remove();
      },
    };
  };

  return {
    toasts,
    showToast,
    showProgressToast
  };
}
