import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { ref } from "vue";

import { restoreMainWindowFromMiniMode } from "./useMiniPlayerWindowBridge";

vi.mock("@tauri-apps/api/dpi", () => ({
    LogicalPosition: class {
        constructor(
            public x: number,
            public y: number,
        ) {}
    },
}));

vi.mock("@tauri-apps/api/event", () => ({
    emitTo: vi.fn(),
    listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
    WebviewWindow: {
        getByLabel: vi.fn(),
    },
}));

vi.mock("@tauri-apps/api/window", () => ({
    availableMonitors: vi.fn(),
    getCurrentWindow: vi.fn(),
}));

vi.mock("./player", () => ({
    usePlayer: vi.fn(),
}));

vi.mock("./lyrics", () => ({
    createDefaultDesktopLyricsSettings: vi.fn(() => ({})),
    createDefaultLyricsSettings: vi.fn(() => ({})),
    useLyrics: vi.fn(),
}));

vi.mock("./useCoverCache", () => ({
    useCoverCache: vi.fn(),
}));

// 构造与 restoreMainWindowFromMiniMode 入参同形的夹具。
function makeRestoreFixture() {
    return {
        isMiniMode: ref(true),
        hideMiniPlayerWindow: vi.fn().mockResolvedValue(undefined),
        mainWindow: {
            unminimize: vi.fn().mockResolvedValue(undefined),
            show: vi.fn().mockResolvedValue(undefined),
            setFocus: vi.fn().mockResolvedValue(undefined),
        },
    };
}

function spyWindowDispatch(): any {
    return vi.spyOn((globalThis as any).window, "dispatchEvent") as any;
}

function expectMainWindowRevealed(
    fixture: ReturnType<typeof makeRestoreFixture>,
) {
    expect(fixture.isMiniMode.value).toBe(false);
    expect(fixture.mainWindow.unminimize).toHaveBeenCalledTimes(1);
    expect(fixture.mainWindow.show).toHaveBeenCalledTimes(1);
    expect(fixture.mainWindow.setFocus).toHaveBeenCalledTimes(1);
}

function expectResizeRelayedTwice(spy: any) {
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.map((call: any[]) => call[0].type)).toEqual([
        "resize",
        "resize",
    ]);
}

async function restoreWithinFakeTimers(
    options: Parameters<typeof restoreMainWindowFromMiniMode>[0],
) {
    const pending = restoreMainWindowFromMiniMode(options);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
}

describe("restoreMainWindowFromMiniMode", () => {
    beforeAll(() => {
        (globalThis as any).window = {
            dispatchEvent: () => false,
        } as any;
    });

    afterAll(() => {
        delete (globalThis as any).window;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("dismisses the mini overlay before unminimizing and focusing the main window", async () => {
        vi.useFakeTimers();
        const resizeSpy = spyWindowDispatch();
        const fixture = makeRestoreFixture();

        await restoreWithinFakeTimers(fixture);

        expectMainWindowRevealed(fixture);
        expect(fixture.hideMiniPlayerWindow).toHaveBeenCalledTimes(1);

        vi.runAllTimers();
        expectResizeRelayedTwice(resizeSpy);

        vi.useRealTimers();
        resizeSpy.mockRestore();
    });

    it("leaves the mini overlay untouched when keepMiniPlayerVisible is set", async () => {
        vi.useFakeTimers();
        const resizeSpy = spyWindowDispatch();
        const fixture = makeRestoreFixture();

        await restoreWithinFakeTimers({
            ...fixture,
            keepMiniPlayerVisible: true,
        });

        expectMainWindowRevealed(fixture);
        expect(fixture.hideMiniPlayerWindow).not.toHaveBeenCalled();

        vi.runAllTimers();
        expectResizeRelayedTwice(resizeSpy);

        vi.useRealTimers();
        resizeSpy.mockRestore();
    });
});
