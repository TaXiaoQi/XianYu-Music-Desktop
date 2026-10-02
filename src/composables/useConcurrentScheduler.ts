/**
 * 并发任务闸门：任意时刻最多放行一个异步任务。
 * 执行期间新提交的任务采用"仅保留最新"的暂存策略——
 * 旧任务一结束就立刻顶上运行最近一次暂存的任务，更早的暂存被丢弃。
 */

export function useConcurrentScheduler() { // 实现
    // 当前是否已有任务在跑（用其 Promise 标记）
    let running: Promise<unknown> | null = null;
    // 被顶替后暂存起来、等待上一任务结束后执行的启动函数
    let staged: (() => Promise<unknown>) | null = null;

    const execute = <T>(runTask: () => Promise<T>): Promise<T> =>
        new Promise<T>((settle, fail) => {
            // 启动任务并把结果桥接到本次调用的 Promise 上；
            // 无论成败处理函数自身都不会抛错，因此返回值恒为 fulfilled
            const launch = (): Promise<unknown> => runTask().then(settle, fail);

            if (running) {
                // 已有任务占用闸门：用最新任务顶替暂存位
                staged = launch;
                return;
            }

            // 闸门空闲，直接放行
            const first = launch();
            running = first;

            const afterSettled = (): void => {
                running = null;
                if (!staged) {
                    return;
                }
                const upcoming = staged;
                staged = null;
                running = upcoming();
                running.finally(afterSettled);
            };

            first.finally(afterSettled);
        });

    const cancel = (): void => {
        staged = null;
    };

    return {
        execute,
        cancel,
    };
}
