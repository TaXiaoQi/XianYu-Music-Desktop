import { describe, it } from "vitest";

import { expectSourceContains, expectSourceNotContains } from "../../testing/sourceText";
import source from "./SettingsFooterLayout.vue?raw";

describe("SettingsFooterLayout visual editor", () => {
    it("uses the footer preview itself as the drag editor", () => {
        expectSourceContains(source, "效果实时预览");
        expectSourceContains(
            source,
            "@pointerdown=\"startItemDrag($event, { type: 'bar'",
        );
        expectSourceContains(source, ':data-footer-preview-slot="slot"');
        expectSourceNotContains(source, "左侧容器");
        expectSourceNotContains(source, "中间左侧");
        expectSourceNotContains(source, "收纳菜单");
    });

    it('lets every configurable control be dragged into a slot or the "more" palette', () => {
        expectSourceContains(source, "startItemDrag($event, { type: 'bar'");
        expectSourceContains(source, "startItemDrag($event, { type: 'palette'");
        expectSourceContains(source, "data-collapse-target");
        expectSourceContains(source, ':data-palette-index="index"');
    });
});
