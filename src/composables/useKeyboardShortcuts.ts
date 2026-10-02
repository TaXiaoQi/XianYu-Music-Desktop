import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
    register,
    unregister,
    unregisterAll,
} from "@tauri-apps/plugin-global-shortcut";

import { useLibraryCollections } from "../features/collections/useLibraryCollections";
import { usePlaybackController } from "../features/playback/usePlaybackController";
import { useSettings } from "../features/settings/useSettings";
import {
    matchesShortcutEvent,
    shortcutActionOrder,
    toGlobalShortcutAccelerator,
} from "../features/settings/shortcuts";
import type { ShortcutActionId, ShortcutSettings } from "../types";
import { useLyrics } from "./lyrics";
import { useUiStore } from "../shared/stores/ui";
import { useToast } from "./toast";

// 这些控件获得焦点时，本地快捷键一律放行给输入法/控件本身
const INTERACTIVE_SELECTOR =
    'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"], [data-shortcut-capture="true"]';

// 全局快捷键注册冲突时系统报错常见的关键词
const OCCUPIED_ERROR_HINTS = ["already registered", "hotkey", "already"];

const occupiedGlobalShortcutActionIds = ref([] as ShortcutActionId[]);

const isTypingTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    return target.closest(INTERACTIVE_SELECTOR) !== null;
};

const isGlobalShortcutOccupiedError = (error: unknown): boolean => {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const normalizedMessage = rawMessage.toLowerCase();
    return OCCUPIED_ERROR_HINTS.some((hint) =>
        normalizedMessage.includes(hint),
    );
};

export function useGlobalShortcutStatus() { // 实现
    const occupiedActionIdSet = computed<Set<ShortcutActionId>>(
        () => new Set(occupiedGlobalShortcutActionIds.value),
    );

    return { occupiedGlobalShortcutActionIds, occupiedActionIdSet };
}

/** 生成全局快捷键配置的指纹：开关状态 + 各动作加速键依次拼接 */
export function createGlobalShortcutSyncKey(shortcuts: ShortcutSettings) { // 实现
    const fragments: string[] = [
        shortcuts.globalEnabled ? "enabled" : "disabled",
    ];

    shortcutActionOrder.forEach((actionId) => {
        const accelerator = toGlobalShortcutAccelerator(
            shortcuts.global[actionId],
        );
        fragments.push(`${actionId}:${accelerator ?? ""}`);
    });

    return fragments.join("\u001F");
}

