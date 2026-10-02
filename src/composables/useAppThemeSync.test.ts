import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { effectScope, nextTick, ref, type EffectScope } from "vue";

import { useSettingsStore } from "../features/settings/store";
import { useAppThemeSync } from "./useAppThemeSync";

// ---------------------------------------------------------------------------
// 原生层与窗口材质层的替身
// ---------------------------------------------------------------------------

const nativeSetTheme = vi.fn(() => Promise.resolve());
const nativeOnFocusChanged = vi.fn(() => Promise.resolve(() => undefined));
const materialPushMock = vi.fn(() => Promise.resolve("none"));
const materialRebuildMock = vi.fn(() => Promise.resolve("none"));
const materialCapabilityReport = vi.fn(() =>
    Promise.resolve({
        isWindows: true,
        supportsAcrylic: true,
        supportsMica: true,
        supportsBlur: true,
        systemTransparencyEnabled: true,
        windowsBuildNumber: 22631,
    }),
);
const activeMaterialRef = ref("none");
const refreshMaterialActiveStateMock = vi.hoisted(() =>
    vi.fn(() => Promise.resolve()),
);
let hostScope: EffectScope | null = null;

vi.mock("@tauri-apps/api/window", () => ({
    getCurrentWindow: () => ({
        setTheme: nativeSetTheme,
        onFocusChanged: nativeOnFocusChanged,
    }),
}));

vi.mock("./windowMaterial", () => ({
    useWindowMaterial: () => ({
        activeWindowMaterial: activeMaterialRef,
        applyWindowMaterial: materialPushMock,
        rebuildWindowMaterialForCompositor: materialRebuildMock,
        loadWindowMaterialCapabilities: materialCapabilityReport,
    }),
}));

vi.mock("../services/tauri/windowApi", () => ({
    windowApi: {
        refreshWindowMaterialActiveState: refreshMaterialActiveStateMock,
    },
}));

// ---------------------------------------------------------------------------
// 测试脚手架
// ---------------------------------------------------------------------------

/** 排空响应式队列与微任务，让主题同步管线完整跑完 */
const drainReactiveQueue = async () => {
    await nextTick();
    await Promise.resolve();
    await nextTick();
    await Promise.resolve();
};

/** 在当前 effectScope 内挂载 useAppThemeSync 并排空首轮同步 */
const mountThemeSyncInScope = async () => {
    hostScope?.run(() => useAppThemeSync());
    await drainReactiveQueue();
};

const installDocumentStub = () => {
    vi.stubGlobal("document", {
        documentElement: {
            classList: {
                add: vi.fn(),
                contains: vi.fn(() => false),
                remove: vi.fn(),
            },
            style: {
                setProperty: vi.fn(),
            },
        },
    });
};

const resetMaterialMocks = () => {
    nativeSetTheme.mockClear();
    nativeOnFocusChanged.mockClear();
    materialPushMock.mockClear();
    materialPushMock.mockResolvedValue("none");
    materialRebuildMock.mockClear();
    materialRebuildMock.mockResolvedValue("none");
    refreshMaterialActiveStateMock.mockClear();
    materialCapabilityReport.mockClear();
    activeMaterialRef.value = "none";
};

/** 以「自定义背景 + 指定前景明暗」的形态铺设主题设置 */
const seedCustomBackdropTheme = (foregroundStyle: "light" | "dark") => {
    useSettingsStore().patchTheme({
        mode: "custom",
        windowMaterial: "none",
        customBackground: {
            imagePath: "/covers/demo.jpg",
            foregroundStyle,
        },
    });
};

describe("useAppThemeSync 主题/材质联动", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        hostScope = effectScope();
        installDocumentStub();
        resetMaterialMocks();
    });

    afterEach(() => {
        hostScope?.stop();
        hostScope = null;
        vi.unstubAllGlobals();
    });

    it("材质应用成功后把激活态（含失焦保活偏好）同步给原生层", async () => {
        useSettingsStore().patchTheme({
            windowMaterial: "acrylic",
            keepWindowMaterialOnBlur: true,
        });
        materialPushMock.mockResolvedValue("acrylic");

        await mountThemeSyncInScope();

        expect(refreshMaterialActiveStateMock).toHaveBeenCalledWith(true);
    });

    it("主题色变化即时写入根节点 CSS 变量", async () => {
        await mountThemeSyncInScope();

        useSettingsStore().patchTheme({ accentColor: "#3B82F6" });
        await drainReactiveQueue();

        expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
            "--theme-color",
            "#3B82F6",
        );
        expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
            "--theme-color-rgb",
            "59 130 246",
        );
    });

    it("自定义背景仅调整绘制参数时，不触发原生主题与材质重同步", async () => {
        seedCustomBackdropTheme("light");
        await mountThemeSyncInScope();

        const setThemeCallsBefore = nativeSetTheme.mock.calls.length;
        const materialPushCallsBefore = materialPushMock.mock.calls.length;

        useSettingsStore().patchTheme({
            customBackground: {
                blur: 36,
                opacity: 0.82,
                maskAlpha: 0.56,
                scale: 1.14,
            },
        });
        await drainReactiveQueue();

        expect(nativeSetTheme).toHaveBeenCalledTimes(setThemeCallsBefore);
        expect(materialPushMock).toHaveBeenCalledTimes(materialPushCallsBefore);
    });

    it("自定义背景前景明暗反转（改变明暗解析）时，触发完整重同步", async () => {
        seedCustomBackdropTheme("light");
        await mountThemeSyncInScope();

        const setThemeCallsBefore = nativeSetTheme.mock.calls.length;
        const materialPushCallsBefore = materialPushMock.mock.calls.length;

        useSettingsStore().patchTheme({
            customBackground: {
                foregroundStyle: "dark",
            },
        });
        await drainReactiveQueue();

        expect(nativeSetTheme.mock.calls.length).toBeGreaterThan(
            setThemeCallsBefore,
        );
        expect(materialPushMock.mock.calls.length).toBeGreaterThan(
            materialPushCallsBefore,
        );
    });
});
