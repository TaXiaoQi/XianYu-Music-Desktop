import type { Ref } from "vue";
import type { Song } from "../../types";

/* —— 托盘菜单相关的固定事件名与窗口尺寸 —— */

const TRAY_EVENT_NAMES = {
    menu: "app:tray-menu",
    open: "app:tray-menu-open",
    state: "tray-menu:state",
    ready: "tray-menu:ready",
} as const;

export const APP_TRAY_MENU_EVENT = TRAY_EVENT_NAMES.menu;
export const APP_TRAY_MENU_OPEN_EVENT = TRAY_EVENT_NAMES.open;
export const TRAY_MENU_WINDOW_LABEL = "tray-menu";
export const TRAY_MENU_STATE_EVENT = TRAY_EVENT_NAMES.state;
export const TRAY_MENU_READY_EVENT = TRAY_EVENT_NAMES.ready;

export const TRAY_MENU_PANEL_WIDTH = 210;
export const TRAY_MENU_WINDOW_WIDTH = TRAY_MENU_PANEL_WIDTH;
export const TRAY_MENU_WINDOW_HEIGHT = 268;

export type TrayMenuAction = // 实现
    | "prev-song"
    | "toggle-play"
    | "next-song"
    | "cycle-play-mode"
    | "show-mini-player"
    | "open-desktop-lyrics"
    | "open-settings"
    | "quit"
    | "toggle-favorite";

export interface TrayMenuStatePayload { // 实现
    currentSong: Song | null;
    isPlaying: boolean;
    isDarkTheme: boolean;
    playMode: number;
    showDesktopLyrics: boolean;
    isFavorite: boolean;
    isMiniMode: boolean;
    useCustomTrayMenu: boolean;
    windowMaterial: "none" | "mica" | "acrylic" | "blur";
    windowBlurTint: number;
}

export interface TrayMenuActionDeps { // 实现
    prevSong: () => void;
    nextSong: () => void;
    cyclePlayMode: () => void;
    togglePlay: () => void | Promise<unknown>;
    toggleFavorite: () => void | Promise<unknown>;
    playMode: Ref<number>;
    isMiniMode: Ref<boolean>;
    showDesktopLyrics: Ref<boolean>;
    revealMainWindow: () => Promise<unknown>;
    openSettings: () => Promise<unknown>;
    quitApp: () => Promise<unknown>;
}

/** 迷你模式切换：进入迷你模式时不唤醒主窗，退出时才拉起。 */
async function switchMiniPlayerMode(deps: TrayMenuActionDeps): Promise<void> {
    if (!deps.isMiniMode.value) {
        deps.isMiniMode.value = true;
        return;
    }

    deps.isMiniMode.value = false;
    await deps.revealMainWindow();
}

/** 打开设置页：先脱离迷你模式，再打开窗口并置前。 */
async function openSettingsFromTray(deps: TrayMenuActionDeps): Promise<void> {
    deps.isMiniMode.value = false;
    await deps.openSettings();
    await deps.revealMainWindow();
}

/** 托盘菜单动作分发表：每个动作对应一个独立处理函数。 */
function buildTrayActionHandlers(
    deps: TrayMenuActionDeps,
): Record<TrayMenuAction, () => unknown> {
    return {
        "prev-song": () => {
            deps.prevSong();
        },
        "toggle-play": () => deps.togglePlay(),
        "next-song": () => {
            deps.nextSong();
        },
        "cycle-play-mode": () => {
            deps.cyclePlayMode();
        },
        "show-mini-player": () => switchMiniPlayerMode(deps),
        "toggle-favorite": () => deps.toggleFavorite(),
        "open-desktop-lyrics": () => {
            deps.showDesktopLyrics.value = true;
        },
        "open-settings": () => openSettingsFromTray(deps),
        quit: () => deps.quitApp(),
    };
}

export async function handleTrayMenuAction(
    action: TrayMenuAction,
    deps: TrayMenuActionDeps,
) {
    const handlers = buildTrayActionHandlers(deps);
    const handler = handlers[action];
    if (handler) {
        await handler();
    }
}
