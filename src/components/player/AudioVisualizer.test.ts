import { describe, it } from "vitest";

import { expectSourceContains } from "../../testing/sourceText";
import source from "./AudioVisualizer.vue?raw";

// 组件源码中必须存在的关键片段（低功耗时不取样本、不驱动动画）
const requiredSnippets = [
    "useRenderingPower",
    "!isMainWindowLowPower.value",
    "props.active && props.isPlaying && !isMainWindowLowPower.value",
    "watch(() => [props.active, props.isPlaying, isMainWindowLowPower.value] as const",
];

describe("AudioVisualizer 低功耗渲染约定", () => {
    it("主窗口低功耗时停止采样拉取与动画", () => {
        requiredSnippets.forEach((snippet) => {
            expectSourceContains(source, snippet);
        });
    });
});
