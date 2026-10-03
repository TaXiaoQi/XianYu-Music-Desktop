import { describe, it } from "vitest";

import { expectSourceContains } from "../../testing/sourceText";
import source from "./GlobalBackground.vue?raw";

// 组件源码中必须存在的关键片段（低功耗渲染约定）
const requiredSnippets = [
    "useRenderingPower",
    "showPlayerDetail.value || isMainWindowLowPower.value",
    "global-background--low-power",
    "animation-play-state: paused !important;",
];

describe("GlobalBackground 低功耗渲染约定", () => {
    it("主窗口进入低功耗时冻结动态背景的全部工作", () => {
        requiredSnippets.forEach((snippet) => {
            expectSourceContains(source, snippet);
        });
    });
});
