// 播放详情页皮肤：把现有主题令牌解析成皮肤层可消费的 CSS 变量与作用域类名。
//
// 设计约束（与计划一致）：**不新增任何持久化主题字段**。
// 配色全部从现有主题派生——强调色取 theme.accentColor，沉浸白/跟随主题由已解析的
// 明暗状态（useThemeSettings().isDarkTheme）自动决定，因此切换主题、换主题包、
// 切明暗时皮肤会即时跟随；旧数据没有 playerDetailStyle 时回落 classic。
import { computed } from "vue";
import type { ThemeSettings } from "../types";

import { useThemeSettings } from "./useThemeSettings";

/** 皮肤可消费的两种调色：沉浸白（AMLL 原味）与跟随主题（浅色主题下优先可读性） */
export type PlayerDetailPalette = "immersive" | "follow-theme";

/** 详情页皮肤作用域类名，与 ThemeSettings['playerDetailStyle'] 一一对应 */
export type PlayerDetailSkinClass =
    | "detail-root--classic"
    | "detail-root--vinyl"
    | "detail-root--amll";

/** AMLL 经典页对齐常量：逐字高亮软边宽度（皮肤内固定，不开放配置） */
export const AMLL_WORD_FADE_WIDTH = 0.66;

/**
 * 内置详情页皮肤清单：主题中心「本地」页签顶部的切换入口。
 * AMLL 皮肤**只**在这里切换（设置页不提供该选项），classic/vinyl 同时保留在设置页。
 */
export const BUILTIN_DETAIL_SKINS: ReadonlyArray<{
    value: ThemeSettings["playerDetailStyle"];
    zh: string;
    en: string;
}> = [
    { value: "classic", zh: "经典", en: "Classic" },
    { value: "vinyl", zh: "黑胶唱片", en: "Vinyl Record" },
    { value: "amll", zh: "AMLL 风格", en: "AMLL Style" },
];

/** 详情页兜底强调色，与项目既有红色主题变量保持一致 */
const FALLBACK_ACCENT = "#EC4141";

/**
 * 明暗 → 调色策略。
 * 深色主题用 AMLL 招牌沉浸白（白字 + plus-lighter 提亮）；
 * 浅色主题下 plus-lighter 会明显牺牲可读性，退化为跟随主题。
 */
export function resolvePlayerDetailPalette(isDark: boolean): PlayerDetailPalette {
    return isDark ? "immersive" : "follow-theme";
}

/** 皮肤枚举 → 作用域类名（未知值回落 classic，保证旧数据安全） */
export function resolvePlayerDetailSkinClass(
    style: ThemeSettings["playerDetailStyle"] | undefined,
): PlayerDetailSkinClass {
    if (style === "vinyl") return "detail-root--vinyl";
    if (style === "amll") return "detail-root--amll";
    return "detail-root--classic";
}

/**
 * 主题令牌 → 皮肤 CSS 变量表。
 * 皮肤样式层只读 var()，因此主题中心的强调色、明暗切换会自动作用于本皮肤。
 */
export function resolveDetailSkinVars(
    theme: Pick<ThemeSettings, "accentColor">,
    palette: PlayerDetailPalette,
): Record<string, string> {
    const immersive = palette === "immersive";
    return {
        "--skin-accent": theme.accentColor || FALLBACK_ACCENT,
        "--skin-text": immersive ? "#ffffff" : "#111111",
        "--skin-text-dim": immersive
            ? "rgba(255, 255, 255, 0.62)"
            : "rgba(17, 17, 17, 0.62)",
        "--skin-text-faint": immersive
            ? "rgba(255, 255, 255, 0.28)"
            : "rgba(17, 17, 17, 0.24)",
        // plus-lighter 只在沉浸白下启用：它靠叠加提亮制造 AMLL 的发光感
        "--skin-blend": immersive ? "plus-lighter" : "normal",
        // AMLL 经典页对齐的几何常量
        "--skin-cover-size": "min(50vh, 38vw)",
        "--skin-cover-radius": "max(2%, 0.7vh)",
        "--skin-cover-shadow": "0 1em 1.2em rgba(0, 0, 0, 0.19)",
        "--skin-title-size": "max(2vh, 1em)",
        "--skin-meta-size": "max(1.2vh, 0.8em)",
        "--skin-font": '-apple-system, "SF Pro Text", "PingFang SC", var(--font-sans)',
    };
}

/** 详情页皮肤视图模型：类名 + 变量，供 .detail-root 绑定 */
export function usePlayerDetailSkin() {
    const { theme, isDarkTheme } = useThemeSettings();

    const style = computed<ThemeSettings["playerDetailStyle"]>(
        () => theme.value?.playerDetailStyle ?? "classic",
    );
    const palette = computed(() =>
        resolvePlayerDetailPalette(isDarkTheme.value === true),
    );
    const skinClass = computed(() => resolvePlayerDetailSkinClass(style.value));
    const isAmllSkin = computed(() => style.value === "amll");
    const skinVars = computed(() =>
        resolveDetailSkinVars(
            { accentColor: theme.value?.accentColor ?? FALLBACK_ACCENT },
            palette.value,
        ),
    );

    return { style, palette, skinClass, skinVars, isAmllSkin };
}