import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { storeToRefs } from "pinia";
import { nextTick, onMounted, onUnmounted, watch } from "vue";
import type { Router } from "vue-router";

import { useLyrics } from "./lyrics";
import { useThemeSettings } from "./useThemeSettings";
import { useLibraryCollections } from "../features/collections/useLibraryCollections";
import { usePlaybackController } from "../features/playback/usePlaybackController";
import { usePlaybackStore } from "../features/playback/store";
import { useUiStore } from "../shared/stores/ui";
import {
    APP_TRAY_MENU_EVENT,
    APP_TRAY_MENU_OPEN_EVENT,
    handleTrayMenuAction,
    TRAY_MENU_READY_EVENT,
    TRAY_MENU_STATE_EVENT,
    TRAY_MENU_WINDOW_HEIGHT,
    TRAY_MENU_WINDOW_LABEL,
    TRAY_MENU_WINDOW_WIDTH,
    type TrayMenuAction,
    type TrayMenuStatePayload,
} from "../features/tray/actions";
import { windowApi } from "../services/tauri/windowApi";
import { appApi } from "../services/tauri/appApi";

interface TrayMenuAnchor {
    x: number;
    y: number;
}

interface TrayWindowLease {
    creation: Promise<WebviewWindow> | null;
    announced: boolean;
    readyGate: Promise<void> | null;
    readyRelease: (() => void) | null;
    metricsApplied: boolean;
    metricsJob: Promise<void> | null;
}

const lease: TrayWindowLease = {
    creation: null,
    announced: false,
    readyGate: null,
    readyRelease: null,
    metricsApplied: false,
    metricsJob: null,
};

const WARMUP_DELAY_MS = 600;
const READY_GATE_TIMEOUT_MS = 600;
const CURSOR_NUDGE_X = 12;
const CURSOR_GAP_Y = 10;

const findTrayWindow = async () =>
    WebviewWindow.getByLabel(TRAY_MENU_WINDOW_LABEL);

const resetLease = () => {
    lease.creation = null;
    lease.announced = false;
    lease.readyGate = null;
    lease.readyRelease = null;
    lease.metricsApplied = false;
    lease.metricsJob = null;
};

const openTrayWindow = async (): Promise<WebviewWindow> => {
    const existing = await findTrayWindow();
    if (existing) return existing;

    if (lease.creation) {
        return lease.creation;
    }

    lease.announced = false;
    lease.metricsApplied = false;
    lease.metricsJob = null;
    lease.readyGate = null;
    lease.readyRelease = null;

    const candidate = new WebviewWindow(TRAY_MENU_WINDOW_LABEL, {
        url: "/",
        title: "XianYu Music Tray Menu",
        width: TRAY_MENU_WINDOW_WIDTH,
        height: TRAY_MENU_WINDOW_HEIGHT,
        minWidth: TRAY_MENU_WINDOW_WIDTH,
        minHeight: TRAY_MENU_WINDOW_HEIGHT,
        maxWidth: TRAY_MENU_WINDOW_WIDTH,
        maxHeight: TRAY_MENU_WINDOW_HEIGHT,
        visible: false,
        decorations: false,
        transparent: true,
        shadow: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focus: false,
        focusable: true,
        center: false,
    });

    let settled = false;
    const conclude = (finish: () => void) => {
        if (settled) return;
        settled = true;
        lease.creation = null;
        finish();
    };

    lease.creation = new Promise<WebviewWindow>((resolve, reject) => {
        void candidate.once("tauri://created", () => {
            conclude(() => resolve(candidate));
        });

        void candidate.once("tauri://error", (event) => {
            conclude(() => reject(event.payload));
        });
    });

    return lease.creation;
};

const announceTrayReady = () => {
    lease.announced = true;
    lease.readyRelease?.();
    lease.readyRelease = null;
    lease.readyGate = null;
};

const awaitTrayReady = (timeoutMs = READY_GATE_TIMEOUT_MS) => {
    if (lease.announced) return Promise.resolve();

    if (!lease.readyGate) {
        lease.readyGate = new Promise<void>((resolve) => {
            lease.readyRelease = resolve;
            window.setTimeout(resolve, timeoutMs);
        });
    }

    return lease.readyGate;
};

const applyTrayMetrics = async (target: WebviewWindow) => {
    if (lease.metricsApplied) return;
    if (lease.metricsJob) return lease.metricsJob;

    const bounds = new LogicalSize(
        TRAY_MENU_WINDOW_WIDTH,
        TRAY_MENU_WINDOW_HEIGHT,
    );
    lease.metricsJob = (async () => {
        for (const resize of [
            target.setMinSize,
            target.setMaxSize,
            target.setSize,
        ]) {
            await resize.call(target, bounds);
        }
        lease.metricsApplied = true;
    })().finally(() => {
        lease.metricsJob = null;
    });

    return lease.metricsJob;
};