export function useKeyboardShortcuts() { // 实现
    const settingsStore = useSettings();
    const { settings } = settingsStore;
    const playback = usePlaybackController();
    const {
        currentSong,
        volume,
        togglePlay,
        nextSong,
        prevSong,
        handleVolume,
    } = playback;
    const collections = useLibraryCollections();
    const { toggleFavorite } = collections;
    const lyrics = useLyrics();
    const { showDesktopLyrics, desktopLyricsSettings } = lyrics;
    const ui = useUiStore();
    const toast = useToast();
    const { showToast } = toast;

    /** 把音量调整到 delta 之后的合法区间内再提交 */
    const updateVolume = async (delta: number): Promise<void> => {
        const clampedVolume = Math.min(100, Math.max(0, volume.value + delta));
        if (clampedVolume === volume.value) {
            return;
        }

        await handleVolume({
            target: { value: clampedVolume.toString() },
        } as unknown as Event);
    };

    const actionHandlers: Record<ShortcutActionId, () => void | Promise<void>> =
        {
            togglePlay,
            prevSong,
            nextSong,
            volumeUp: () => {
                void updateVolume(5);
            },
            volumeDown: () => {
                void updateVolume(-5);
            },
            toggleMiniMode: () => {
                ui.isMiniMode = !ui.isMiniMode;
            },
            toggleFavorite: () => {
                const playingSong = currentSong.value;
                if (playingSong) {
                    toggleFavorite(playingSong);
                }
            },
            toggleDesktopLyrics: () => {
                const nextVisible = !showDesktopLyrics.value;
                showDesktopLyrics.value = nextVisible;
            },
            toggleDesktopLyricsLock: () => {
                const nextLocked = !desktopLyricsSettings.isLocked;
                desktopLyricsSettings.isLocked = nextLocked;
            },
        };

    // 加速键 -> 动作 id 的映射，供全局快捷键回调反查
    const actionByAccelerator = new Map<string, ShortcutActionId>();
    let disposed = false;
    let syncEpoch = 0;

    const handleKeydown = (event: KeyboardEvent): void => {
        const shortcutsEnabled = settings.value.shortcuts.enabled;
        if (!shortcutsEnabled || event.defaultPrevented || event.repeat) {
            return;
        }

        const typing = isTypingTarget(event.target);
        if (typing) {
            return;
        }

        // 按固定顺序找到第一个匹配的本地动作并拦截事件
        const matchedActionId = shortcutActionOrder.find((actionId) =>
            matchesShortcutEvent(
                settings.value.shortcuts.local[actionId],
                event,
            ),
        );
        if (!matchedActionId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        void actionHandlers[matchedActionId]();
    };

    /** 依据当前设置重新注册全部全局快捷键（带并发保护：旧任务的结果会被新任务作废） */
    const syncGlobalShortcuts = async (): Promise<void> => {
        const epoch = ++syncEpoch;
        await unregisterAll();

        if (epoch !== syncEpoch) {
            return; // 期间又触发了新的同步，放弃本轮结果
        }

        actionByAccelerator.clear();
        occupiedGlobalShortcutActionIds.value = [];

        if (!settings.value.shortcuts.globalEnabled) return;

        const pending: Array<{
            actionId: ShortcutActionId;
            accelerator: string;
        }> = [];
        for (const actionId of shortcutActionOrder) {
            const resolved = toGlobalShortcutAccelerator(
                settings.value.shortcuts.global[actionId],
            );
            if (resolved) {
                pending.push({ actionId, accelerator: resolved });
            }
        }

        if (pending.length === 0) {
            return;
        }

        const occupied: ShortcutActionId[] = [];

        for (const { actionId, accelerator: combo } of pending) {
            try {
                await register(combo, (event) => {
                    if (event.state !== "Pressed") return;

                    const boundActionId = actionByAccelerator.get(
                        event.shortcut,
                    );
                    if (!boundActionId) {
                        return;
                    }

                    void actionHandlers[boundActionId]();
                });

                actionByAccelerator.set(combo, actionId);
            } catch (error) {
                if (disposed || epoch !== syncEpoch) {
                    return;
                }

                if (!isGlobalShortcutOccupiedError(error)) {
                    // 非占用类错误：整体放弃本次同步并提示用户
                    actionByAccelerator.clear();
                    occupiedGlobalShortcutActionIds.value = [];
                    await unregisterAll().catch(() => undefined);
                    const message =
                        error instanceof Error ? error.message : `${error}`;
                    const toastText = `全局快捷键注册失败：${message}`;
                    showToast(toastText, "error");
                    return;
                }

                // 仅被其他程序占用：记下该动作并撤销半注册状态
                occupied.push(actionId);
                await unregister(combo).catch(() => undefined);
            }
        }

        occupiedGlobalShortcutActionIds.value = occupied;

        if (epoch !== syncEpoch) {
            await unregisterAll().catch(() => undefined);
            actionByAccelerator.clear();
            occupiedGlobalShortcutActionIds.value = [];
        }
    };

    const startListening = (): void => {
        window.addEventListener("keydown", handleKeydown);
        void syncGlobalShortcuts();
    };

    const stopListening = (): void => {
        disposed = true;
        occupiedGlobalShortcutActionIds.value = [];
        window.removeEventListener("keydown", handleKeydown);
        void unregisterAll().catch(() => undefined);
    };

    onMounted(startListening);
    onUnmounted(stopListening);

    watch(
        () => createGlobalShortcutSyncKey(settings.value.shortcuts),
        () => void syncGlobalShortcuts(),
    );
}
