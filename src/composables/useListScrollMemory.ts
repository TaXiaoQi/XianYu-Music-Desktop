import {
    nextTick,
    onActivated,
    onBeforeUnmount,
    onDeactivated,
    onMounted,
    unref,
    watch,
} from "vue";
import type { Ref } from "vue";

import { listScrollCache as scrollMemoryStore } from "../caches/imageCaches";

// 恢复位置时最多等待的帧数：虚拟列表迟迟未撑开容器就放弃，避免无限重试。
const RESTORE_FRAME_BUDGET = 120;
// scrollTop 与目标值相差不足该像素数即认为已落位。
const SETTLE_TOLERANCE_PX = 2;

type ScrollKeySource = string | Ref<string>;

interface ListScrollMemoryOptions {
    /** 置真后冻结读写；监听器仍会挂载，与既有调用方的约定保持一致。 */
    disabled?: boolean;
}

const frameOnce = () =>
    new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
    });

export function useListScrollMemory( // 实现
    keySource: ScrollKeySource,
    containerRef: Ref<HTMLElement | null>,
    options?: ListScrollMemoryOptions,
) {
    const readKey = () => unref(keySource);
    const writable = () => !(options?.disabled ?? false);

    let boundTarget: HTMLElement | null = null;
    // 键迁移后由迁移回调负责收尾，生命周期钩子不再重复落盘。
    let keyMigrated = false;

    const persist = (key = readKey()) => {
        if (!writable() || !key || !containerRef.value) {
            return;
        }
        scrollMemoryStore.set(key, containerRef.value.scrollTop);
    };

    const reclaim = async (key = readKey()) => {
        if (!writable() || !key) {
            return;
        }

        await nextTick();

        const host = containerRef.value;
        if (!host) {
            return;
        }

        const remembered = scrollMemoryStore.get(key);
        if (remembered === undefined) {
            return;
        }

        await frameOnce();

        for (let frame = 0; ; frame += 1) {
            const target = containerRef.value;
            if (!target) {
                return;
            }

            // 内容尚未撑开容器时先让帧，等列表渲染到位再落位。
            const waitingForContent =
                remembered > 0 &&
                (target.clientHeight <= 0 ||
                    target.scrollHeight <= target.clientHeight);
            if (waitingForContent) {
                if (frame >= RESTORE_FRAME_BUDGET) {
                    return;
                }
                await frameOnce();
                continue;
            }

            target.scrollTop = remembered;
            target.dispatchEvent(new Event("scroll"));

            const settled =
                Math.abs(target.scrollTop - remembered) < SETTLE_TOLERANCE_PX;
            if (settled || frame >= RESTORE_FRAME_BUDGET) {
                return;
            }
            await frameOnce();
        }
    };

    const onHostScroll = () => {
        persist();
    };

    const release = () => {
        if (!boundTarget) {
            return;
        }
        boundTarget.removeEventListener("scroll", onHostScroll);
        boundTarget = null;
    };

    const bind = () => {
        const host = containerRef.value;
        if (!host || host === boundTarget) {
            return;
        }
        release();
        host.addEventListener("scroll", onHostScroll, { passive: true });
        boundTarget = host;
    };

    const bindAndReclaim = () => {
        bind();
        void reclaim();
    };

    const persistIfSettled = () => {
        if (!keyMigrated) persist();
    };

    const persistThenRelease = () => {
        persistIfSettled();
        release();
    };

    onMounted(bindAndReclaim);

    onActivated(bindAndReclaim);

    onDeactivated(persistIfSettled);

    onBeforeUnmount(persistThenRelease);

    watch(containerRef, bind);

    if (typeof keySource !== "string") {
        watch(keySource, (nextKey, prevKey) => {
            if (prevKey && prevKey !== nextKey) {
                persist(prevKey);
                release();
                keyMigrated = true;
            }

            if (nextKey && nextKey !== prevKey) {
                void reclaim(nextKey);
            }
        });
    }

    return {
        saveScrollPosition: persist,
        restoreScrollPosition: reclaim,
    };
}
