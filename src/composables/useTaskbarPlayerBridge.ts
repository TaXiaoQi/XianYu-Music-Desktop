// 主窗口 ↔ 任务栏迷你播放器窗口的桥接层。
// 职责：播控窗口的创建/显隐/销毁编排、播放状态快照推送、
// 用户控制指令分发、全屏遮挡巡检，以及主窗口关闭前的清理。
// 事件名、payload 结构与 Rust 侧契约见 src/features/taskbarPlayer/shared.ts，此处只引用不改动。

import { listen, emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ref, watch, onMounted, onUnmounted } from "vue";

import { useCoverCache as useCoverStore } from "./useCoverCache";
import { useThemeSettings as useThemeMode } from "./useThemeSettings";
import * as taskbarContracts from "../features/taskbarPlayer/shared";
import {
    armStateAppliedGate,
    ensurePanelWindow,
    findPanelWindow,
    forgetPanelWindow,
    isPanelDragging,
    queueLayoutRetries,
    releasePanelGate,
    setPanelDragging,
    signalStateApplied,
    syncPanelLayout,
    untilPanelGateOpen,
} from "./taskbarPanelWindow";
import { usePlayer } from "../features/playback";
import { useSettings as usePreferenceStore } from "../features/settings/useSettings";
import { windowApi } from "../services/tauri/windowApi";

// —— 历史公开类型导出面，保持原样以兼容潜在引用 ——

export type OwnerBindingState =
    "bound" | "failed" | "unsupported" | "already_bound";
export type GeometrySource = "tray" | "taskbar_fallback";

export interface RectPhysical { // 实现
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface TaskbarTrayGeometry { // 实现
    taskbar_rect_physical: RectPhysical;
    tray_rect_physical: RectPhysical | null;
    taskbar_hwnd_changed: boolean;
    owner_binding: OwnerBindingState;
    source: GeometrySource;
    scale_factor: number;
}

/** 持久化任务栏窗口被用户拖动后的横向位置（整数逻辑像素） */
export function writeSavedPositionX(x: number) { // 实现
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
        taskbarContracts.TASKBAR_PLAYER_POSITION_X_KEY,
        String(Math.round(x)),
    );
}

/** 全屏遮挡巡检间隔（毫秒） */
const PANEL_POLL_MS = 1000;

let detachScaleWatcher: (() => void) | null = null;