const clampWithin = (value: number, low: number, high: number) =>
    Math.max(low, Math.min(high, value));

const resolveTrayMenuPosition = async (
    anchor: TrayMenuAnchor,
): Promise<LogicalPosition> => {
    const monitors = await availableMonitors();
    const host =
        monitors.find((monitor) => {
            const area = monitor.workArea;
            return (
                anchor.x >= area.position.x &&
                anchor.x <= area.position.x + area.size.width &&
                anchor.y >= area.position.y &&
                anchor.y <= area.position.y + area.size.height
            );
        }) ?? monitors[0];

    if (!host) {
        return new LogicalPosition(
            anchor.x - TRAY_MENU_WINDOW_WIDTH + CURSOR_NUDGE_X,
            anchor.y - TRAY_MENU_WINDOW_HEIGHT - CURSOR_GAP_Y,
        );
    }

    const zoom = host.scaleFactor || 1;
    const area = host.workArea;
    const origin = area.position.toLogical(zoom);
    const extent = area.size.toLogical(zoom);
    const cursorX = anchor.x / zoom;
    const cursorY = anchor.y / zoom;
    const edge = 0;

    const lowestX = origin.x + edge;
    const highestX = origin.x + extent.width - TRAY_MENU_WINDOW_WIDTH - edge;
    const lowestY = origin.y + edge;
    const highestY = origin.y + extent.height - TRAY_MENU_WINDOW_HEIGHT - edge;
    const aboveY = cursorY - TRAY_MENU_WINDOW_HEIGHT - edge;
    const belowY = cursorY + edge;
    const wantedX = cursorX + CURSOR_NUDGE_X - TRAY_MENU_WINDOW_WIDTH;

    return new LogicalPosition(
        Math.round(clampWithin(wantedX, lowestX, highestX)),
        Math.round(
            clampWithin(aboveY >= lowestY ? aboveY : belowY, lowestY, highestY),
        ),
    );
};

const nextFrame = () =>
    new Promise<void>((settle) => {
        window.requestAnimationFrame(() => settle());
    });

const waitForRoutePaint = () => nextFrame().then(nextFrame);

