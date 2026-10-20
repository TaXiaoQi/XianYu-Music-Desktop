import { ref } from "vue";

interface ToastMessage {
    id: number;
    text: string;
    type?: "success" | "error" | "info";
    progress?: number | null;
    /** 进度 toast 显示取消按钮（点击触发创建时传入的 onCancel 并关闭） */
    cancellable?: boolean;
}

export interface ToastHandle {
    update: (text: string, progress: number) => void;
    complete: (text: string, type?: "success" | "error" | "info") => void;
    fail: (text: string) => void;
    close: () => void;
}

const toasts = ref<ToastMessage[]>([]);
const cancelHandlers = new Map<number, () => void>();
let nextId = 0;

export function useToast() {
    const showToast = (
        text: string,
        type: "success" | "error" | "info" = "info",
    ) => {
        const id = nextId++;
        toasts.value.push({ id, text, type });
        setTimeout(() => {
            toasts.value = toasts.value.filter((t) => t.id !== id);
        }, 3000);
    };

    const showProgressToast = (
        text: string,
        opts?: { cancellable?: boolean; onCancel?: () => void },
    ): ToastHandle => {
        const id = nextId++;
        toasts.value.push({
            id,
            text,
            type: "info",
            progress: 0,
            cancellable: opts?.cancellable === true,
        });
        if (opts?.onCancel) cancelHandlers.set(id, opts.onCancel);
        const find = () => toasts.value.find((t) => t.id === id);
        const remove = () => {
            toasts.value = toasts.value.filter((t) => t.id !== id);
            cancelHandlers.delete(id);
        };
        let finished = false;
        return {
            update(nextText: string, progress: number) {
                const t = find();
                if (t && !finished) {
                    t.text = nextText;
                    t.progress = Math.min(
                        100,
                        Math.max(0, Math.round(progress)),
                    );
                }
            },
            complete(
                finalText: string,
                type: "success" | "error" | "info" = "success",
            ) {
                if (finished) return;
                finished = true;
                const t = find();
                if (t) {
                    t.text = finalText;
                    t.type = type;
                    t.progress = null;
                    t.cancellable = false;
                }
                cancelHandlers.delete(id);
                setTimeout(remove, 3000);
            },
            fail(finalText: string) {
                this.complete(finalText, "error");
            },
            close() {
                if (finished) return;
                finished = true;
                remove();
            },
        };
    };

    /** 用户点击进度 toast 的取消按钮：触发 onCancel 回调并立即关闭 toast；
     * 进行中的流程在下一个检查点（循环步骤/阶段边界）感知后短路 */
    const cancelToast = (id: number) => {
        const handler = cancelHandlers.get(id);
        cancelHandlers.delete(id);
        toasts.value = toasts.value.filter((t) => t.id !== id);
        handler?.();
    };

    return {
        toasts,
        showToast,
        showProgressToast,
        cancelToast,
    };
}
