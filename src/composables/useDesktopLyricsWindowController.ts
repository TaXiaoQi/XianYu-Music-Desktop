import { listen, emitTo } from "@tauri-apps/api/event";
import {
    cursorPosition,
    currentMonitor,
    availableMonitors,
    getCurrentWindow,
} from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import {
    ref,
    computed,
    watch,
    onMounted,
    onUnmounted,
    type Ref,
    type CSSProperties,
} from "vue";

import { loadSystemLyricsFonts } from "./lyrics";
import {
    DESKTOP_LYRICS_BOUNDS_EVENT,
    DESKTOP_LYRICS_PLAYBACK_EVENT,
    DESKTOP_LYRICS_READY_EVENT,
    DESKTOP_LYRICS_REVEAL_SURFACE_EVENT,
    DESKTOP_LYRICS_REQUEST_STATE_EVENT,
    DESKTOP_LYRICS_STATE_EVENT,
    DESKTOP_LYRICS_VISIBILITY_EVENT,
    type DesktopLyricsPlaybackPayload,
    type DesktopLyricsStatePayload,
    type DesktopLyricsWindowBounds,
    type DesktopLyricsWindowSettings,
} from "../features/desktopLyrics/shared";
import { windowApi } from "../services/tauri/windowApi";
import {
    sessionApi,
    type PlaybackSessionChangedPayload,
} from "../services/tauri/sessionApi";

const FULLSCREEN_PROBE_MS = 300;
const RESIZE_HOLD_MS = 1200;
const CENTER_DEBOUNCE_MS = 300;
const CENTER_SETTLE_MS = 300;
const LOCK_WATCH_MS = 80;
const LOCK_PROBE_HEIGHT_PX = 80;
const LOCK_PROBE_HALF_WIDTH_PX = 56;
// 背景隐藏时歌词文本命中框的外扩边距（逻辑像素），兼顾阴影与发光范围
const TEXT_HIT_PAD_PX = 12;
const DRAG_SHADOW_LINGER_MS = 1500;
const SURFACE_LEAVE_DELAY_MS = 180;

// 自动隐藏判定：缩放交互期间永不隐藏；否则按全屏/暂停两个开关分别判断。
type AutoHideDecision = {
    autoHideWhenFullscreen: boolean;
    autoHideWhenPaused: boolean;
    isForegroundFullscreen: boolean;
    isPlaying: boolean;
    isResizeInteractionActive: boolean;
};

export function shouldAutoHideDesktopLyrics(input: AutoHideDecision) {
    if (input.isResizeInteractionActive) {
        return false;
    }

    const hideOnFullscreen =
        input.autoHideWhenFullscreen && input.isForegroundFullscreen;
    const hideOnPause = input.autoHideWhenPaused && !input.isPlaying;

    return hideOnFullscreen || hideOnPause;
}

// 鼠标穿透判定：自动隐藏时整体穿透；锁定时仅锁按钮热区可交互；
// 未锁定且背景隐藏时仅歌词文本本体可交互，其余区域放行鼠标，避免透明窗口挡住底层操作。
export function shouldIgnoreCursorEvents(input: {
    isLocked: boolean;
    surfaceVisible: boolean;
    autoHidden: boolean;
    cursorOverLockHandle: boolean;
    cursorOverLyricsText: boolean;
}) {
    if (input.autoHidden) {
        return true;
    }
    if (input.isLocked) {
        return !input.cursorOverLockHandle;
    }
    return !input.surfaceVisible && !input.cursorOverLyricsText;
}