export function useTrayMenuEvents(router: Router) { // 实现
    const mainWindow = getCurrentWindow();
    const {
        currentSong,
        isPlaying,
        prevSong,
        togglePlay,
        nextSong,
        toggleMode,
    } = usePlaybackController();
    const { showDesktopLyrics } = useLyrics();
    const { isDarkTheme, theme } = useThemeSettings();
    const libraryCollections = useLibraryCollections();
    const playbackStore = usePlaybackStore();
    const uiStore = useUiStore();
    const { playMode } = storeToRefs(playbackStore);
    const { isMiniMode, skipNextPageTransition } = storeToRefs(uiStore);

    const disposers: Array<() => void> = [];
    let stopStateWatcher: (() => void) | null = null;
    let stopCustomWatcher: (() => void) | null = null;
    let warmupTimer: number | null = null;

    const buildTraySnapshot = (): TrayMenuStatePayload => ({
        currentSong: currentSong.value,
        isPlaying: isPlaying.value,
        isDarkTheme: isDarkTheme.value,
        playMode: playMode.value,
        showDesktopLyrics: showDesktopLyrics.value,
        isFavorite: currentSong.value
            ? libraryCollections.isFavorite(currentSong.value)
            : false,
        isMiniMode: isMiniMode.value,
        useCustomTrayMenu: theme.value.useCustomTrayMenu,
        windowMaterial: theme.value.windowMaterial,
        windowBlurTint: theme.value.windowBlurTint,
    });

    const pushNativeSnapshot = async () => {
        try {
            await windowApi.updateNativeTrayMenu(buildTraySnapshot());
        } catch (error) {
            console.warn("Failed to update native tray menu:", error);
        }
    };

    const broadcastSnapshot = async () => {
        if (!theme.value.useCustomTrayMenu) return;
        const target = await findTrayWindow();
        if (!target) return;
        await emitTo<TrayMenuStatePayload>(
            TRAY_MENU_WINDOW_LABEL,
            TRAY_MENU_STATE_EVENT,
            buildTraySnapshot(),
        );
    };

    const cancelWarmup = () => {
        if (warmupTimer !== null) {
            window.clearTimeout(warmupTimer);
            warmupTimer = null;
        }
    };

    const dismantleTrayWindow = async () => {
        const target = await findTrayWindow();
        if (!target) {
            resetLease();
            return;
        }

        try {
            await target.destroy();
        } catch (error) {
            console.warn("Failed to destroy custom tray menu window:", error);
        } finally {
            resetLease();
        }
    };

    const summonMainWindow = async () => {
        for (const step of [
            mainWindow.unminimize,
            mainWindow.show,
            mainWindow.setFocus,
        ]) {
            await step.call(mainWindow);
        }
    };

    const jumpToSettings = async () => {
        skipNextPageTransition.value = true;
        try {
            const currentPath = router.currentRoute.value.path;
            if (currentPath !== "/settings") await router.replace("/settings");
            await nextTick();
            await waitForRoutePaint();
        } finally {
            skipNextPageTransition.value = false;
        }
    };

    const warmTrayWindow = async () => {
        if (!theme.value.useCustomTrayMenu) return;

        try {
            const target = await openTrayWindow();
            await awaitTrayReady();
            await applyTrayMetrics(target);
            await broadcastSnapshot();
            await target.setAlwaysOnTop(true);
        } catch (error) {
            console.warn("Failed to prewarm tray menu window:", error);
        }
    };

    const queueTrayWarmup = () => {
        cancelWarmup();
        if (!theme.value.useCustomTrayMenu) return;

        warmupTimer = window.setTimeout(() => {
            warmupTimer = null;
            void warmTrayWindow();
        }, WARMUP_DELAY_MS);
    };

    const presentTrayMenu = async (anchor: TrayMenuAnchor) => {
        if (!theme.value.useCustomTrayMenu) return;

        const target = await openTrayWindow();
        await awaitTrayReady();
        await applyTrayMetrics(target);
        const position = await resolveTrayMenuPosition(anchor);
        await target.setAlwaysOnTop(true);
        await target.setPosition(position);
        await emitTo<TrayMenuStatePayload>(
            TRAY_MENU_WINDOW_LABEL,
            TRAY_MENU_STATE_EVENT,
            buildTraySnapshot(),
        );
        await target.show();
        // 托盘点击授予的前台激活权在异步弹出链路里往往已失效，普通
        // setFocus 会被系统静默拒绝，菜单窗拿不到焦点时失焦关闭永远不
        // 触发；由 Rust 侧 AttachThreadInput 强制接管前台
        await windowApi.forceWindowForeground(TRAY_MENU_WINDOW_LABEL);
        await nextFrame();
        await target.setFocus();
        // 关外点击收起菜单：Win32 低级鼠标钩子，与原生菜单同源的机制，
        // 不依赖焦点（托盘弹出后进程常拿不到前台，失焦关闭不可靠）
        try {
            await windowApi.startTrayMouseCapture(TRAY_MENU_WINDOW_LABEL);
        } catch (error) {
            console.warn("Failed to start tray mouse capture:", error);
        }
    };

    const shutdownApp = () => appApi.exitApp();

    const buildActionDeps = () => ({
        prevSong,
        togglePlay,
        nextSong,
        playMode,
        cyclePlayMode: toggleMode,
        isMiniMode,
        showDesktopLyrics,
        revealMainWindow: summonMainWindow,
        openSettings: jumpToSettings,
        quitApp: shutdownApp,
        toggleFavorite: () => {
            if (currentSong.value)
                libraryCollections.toggleFavorite(currentSong.value);
        },
    });

    onMounted(async () => {
        await pushNativeSnapshot();
        queueTrayWarmup();

        stopStateWatcher = watch(
            buildTraySnapshot,
            () => {
                void pushNativeSnapshot();
                void broadcastSnapshot();

                if (theme.value.useCustomTrayMenu) {
                    queueTrayWarmup();
                } else {
                    cancelWarmup();
                    void dismantleTrayWindow();
                }
            },
            { deep: true, flush: "post" },
        );

        stopCustomWatcher = watch(
            () => theme.value.useCustomTrayMenu,
            (useCustomTrayMenu) => {
                void pushNativeSnapshot();

                if (useCustomTrayMenu) {
                    queueTrayWarmup();
                    return;
                }

                cancelWarmup();
                void dismantleTrayWindow();
            },
            { flush: "sync" },
        );

        disposers.push(
            await listen<TrayMenuAction>(APP_TRAY_MENU_EVENT, (event) => {
                void (async () => {
                    await handleTrayMenuAction(
                        event.payload,
                        buildActionDeps(),
                    );
                    await pushNativeSnapshot();
                    await broadcastSnapshot();
                })();
            }),
        );

        disposers.push(
            await listen<TrayMenuAnchor>(APP_TRAY_MENU_OPEN_EVENT, (event) => {
                void presentTrayMenu(event.payload);
            }),
        );

        disposers.push(
            await listen(TRAY_MENU_READY_EVENT, () => {
                announceTrayReady();
            }),
        );
    });

    onUnmounted(() => {
        cancelWarmup();
        stopStateWatcher?.();
        stopCustomWatcher?.();
        disposers.splice(0).forEach((off) => off());
        stopStateWatcher = null;
        stopCustomWatcher = null;
    });
}
