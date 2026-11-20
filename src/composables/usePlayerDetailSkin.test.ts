import { describe, expect, it } from "vitest";

import {
    AMLL_WORD_FADE_WIDTH,
    BUILTIN_DETAIL_SKINS,
    resolveDetailSkinVars,
    resolvePlayerDetailPalette,
    resolvePlayerDetailSkinClass,
} from "./usePlayerDetailSkin";

describe("player detail skin", () => {
    it("只有深色主题使用沉浸白，浅色主题退回跟随主题", () => {
        expect(resolvePlayerDetailPalette(true)).toBe("immersive");
        expect(resolvePlayerDetailPalette(false)).toBe("follow-theme");
    });

    it("皮肤枚举映射到作用域类名，未知值回落 classic", () => {
        expect(resolvePlayerDetailSkinClass("amll")).toBe("detail-root--amll");
        expect(resolvePlayerDetailSkinClass("vinyl")).toBe("detail-root--vinyl");
        expect(resolvePlayerDetailSkinClass("classic")).toBe("detail-root--classic");
        expect(resolvePlayerDetailSkinClass(undefined)).toBe("detail-root--classic");
    });

    it("强调色直接取自主题令牌（主题中心换色即生效）", () => {
        const immersive = resolveDetailSkinVars({ accentColor: "#12AB34" }, "immersive");
        expect(immersive["--skin-accent"]).toBe("#12AB34");

        const followTheme = resolveDetailSkinVars({ accentColor: "#12AB34" }, "follow-theme");
        expect(followTheme["--skin-accent"]).toBe("#12AB34");
    });

    it("沉浸白下启用 plus-lighter 与白字，跟随主题下退化为 normal 与深色字", () => {
        const immersive = resolveDetailSkinVars({ accentColor: "#EC4141" }, "immersive");
        expect(immersive["--skin-blend"]).toBe("plus-lighter");
        expect(immersive["--skin-text"]).toBe("#ffffff");

        const followTheme = resolveDetailSkinVars({ accentColor: "#EC4141" }, "follow-theme");
        expect(followTheme["--skin-blend"]).toBe("normal");
        expect(followTheme["--skin-text"]).toBe("#111111");
    });

    it("主题强调色为空时回落项目兜底色", () => {
        const vars = resolveDetailSkinVars({ accentColor: "" }, "immersive");
        expect(vars["--skin-accent"]).toBe("#EC4141");
    });

    it("几何变量对齐 AMLL 经典页（封面尺寸/圆角/字号阶梯）", () => {
        const vars = resolveDetailSkinVars({ accentColor: "#EC4141" }, "immersive");
        expect(vars["--skin-cover-size"]).toBe("min(50vh, 38vw)");
        expect(vars["--skin-cover-radius"]).toBe("max(2%, 0.7vh)");
        expect(vars["--skin-title-size"]).toBe("max(2vh, 1em)");
        expect(AMLL_WORD_FADE_WIDTH).toBeCloseTo(0.66);
    });

    it("内置皮肤清单含三套皮肤且双语标签齐全（主题中心本地页签的切换入口）", () => {
        expect(BUILTIN_DETAIL_SKINS.map((skin) => skin.value)).toEqual([
            "classic",
            "vinyl",
            "amll",
        ]);
        for (const skin of BUILTIN_DETAIL_SKINS) {
            expect(skin.zh.trim().length).toBeGreaterThan(0);
            expect(skin.en.trim().length).toBeGreaterThan(0);
        }
    });
});