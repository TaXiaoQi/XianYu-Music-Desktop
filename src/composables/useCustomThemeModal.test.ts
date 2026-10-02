import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { effectScope, nextTick, type EffectScope } from "vue";

import { useSettingsStore } from "../features/settings/store";
import {
    skinModalOriginalTheme,
    useCustomThemeModal,
} from "./useCustomThemeModal";

vi.mock("@tauri-apps/plugin-dialog", () => ({
    open: vi.fn(),
}));

type ModalController = ReturnType<typeof useCustomThemeModal>;

// 预览草稿是响应式对象，改动后要等一个微任务让副作用收敛再断言
const settlePreview = async () => {
    await nextTick();
    await Promise.resolve();
};

describe("useCustomThemeModal", () => {
    let scope: EffectScope | null = null;

    const launchModal = (): ModalController =>
        scope!.run(() => useCustomThemeModal())!;

    beforeEach(() => {
        setActivePinia(createPinia());
        scope = effectScope();
        skinModalOriginalTheme.value = null;
    });

    afterEach(() => {
        scope?.stop();
        scope = null;
    });

    it("holds slider edits in the local preview until the custom skin is saved", async () => {
        const settingsStore = useSettingsStore();
        settingsStore.patchTheme({
            mode: "light",
            dynamicBgType: "flow",
            windowMaterial: "none",
            customBackground: {
                imagePath: "/covers/original.jpg",
                blur: 20,
                opacity: 1,
                maskAlpha: 0.4,
                scale: 1,
                foregroundStyle: "light",
            },
        });

        const modal = launchModal();
        Object.assign(modal.preview.value, {
            blur: 36,
            opacity: 0.82,
            maskAlpha: 0.56,
            scale: 1.14,
        });
        await settlePreview();

        expect(settingsStore.theme.mode).toBe("light");
        expect(settingsStore.theme.dynamicBgType).toBe("flow");
        expect(settingsStore.theme.customBackground.blur).toBe(20);
        expect(settingsStore.theme.customBackground.opacity).toBe(1);
        expect(settingsStore.theme.customBackground.maskAlpha).toBe(0.4);
        expect(settingsStore.theme.customBackground.scale).toBe(1);

        modal.handleSave();

        expect(settingsStore.theme.mode).toBe("custom");
        expect(settingsStore.theme.dynamicBgType).toBe("none");
        expect(settingsStore.theme.windowMaterial).toBe("none");
        expect(settingsStore.theme.customBackground.blur).toBe(36);
        expect(settingsStore.theme.customBackground.opacity).toBe(0.82);
        expect(settingsStore.theme.customBackground.maskAlpha).toBe(0.56);
        expect(settingsStore.theme.customBackground.scale).toBe(1.14);
    });

    it("discards preview edits on cancel and leaves the applied theme untouched", async () => {
        const settingsStore = useSettingsStore();
        settingsStore.patchTheme({
            mode: "light",
            customBackground: {
                imagePath: "/covers/original.jpg",
                blur: 20,
                foregroundStyle: "light",
            },
        });

        const modal = launchModal();
        modal.preview.value.blur = 42;
        modal.preview.value.foregroundStyle = "dark";
        await settlePreview();

        modal.handleCancel();

        expect(settingsStore.theme.mode).toBe("light");
        expect(settingsStore.theme.customBackground.blur).toBe(20);
        expect(settingsStore.theme.customBackground.foregroundStyle).toBe(
            "light",
        );
    });

    it("rolls back the original color scheme and window material on cancel when opened from the top bar skin shortcut", async () => {
        const settingsStore = useSettingsStore();
        settingsStore.patchTheme({
            mode: "light",
            dynamicBgType: "flow",
            windowMaterial: "acrylic",
            customBackground: {
                imagePath: "/covers/original.jpg",
                blur: 20,
                foregroundStyle: "light",
            },
        });

        skinModalOriginalTheme.value = { ...settingsStore.theme };
        const modal = launchModal();
        modal.preview.value.blur = 42;
        modal.preview.value.foregroundStyle = "dark";
        await settlePreview();

        modal.handleCancel();

        expect(settingsStore.theme.mode).toBe("light");
        expect(settingsStore.theme.dynamicBgType).toBe("flow");
        expect(settingsStore.theme.windowMaterial).toBe("acrylic");
        expect(settingsStore.theme.customBackground.blur).toBe(20);
        expect(settingsStore.theme.customBackground.foregroundStyle).toBe(
            "light",
        );
        expect(skinModalOriginalTheme.value).toBeNull();
    });

    it("forgets the saved original theme after the custom skin is saved", async () => {
        const settingsStore = useSettingsStore();
        settingsStore.patchTheme({
            mode: "light",
            customBackground: {
                imagePath: "/covers/original.jpg",
                blur: 20,
                foregroundStyle: "light",
            },
        });

        skinModalOriginalTheme.value = { ...settingsStore.theme };
        const modal = launchModal();
        modal.preview.value.blur = 36;
        await settlePreview();

        modal.handleSave();

        expect(settingsStore.theme.mode).toBe("custom");
        expect(settingsStore.theme.customBackground.blur).toBe(36);
        expect(skinModalOriginalTheme.value).toBeNull();
    });
});
