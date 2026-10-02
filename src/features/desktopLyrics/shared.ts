// 桌面歌词跨窗口协作的共享契约：事件名、存储键、窗口几何常量与载荷类型。
// 主窗口与桌面歌词窗口两侧都引用本文件，导出名与字段名保持稳定。
import type {
    DesktopLyricsSettings,
    ImportedLyricsFont,
    LyricsStatus,
    LyricLine,
} from "../../composables/lyrics";
import type { Song } from "../../types";
import { clamp } from "../../utils/math";

// —— 跨窗口事件与存储常量（字符串值被双方逐字匹配，不可改动） ——

export const /** 桌面歌词窗口的唯一 label */
    DESKTOP_LYRICS_WINDOW_LABEL = "desktop-lyrics",
    /** 主窗口 → 歌词窗口：全量状态推送 */
    DESKTOP_LYRICS_STATE_EVENT = "desktop-lyrics:state",
    /** 主窗口 → 歌词窗口：播放进度推送 */
    DESKTOP_LYRICS_PLAYBACK_EVENT = "desktop-lyrics:playback",
    /** 歌词窗口 → 主窗口：就绪通知 */
    DESKTOP_LYRICS_READY_EVENT = "desktop-lyrics:ready",
    /** 歌词窗口 → 主窗口：请求一份全量状态 */
    DESKTOP_LYRICS_REQUEST_STATE_EVENT = "desktop-lyrics:request-state",
    /** 歌词窗口 → 主窗口：用户触发的播放控制指令 */
    DESKTOP_LYRICS_ACTION_EVENT = "desktop-lyrics:action",
    /** 主窗口 → 歌词窗口：可见性切换 */
    DESKTOP_LYRICS_VISIBILITY_EVENT = "desktop-lyrics:visibility",
    /** 窗口几何变化广播 */
    DESKTOP_LYRICS_BOUNDS_EVENT = "desktop-lyrics:bounds",
    DESKTOP_LYRICS_REVEAL_SURFACE_EVENT = "desktop-lyrics:reveal-surface",
    DESKTOP_LYRICS_RESET_BOUNDS_EVENT = "desktop-lyrics:reset-bounds",
    /** 持久化窗口位置的存储键 */
    DESKTOP_LYRICS_BOUNDS_KEY = "desktop_lyrics_window_bounds";

// —— 窗口几何常量（逻辑像素） ——

export const DESKTOP_LYRICS_WINDOW_DEFAULT_WIDTH = 900,
    DESKTOP_LYRICS_WINDOW_DEFAULT_HEIGHT = 280,
    DESKTOP_LYRICS_WINDOW_MIN_WIDTH = 520,
    DESKTOP_LYRICS_WINDOW_MIN_HEIGHT = 160,
    DESKTOP_LYRICS_WINDOW_MAX_WIDTH = 1440,
    /** 与工作区边缘距离小于该阈值时触发吸附 */
    DESKTOP_LYRICS_WINDOW_EDGE_SNAP_THRESHOLD = 24,
    DESKTOP_LYRICS_WINDOW_SCREEN_MARGIN = 12;

// —— 载荷类型 ——

/** 桌面歌词内容层面的展示开关（翻译 / 罗马音） */
export type DesktopLyricsContentSettings = {
    showTranslation: boolean;
    showRomaji: boolean;
};

/** 歌词窗口实际生效的完整设置：内容开关叠加桌面歌词专属设置 */
export type DesktopLyricsWindowSettings = DesktopLyricsContentSettings &
    DesktopLyricsSettings;

/** 主窗口下发给歌词窗口的歌曲快照 */
export type DesktopLyricsSongSnapshot = {
    path: string;
    title: string;
    artist: string;
    duration: number;
};

/** 窗口几何：位置 + 尺寸 */
export type DesktopLyricsWindowBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

/** 屏幕可用工作区（已扣除任务栏等系统区域） */
export type DesktopLyricsWorkArea = {
    x: number;
    y: number;
    width: number;
    height: number;
};

/** 窗口尺寸的上下限 */
export type DesktopLyricsWindowSizeLimits = {
    minWidth: number;
    minHeight: number;
    maxWidth: number;
    maxHeight: number;
};