export function useDesktopLyricsWindowController(options: { // 实现
    showDragShadow: Ref<boolean>;
    settings: Ref<DesktopLyricsWindowSettings>;
    playbackTime: Ref<number>;
    isPlaying: Ref<boolean>;
    handlePayload: (payload: DesktopLyricsStatePayload) => void;
    handlePlaybackPayload: (payload: DesktopLyricsPlaybackPayload) => void;
}) {
    const {
        showDragShadow,
        settings,
        playbackTime,
        isPlaying,
        handlePayload,
        handlePlaybackPayload,
    } = options;

    const lyricsWindow = getCurrentWindow();

    // —— 水平居中的并发保护： setPosition 触发 onMoved，需要短暂抑制回环 ——
    let centeringInProgress = false;
    let centerSettleTimer: ReturnType<typeof setTimeout> | null = null;
    let centerDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    // —— 文档隐藏时暂停本窗口内的各类定时器 ——
    let documentHidden = false;

    const isFullscreenObscured = ref(false);
    const pointerOverSurface = ref(false);
    const isResizing = ref(false);
    const cursorOnLockHandle = ref(false);
    const cursorOnLyricsText = ref(false);

    let wakeWatchTimer: ReturnType<typeof setInterval> | null = null;
    let leaveTimer: ReturnType<typeof setTimeout> | null = null;
    let fullscreenProbeTimer: ReturnType<typeof setInterval> | null = null;
    let resizeHoldTimer: ReturnType<typeof setTimeout> | null = null;
    let rafHandle = 0;
    let shadowTimer: ReturnType<typeof setTimeout> | null = null;
    let detachState: (() => void) | null = null;
    let detachPlayback: (() => void) | null = null;
    let detachReveal: (() => void) | null = null;
    let detachClose: (() => void) | null = null;
    let detachMoved: (() => void) | null = null;
    let detachResized: (() => void) | null = null;
    let detachSession: (() => void) | null = null;

    const autoHiddenNow = computed(() =>
        shouldAutoHideDesktopLyrics({
            autoHideWhenFullscreen: settings.value.autoHideWhenFullscreen,
            autoHideWhenPaused: settings.value.autoHideWhenPaused,
            isForegroundFullscreen: isFullscreenObscured.value,
            isPlaying: isPlaying.value,
            isResizeInteractionActive: isResizing.value,
        }),
    );

    // 锁定时表面整体隐藏，仅靠悬停检测的锁定按钮保持可点。
    const surfaceShown = computed(() => {
        if (settings.value.isLocked) return false;
        return (
            pointerOverSurface.value ||
            showDragShadow.value ||
            isResizing.value ||
            settings.value.alwaysShowShadowBackground
        );
    });

    function onDocumentVisibilityChange() {
        const hidden = document.hidden;
        if (hidden === documentHidden) return;
        documentHidden = hidden;

        if (hidden) {
            haltClock();
            haltFullscreenWatch();
            endWakeWatch();
            return;
        }

        startClock();
        startFullscreenWatch();
        if (
            !autoHiddenNow.value &&
            (settings.value.isLocked || !surfaceShown.value)
        ) {
            beginWakeWatch();
        }
    }

    // —— 播放时钟：用 requestAnimationFrame 推进本地播放进度 ——

    function startClock() {
        haltClock();

        let lastStamp = performance.now();
        const step = (now: number) => {
            const elapsedSeconds = (now - lastStamp) / 1000;
            lastStamp = now;
            if (isPlaying.value) {
                playbackTime.value += elapsedSeconds;
            }
            rafHandle = requestAnimationFrame(step);
        };

        rafHandle = requestAnimationFrame(step);
    }

    function haltClock() {
        if (rafHandle !== 0) {
            cancelAnimationFrame(rafHandle);
            rafHandle = 0;
        }
    }

    // —— 前台全屏探测轮询 ——

    function startFullscreenWatch() {
        haltFullscreenWatch();

        const probe = async () => {
            if (isResizing.value || !settings.value.autoHideWhenFullscreen) {
                isFullscreenObscured.value = false;
                return;
            }

            try {
                const state = await windowApi.getForegroundFullscreenState();
                isFullscreenObscured.value = state.isFullscreen;
            } catch {
                isFullscreenObscured.value = false;
            }
        };

        fullscreenProbeTimer = setInterval(() => {
            void probe();
        }, FULLSCREEN_PROBE_MS);

        void probe();
    }

    function haltFullscreenWatch() {
        if (fullscreenProbeTimer) {
            clearInterval(fullscreenProbeTimer);
            fullscreenProbeTimer = null;
        }
    }

    // 采集歌词文本的实际渲染矩形（CSS 像素）：对内容建 Range，得到紧贴字形的包围盒
    function collectLyricsTextRects(): DOMRect[] {
        const nodes = document.querySelectorAll(
            ".desktop-lyric-main, .desktop-lyric-sub, .desktop-empty-state",
        );
        const rects: DOMRect[] = [];

        nodes.forEach((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            const bounds = range.getBoundingClientRect();
            if (bounds.width > 0 && bounds.height > 0) {
                rects.push(bounds);
            }
        });

        return rects;
    }

    // 轮询唤醒热区：锁定态探测锁按钮位置，背景隐藏态探测歌词文本本体
    async function pollWakeZone() {
        if (autoHiddenNow.value) return;

        try {
            const cursor = await cursorPosition();
            const origin = await lyricsWindow.outerPosition();
            const scale = await lyricsWindow.scaleFactor();
            const localX = cursor.x - origin.x;
            const localY = cursor.y - origin.y;

            let overLockHandle = false;
            let overLyricsText = false;

            if (settings.value.isLocked) {
                const box = await lyricsWindow.outerSize();
                const hitHeight = LOCK_PROBE_HEIGHT_PX * scale;
                const hitHalfWidth = LOCK_PROBE_HALF_WIDTH_PX * scale;
                const midX = box.width / 2;
                overLockHandle =
                    localY >= 0 &&
                    localY <= hitHeight &&
                    localX >= midX - hitHalfWidth &&
                    localX <= midX + hitHalfWidth;
            } else {
                const pad = TEXT_HIT_PAD_PX * scale;
                overLyricsText = collectLyricsTextRects().some(
                    (rect) =>
                        localX >= rect.left * scale - pad &&
                        localX <= rect.right * scale + pad &&
                        localY >= rect.top * scale - pad &&
                        localY <= rect.bottom * scale + pad,
                );
            }

            if (
                overLockHandle !== cursorOnLockHandle.value ||
                overLyricsText !== cursorOnLyricsText.value
            ) {
                cursorOnLockHandle.value = overLockHandle;
                cursorOnLyricsText.value = overLyricsText;
                await syncCursorPassthrough();
            }
        } catch (err) {
            console.warn("Failed to check cursor proximity:", err);
        }
    }

    function beginWakeWatch() {
        endWakeWatch();
        wakeWatchTimer = setInterval(() => {
            void pollWakeZone();
        }, LOCK_WATCH_MS);
    }

    function endWakeWatch() {
        if (wakeWatchTimer) {
            clearInterval(wakeWatchTimer);
            wakeWatchTimer = null;
        }
        cursorOnLockHandle.value = false;
        cursorOnLyricsText.value = false;
    }

    async function syncCursorPassthrough() {
        const ignoreCursor = shouldIgnoreCursorEvents({
            isLocked: settings.value.isLocked,
            surfaceVisible: surfaceShown.value,
            autoHidden: autoHiddenNow.value,
            cursorOverLockHandle: cursorOnLockHandle.value,
            cursorOverLyricsText: cursorOnLyricsText.value,
        });
        await lyricsWindow.setIgnoreCursorEvents(ignoreCursor);
        await lyricsWindow.setFocusable(!ignoreCursor);
    }

    async function pushTopmostState(enabled: boolean) {
        await lyricsWindow.setAlwaysOnTop(enabled);
        await windowApi.refreshCurrentWindowTopmost(enabled);

        if (enabled) {
            await windowApi.startTopmostGuard();
            return;
        }

        await windowApi.stopTopmostGuard();
    }

    function clearLeaveTimer() {
        if (leaveTimer) {
            clearTimeout(leaveTimer);
            leaveTimer = null;
        }
    }

    function clearResizeHoldTimer() {
        if (resizeHoldTimer) {
            clearTimeout(resizeHoldTimer);
            resizeHoldTimer = null;
        }
    }

    function clearCenterSettleTimer() {
        centeringInProgress = false;
        if (centerSettleTimer) {
            clearTimeout(centerSettleTimer);
            centerSettleTimer = null;
        }
    }

    function armCenterSettle() {
        if (centerSettleTimer) {
            clearTimeout(centerSettleTimer);
        }
        centerSettleTimer = setTimeout(() => {
            centeringInProgress = false;
            centerSettleTimer = null;
        }, CENTER_SETTLE_MS);
    }

    function scheduleCenterDebounce() {
        if (centerDebounceTimer) {
            clearTimeout(centerDebounceTimer);
        }
        centerDebounceTimer = setTimeout(() => {
            centerDebounceTimer = null;
            void snapToHorizontalCenter();
        }, CENTER_DEBOUNCE_MS);
    }

    // —— 缩放进行中：强制保持可见并展示拖拽阴影 ——

    function extendResizeVisibility() {
        clearResizeHoldTimer();
        clearLeaveTimer();

        isResizing.value = true;
        isFullscreenObscured.value = false;
        flashDragShadow();

        resizeHoldTimer = setTimeout(() => {
            isResizing.value = false;
            resizeHoldTimer = null;
        }, RESIZE_HOLD_MS);
    }

    function scheduleSurfaceHide(delay = SURFACE_LEAVE_DELAY_MS) {
        clearLeaveTimer();

        leaveTimer = setTimeout(() => {
            pointerOverSurface.value = false;
            leaveTimer = null;
        }, delay);
    }

    function flashDragShadow() {
        showDragShadow.value = true;

        if (shadowTimer) {
            clearTimeout(shadowTimer);
        }

        shadowTimer = setTimeout(() => {
            showDragShadow.value = false;
            shadowTimer = null;
        }, DRAG_SHADOW_LINGER_MS);
    }

    function handlePointerEnter() {
        if (settings.value.isLocked) return;
        clearLeaveTimer();
        pointerOverSurface.value = true;
    }

    function handlePointerMove() {
        if (settings.value.isLocked) return;
        clearLeaveTimer();
        pointerOverSurface.value = true;
    }

    function handlePointerLeave() {
        if (settings.value.isLocked) return;
        if (isResizing.value) return;
        scheduleSurfaceHide();
    }

    async function startWindowDrag(event: MouseEvent) {
        if (settings.value.isLocked || autoHiddenNow.value) return;
        const hit = (event.target as HTMLElement).closest(
            "button, .settings-menu",
        );
        if (hit) return;

        flashDragShadow();
        await lyricsWindow.startDragging();
    }

    async function publishBounds(bounds: DesktopLyricsWindowBounds) {
        await emitTo<DesktopLyricsWindowBounds>(
            "main",
            DESKTOP_LYRICS_BOUNDS_EVENT,
            bounds,
        );
    }

    const widgetShellStyle = computed<CSSProperties>(() => ({
        opacity: autoHiddenNow.value ? "0" : "1",
        transform: autoHiddenNow.value ? "scale(0.96)" : "scale(1)",
        pointerEvents: autoHiddenNow.value ? "none" : "auto",
    }));

    // —— 水平居中：把窗口 x 调到当前工作区中线（仅当偏差超过 1px） ——

    async function resolveActiveMonitor() {
        const focused = await currentMonitor();
        if (focused) return focused;

        const all = await availableMonitors();
        return all.length > 0 ? all[0] : undefined;
    }

    async function snapToHorizontalCenter() {
        if (centeringInProgress) return;

        try {
            const monitor = await resolveActiveMonitor();
            if (!monitor) return;

            const area = monitor.workArea;
            const box = await lyricsWindow.outerSize();
            const origin = await lyricsWindow.outerPosition();
            const targetX =
                area.position.x + Math.round((area.size.width - box.width) / 2);

            if (Math.abs(origin.x - targetX) <= 1) return;

            centeringInProgress = true;
            armCenterSettle();

            try {
                await lyricsWindow.setPosition(
                    new PhysicalPosition(targetX, origin.y),
                );
            } catch (err) {
                console.warn("Failed to call setPosition:", err);
                clearCenterSettleTimer();
            }

            await publishBounds({
                x: targetX,
                y: origin.y,
                width: box.width,
                height: box.height,
            });
        } catch (error) {
            console.warn("Failed to force center horizontally:", error);
            clearCenterSettleTimer();
        }
    }

    onMounted(async () => {
        startClock();
        startFullscreenWatch();
        void loadSystemLyricsFonts();

        document.addEventListener(
            "visibilitychange",
            onDocumentVisibilityChange,
        );

        try {
            await lyricsWindow.setBackgroundColor([0, 0, 0, 0]);
        } catch (error) {
            console.warn(
                "Failed to force transparent background for desktop lyrics window:",
                error,
            );
        }

        detachState = await lyricsWindow.listen<DesktopLyricsStatePayload>(
            DESKTOP_LYRICS_STATE_EVENT,
            (event) => {
                handlePayload(event.payload);
            },
        );

        detachPlayback =
            await lyricsWindow.listen<DesktopLyricsPlaybackPayload>(
                DESKTOP_LYRICS_PLAYBACK_EVENT,
                (event) => {
                    handlePlaybackPayload(event.payload);
                },
            );

        detachReveal = await lyricsWindow.listen(
            DESKTOP_LYRICS_REVEAL_SURFACE_EVENT,
            () => {
                flashDragShadow();
            },
        );

        flashDragShadow();

        detachClose = await lyricsWindow.onCloseRequested(async (event) => {
            event.preventDefault();
            await lyricsWindow.hide();
            await emitTo("main", DESKTOP_LYRICS_VISIBILITY_EVENT, {
                visible: false,
            });
        });

        detachMoved = await lyricsWindow.onMoved(async ({ payload }) => {
            flashDragShadow();

            // 居中流程引发的移动事件：直接上报结果位置，不再触发居中去抖。
            if (centeringInProgress) {
                clearCenterSettleTimer();
                const box = await lyricsWindow.outerSize();
                await publishBounds({
                    x: payload.x,
                    y: payload.y,
                    width: box.width,
                    height: box.height,
                });
                return;
            }

            const box = await lyricsWindow.outerSize();
            if (settings.value.centerHorizontally) {
                scheduleCenterDebounce();
            }

            await publishBounds({
                x: payload.x,
                y: payload.y,
                width: box.width,
                height: box.height,
            });
        });

        detachResized = await lyricsWindow.onResized(async ({ payload }) => {
            extendResizeVisibility();

            if (centeringInProgress) {
                clearCenterSettleTimer();
                const origin = await lyricsWindow.outerPosition();
                await publishBounds({
                    x: origin.x,
                    y: origin.y,
                    width: payload.width,
                    height: payload.height,
                });
                return;
            }

            const origin = await lyricsWindow.outerPosition();
            if (settings.value.centerHorizontally) {
                scheduleCenterDebounce();
            }

            await publishBounds({
                x: origin.x,
                y: origin.y,
                width: payload.width,
                height: payload.height,
            });
        });

        // 从持久化会话恢复播放状态，失败则等待主窗口的全量状态推送。
        try {
            const session = await sessionApi.getPlaybackSession();
            if (session && session.currentSongPath) {
                isPlaying.value = session.isPlaying;
                playbackTime.value = session.currentPositionSecs;
            }
        } catch {
            /* 静默：状态推送会补齐 */
        }

        detachSession = await listen<PlaybackSessionChangedPayload>(
            "playback:session-changed",
            (event) => {
                const data = event.payload;
                isPlaying.value = data.isPlaying;
                playbackTime.value = data.currentPositionSecs;
            },
        );

        try {
            await emitTo("main", DESKTOP_LYRICS_READY_EVENT);
            await emitTo("main", DESKTOP_LYRICS_REQUEST_STATE_EVENT);
        } catch (error) {
            console.warn(
                "Failed to notify main window that desktop lyrics is ready:",
                error,
            );
        }
    });

    onUnmounted(() => {
        document.removeEventListener(
            "visibilitychange",
            onDocumentVisibilityChange,
        );
        endWakeWatch();
        haltClock();
        haltFullscreenWatch();
        clearLeaveTimer();
        clearResizeHoldTimer();
        detachState?.();
        detachPlayback?.();
        detachReveal?.();
        detachClose?.();
        detachMoved?.();
        detachResized?.();
        detachSession?.();
        void windowApi.stopTopmostGuard();

        clearCenterSettleTimer();

        if (centerDebounceTimer) {
            clearTimeout(centerDebounceTimer);
            centerDebounceTimer = null;
        }

        if (shadowTimer) {
            clearTimeout(shadowTimer);
            shadowTimer = null;
        }
    });

    // 穿透状态统一收敛：锁定态轮询锁按钮热区；未锁定时背景隐藏则仅歌词文本热区可唤醒窗口
    watch(
        () => [
            settings.value.isLocked,
            autoHiddenNow.value,
            surfaceShown.value,
        ],
        () => {
            if (settings.value.isLocked) {
                clearLeaveTimer();
                pointerOverSurface.value = false;
            }

            if (autoHiddenNow.value) {
                endWakeWatch();
            } else if (settings.value.isLocked || !surfaceShown.value) {
                beginWakeWatch();
            } else {
                // 背景可见即常规交互态，无需热区轮询
                endWakeWatch();
            }
            void syncCursorPassthrough();
        },
        { immediate: true },
    );

    watch(
        () => settings.value.autoHideWhenFullscreen,
        (enabled) => {
            if (!enabled) {
                isFullscreenObscured.value = false;
            }
        },
    );

    watch(
        () => settings.value.isAlwaysOnTop,
        (enabled) => {
            void pushTopmostState(enabled);
        },
        { immediate: true },
    );

    watch(
        () => settings.value.centerHorizontally,
        (enabled) => {
            if (enabled) {
                void snapToHorizontalCenter();
            }
        },
    );

    return {
        showDragShadow,
        isSystemHidden: isFullscreenObscured,
        isSurfaceVisible: surfaceShown,
        isCursorOverLockButton: cursorOnLockHandle,
        widgetShellStyle,
        handlePointerEnter,
        handlePointerMove,
        handlePointerLeave,
        startWindowDrag,
    };
}
