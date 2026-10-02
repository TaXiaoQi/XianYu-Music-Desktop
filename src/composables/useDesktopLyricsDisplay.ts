// 桌面歌词显示层：接收主窗口推送的播放状态快照，加工成视图所需的样式变量与渲染结构
import { emitTo } from "@tauri-apps/api/event";
import { computed, ref, type CSSProperties, type Ref } from "vue";

import type { ImportedLyricsFont } from "../types";
import {
    DESKTOP_LYRICS_ACTION_EVENT,
    type DesktopLyricsAction,
    type DesktopLyricsPlaybackPayload,
    type DesktopLyricsSettingsPatch,
    type DesktopLyricsStatePayload,
    type DesktopLyricsWindowSettings,
} from "../features/desktopLyrics/shared";
import {
    DEFAULT_DESKTOP_PLAYER_ALIGNMENT,
    DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR,
    DEFAULT_DESKTOP_CUSTOM_ROMAJI_COLOR,
    DEFAULT_DESKTOP_CUSTOM_ROMAJI_PLAYED_COLOR,
    DEFAULT_DESKTOP_CUSTOM_ROMAJI_UNPLAYED_COLOR,
    DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
    DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
    DEFAULT_DESKTOP_TEXT_OPACITY,
    DEFAULT_DESKTOP_TEXT_SHADOW_COLOR,
    DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH,
    DEFAULT_DESKTOP_TEXT_OUTLINE_COLOR,
    DEFAULT_DESKTOP_TEXT_OUTLINE_WIDTH,
    DEFAULT_PLAYER_FONT_PRESET,
    DEFAULT_PLAYER_FONT_SCALE,
    DEFAULT_SUB_FONT_SCALE,
    DEFAULT_PLAYER_LINE_GAP,
    DEFAULT_PLAYER_OFFSET_X,
    DEFAULT_PLAYER_OFFSET_Y,
    MAX_DESKTOP_TEXT_OPACITY,
    MAX_DESKTOP_TEXT_SHADOW_STRENGTH,
    LYRICS_FONT_OPTIONS,
    MAX_PLAYER_FONT_SCALE,
    MAX_SUB_FONT_SCALE,
    MAX_PLAYER_LINE_GAP,
    MAX_PLAYER_OFFSET_X,
    MAX_PLAYER_OFFSET_Y,
    MIN_PLAYER_FONT_SCALE,
    MIN_SUB_FONT_SCALE,
    MIN_PLAYER_LINE_GAP,
    MIN_PLAYER_OFFSET_X,
    MIN_PLAYER_OFFSET_Y,
    MIN_DESKTOP_TEXT_OPACITY,
    MIN_DESKTOP_TEXT_SHADOW_STRENGTH,
    buildImportedLyricsFontOptions,
    getLyricsFontFamily,
    normalizeHexColor,
    normalizeDesktopPlayerAlignment,
    normalizeLyricsFontPreset,
    registerImportedLyricsFonts,
    systemLyricsFontOptions,
    type LyricsStatus,
    type LyricLine,
    type LyricWord,
} from "./lyrics";

// 固定配色库：键与 colorScheme 设置项一一对应，auto 档配合主题提取色使用
const PALETTE_LIBRARY = {
    auto: ["#8ec5ff", "#ff8cab", "#88f3c2", "#ffe07d"],
    default: ["#EC4141", "#ff8364", "#f7b267", "#ffd166"],
    pink: ["#f472b6", "#fb7185", "#f9a8d4", "#fbcfe8"],
    blue: ["#60a5fa", "#38bdf8", "#93c5fd", "#bfdbfe"],
    green: ["#34d399", "#22c55e", "#6ee7b7", "#bbf7d0"],
    white: ["#ffffff", "#f3f4f6", "#d1d5db", "#9ca3af"],
} as const;

