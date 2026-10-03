import { describe, it } from "vitest";

import { expectSourceContains, expectSourceNotContains } from "../../testing/sourceText";
import source from "./SettingsDesktopLyrics.vue?raw";

describe("SettingsDesktopLyrics preview copy", () => {
    it("uses the requested coastline lyric and translation", () => {
        expectSourceContains(source, ">I'm leaving&nbsp;</span>");
        expectSourceContains(source, ">home&nbsp;</span>");
        expectSourceContains(source, ">for the coastline</span>");
        expectSourceContains(source, "我要离开家去往海岸线");
        expectSourceNotContains(source, "第一次参观卢浮宫");
    });

    it("shows color schemes as a labeled dropdown", () => {
        expectSourceContains(source, '@click="toggleColorSchemeMenu"');
        expectSourceContains(source, "{{ selectedColorScheme.label }}");
        expectSourceContains(source, "{{ option.label }}");
        expectSourceContains(source, "{{ option.hint }}");
        expectSourceContains(
            source,
            '@click="selectColorSchemeFromMenu(option.value)"',
        );
        expectSourceNotContains(source, "desktop-compact-selector-scheme");
    });

    it("pairs typography controls without leaving an empty grid cell", () => {
        // 行三/行四/行六的成对控件锚点：控件本体必须都在（网格不留空位）。
        // 此前断言依赖分组注释，注释清理后改用控件文本锚点。
        expectSourceContains(source, ">描边阴影<");
        expectSourceContains(source, ">双行显示<");
        expectSourceContains(source, ">字体方案<");
        expectSourceContains(source, ">配色方案<");
        expectSourceNotContains(source, "desktop-compact-row-full");
    });
});
