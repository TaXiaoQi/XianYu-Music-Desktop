import { describe, it, expect, vi } from "vitest";

import { createGlobalShortcutSyncKey } from "./useKeyboardShortcuts";
import { createDefaultShortcutSettings } from "../features/settings/shortcuts";

vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
    register: vi.fn(),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
}));

vi.mock("../features/collections/useLibraryCollections", () => ({
    useLibraryCollections: vi.fn(),
}));

vi.mock("../features/playback/usePlaybackController", () => ({
    usePlaybackController: vi.fn(),
}));

vi.mock("../features/settings/useSettings", () => ({ useSettings: vi.fn() }));

vi.mock("./lyrics", () => ({
    createDefaultDesktopLyricsSettings: vi.fn(() => ({})),
    createDefaultLyricsSettings: vi.fn(() => ({})),
    useLyrics: vi.fn(),
}));

vi.mock("../shared/stores/ui", () => ({ useUiStore: vi.fn() }));

vi.mock("./toast", () => ({ useToast: vi.fn() }));

type ShortcutSettings = ReturnType<typeof createDefaultShortcutSettings>;

const cloneSettings = (settings: ShortcutSettings) =>
    JSON.parse(JSON.stringify(settings));

/** 打开全局快捷键总开关后的默认配置 */
const makeEnabledSettings = (): ShortcutSettings => {
    const settings = createDefaultShortcutSettings();
    settings.globalEnabled = true;
    return settings;
};

describe("全局快捷键同步键（createGlobalShortcutSyncKey）", () => {
    it("设置对象被整体替换但快捷键内容未变时，同步键保持不变", () => {
        const settings = makeEnabledSettings();
        const clonedSettings = cloneSettings(settings);

        expect(createGlobalShortcutSyncKey(clonedSettings)).toBe(
            createGlobalShortcutSyncKey(settings),
        );
    });

    it("仅当全局快捷键的实际绑定发生变化时，同步键才随之改变", () => {
        const defaults = createDefaultShortcutSettings();
        const enabledSettings = { ...defaults, globalEnabled: true };
        // 把 toggleFavorite 重绑为 Ctrl+Alt+F
        const reboundSettings = {
            ...enabledSettings,
            global: {
                ...enabledSettings.global,
                toggleFavorite: {
                    code: "KeyF",
                    ctrl: true,
                    alt: true,
                    shift: false,
                    meta: false,
                },
            },
        };
        const syncKeyOf = createGlobalShortcutSyncKey;

        expect(syncKeyOf(enabledSettings)).not.toBe(syncKeyOf(defaults));
        expect(syncKeyOf(reboundSettings)).not.toBe(syncKeyOf(enabledSettings));
    });
});