/** 主窗口推送给歌词窗口的全量状态 */
export interface DesktopLyricsStatePayload { // 实现
    song: DesktopLyricsSongSnapshot | null;
    parsedLyrics: LyricLine[];
    lyricsStatus: LyricsStatus;
    fallbackText: string;
    playbackTime: number;
    syncedAt: number;
    isPlaying: boolean;
    isFavorite: boolean;
    audioDelay: number;
    settings: DesktopLyricsWindowSettings;
    customLyricsFonts: ImportedLyricsFont[];
    themeColors: string[];
}

/** 播放进度增量推送 */
export interface DesktopLyricsPlaybackPayload { // 实现
    playbackTime: number;
    syncedAt: number;
    isPlaying: boolean;
    audioDelay: number;
}

/** 对完整设置的部分更新（映射写法等价于 Partial） */
export type DesktopLyricsSettingsPatch = {
    [K in keyof DesktopLyricsWindowSettings]?: DesktopLyricsWindowSettings[K];
};

/** 歌词窗口用户可触发的全部动作 */
export type DesktopLyricsAction = // 实现
    | {
          type:
              | "toggle-play"
              | "prev-song"
              | "next-song"
              | "toggle-favorite"
              | "open-settings"
              | "close";
      }
    | { type: "adjust-offset"; delta: number }
    | { type: "update-settings"; patch: DesktopLyricsSettingsPatch };

// —— 工具函数 ——

/** 由歌曲对象生成快照；标题 / 艺人缺失时回退到文件名与占位文案 */
export function createDesktopLyricsSongSnapshot(
    song: Song | null,
): DesktopLyricsSongSnapshot | null {
    if (song == null) {
        return null;
    }
    const displayName = song.title || song.name;
    const displayArtist = song.artist || "Unknown Artist";
    return {
        path: song.path,
        title: displayName,
        artist: displayArtist,
        duration: song.duration,
    };
}

// —— 工作区几何辅助 ——

const rightEdgeOf = (area: DesktopLyricsWorkArea) => area.x + area.width;
const bottomEdgeOf = (area: DesktopLyricsWorkArea) => area.y + area.height;

/** 计算窗口与工作区的可见重叠面积，完全不重叠时为 0 */
function measureOverlapArea(
    bounds: DesktopLyricsWindowBounds,
    area: DesktopLyricsWorkArea,
) {
    const overlapW = Math.max(
        0,
        Math.min(bounds.x + bounds.width, rightEdgeOf(area)) -
            Math.max(bounds.x, area.x),
    );
    const overlapH = Math.max(
        0,
        Math.min(bounds.y + bounds.height, bottomEdgeOf(area)) -
            Math.max(bounds.y, area.y),
    );
    return overlapW * overlapH;
}

/** 依据工作区推导窗口尺寸上下限（不得超过屏幕，且不低于最小尺寸） */
export function getDesktopLyricsWindowSizeLimits(
    workArea: DesktopLyricsWorkArea,
): DesktopLyricsWindowSizeLimits {
    const inset = DESKTOP_LYRICS_WINDOW_SCREEN_MARGIN * 2;
    const horizontalRoom = workArea.width - inset;
    const verticalRoom = workArea.height - inset;
    const maxWidth = Math.max(
        DESKTOP_LYRICS_WINDOW_MIN_WIDTH,
        Math.min(
            DESKTOP_LYRICS_WINDOW_MAX_WIDTH,
            Math.max(DESKTOP_LYRICS_WINDOW_MIN_WIDTH, horizontalRoom),
        ),
    );
    const maxHeight = Math.max(
        DESKTOP_LYRICS_WINDOW_MIN_HEIGHT,
        Math.max(DESKTOP_LYRICS_WINDOW_MIN_HEIGHT, verticalRoom),
    );
    const minWidth = Math.min(DESKTOP_LYRICS_WINDOW_MIN_WIDTH, maxWidth);
    const minHeight = Math.min(DESKTOP_LYRICS_WINDOW_MIN_HEIGHT, maxHeight);
    return { minWidth, minHeight, maxWidth, maxHeight };
}

/**
 * 挑选与目标窗口关系最紧密的工作区：
 * 先比较可见重叠面积，面积并列时取中心点距离更近者。
 */
