import { describe, it } from "vitest";

import { expectSourceContains, expectSourceNotContains } from "../../testing/sourceText";
import playerDetailSource from "./PlayerDetail.vue?raw";

describe("player detail immersive fullscreen", () => {
    it("uses custom immersive fullscreen command for smooth maximize-to-fullscreen transition", () => {
        expectSourceContains(playerDetailSource, "windowApi.setImmersiveFullscreen(enter)");
        expectSourceNotContains(playerDetailSource, "await appWindow.setFullscreen(enter)");
    });

    it("uses smart_toggle_maximize for maximize/restore after fullscreen", () => {
        expectSourceContains(playerDetailSource, "windowApi.smartToggleMaximize()");
        expectSourceNotContains(playerDetailSource, "appWindow.isMaximized()");
        expectSourceNotContains(playerDetailSource, "appWindow.unmaximize()");
    });

    it("allows Escape to leave fullscreen", () => {
        expectSourceContains(playerDetailSource, "if (e.key !== 'Escape') return");
        expectSourceContains(playerDetailSource, "if (isFullscreen.value)");
        expectSourceContains(playerDetailSource, "void toggleFullscreen()");
    });
});
