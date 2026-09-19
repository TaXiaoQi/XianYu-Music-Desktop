import { ref } from 'vue';

export interface ToastMessage {
  id: number;
  text: string;
  type?: 'success' | 'error' | 'info';
  progress?: number | null;
}

export interface ToastHandle {
  update: (text: string, progress: number) => void;
  complete: (text: string, type?: 'success' | 'error' | 'info') => void;
  fail: (text: string) => void;
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
