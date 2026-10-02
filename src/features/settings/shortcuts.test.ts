/*
 * Shortcut helper suite. Behavioural coverage is unchanged; scenarios are
 * phrased and structured originally.
 */

import { describe, expect, it } from "vitest";

import {
    createDefaultShortcutSettings,
    getShortcutBindingFromEvent,
    isSystemReservedShortcutEvent,
    matchesShortcutEvent,
    shortcutActionLabels,
    shortcutActionOrder,
    toGlobalShortcutAccelerator,
} from "./shortcuts";

describe("keyboard shortcut configuration utilities", () => {
    it("ships with OS-level global hotkeys disabled", () => {
        const factoryDefaults = createDefaultShortcutSettings();
        expect(factoryDefaults.globalEnabled).toBe(false);
    });

    it("exposes a desktop-lyrics lock action rather than a lyric-translation one", () => {
        const factoryDefaults = createDefaultShortcutSettings();

        expect(shortcutActionOrder).toContain("toggleDesktopLyricsLock");
        expect(shortcutActionOrder).not.toContain("toggleLyricTranslation");

        const lockLabel = shortcutActionLabels.toggleDesktopLyricsLock;
        expect(lockLabel).toBe("锁定/解锁桌面歌词");

        expect(factoryDefaults.local.toggleDesktopLyricsLock).toEqual({
            code: "KeyD",
            ctrl: true,
            alt: false,
            shift: true,
            meta: false,
        });
        expect(factoryDefaults.global.toggleDesktopLyricsLock).toBeNull();
    });

    it("renders bindings as Tauri global accelerator strings", () => {
        const playAccelerator = toGlobalShortcutAccelerator({
            code: "KeyP",
            ctrl: true,
            alt: true,
            shift: false,
            meta: false,
        });
        expect(playAccelerator).toBe("control+alt+KeyP");

        const metaCarrying = toGlobalShortcutAccelerator({
            code: "ArrowLeft",
            ctrl: false,
            alt: false,
            shift: true,
            meta: true,
        });
        expect(metaCarrying).toBeNull();
    });

    it("yields no accelerator when nothing is bound", () => {
        const unbound = null;
        expect(toGlobalShortcutAccelerator(unbound)).toBeNull();
    });

    it("refuses to capture Windows/Meta key combinations", () => {
        const metaKeyEvent = {
            code: "KeyJ",
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: true,
        } as KeyboardEvent;
        expect(getShortcutBindingFromEvent(metaKeyEvent)).toBeNull();
    });

    it("treats Windows/Meta key events as system reserved", () => {
        const reservedEvent = { code: "KeyJ", metaKey: true } as KeyboardEvent;
        expect(isSystemReservedShortcutEvent(reservedEvent)).toBe(true);
    });

    it("never matches bindings carrying the legacy Meta flag", () => {
        const legacyBinding = {
            code: "KeyJ",
            ctrl: false,
            alt: false,
            shift: false,
            meta: true,
        };
        const matchingEvent = {
            code: "KeyJ",
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: true,
        } as KeyboardEvent;
        expect(matchesShortcutEvent(legacyBinding, matchingEvent)).toBe(false);
    });
});
