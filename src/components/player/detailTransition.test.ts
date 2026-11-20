// AMLL 进出过渡静置窗 + genie 形变层接线断言：
// 与 usePlayerDetailSkin.test.ts 同源风格，断言关键接线存在，防止多处脱钩。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const playerDetailSource = readFileSync(
    resolve(process.cwd(), "src/components/player/PlayerDetail.vue"),
    "utf8",
);
const playerDetailLeftSource = readFileSync(
    resolve(process.cwd(), "src/components/player/PlayerDetailLeft.vue"),
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
            /watch\(detailShown, \(open\) => \{\s*detailTransitionDirection\.value = open \? 'enter' : 'exit';\s*detailTransitioning\.value = true;/,
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

describe("genie 屏幕空间接线（C7）", () => {
    it("PlayerDetail 记录方向并把静置窗/方向/amll 门控传给 PlayerDetailLeft", () => {
        expect(playerDetailSource).toContain(
            "const detailTransitionDirection = ref<'enter' | 'exit'>('exit');",
        );
        expect(playerDetailSource).toContain(':genie-active="detailTransitioning"');
        expect(playerDetailSource).toContain(':genie-direction="detailTransitionDirection"');
        expect(playerDetailSource).toContain(':amll="isAmllSkin"');
    });

    it("genie 窗内冻结容器过渡，飞行交给视口画布（起点预拾/终点实测）", () => {
        expect(playerDetailLeftSource).toContain(
            "import CoverGenieCanvas from './detail/CoverGenieCanvas.vue';",
        );
        expect(playerDetailLeftSource).toContain(
            "genieCovering ? 'cover-stage--genie-frozen' : ''",
        );
        expect(playerDetailLeftSource).toContain("transition: none !important;");
        expect(playerDetailLeftSource).toContain('v-if="genieCovering"');
        expect(playerDetailLeftSource).toContain(':from-rect="genieFromRect"');
        expect(playerDetailLeftSource).toContain(':to-el="() => detailCoverRef"');
        expect(playerDetailLeftSource).toContain("genieFromRect.value !== null");
    });
});
