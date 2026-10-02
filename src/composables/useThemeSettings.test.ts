import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useSettingsStore } from "../features/settings/store";
import { useThemeSettings } from "./useThemeSettings";

const bootThemeBed = () => setActivePinia(createPinia());

describe("useThemeSettings", () => {
    beforeEach(bootThemeBed);

    it("cycles between light and dark app theme modes on toggle", () => {
        const themeApi = useThemeSettings();

        expect(themeApi.theme.value.mode).toBe("system");

        themeApi.toggleThemeMode();
        expect(themeApi.theme.value.mode).toBe("dark");

        themeApi.toggleThemeMode();
        expect(themeApi.theme.value.mode).toBe("light");
    });

    it("flips the custom wallpaper foreground style without leaving custom mode", () => {
        const settingsStore = useSettingsStore();
        const themeApi = useThemeSettings();

        settingsStore.patchTheme({
            mode: "custom",
            customBackground: {
                imagePath: "/covers/demo.jpg",
                foregroundStyle: "light",
            },
        });

        themeApi.toggleThemeMode();

        expect(themeApi.theme.value.mode).toBe("custom");
        expect(themeApi.theme.value.customBackground.foregroundStyle).toBe(
            "dark",
        );
    });

    it("falls back to switching app theme modes when custom mode has no wallpaper", () => {
        const settingsStore = useSettingsStore();
        const themeApi = useThemeSettings();

        settingsStore.patchTheme({ mode: "custom" });

        themeApi.toggleThemeMode();

        expect(themeApi.theme.value.mode).toBe("light");
    });
});