export function resolveDesktopLyricsWorkArea( // 实现
    workAreas: DesktopLyricsWorkArea[],
    bounds: DesktopLyricsWindowBounds,
): DesktopLyricsWorkArea | null { // 实现
    if (!workAreas.length) {
        return null;
    }
    const boundsCenterX = bounds.x + bounds.width / 2;
    const boundsCenterY = bounds.y + bounds.height / 2;
    let winner = workAreas[0];
    let winnerOverlap = -1;
    let winnerGap = Number.POSITIVE_INFINITY;
    for (const area of workAreas) {
        const overlap = measureOverlapArea(bounds, area);
        const gap =
            (area.x + area.width / 2 - boundsCenterX) ** 2 +
            (area.y + area.height / 2 - boundsCenterY) ** 2;
        const isCloser =
            overlap > winnerOverlap ||
            (overlap === winnerOverlap && gap < winnerGap);
        if (isCloser) {
            winner = area;
            winnerOverlap = overlap;
            winnerGap = gap;
        }
    }
    return winner;
}

/** 把窗口尺寸约束到合法区间，并把位置夹回所属工作区内 */
export function normalizeDesktopLyricsBounds( // 实现
    bounds: DesktopLyricsWindowBounds,
    workAreas: DesktopLyricsWorkArea[],
): DesktopLyricsWindowBounds | null { // 实现
    const host = resolveDesktopLyricsWorkArea(workAreas, bounds);
    if (!host) {
        return null;
    }
    const size = getDesktopLyricsWindowSizeLimits(host);
    const width = clamp(bounds.width, size.minWidth, size.maxWidth);
    const height = clamp(bounds.height, size.minHeight, size.maxHeight);
    // 位置上限：工作区右 / 下边界减去尺寸，保证窗口不出界。
    const maxOffsetX = host.x + Math.max(0, host.width - width);
    const maxOffsetY = host.y + Math.max(0, host.height - height);
    return {
        x: clamp(bounds.x, host.x, maxOffsetX),
        y: clamp(bounds.y, host.y, maxOffsetY),
        width,
        height,
    };
}

/**
 * 从持久化数据恢复窗口位置：
 * 恢复结果与任一屏幕仍有可见重叠时原样采用，否则夹回最近工作区。
 */
export function restoreDesktopLyricsBounds( // 实现
    bounds: DesktopLyricsWindowBounds,
    workAreas: DesktopLyricsWorkArea[],
): DesktopLyricsWindowBounds | null { // 实现
    const host = resolveDesktopLyricsWorkArea(workAreas, bounds);
    if (!host) {
        return null;
    }
    const size = getDesktopLyricsWindowSizeLimits(host);
    const width = clamp(bounds.width, size.minWidth, size.maxWidth);
    const height = clamp(bounds.height, size.minHeight, size.maxHeight);
    const restoredBounds = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width,
        height,
    };
    const staysVisible = workAreas.some(
        (candidate) => measureOverlapArea(restoredBounds, candidate) > 0,
    );
    if (staysVisible) {
        return restoredBounds;
    }
    const maxOffsetX = host.x + Math.max(0, host.width - width);
    const maxOffsetY = host.y + Math.max(0, host.height - height);
    return {
        x: clamp(bounds.x, host.x, maxOffsetX),
        y: clamp(bounds.y, host.y, maxOffsetY),
        width,
        height,
    };
}

const nearStartEdge = (position: number, edge: number, tolerance: number) =>
    Math.abs(position - edge) <= tolerance;
const nearEndEdge = (
    position: number,
    span: number,
    edge: number,
    tolerance: number,
) => Math.abs(position + span - edge) <= tolerance;

/** 在归一化基础上做屏幕边缘吸附：四边任一落入阈值即钉到边缘 */
export function snapDesktopLyricsBounds( // 实现
    bounds: DesktopLyricsWindowBounds,
    workAreas: DesktopLyricsWorkArea[],
    threshold = DESKTOP_LYRICS_WINDOW_EDGE_SNAP_THRESHOLD,
): DesktopLyricsWindowBounds | null { // 实现
    const normalized = normalizeDesktopLyricsBounds(bounds, workAreas);
    if (!normalized) {
        return null;
    }
    const host = resolveDesktopLyricsWorkArea(workAreas, normalized);
    if (!host) {
        return normalized;
    }
    let { x, y } = normalized;
    const { width, height } = normalized;
    const rightEdge = rightEdgeOf(host);
    const bottomEdge = bottomEdgeOf(host);
    if (nearStartEdge(x, host.x, threshold)) x = host.x;
    if (nearStartEdge(y, host.y, threshold)) y = host.y;
    if (nearEndEdge(x, width, rightEdge, threshold)) x = rightEdge - width;
    if (nearEndEdge(y, height, bottomEdge, threshold)) y = bottomEdge - height;
    return { x, y, width, height };
}
