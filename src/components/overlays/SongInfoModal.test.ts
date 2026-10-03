// SongInfoModal 源码约定：拖拽区、文本选中、暗色令牌、定向编辑与响应式布局
import { it, describe } from "vitest";

import { condense, expectSourceContains, expectSourceNotContains } from "../../testing/sourceText";
import source from "./SongInfoModal.vue?raw";

const modalSource = source;

// 截取窄窗口媒体查询之后的全部样式，用于响应式约定断言
const flat = condense(modalSource);
const gatherNarrowStyles = () =>
    flat.slice(flat.indexOf(condense("@media (max-width: 1100px)")));

describe("SongInfoModal window drag area", () => {
    it("exposes a Tauri drag strip along the top of the dialog", () => {
        ["song-info-window-drag-strip", "data-tauri-drag-region"].forEach(
            (needle) => {
                expectSourceContains(modalSource, needle);
            },
        );
    });
});

describe("SongInfoModal text selection", () => {
    it("re-enables native text selection across the song info stage", () => {
        [
            ".song-info-stage {",
            "-webkit-user-select: text;",
            "user-select: text;",
        ].forEach((needle) => {
            expectSourceContains(modalSource, needle);
        });
    });
});

describe("SongInfoModal lyrics editor theme", () => {
    it("declares the lyrics editor surface tokens for light and dark stages", () => {
        [
            "--lyrics-editor-panel-bg: rgba(255, 255, 255, 0.82);",
            "isDarkTheme ? 'song-info-stage--dark' : ''",
            ".song-info-stage--dark",
            "--lyrics-editor-panel-bg: rgba(15, 23, 42, 0.92);",
            "--modal-external-header-bg: rgba(15, 23, 42, 0.72);",
            "--lyrics-editor-button-bg: rgba(255, 255, 255, 0.06);",
        ].forEach((needle) => {
            expectSourceContains(modalSource, needle);
        });
    });

    it("keeps dark-mode selectors scoped under the modal stage instead of global .dark rules", () => {
        [
            ":global(.dark) .song-info-stage",
            ":global(.dark) .lyrics-editor-expand-button",
            ":global(.dark) .modal-action-button",
        ].forEach((needle) => {
            expectSourceNotContains(modalSource, needle);
        });
    });
});

describe("SongInfoModal targeted editing", () => {
    it("jumps straight into cover or lyrics editing when an initial action is given", () => {
        expectSourceContains(modalSource, 'props.initialAction === "cover"');
        expectSourceContains(modalSource, "await handleChooseCover()");
        expectSourceContains(modalSource, 'props.initialAction === "lyrics"');
        expectSourceContains(modalSource, "lyricsTextareaRef.value?.focus()");
        expectSourceContains(modalSource, 'ref="lyricsTextareaRef"');
    });
});

describe("SongInfoModal responsive layout", () => {
    it("preserves natural body height for the stacked narrow-window layout", () => {
        const narrowWindowStyles = gatherNarrowStyles();

        expectSourceContains(narrowWindowStyles, ".song-info-main {");
        expectSourceContains(narrowWindowStyles, "flex: 0 0 auto;");
        expectSourceContains(narrowWindowStyles, ".song-info-content {");
        expectSourceContains(narrowWindowStyles, "overflow: visible;");
    });
});
