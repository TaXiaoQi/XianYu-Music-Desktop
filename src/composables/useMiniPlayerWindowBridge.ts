import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";

import { useCoverCache } from "./useCoverCache";
import { logApplicationEvent } from "../services/applicationLogger";
import { showDesktopLyrics, useLyrics } from "./lyrics";
import { useThemeSettings } from "./useThemeSettings";
import { persistAnchor } from "./miniPlayerBoundsMemory";
import { restoreMainWindowFromMiniMode } from "./miniPlayerMainRestore";
import {
    acquireMiniWindow,
    awaitMiniStateApplied,
    awaitMiniWindowReady,
    confirmMiniStateApplied,
    confirmMiniWindowReady,
    detachMiniWindowRuntime,
    lookupMiniWindow,
} from "./miniPlayerWindowDriver";
import { usePlayer } from "../features/playback";
import { useSettings } from "../features/settings/useSettings";
import {
    APP_SHOW_MAIN_EVENT,
    MINI_PLAYER_ACTION_EVENT,
    MINI_PLAYER_BOUNDS_EVENT,
    MINI_PLAYER_READY_EVENT,
    MINI_PLAYER_REQUEST_STATE_EVENT,
    MINI_PLAYER_STATE_APPLIED_EVENT,
    MINI_PLAYER_STATE_EVENT,
    MINI_PLAYER_VISIBILITY_EVENT,
    MINI_PLAYER_WINDOW_LABEL,
    type MiniPlayerAction,
    type MiniPlayerStatePayload,
    type MiniPlayerWindowBounds,
} from "../features/miniPlayer/shared";
import { useUiStore } from "../shared/stores/ui";

export { restoreMainWindowFromMiniMode };

// 「迷你窗已显示」信号：外部路径流程先等窗口可见再开始播放，避免先出声后出窗。
// 超时兜底（窗口异常时不阻塞播放）。
let miniSurfaceShownResolve: (() => void) | null = null;
let miniSurfaceShownPromise: Promise<void> | null = null;

export function waitForMiniSurfaceShown(timeoutMs = 2500): Promise<void> {
    if (!miniSurfaceShownPromise) {
        miniSurfaceShownPromise = new Promise<void>((resolve) => {
            miniSurfaceShownResolve = () => {
                miniSurfaceShownResolve = null;
                miniSurfaceShownPromise = null;
                resolve();
            };
            window.setTimeout(() => miniSurfaceShownResolve?.(), timeoutMs);
        });
    }
    return miniSurfaceShownPromise;
}

// 迷你窗进度条推流的节流间隔（毫秒）。
const PROGRESS_SYNC_GAP_MS = 250;

