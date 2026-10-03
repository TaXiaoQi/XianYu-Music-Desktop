import { describe, it } from "vitest";

import { expectSourceContains } from "../../testing/sourceText";
import playerDetailSource from "./PlayerDetail.vue?raw";

describe("player detail cover preference", () => {
    it("supports forced and remembered cover behavior while restoring the footer cover on close", () => {
        expectSourceContains(playerDetailSource, "playerDetailCoverBehavior === 'hide'");
        expectSourceContains(playerDetailSource, "playerDetailCoverBehavior === 'remember' && !lastPlayerDetailCoverVisible");
        expectSourceContains(playerDetailSource, "coverHidden.value = false;");
    });

    it("persists the in-page toggle as the last cover choice", () => {
        expectSourceContains(playerDetailSource, "coverHidden.value = !coverHidden.value;");
        expectSourceContains(playerDetailSource, "patchTheme({ lastPlayerDetailCoverVisible: !coverHidden.value });");
        expectSourceContains(playerDetailSource, '@toggle-cover="handleToggleCover"');
    });
});
