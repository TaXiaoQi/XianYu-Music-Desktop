// AMLL 进出过渡静置窗接线断言：detailShown 翻转 → 750ms settling class → blend 临时关闭。
// 与 usePlayerDetailSkin.test.ts 同源风格：断言关键接线存在，防止三处（script/模板/CSS）脱钩。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const playerDetailSource = readFileSync(
    resolve(process.cwd(), "src/components/player/PlayerDetail.vue"),
    "utf8",
);
const styleSource = readFileSync(
    resolve(process.cwd(), "src/style.css"),
    "utf8",
);

describe("AMLL 进出过渡静置窗", () => {
    it("detailShown 翻转时开启 750ms 静置窗", () => {
        expect(playerDetailSource).toContain(
            "const detailTransitioning = ref(false);",
        );
        expect(playerDetailSource).toMatch(
            /watch\(detailShown, \(\) => \{\s*detailTransitioning\.value = true;/,
        );
        expect(playerDetailSource).toContain("}, 750);");
    });

    it("静置窗挂到 detail-root 的 class 绑定", () => {
        expect(playerDetailSource).toContain(
            "detailTransitioning ? 'detail-root--settling' : '',",
        );
    });

    it("settling 期间三层 plus-lighter 全部退到 normal（双类特异性压过 scoped）", () => {
        for (const target of [
            ".detail-root--amll.detail-root--settling .lyrics-mask-shell",
            ".detail-root--amll.detail-root--settling .marquee-dock",
            ".detail-root--amll.detail-root--settling .amll-controls",
        ]) {
            expect(styleSource).toContain(target);
        }
        expect(styleSource).toMatch(
            /\.detail-root--amll\.detail-root--settling \.amll-controls \{\s*mix-blend-mode: normal;\s*\}/,
        );
    });
});