// 伪逐字歌词参数：整行无逐字时间戳时按字均分，收尾提前结束并受下一行起始时间约束
const PSEUDO_WORD_TAIL_SECONDS = 0.08;
const PSEUDO_WORD_UNIT_SECONDS = 3;
// 阴影色解析失败时使用的默认 RGB 三元组
const INK_RGB_FALLBACK = "0 0 0";
// 拉丁词元字符（含撇号/连字符/下划线）与空白字符的判定规则
const LATIN_TOKEN_CHAR = /[\p{Script=Latin}\p{Number}'’_-]/u;
const BLANK_CHAR = /\s/u;

// 桌面歌词对齐档位（供设置面板下拉使用）
type AlignmentOption = {
    value: DesktopLyricsWindowSettings["playerAlignment"];
    label: string;
};
const ALIGNMENT_LABELS = { left: "左", center: "中", right: "右" } as const;
export const DESKTOP_LYRICS_ALIGNMENT_OPTIONS: AlignmentOption[] = (
    ["left", "center", "right"] as const
).map((alignment) => ({
    value: alignment,
    label: ALIGNMENT_LABELS[alignment],
}));

type SubLineKind = "romaji" | "translation";
type SubLine = { kind: SubLineKind; text: string };

// 单行歌词在桌面上展示所需的全部信息
interface DisplayLine {
    line: LyricLine;
    lineIndex: number;
    active: boolean;
    words: LyricWord[];
    hasAlignedRomaji: boolean;
    secondaryLines: SubLine[];
}

export function useDesktopLyricsDisplay(showDragShadow: Ref<boolean>) { // 实现
    const playClock = ref(0);
    const playing = ref(false);
    const latencySeconds = ref(0);
    const lyricTimeline = ref<LyricLine[]>([]);
    const status = ref<LyricsStatus>("idle");
    const placeholderText = ref("Instrumental / No lyrics");
    const extractedPalette = ref<string[]>([]);
    const importedFonts = ref<ImportedLyricsFont[]>([]);
    const trackDuration = ref<number | null>(null);
    const favorited = ref(false);
    const widgetPrefs = ref<DesktopLyricsWindowSettings>({
        showTranslation: true,
        showRomaji: false,
        isAlwaysOnTop: false,
        alwaysShowShadowBackground: false,
        autoHideWhenFullscreen: true,
        autoHideWhenPaused: false,
        showDoubleLine: false,
        enableWordEffect: true,
        enableTextOutline: false,
        textOutlineWidth: 0.1,
        textOutlineColor: "#000000",
        isLocked: false,
        persistLock: false,
        centerHorizontally: false,
        colorScheme: "auto",
        customPlayedColor: DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR,
        customUnplayedColor: DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
        customRomajiPlayedColor: DEFAULT_DESKTOP_CUSTOM_ROMAJI_PLAYED_COLOR,
        customRomajiUnplayedColor: DEFAULT_DESKTOP_CUSTOM_ROMAJI_UNPLAYED_COLOR,
        customRomajiColor: DEFAULT_DESKTOP_CUSTOM_ROMAJI_COLOR,
        customTranslationColor: DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
        textOpacity: DEFAULT_DESKTOP_TEXT_OPACITY,
        textShadowColor: DEFAULT_DESKTOP_TEXT_SHADOW_COLOR,
        firstLineTextShadowStrength: DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH,
        secondLineTextShadowStrength: DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH,
        playerFontScale: DEFAULT_PLAYER_FONT_SCALE,
        subFontScale: DEFAULT_SUB_FONT_SCALE,
        playerLineGap: DEFAULT_PLAYER_LINE_GAP,
        playerOffsetX: DEFAULT_PLAYER_OFFSET_X,
        playerOffsetY: DEFAULT_PLAYER_OFFSET_Y,
        playerAlignment: DEFAULT_DESKTOP_PLAYER_ALIGNMENT,
        playerFontPreset: DEFAULT_PLAYER_FONT_PRESET,
    });

    // 通过事件通道向主窗口广播桌面歌词动作
    const sendAction = async (action: DesktopLyricsAction) => {
        await emitTo<DesktopLyricsAction>(
            "main",
            DESKTOP_LYRICS_ACTION_EVENT,
            action,
        );
    };

    // 本地 rAF 时钟相对远端投影允许的最大领先量，超出即强制回拨对齐
    const CLOCK_LAG_TOLERANCE_SECONDS = 0.5;

    // 以“远端上报时间 + 经过时长”投影出当前时刻，再按漂移幅度决定是否采纳
    function alignPlaybackClock(
        reportedTime: number,
        reportedPlaying: boolean,
        reportedAt: number,
    ) {
        const projected = Math.max(
            0,
            reportedTime +
                (reportedPlaying
                    ? Math.max(0, (Date.now() - reportedAt) / 1000)
                    : 0),
        );
        const stateChanged = playing.value !== reportedPlaying;
        playing.value = reportedPlaying;
        const drift = projected - playClock.value;

        // 状态切换直接采纳；未切换且本地仅小幅领先时忽略本次同步，防止时间回退
        if (
            !stateChanged &&
            drift < 0 &&
            -drift <= CLOCK_LAG_TOLERANCE_SECONDS
        ) {
            return;
        }
        playClock.value = projected;
    }

    // 数值设置的统一收敛：限制区间后按给定小数位取整
    const clampToFixed = (
        raw: number,
        low: number,
        high: number,
        digits: number,
    ) => Number(Math.min(high, Math.max(low, raw)).toFixed(digits));
    // 整数设置的收敛：限制区间后四舍五入
    const clampToRound = (raw: number, low: number, high: number) =>
        Math.round(Math.min(high, Math.max(low, raw)));

    // 合并设置补丁：逐项做区间与格式收敛，再写回本地并同步给主窗口
    function mergeSettingsPatch(patch: DesktopLyricsSettingsPatch) {
        const next: DesktopLyricsSettingsPatch = { ...patch };

        if (typeof next.playerFontScale === "number")
            next.playerFontScale = clampToFixed(
                next.playerFontScale,
                MIN_PLAYER_FONT_SCALE,
                MAX_PLAYER_FONT_SCALE,
                2,
            );
        if (typeof next.subFontScale === "number")
            next.subFontScale = clampToFixed(
                next.subFontScale,
                MIN_SUB_FONT_SCALE,
                MAX_SUB_FONT_SCALE,
                2,
            );
        if (typeof next.playerLineGap === "number")
            next.playerLineGap = clampToFixed(
                next.playerLineGap,
                MIN_PLAYER_LINE_GAP,
                MAX_PLAYER_LINE_GAP,
                2,
            );
        if (typeof next.playerOffsetX === "number")
            next.playerOffsetX = clampToFixed(
                next.playerOffsetX,
                MIN_PLAYER_OFFSET_X,
                MAX_PLAYER_OFFSET_X,
                0,
            );
        if (typeof next.playerOffsetY === "number")
            next.playerOffsetY = clampToFixed(
                next.playerOffsetY,
                MIN_PLAYER_OFFSET_Y,
                MAX_PLAYER_OFFSET_Y,
                0,
            );
        if (typeof next.playerFontPreset === "string")
            next.playerFontPreset = normalizeLyricsFontPreset(
                next.playerFontPreset,
            );
        if (typeof next.playerAlignment === "string")
            next.playerAlignment = normalizeDesktopPlayerAlignment(
                next.playerAlignment,
            );
        if (typeof next.textOpacity === "number")
            next.textOpacity = clampToFixed(
                next.textOpacity,
                MIN_DESKTOP_TEXT_OPACITY,
                MAX_DESKTOP_TEXT_OPACITY,
                2,
            );
        if (typeof next.firstLineTextShadowStrength === "number")
            next.firstLineTextShadowStrength = clampToRound(
                next.firstLineTextShadowStrength,
                MIN_DESKTOP_TEXT_SHADOW_STRENGTH,
                MAX_DESKTOP_TEXT_SHADOW_STRENGTH,
            );
        if (typeof next.secondLineTextShadowStrength === "number")
            next.secondLineTextShadowStrength = clampToRound(
                next.secondLineTextShadowStrength,
                MIN_DESKTOP_TEXT_SHADOW_STRENGTH,
                MAX_DESKTOP_TEXT_SHADOW_STRENGTH,
            );
        if (typeof next.textShadowColor === "string")
            next.textShadowColor = normalizeHexColor(
                next.textShadowColor,
                DEFAULT_DESKTOP_TEXT_SHADOW_COLOR,
            );

        widgetPrefs.value = { ...widgetPrefs.value, ...next };
        void sendAction({ type: "update-settings", patch: next });
    }

    // 主窗口推送的完整状态快照：整体替换歌词数据与设置，并重建播放时钟
    function applyStateSnapshot(snapshot: DesktopLyricsStatePayload) {
        const reportedDuration = snapshot.song?.duration;

        lyricTimeline.value = snapshot.parsedLyrics;
        status.value = snapshot.lyricsStatus;
        placeholderText.value = snapshot.fallbackText;
        latencySeconds.value = snapshot.audioDelay;
        favorited.value = snapshot.isFavorite;
        extractedPalette.value = [...snapshot.themeColors];
        trackDuration.value =
            typeof reportedDuration === "number" &&
            Number.isFinite(reportedDuration)
                ? reportedDuration
                : null;
        widgetPrefs.value = { ...widgetPrefs.value, ...snapshot.settings };
        importedFonts.value = [...snapshot.customLyricsFonts];
        registerImportedLyricsFonts(snapshot.customLyricsFonts);
        alignPlaybackClock(
            snapshot.playbackTime,
            snapshot.isPlaying,
            snapshot.syncedAt,
        );
    }

    // 仅播放进度/状态变化的轻量快照
    function applyPlaybackSnapshot(snapshot: DesktopLyricsPlaybackPayload) {
        latencySeconds.value = snapshot.audioDelay;
        alignPlaybackClock(
            snapshot.playbackTime,
            snapshot.isPlaying,
            snapshot.syncedAt,
        );
    }

    // 把主题提取色补齐为四色盘；空列表回退到默认配色
    function buildPalette(rawColors: string[]) {
        const usable = rawColors.filter(
            (color) => color && color !== "transparent",
        );
        if (usable.length === 0) {
            return [...PALETTE_LIBRARY.auto];
        }

        const filled = [...usable];
        for (let slot = filled.length; slot < 4; slot += 1) {
            filled.push(filled[slot - 1] || PALETTE_LIBRARY.auto[slot]);
        }
        return filled.slice(0, 4);
    }

    // 二分查找：定位“时间戳不晚于目标时刻”的最后一行，没有则返回 -1
    function locateActiveLine(lines: LyricLine[], moment: number): number {
        let low = 0;
        let high = lines.length - 1;
        let hit = -1;

        while (low <= high) {
            const pivot = (low + high) >> 1;
            if (lines[pivot].time <= moment) {
                hit = pivot;
                low = pivot + 1;
            } else {
                high = pivot - 1;
            }
        }

        return hit;
    }

    // 仅当每个有效词元都携带罗马音时才启用词级罗马音
    function allWordsCarryRomaji(words: LyricWord[]): boolean {
        if (words.length === 0) return false;
        const audible = words.filter(
            (word) => word.text.trim() && word.end > word.start,
        );
        return (
            audible.length > 0 &&
            audible.every((word) => word.romaji && word.romaji.trim())
        );
    }

    // 组装副行：词级罗马音齐备时不再整行重复，翻译按开关追加
    function buildSubLines(
        line: LyricLine,
        wordRomajiReady: boolean,
    ): SubLine[] {
        const subs: SubLine[] = [];
        if (widgetPrefs.value.showRomaji && line.romaji && !wordRomajiReady) {
            subs.push({ kind: "romaji", text: line.romaji });
        }
        if (widgetPrefs.value.showTranslation && line.translation) {
            subs.push({ kind: "translation", text: line.translation });
        }
        return subs;
    }

    // 估算伪逐字场景下整行的可见结束时刻：受下一行起始与歌曲时长双重约束
    function estimateLineTail(
        line: LyricLine,
        lineIndex: number,
        startAt: number,
    ): number {
        const declaredEnd =
            Number.isFinite(line.endTime) && line.endTime > startAt
                ? line.endTime
                : startAt + PSEUDO_WORD_UNIT_SECONDS;
        const followingStart = lyricTimeline.value[lineIndex + 1]?.time;
        const hardBoundary =
            typeof followingStart === "number" &&
            Number.isFinite(followingStart) &&
            followingStart > startAt
                ? followingStart
                : trackDuration.value;

        if (
            typeof hardBoundary === "number" &&
            Number.isFinite(hardBoundary) &&
            hardBoundary > startAt
        ) {
            return Math.min(
                declaredEnd,
                Math.max(startAt, hardBoundary - PSEUDO_WORD_TAIL_SECONDS),
            );
        }

        return declaredEnd;
    }

    // 把整行文本切成词元序列：拉丁连续串保持完整，空白附着到前一个词元之后
    function splitIntoWordUnits(text: string): string[] {
        const units: string[] = [];
        let pendingToken = "";

        const commitToken = () => {
            if (!pendingToken) return;
            units.push(pendingToken);
            pendingToken = "";
        };

        for (const ch of [...text]) {
            if (LATIN_TOKEN_CHAR.test(ch)) {
                pendingToken += ch;
                continue;
            }

            commitToken();

            if (BLANK_CHAR.test(ch) && units.length > 0) {
                units[units.length - 1] += ch;
                continue;
            }

            units.push(ch);
        }

        commitToken();

        return units;
    }

    // 无逐字时间戳时，把词元在整行时间区间内均分出起止时刻
    function buildPseudoWords(
        text: string,
        startAt: number,
        endAt: number,
    ): LyricWord[] {
        const units = splitIntoWordUnits(text);
        if (units.length === 0) return [];

        const slice = Math.max(0.001, endAt - startAt) / units.length;

        return units.map((unit, position) => ({
            text: unit,
            start: startAt + slice * position,
            end:
                position === units.length - 1
                    ? endAt
                    : startAt + slice * (position + 1),
            romaji: "",
        }));
    }

    // 决定某行的渲染粒度：优先真实逐字时间戳，其次伪逐字切分，关闭特效则退化为整行
    function resolveDisplayWords(
        line: LyricLine,
        lineIndex: number,
    ): LyricWord[] {
        if (!widgetPrefs.value.enableWordEffect) {
            return [];
        }

        const stamped = (line.words ?? []).filter(
            (word) =>
                word.text.length > 0 &&
                Number.isFinite(word.start) &&
                Number.isFinite(word.end) &&
                word.end > word.start,
        );
        if (stamped.length > 0) return stamped;

        const text = line.text || "";
        if (!text) return [];

        const startAt = Number.isFinite(line.time) ? line.time : 0;
        return buildPseudoWords(
            text,
            startAt,
            Math.max(
                startAt + 0.001,
                estimateLineTail(line, lineIndex, startAt),
            ),
        );
    }

    const describeSignedPercent = (value: number) =>
        `${value > 0 ? "+" : ""}${Math.round(value)}%`;
    const trimNumberText = (value: number) =>
        Number(value.toFixed(2)).toString();

    // 十六进制颜色 → “R G B”文本三元组，供 drop-shadow 的 rgb() 使用
    function decomposeHexToRgb(value: string) {
        const canonical = normalizeHexColor(
            value,
            DEFAULT_DESKTOP_TEXT_SHADOW_COLOR,
        );
        const parsed = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(
            canonical,
        );
        if (!parsed) return INK_RGB_FALLBACK;

        return [
            Number.parseInt(parsed[1], 16),
            Number.parseInt(parsed[2], 16),
            Number.parseInt(parsed[3], 16),
        ].join(" ");
    }

    const syncedCurrentTime = computed(() =>
        Math.max(0, playClock.value - latencySeconds.value),
    );
    const lyricsAlignmentClass = computed(() => {
        if (widgetPrefs.value.playerAlignment === "split-corners") {
            return widgetPrefs.value.showDoubleLine
                ? "lyrics-align-split-corners"
                : "lyrics-align-left";
        }
        return `lyrics-align-${widgetPrefs.value.playerAlignment}`;
    });
    const availableFontOptions = computed(() => [
        ...buildImportedLyricsFontOptions(importedFonts.value),
        ...LYRICS_FONT_OPTIONS,
        ...systemLyricsFontOptions.value,
    ]);
    const offsetLabel = computed(() => {
        const offsetMs = Math.round(latencySeconds.value * 1000);
        if (offsetMs === 0) return "0 ms";
        return `${offsetMs > 0 ? "+" : ""}${offsetMs} ms`;
    });
    const fontScaleLabel = computed(
        () => `${Math.round(widgetPrefs.value.playerFontScale * 100)}%`,
    );
    const lineGapLabel = computed(
        () => `${Math.round(widgetPrefs.value.playerLineGap * 100)}%`,
    );
    const offsetXLabel = computed(() =>
        describeSignedPercent(widgetPrefs.value.playerOffsetX),
    );
    const offsetYLabel = computed(() =>
        describeSignedPercent(widgetPrefs.value.playerOffsetY),
    );
    const selectedFontLabel = computed(
        () =>
            availableFontOptions.value.find(
                (option) => option.value === widgetPrefs.value.playerFontPreset,
            )?.label ??
            normalizeLyricsFontPreset(widgetPrefs.value.playerFontPreset),
    );
    const fallbackStateText = computed(() => {
        if (status.value === "loading") return "Loading lyrics...";
        if (status.value === "error") return "Lyrics unavailable";
        return placeholderText.value;
    });
    const lyricsPlayerStyle = computed(() => ({
        "--desktop-font-scale": widgetPrefs.value.playerFontScale.toString(),
        "--desktop-sub-font-scale": widgetPrefs.value.subFontScale.toString(),
        "--lyrics-font-family": getLyricsFontFamily(
            widgetPrefs.value.playerFontPreset,
        ),
        "--lyrics-offset-x": `${widgetPrefs.value.playerOffsetX}%`,
        "--lyrics-offset-y": `${widgetPrefs.value.playerOffsetY}%`,
    }));
    // 按配色方案解析四色盘：custom 取播放/未播放两色，auto 用主题提取色，其余用固定盘
    const resolvedPalette = computed(() => {
        const scheme = widgetPrefs.value.colorScheme;
        if (scheme === "custom") {
            return [
                widgetPrefs.value.customPlayedColor,
                widgetPrefs.value.customPlayedColor,
                widgetPrefs.value.customPlayedColor,
                widgetPrefs.value.customUnplayedColor,
            ];
        }
        if (scheme === "auto") {
            return buildPalette(extractedPalette.value);
        }
        return [...PALETTE_LIBRARY[scheme]];
    });
    const widgetStyle = computed(() => {
        const custom = widgetPrefs.value.colorScheme === "custom";
        const surface =
            showDragShadow.value ||
            widgetPrefs.value.alwaysShowShadowBackground;
        // 文本透明度通过 color-mix 向 transparent 混色实现，百分比来自 CSS 变量
        const alphaPercent = "calc(var(--desktop-text-opacity, 1) * 100%)";
        const tinted = (base: string) =>
            `color-mix(in srgb, ${base} ${alphaPercent}, transparent)`;
        const accentMix = (accent: string, ratio: string, target: string) =>
            `color-mix(in srgb, var(${accent}) ${ratio}, var(${target}))`;
        const palette = resolvedPalette.value;
        const styleVars: Record<string, string> = {
            "--desktop-accent-a": tinted(palette[0]),
            "--desktop-accent-b": tinted(palette[1]),
            "--desktop-accent-c": tinted(palette[2]),
            "--desktop-accent-d": tinted(palette[3]),
            "--desktop-lyric-solid-color": custom
                ? tinted(widgetPrefs.value.customPlayedColor)
                : "var(--desktop-accent-a)",
            "--desktop-text-primary": custom
                ? tinted(widgetPrefs.value.customUnplayedColor)
                : tinted("rgba(255, 255, 255, 0.98)"),
            "--desktop-text-secondary": tinted("rgba(255, 255, 255, 0.88)"),
            "--desktop-text-tertiary": tinted("rgba(255, 255, 255, 0.76)"),
            "--desktop-romaji-color": custom
                ? tinted(widgetPrefs.value.customRomajiUnplayedColor)
                : accentMix(
                      "--desktop-accent-d",
                      "42%",
                      "--desktop-text-secondary",
                  ),
            "--desktop-romaji-played-color": custom
                ? tinted(widgetPrefs.value.customRomajiPlayedColor)
                : accentMix(
                      "--desktop-accent-b",
                      "58%",
                      "--desktop-romaji-color",
                  ),
            "--desktop-romaji-unplayed-color": custom
                ? tinted(widgetPrefs.value.customRomajiUnplayedColor)
                : "var(--desktop-romaji-color)",
            "--desktop-translation-color": custom
                ? tinted(widgetPrefs.value.customTranslationColor)
                : accentMix(
                      "--desktop-accent-c",
                      "28%",
                      "--desktop-text-tertiary",
                  ),
            "--desktop-text-opacity": trimNumberText(
                widgetPrefs.value.textOpacity,
            ),
            "--desktop-text-shadow-color": decomposeHexToRgb(
                widgetPrefs.value.textShadowColor,
            ),
            "--desktop-text-outline-width": widgetPrefs.value.enableTextOutline
                ? `${DEFAULT_DESKTOP_TEXT_OUTLINE_WIDTH}px`
                : "0px",
            "--desktop-text-outline-color": DEFAULT_DESKTOP_TEXT_OUTLINE_COLOR,
            "--desktop-first-line-text-shadow-alpha": trimNumberText(
                widgetPrefs.value.firstLineTextShadowStrength / 100,
            ),
            "--desktop-first-line-text-shadow-blur": `${Math.round(widgetPrefs.value.firstLineTextShadowStrength * 0.24)}px`,
            "--desktop-second-line-text-shadow-alpha": trimNumberText(
                widgetPrefs.value.secondLineTextShadowStrength / 100,
            ),
            "--desktop-second-line-text-shadow-blur": `${Math.round(widgetPrefs.value.secondLineTextShadowStrength * 0.24)}px`,
        };
        styleVars.outline = surface
            ? "1px solid rgba(255, 255, 255, 0.16)"
            : "none";
        return styleVars;
    });
    const activeLyricIndex = computed(() =>
        lyricTimeline.value.length === 0
            ? -1
            : locateActiveLine(lyricTimeline.value, syncedCurrentTime.value),
    );
    const activeLyricLine = computed<LyricLine | null>(() => {
        if (lyricTimeline.value.length === 0) {
            return null;
        }
        if (activeLyricIndex.value >= 0) {
            return lyricTimeline.value[activeLyricIndex.value] ?? null;
        }
        return lyricTimeline.value[0] ?? null;
    });
    const visiblePairStartIndex = computed(() => {
        if (lyricTimeline.value.length === 0) return -1;
        return activeLyricIndex.value >= 0 ? activeLyricIndex.value : 0;
    });
    const blockTransitionKey = computed(() => {
        if (!activeLyricLine.value)
            return `${status.value}:${placeholderText.value}`;
        return widgetPrefs.value.showDoubleLine
            ? `double-line:${status.value}`
            : `single-line:${status.value}`;
    });
    const visibleLyricLines = computed<DisplayLine[]>(() => {
        if (lyricTimeline.value.length === 0 || visiblePairStartIndex.value < 0)
            return [];

        const rowCount = widgetPrefs.value.showDoubleLine ? 2 : 1;
        const rows: DisplayLine[] = [];

        for (let offset = 0; offset < rowCount; offset += 1) {
            const lineIndex = visiblePairStartIndex.value + offset;
            const line = lyricTimeline.value[lineIndex];
            if (!line) continue;

            const words = resolveDisplayWords(line, lineIndex);
            const wordRomajiReady =
                widgetPrefs.value.showRomaji && allWordsCarryRomaji(words);

            rows.push({
                line,
                lineIndex,
                active:
                    activeLyricIndex.value >= 0
                        ? lineIndex === activeLyricIndex.value
                        : lineIndex === 0,
                words,
                hasAlignedRomaji: wordRomajiReady,
                secondaryLines: buildSubLines(line, wordRomajiReady),
            });
        }

        return rows;
    });
    const blockStyle = computed(() => ({
        "--desktop-line-gap": widgetPrefs.value.playerLineGap.toString(),
    }));

    // 文字描边样式：粗细与颜色均由 CSS 变量控制
    const strokePaint =
        "var(--desktop-text-outline-width, 0px) var(--desktop-text-outline-color, #000000)";
    // 卡拉OK扫色渐变：0% 起 head 色，cut 处切换为 tail 色
    const sweepGradient = (
        head: string,
        mid: string,
        tail: string,
        cut: string,
    ) =>
        `linear-gradient(90deg, var(${head}) 0%, var(${mid}) ${cut}, var(${tail}) ${cut}, var(${tail}) 100%)`;

    // 主行词元样式：未开始为纯色，开始后按进度扫色
    function getWordStyle(startAt: number, endAt: number): CSSProperties {
        const span = Math.max(0.001, endAt - startAt);
        const ratio = Math.max(
            0,
            Math.min(1, (syncedCurrentTime.value - startAt) / span),
        );

        if (ratio <= 0) {
            return {
                color: "var(--desktop-text-primary)",
                textShadow: "none",
                WebkitTextStroke: strokePaint,
                paintOrder: "fill stroke",
            };
        }

        const cut = `${(ratio * 100).toFixed(2)}%`;
        return {
            backgroundImage: sweepGradient(
                "--desktop-accent-a",
                "--desktop-accent-b",
                "--desktop-text-primary",
                cut,
            ),
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            WebkitTextFillColor: "transparent",
            textShadow: "none",
            WebkitTextStroke: strokePaint,
            paintOrder: "fill stroke",
        };
    }

    // 罗马音词元样式：结构同主行，但使用罗马音专用配色
    function getRomajiWordStyle(startAt: number, endAt: number): CSSProperties {
        const span = Math.max(0.001, endAt - startAt);
        const ratio = Math.max(
            0,
            Math.min(1, (syncedCurrentTime.value - startAt) / span),
        );

        if (ratio <= 0) {
            return {
                color: "var(--desktop-romaji-unplayed-color)",
                textShadow: "none",
                WebkitTextStroke: strokePaint,
                paintOrder: "fill stroke",
            };
        }

        const cut = `${(ratio * 100).toFixed(2)}%`;
        return {
            backgroundImage: sweepGradient(
                "--desktop-romaji-played-color",
                "--desktop-romaji-played-color",
                "--desktop-romaji-unplayed-color",
                cut,
            ),
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            WebkitTextFillColor: "transparent",
            textShadow: "none",
            WebkitTextStroke: strokePaint,
            paintOrder: "fill stroke",
        };
    }

    // 罗马音整行副行样式：与词元一致，但不带描边
    function getRomajiLineStyle(
        line: LyricLine,
        lineIndex: number,
    ): CSSProperties {
        const startAt = Number.isFinite(line.time) ? line.time : 0;
        const endAt = Math.max(
            startAt + 0.001,
            estimateLineTail(line, lineIndex, startAt),
        );
        const span = Math.max(0.001, endAt - startAt);
        const ratio = Math.max(
            0,
            Math.min(1, (syncedCurrentTime.value - startAt) / span),
        );

        if (ratio <= 0) {
            return {
                color: "var(--desktop-romaji-unplayed-color)",
                textShadow: "none",
            };
        }

        const cut = `${(ratio * 100).toFixed(2)}%`;
        return {
            backgroundImage: sweepGradient(
                "--desktop-romaji-played-color",
                "--desktop-romaji-played-color",
                "--desktop-romaji-unplayed-color",
                cut,
            ),
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            WebkitTextFillColor: "transparent",
            textShadow: "none",
        };
    }

    return {
        playbackTime: playClock,
        isPlaying: playing,
        settings: widgetPrefs,
        isFavorite: favorited,
        availableFontOptions,
        offsetLabel,
        fontScaleLabel,
        lineGapLabel,
        offsetXLabel,
        offsetYLabel,
        selectedFontLabel,
        lyricsAlignmentClass,
        fallbackStateText,
        lyricsPlayerStyle,
        widgetStyle,
        activeLyricLine,
        blockTransitionKey,
        visibleLyricLines,
        blockStyle,
        handlePayload: applyStateSnapshot,
        handlePlaybackPayload: applyPlaybackSnapshot,
        patchSettings: mergeSettingsPatch,
        emitAction: sendAction,
        getWordStyle,
        getRomajiWordStyle,
        getRomajiLineStyle,
    };
}
