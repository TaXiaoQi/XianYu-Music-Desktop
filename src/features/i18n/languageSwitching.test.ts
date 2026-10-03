import { describe, it } from "vitest";

import { expectSourceContains, expectSourceNotContains } from "../../testing/sourceText";
import appSource from "../../App.vue?raw";
import settingsGeneralSource from "../../components/settings/SettingsGeneral.vue?raw";

describe("language switching reliability", () => {
    it("switches the active interface language without reloading the page", () => {
        expectSourceNotContains(appSource, "previousLanguage");
        expectSourceNotContains(appSource, "window.location.reload()");
        expectSourceContains(
            appSource,
            "document.documentElement.dataset.language = value",
        );
    });

    it("recreates the rendered interface so legacy DOM translations cannot leak across languages", () => {
        expectSourceContains(appSource, '<MainShell v-else :key="language"');
        expectSourceContains(
            appSource,
            '<DesktopLyricsWindow v-if="isDesktopLyricsWindow" :key="language"',
        );
        expectSourceContains(
            appSource,
            '<MiniPlayerWindow v-else-if="isMiniPlayerWindow" :key="language"',
        );
    });

    it("persists a manual language choice synchronously", () => {
        expectSourceContains(
            settingsGeneralSource,
            "patchSettings({ language: value })",
        );
        expectSourceContains(
            settingsGeneralSource,
            "playerStorage.writeSettings(settings.value)",
        );
    });

    it("does not let a delayed installer read overwrite a manual choice", () => {
        expectSourceContains(
            appSource,
            "const languageBeforeInstallRead = settings.value.language",
        );
        expectSourceContains(
            appSource,
            "settings.value.language === languageBeforeInstallRead",
        );
        expectSourceContains(
            appSource,
            "settings.value.language !== languageBeforeInstallRead",
        );
    });
});
