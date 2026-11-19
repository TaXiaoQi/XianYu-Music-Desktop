import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    createWindowResizeCoordinator,
    RESIZE_IDLE_MS,
    WINDOW_RESIZING_CLASS,
    type WindowResizeCoordinatorEnv,
} from "./windowResizeCoordinator";

type FakeEnv = WindowResizeCoordinatorEnv & {
    timers: Map<number, () => void>;
    frames: Map<number, () => void>;
    runFrames: () => void;
    runIdleTimers: () => void;
    windowListeners: Array<() => void>;
    addWindowResizeCalls: number;
    fireWindowResize: () => void;
    classList: Set<string>;
};

const createFakeEnv = (): FakeEnv => {
    let seq = 0;
    const timers = new Map<number, () => void>();
    const frames = new Map<number, () => void>();
    const windowListeners: Array<() => void> = [];
    const classList = new Set<string>();
    let addWindowResizeCalls = 0;

    return {
        timers,
        frames,
        windowListeners,
        classList,
        get addWindowResizeCalls() {
            return addWindowResizeCalls;
        },
        runFrames: () => {
            const pending = [...frames.values()];
            frames.clear();
            pending.forEach((cb) => cb());
        },
        runIdleTimers: () => {
            const pending = [...timers.values()];
            timers.clear();
            pending.forEach((cb) => cb());
        },
        fireWindowResize: () => windowListeners.forEach((cb) => cb()),
        addWindowResize: (listener) => {
            addWindowResizeCalls += 1;
            windowListeners.push(listener);
            return () => {
                const index = windowListeners.indexOf(listener);
                if (index >= 0) {
                    windowListeners.splice(index, 1);
                }
            };
        },
        root: {
            classList: {
                toggle: (name: string, on: boolean) => {
                    if (on) {
                        classList.add(name);
                    } else {
                        classList.delete(name);
                    }
                    return on;
                },
            },
        },
        raf: (cb) => {
            seq += 1;
            frames.set(seq, cb);
            return seq;
        },
        caf: (handle) => {
            frames.delete(handle);
        },
        timeout: (cb) => {
            seq += 1;
            timers.set(seq, cb);
            return seq as unknown as ReturnType<typeof setTimeout>;
        },
        clear: (handle) => {
            timers.delete(handle as unknown as number);
        },
    };
};

describe("createWindowResizeCoordinator", () => {
    let env: FakeEnv;

    beforeEach(() => {
        env = createFakeEnv();
    });

    it("coalesces a burst of resize events into one frame dispatch", () => {
        const coordinator = createWindowResizeCoordinator(env);
        const onFrame = vi.fn();
        coordinator.subscribeWindowResize(onFrame);
        coordinator.start();

        for (let i = 0; i < 50; i += 1) {
            coordinator.notifyWindowResize();
        }
        expect(env.frames.size).toBe(1);
        env.runFrames();
        expect(onFrame).toHaveBeenCalledTimes(1);
        expect(coordinator.isWindowResizing.value).toBe(true);
    });

    it("settles exactly once after the idle window, flipping the signal off", () => {
        const coordinator = createWindowResizeCoordinator(env);
        const onSettled = vi.fn();
        coordinator.subscribeWindowResizeSettled(onSettled);
        coordinator.start();

        coordinator.notifyWindowResize();
        coordinator.notifyWindowResize();
        env.runIdleTimers();

        expect(coordinator.isWindowResizing.value).toBe(false);
        expect(onSettled).toHaveBeenCalledTimes(1);
        expect(env.timers.size).toBe(0);
    });

    it("uses the exported idle duration for the settle timer", () => {
        const coordinator = createWindowResizeCoordinator(env);
        coordinator.start();
        let scheduledMs: number | undefined;
        env.timeout = (cb, ms) => {
            scheduledMs = ms;
            return env.timers.set(1, cb) && (1 as unknown as ReturnType<typeof setTimeout>);
        };

        coordinator.notifyWindowResize();
        expect(scheduledMs).toBe(RESIZE_IDLE_MS);
    });

    it("keeps dispatching to other subscribers when one handler throws", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const coordinator = createWindowResizeCoordinator(env);
        const good = vi.fn();
        coordinator.subscribeWindowResize(() => {
            throw new Error("boom");
        });
        coordinator.subscribeWindowResize(good);
        coordinator.start();

        coordinator.notifyWindowResize();
        env.runFrames();

        expect(good).toHaveBeenCalledTimes(1);
        vi.restoreAllMocks();
    });

    it("returns an idempotent disposer that stops further callbacks", () => {
        const coordinator = createWindowResizeCoordinator(env);
        const onFrame = vi.fn();
        const dispose = coordinator.subscribeWindowResize(onFrame);
        coordinator.start();

        dispose();
        expect(() => dispose()).not.toThrow();

        coordinator.notifyWindowResize();
        env.runFrames();
        expect(onFrame).toHaveBeenCalledTimes(0);
    });

    it("toggles the root class while resizing and clears it on stop", () => {
        const coordinator = createWindowResizeCoordinator(env);
        const stop = coordinator.start();

        coordinator.notifyWindowResize();
        expect(env.classList.has(WINDOW_RESIZING_CLASS)).toBe(true);

        env.runIdleTimers();
        expect(env.classList.has(WINDOW_RESIZING_CLASS)).toBe(false);

        coordinator.notifyWindowResize();
        expect(env.classList.has(WINDOW_RESIZING_CLASS)).toBe(true);

        stop();
        expect(env.classList.has(WINDOW_RESIZING_CLASS)).toBe(false);
        expect(coordinator.isWindowResizing.value).toBe(false);
    });

    it("dedupes: DOM resize and notifyWindowResize in the same frame dispatch once", () => {
        const coordinator = createWindowResizeCoordinator(env);
        const onFrame = vi.fn();
        coordinator.subscribeWindowResize(onFrame);
        coordinator.start();

        env.fireWindowResize();
        coordinator.notifyWindowResize();
        expect(env.frames.size).toBe(1);
        env.runFrames();
        expect(onFrame).toHaveBeenCalledTimes(1);
    });

    it("registers the window listener once for multiple start holders and cleans up on last stop", () => {
        const coordinator = createWindowResizeCoordinator(env);
        const stopFirst = coordinator.start();
        const stopSecond = coordinator.start();
        expect(env.windowListeners.length).toBe(1);

        stopFirst();
        expect(env.windowListeners.length).toBe(1);

        coordinator.notifyWindowResize();
        stopSecond();
        expect(env.windowListeners.length).toBe(0);
        expect(env.frames.size).toBe(0);
        expect(env.timers.size).toBe(0);
    });
});
