import { describe, expect, it, vi } from "vitest";

import {
    shouldAutoHideDesktopLyrics,
    shouldIgnoreCursorEvents,
} from "./useDesktopLyricsWindowController";

vi.mock("@tauri-apps/api/event", () => {
    return {
        emitTo: vi.fn(),
    };
});

vi.mock("@tauri-apps/api/window", () => {
    return {
        getCurrentWindow: vi.fn(),
    };
});

vi.mock("./lyrics", () => ({
    createDefaultDesktopLyricsSettings: vi.fn(() => ({})),
    createDefaultLyricsSettings: vi.fn(() => ({})),
    loadSystemLyricsFonts: vi.fn(),
}));

vi.mock("../services/tauri/windowApi", () => ({
    windowApi: {
        getForegroundFullscreenState: vi.fn(),
        refreshCurrentWindowTopmost: vi.fn(),
        startTopmostGuard: vi.fn(),
        stopTopmostGuard: vi.fn(),
    },
}));

// shouldAutoHideDesktopLyrics 的行为规格表：输入组合 → 期望是否自动隐藏。
const autoHideScenarios = [
    {
        title: "hides when playback is paused and pause auto-hide is on",
        input: {
            autoHideWhenFullscreen: false,
            autoHideWhenPaused: true,
            isForegroundFullscreen: false,
            isPlaying: false,
            isResizeInteractionActive: false,
        },
        expectHidden: true,
    },
    {
        title: "stays visible while playing when only pause auto-hide is on",
        input: {
            autoHideWhenFullscreen: false,
            autoHideWhenPaused: true,
            isForegroundFullscreen: false,
            isPlaying: true,
            isResizeInteractionActive: false,
        },
        expectHidden: false,
    },
    {
        title: "stays visible while a resize interaction is in progress",
        input: {
            autoHideWhenFullscreen: true,
            autoHideWhenPaused: true,
            isForegroundFullscreen: true,
            isPlaying: false,
            isResizeInteractionActive: true,
        },
        expectHidden: false,
    },
] as const;

// shouldIgnoreCursorEvents 的行为规格表：输入组合 → 期望是否穿透（忽略鼠标）。
const passthroughScenarios = [
    {
        title: "ignores all cursor events while auto-hidden",
        input: {
            isLocked: false,
            surfaceVisible: false,
            autoHidden: true,
            cursorOverLockHandle: false,
            cursorOverLyricsText: true,
        },
        expectIgnore: true,
    },
    {
        title: "passes through outside the lock handle while locked",
        input: {
            isLocked: true,
            surfaceVisible: false,
            autoHidden: false,
            cursorOverLockHandle: false,
            cursorOverLyricsText: false,
        },
        expectIgnore: true,
    },
    {
        title: "stays interactive over the lock handle while locked",
        input: {
            isLocked: true,
            surfaceVisible: false,
            autoHidden: false,
            cursorOverLockHandle: true,
            cursorOverLyricsText: false,
        },
        expectIgnore: false,
    },
    {
        title: "passes through outside lyric text when the surface is hidden",
        input: {
            isLocked: false,
            surfaceVisible: false,
            autoHidden: false,
            cursorOverLockHandle: false,
            cursorOverLyricsText: false,
        },
        expectIgnore: true,
    },
    {
        title: "stays interactive over lyric text when the surface is hidden",
        input: {
            isLocked: false,
            surfaceVisible: false,
            autoHidden: false,
            cursorOverLockHandle: false,
            cursorOverLyricsText: true,
        },
        expectIgnore: false,
    },
    {
        title: "stays interactive whenever the surface is visible",
        input: {
            isLocked: false,
            surfaceVisible: true,
            autoHidden: false,
            cursorOverLockHandle: false,
            cursorOverLyricsText: false,
        },
        expectIgnore: false,
    },
] as const;

describe("useDesktopLyricsWindowController", () => {
    for (const scenario of autoHideScenarios) {
        it(scenario.title, () => {
            expect(shouldAutoHideDesktopLyrics({ ...scenario.input })).toBe(
                scenario.expectHidden,
            );
        });
    }

    for (const scenario of passthroughScenarios) {
        it(scenario.title, () => {
            expect(shouldIgnoreCursorEvents({ ...scenario.input })).toBe(
                scenario.expectIgnore,
            );
        });
    }
});