export function useTaskbarPlayerBridge() {
    const rootWindow = getCurrentWindow();
    const { settings: prefs } = usePreferenceStore();
    const player = usePlayer();
    const coverLoader = useCoverStore();
    const themeMode = useThemeMode();

    const panelVisible = ref(false);
    const disposers: Array<() => void> = [];
    let pollHandle: number | null = null;
    let closeFlowStarted = false;

    // 组装一份完整播放状态快照（封面加载失败时回退为空串）
    const buildStateSnapshot =
        async (): Promise<taskbarContracts.TaskbarPlayerStatePayload> => {
            const song = player.currentSong.value;
            const artwork = song?.path
                ? await coverLoader.loadCover(song.path).catch(() => "")
                : "";
            const snapshot: taskbarContracts.TaskbarPlayerStatePayload = {
                currentSong: song,
                coverUrl: artwork || "",
                isPlaying: player.isPlaying.value,
                isDarkTheme: themeMode.isDarkTheme.value,
            };
            return snapshot;
        };

    // 向播控窗口推送状态，并等待其渲染回执（带超时兜底）
    const pushStateToPanel = async () => {
        if (!(await findPanelWindow())) return;

        const appliedGate = armStateAppliedGate();
        await emitTo<taskbarContracts.TaskbarPlayerStatePayload>(
            taskbarContracts.TASKBAR_PLAYER_WINDOW_LABEL,
            taskbarContracts.TASKBAR_PLAYER_STATE_EVENT,
            await buildStateSnapshot(),
        );
        await appliedGate;
    };

    const dropScaleWatcher = () => {
        if (detachScaleWatcher) {
            detachScaleWatcher();
            detachScaleWatcher = null;
        }
    };

    // 重新挂载缩放监听（旧监听先拆除，避免重复触发布局重试）
    const watchPanelScale = async (panel: WebviewWindow) => {
        dropScaleWatcher();
        detachScaleWatcher = await panel
            .onScaleChanged(() => queueLayoutRetries(panel))
            .catch((err) => {
                console.warn("taskbar player scale watcher failed:", err);
                return null;
            });
    };

    // 巡检：前台全屏时隐藏播控窗口，退出全屏后恢复显示并周期性自愈布局
    const patrolPanel = async () => {
        const panel = await findPanelWindow();
        if (!panel || !prefs.value.showTaskbarPlayer) return;

        try {
            const foreground = await windowApi.getForegroundFullscreenState();
            if (!foreground.isFullscreen) {
                if (!panelVisible.value) {
                    await syncPanelLayout(panel);
                    await panel.show();
                    await syncPanelLayout(panel);
                    panelVisible.value = true;
                } else if (!isPanelDragging()) {
                    void syncPanelLayout(panel);
                }
                return;
            }
            if (panelVisible.value) {
                await panel.hide();
                panelVisible.value = false;
            }
        } catch (err) {
            console.warn("taskbar player patrol failed:", err);
        }
    };

    const beginPolling = () => {
        if (pollHandle) return;
        pollHandle = window.setInterval(
            () => void patrolPanel(),
            PANEL_POLL_MS,
        );
    };

    const endPolling = () => {
        if (!pollHandle) return;
        window.clearInterval(pollHandle);
        pollHandle = null;
    };

    const showPanel = async () => {
        const panel = await ensurePanelWindow();
        await untilPanelGateOpen();

        // 显示前后各做一次几何对齐，规避 DPI/任务栏刷新导致的错位
        await syncPanelLayout(panel);

        await pushStateToPanel();
        await emitTo(
            taskbarContracts.TASKBAR_PLAYER_WINDOW_LABEL,
            taskbarContracts.TASKBAR_PLAYER_VISIBILITY_EVENT,
            {
                visible: true,
            },
        );
        await panel.show();
        await syncPanelLayout(panel);
        panelVisible.value = true;

        void windowApi.installTaskbarZorderGuard().catch((err) => {
            console.warn("taskbar player zorder guard install failed:", err);
        });
        await watchPanelScale(panel);

        beginPolling();
    };

    const hidePanel = async () => {
        const panel = await findPanelWindow();
        if (!panel) {
            panelVisible.value = false;
            return;
        }

        endPolling();
        dropScaleWatcher();
        void windowApi.uninstallTaskbarZorderGuard().catch(() => {});
        await emitTo(
            taskbarContracts.TASKBAR_PLAYER_WINDOW_LABEL,
            taskbarContracts.TASKBAR_PLAYER_VISIBILITY_EVENT,
            {
                visible: false,
            },
        );
        await panel.hide();
        panelVisible.value = false;
    };

    // 主窗口关闭前的彻底清理：销毁播控窗口并复位创建缓存
    const teardownPanel = async () => {
        const panel = await findPanelWindow();
        if (!panel) {
            panelVisible.value = false;
            return;
        }

        endPolling();
        dropScaleWatcher();
        void windowApi.uninstallTaskbarZorderGuard().catch(() => {});
        try {
            await panel.destroy();
        } catch (err) {
            console.warn("taskbar player window destroy failed:", err);
        } finally {
            forgetPanelWindow();
            panelVisible.value = false;
        }
    };

    const dispatchAction = async (
        action: taskbarContracts.TaskbarPlayerAction,
    ) => {
        if (action.type === "toggle-play") {
            await player.togglePlay();
        } else if (action.type === "prev-song") {
            player.prevSong();
        } else if (action.type === "next-song") {
            player.nextSong();
        } else if (action.type === "close") {
            prefs.value.showTaskbarPlayer = false;
        }
    };

    const wirePanelEvents = async () => {
        disposers.push(
            await rootWindow.onCloseRequested(async (event) => {
                if (prefs.value.closeToTray || closeFlowStarted) return;
                closeFlowStarted = true;
                event.preventDefault();
                await teardownPanel();
                await rootWindow.close();
            }),
        );

        disposers.push(
            await listen(
                taskbarContracts.TASKBAR_PLAYER_REQUEST_STATE_EVENT,
                () => void pushStateToPanel(),
            ),
        );
        disposers.push(
            await listen(taskbarContracts.TASKBAR_PLAYER_READY_EVENT, () =>
                releasePanelGate(),
            ),
        );
        disposers.push(
            await listen(
                taskbarContracts.TASKBAR_PLAYER_STATE_APPLIED_EVENT,
                () => signalStateApplied(),
            ),
        );
        disposers.push(
            await listen<taskbarContracts.TaskbarPlayerAction>(
                taskbarContracts.TASKBAR_PLAYER_ACTION_EVENT,
                (event) => void dispatchAction(event.payload),
            ),
        );
        disposers.push(
            await listen<{ dragging: boolean }>(
                taskbarContracts.TASKBAR_PLAYER_DRAG_EVENT,
                (event) => setPanelDragging(event.payload.dragging),
            ),
        );

        watch(
            () => prefs.value.showTaskbarPlayer,
            (enabled) => void (enabled ? showPanel() : hidePanel()),
            { immediate: true },
        );

        // 播放状态 / 主题变化时向播控窗口重新推送快照
        watch(
            [player.currentSong, player.isPlaying, themeMode.isDarkTheme],
            () => {
                if (panelVisible.value) void pushStateToPanel();
            },
        );
    };

    onMounted(() => {
        void wirePanelEvents();
    });

    onUnmounted(cleanupBridge);

    function cleanupBridge() {
        endPolling();
        dropScaleWatcher();
        disposers.splice(0).forEach((off) => off());
    }
}