export function useMiniPlayerWindowBridge() {
    const hostWindow = getCurrentWindow();
    const { settings: appSettings } = useSettings();
    const ui = useUiStore();
    const {
        currentSong,
        currentCover,
        currentTime,
        isFavorite,
        isMiniMode,
        isPlaying,
        playMode,
        playQueue,
        playSong,
        prevSong,
        nextSong,
        seekTo,
        songList,
        tempQueue,
        volume,
        handleVolume,
        toggleFavorite,
        toggleMode,
        toggleMute,
        togglePlay,
    } = usePlayer();
    const { currentLyricLine: activeLyricLine } = useLyrics();
    const { loadCover: fetchCover } = useCoverCache();
    const { isDarkTheme: darkTheme, theme: currentTheme } = useThemeSettings();

    let mainExitHandled = false;
    let holdMiniOnQuitMiniMode = false;
    const miniSurfaceVisible = ref(false);
    const disposers: Array<() => void> = [];

    const buildStateSnapshot = async (): Promise<MiniPlayerStatePayload> => {
        const activeSong = currentSong.value;
        const playingNow = isPlaying.value;
        const darkMode = darkTheme.value;
        const currentVolume = volume.value;
        const elapsed = currentTime.value;
        const playbackMode = playMode.value;
        const lyricsOnDesktop = showDesktopLyrics.value;
        const lyricLineText = activeLyricLine.value?.text ?? "";
        // 在线曲目（lx://、plugin:// 等）无法走本地封面提取，回退到主窗口
        // 正在展示的封面地址，避免迷你窗只剩占位图
        const fetchedCover = activeSong?.path
            ? await fetchCover(activeSong.path).catch(() => "")
            : "";
        const resolvedCover = fetchedCover || currentCover.value || "";
        const queuedSongs =
            playQueue.value.length + tempQueue.value.length > 0
                ? [...tempQueue.value, ...playQueue.value]
                : songList.value;

        return {
            currentSong: activeSong,
            coverUrl: resolvedCover,
            isPlaying: playingNow,
            isDarkTheme: darkMode,
            volume: currentVolume,
            queue: queuedSongs,
            lyricText: lyricLineText,
            windowMaterial: currentTheme.value.windowMaterial,
            windowBlurTint: currentTheme.value.windowBlurTint,
            currentTime: elapsed,
            duration: activeSong?.duration ?? 0,
            isFavorite: activeSong ? isFavorite(activeSong) : false,
            playMode: playbackMode,
            desktopLyricsEnabled: lyricsOnDesktop,
        };
    };

    const pushStateSnapshot = async () => {
        if ((await lookupMiniWindow()) === null) return;

        const appliedGate = awaitMiniStateApplied();
        const snapshot = await buildStateSnapshot();
        await emitTo(
            MINI_PLAYER_WINDOW_LABEL,
            MINI_PLAYER_STATE_EVENT,
            snapshot,
        );
        await appliedGate;
    };

    const pushVisibilityFlag = async (shown: boolean) => {
        if ((await lookupMiniWindow()) === null) return;

        await emitTo(MINI_PLAYER_WINDOW_LABEL, MINI_PLAYER_VISIBILITY_EVENT, {
            visible: shown,
        });
    };

    const openMiniSurface = async () => {
        const mainVisibleBefore = await hostWindow.isVisible().catch(() => null);
        logApplicationEvent(
            "info",
            "迷你窗",
            "open",
            `开始 主窗可见=${mainVisibleBefore === null ? "unknown" : mainVisibleBefore ? 1 : 0}`,
        );
        ui.mainWindowUiSleepRequested = true;
        await nextTick();
        await hostWindow.hide();

        const surface = await acquireMiniWindow();
        await awaitMiniWindowReady();
        await surface.setAlwaysOnTop(true);
        miniSurfaceVisible.value = true;
        await pushVisibilityFlag(true);
        await surface.show();
        // 先出窗：唤醒等待方（外部路径流程据此在窗口可见后才开始播放）
        miniSurfaceShownResolve?.();
        logApplicationEvent("info", "迷你窗", "open", "迷你窗已显示");
        // 状态异步推送：迷你窗自身会 request state，不再阻塞 show（原实现最多等 500ms）
        void pushStateSnapshot();
    };

    const closeMiniSurface = async () => {
        const surface = await lookupMiniWindow();
        if (surface === null) {
            miniSurfaceVisible.value = false;
            return;
        }

        try {
            await surface.destroy();
        } catch (destroyError) {
            console.warn("Failed to destroy mini player window:", destroyError);
        } finally {
            detachMiniWindowRuntime();
            miniSurfaceVisible.value = false;
        }
    };

    const hideMiniPlayerWindow = async () => {
        await pushVisibilityFlag(false);
        await closeMiniSurface();
    };

    const resumeFromMiniMode = (keepSurface?: boolean) =>
        restoreMainWindowFromMiniMode({
            isMiniMode,
            hideMiniPlayerWindow,
            keepMiniPlayerVisible: keepSurface,
            mainWindow: hostWindow,
            isImmersiveFullscreen: ui.isImmersiveFullscreen,
        });

    const wakeMainWindowFromTray = async () => {
        holdMiniOnQuitMiniMode = false;
        ui.mainWindowUiSleepRequested = false;

        await resumeFromMiniMode(false);
    };

    const runMiniAction = async (action: MiniPlayerAction) => {
        if (action.type === "toggle-play") {
            await togglePlay();
            return;
        }
        if (action.type === "prev-song") {
            prevSong();
            return;
        }
        if (action.type === "next-song") {
            nextSong();
            return;
        }
        if (action.type === "set-volume") {
            const sliderEvent = {
                target: { value: String(action.volume) },
            } as unknown as Event;
            await handleVolume(sliderEvent);
            return;
        }
        if (action.type === "toggle-mute") {
            await toggleMute();
            return;
        }
        if (action.type === "play-song") {
            await playSong(action.song);
            return;
        }
        if (action.type === "restore-main") {
            ui.mainWindowUiSleepRequested = false;
            await resumeFromMiniMode(undefined);
            return;
        }
        if (action.type === "close") {
            isMiniMode.value = false;
            ui.mainWindowUiSleepRequested = false;
            await hideMiniPlayerWindow();
            return;
        }
        if (action.type === "seek") {
            await seekTo(action.time);
            return;
        }
        if (action.type === "toggle-favorite") {
            const targetSong = currentSong.value;
            if (targetSong) toggleFavorite(targetSong);
            return;
        }
        if (action.type === "cycle-play-mode") {
            toggleMode();
            return;
        }
        if (action.type === "toggle-desktop-lyrics") {
            showDesktopLyrics.value = !showDesktopLyrics.value;
        }
    };

    const bindEventListeners = async () => {
        disposers.push(
            await hostWindow.onCloseRequested(async (event) => {
                if (appSettings.value.closeToTray || mainExitHandled) return;

                mainExitHandled = true;
                event.preventDefault();
                await closeMiniSurface();
                await hostWindow.close();
            }),
        );

        disposers.push(
            await listen(
                MINI_PLAYER_REQUEST_STATE_EVENT,
                () => void pushStateSnapshot(),
            ),
        );
        disposers.push(
            await listen(
                APP_SHOW_MAIN_EVENT,
                () => void wakeMainWindowFromTray(),
            ),
        );
        disposers.push(
            await listen(MINI_PLAYER_READY_EVENT, () =>
                confirmMiniWindowReady(),
            ),
        );
        disposers.push(
            await listen(MINI_PLAYER_STATE_APPLIED_EVENT, () =>
                confirmMiniStateApplied(),
            ),
        );
        disposers.push(
            await listen<MiniPlayerAction>(
                MINI_PLAYER_ACTION_EVENT,
                (event) => void runMiniAction(event.payload),
            ),
        );
        disposers.push(
            await listen<MiniPlayerWindowBounds>(
                MINI_PLAYER_BOUNDS_EVENT,
                (event) => void persistAnchor(event.payload),
            ),
        );
    };

    onMounted(() => {
        void bindEventListeners();
    });

    // 开启「本地文件默认 mini 小窗」时预热隐藏窗口：
    // 迷你窗是独立 WebView2 实例，按需创建要等 SPA 加载；预热后弹出几乎即时。
    const prewarmMiniWindow = () => {
        void acquireMiniWindow().catch((error) => {
            console.warn("Failed to prewarm mini player window:", error);
        });
    };
    watch(
        () => appSettings.value.openLocalAudioInMiniWindow,
        (enabled) => {
            if (enabled) prewarmMiniWindow();
        },
        { immediate: true },
    );

    onUnmounted(() => {
        while (disposers.length > 0) {
            disposers.pop()?.();
        }
    });

    watch(isMiniMode, async (enteringMiniMode) => {
        if (enteringMiniMode) {
            await openMiniSurface();
            return;
        }

        ui.mainWindowUiSleepRequested = false;

        if (holdMiniOnQuitMiniMode) {
            holdMiniOnQuitMiniMode = false;
            return;
        }

        await hideMiniPlayerWindow();
    });

    watch(
        [
            isPlaying,
            currentSong,
            currentCover,
            volume,
            songList,
            playQueue,
            tempQueue,
            playMode,
            showDesktopLyrics,
            darkTheme,
            () => activeLyricLine.value?.text,
        ],
        () => {
            if (!miniSurfaceVisible.value) return;
            void pushStateSnapshot();
        },
    );

    let lastProgressSyncMs = 0;
    watch(currentTime, () => {
        if (!miniSurfaceVisible.value) return;

        const nowMs = performance.now();
        if (nowMs - lastProgressSyncMs < PROGRESS_SYNC_GAP_MS) return;

        lastProgressSyncMs = nowMs;
        void pushStateSnapshot();
    });
}
