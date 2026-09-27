/**
 * 歌词设置的默认值、合法区间与迁移清洗规则。
 *
 * 主窗口播放器与桌面歌词窗口共用这里的清洗入口：任何“从落盘数据
 * 恢复设置”的路径都必须先经过本文件的 normalize / clamp / merge
 * 三类函数，旧版本字段才能被安全地映射到当前数据模型。
 */

import type {
  DesktopLyricsSettings, DesktopLyricsPlayerAlignment, ImportedLyricsFont, LyricsColorScheme,
  LyricsFontPreset, LyricsPlayerAlignment, LyricsPlayerRenderMode, LyricsSettings,
} from '../../types';

/* ==================== 旧版落盘键（迁移后即弃用） ==================== */

export const LEGACY_LYRICS_SETTINGS_KEY: string = 'lyrics_settings';
export const LEGACY_DESKTOP_LYRICS_SETTINGS_KEY: string = 'desktop_lyrics_settings';

/* ==================== 数值区间与默认值 ==================== */

// —— 主窗口文字度量 ——
export const DEFAULT_PLAYER_FONT_SCALE: number = 1;
export const MIN_PLAYER_FONT_SCALE: number = 0.5;
export const MAX_PLAYER_FONT_SCALE: number = 3.0;
export const DEFAULT_SUB_FONT_SCALE: number = 1.5;
export const MIN_SUB_FONT_SCALE: number = 0.5;
export const MAX_SUB_FONT_SCALE: number = 3.0;
export const DEFAULT_PLAYER_LINE_GAP: number = 1;
export const MIN_PLAYER_LINE_GAP: number = 0.5;
export const MAX_PLAYER_LINE_GAP: number = 3.0;

// —— 主窗口位置微调 ——
export const DEFAULT_PLAYER_OFFSET_X: number = 0;
export const MIN_PLAYER_OFFSET_X: number = -30;
export const MAX_PLAYER_OFFSET_X: number = 30;
export const DEFAULT_PLAYER_OFFSET_Y: number = 0;
export const MIN_PLAYER_OFFSET_Y: number = -25;
export const MAX_PLAYER_OFFSET_Y: number = 25;

// —— 播放器呈现方式 ——
export const DEFAULT_PLAYER_ALIGNMENT = 'left' as LyricsPlayerAlignment;
export const DEFAULT_DESKTOP_PLAYER_ALIGNMENT = 'split-corners' as DesktopLyricsPlayerAlignment;
export const DEFAULT_PLAYER_FONT_PRESET = 'system' as LyricsFontPreset;
export const DEFAULT_PLAYER_RENDER_MODE = 'amll' as LyricsPlayerRenderMode;

// —— 主窗口背景 ——
export const DEFAULT_BACKGROUND_BLUR: number = 100;
export const MIN_BACKGROUND_BLUR: number = 0;
export const MAX_BACKGROUND_BLUR: number = 100;
export const DEFAULT_CUSTOM_BACKGROUND_IMAGE: string = '';

// —— 桌面歌词配色（冻结色值） ——
export const DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR: string = '#EC4141';
export const DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR: string = '#FFFFFF';
export const DEFAULT_DESKTOP_CUSTOM_ROMAJI_PLAYED_COLOR: string = '#BFDBFE';
export const DEFAULT_DESKTOP_CUSTOM_ROMAJI_UNPLAYED_COLOR: string = '#FFFFFF';
export const DEFAULT_DESKTOP_CUSTOM_ROMAJI_COLOR: string = '#BFDBFE';
export const DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR: string = '#FBCFE8';

// —— 桌面歌词文字可读性 ——
export const DEFAULT_DESKTOP_TEXT_OPACITY: number = 1;
export const MIN_DESKTOP_TEXT_OPACITY: number = 0.6;
export const MAX_DESKTOP_TEXT_OPACITY: number = 1;
export const DEFAULT_DESKTOP_TEXT_SHADOW_COLOR: string = '#000000';
export const DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH: number = 0;
export const MIN_DESKTOP_TEXT_SHADOW_STRENGTH: number = 0;
export const MAX_DESKTOP_TEXT_SHADOW_STRENGTH: number = 100;
export const DEFAULT_DESKTOP_TEXT_OUTLINE_WIDTH: number = 0.3;
export const MIN_DESKTOP_TEXT_OUTLINE_WIDTH: number = 0.1;
export const MAX_DESKTOP_TEXT_OUTLINE_WIDTH: number = 5;
export const DEFAULT_DESKTOP_TEXT_OUTLINE_COLOR: string = '#000000';

/* ==================== 预设字体表 ==================== */

export interface LyricsFontOption {
  value: LyricsFontPreset; // 下拉项取值：内置预设名或字体族名
  label: string; // 界面展示名
  fontFamily: string; // 写入 CSS 的 font-family 串
  isSystem?: boolean; // 选项来自系统字体枚举
  isImported?: boolean; // 选项来自用户导入的字体文件
}

/** 各预设引用的字体栈；字面值为冻结值，只能原样引用。 */
const SYSTEM_DEFAULT_STACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const CJK_SANS_STACK = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
const DENGXIAN_STACK = '"DengXian", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
const SONGTI_STACK = '"SimSun", "Songti SC", "STSong", serif';
const HEITI_STACK = '"SimHei", "Heiti SC", "Microsoft YaHei", sans-serif';
const KAITI_STACK = '"KaiTi", "Kaiti SC", "STKaiti", serif';
const ARIAL_STACK = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
const GEORGIA_STACK = 'Georgia, "Times New Roman", serif';
const MONO_STACK = '"Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace';

/** 预设表行结构：[预设名, 展示名, 字体栈]。 */
type FontPresetRow = readonly [LyricsFontPreset, string, string];

/** 内置预设的声明表：新增预设只需在此追加一行。 */
const FONT_PRESET_ROWS: readonly FontPresetRow[] = [
  ['system', '跟随系统默认', SYSTEM_DEFAULT_STACK],
  ['yahei', '微软雅黑', CJK_SANS_STACK],
  ['dengxian', '等线', DENGXIAN_STACK],
  ['songti', '宋体', SONGTI_STACK],
  ['heiti', '黑体', HEITI_STACK],
  ['kaiti', '楷体', KAITI_STACK],
  ['arial', 'Arial', ARIAL_STACK],
  ['georgia', 'Georgia', GEORGIA_STACK],
  ['mono', '等宽字体', MONO_STACK],
];

export const LYRICS_FONT_OPTIONS: readonly LyricsFontOption[] = FONT_PRESET_ROWS.map(
  ([value, label, fontFamily]) => ({ value, label, fontFamily }),
);

/* ==================== 默认设置 ==================== */

/** 主窗口行组开关的出厂值。 */
const MAIN_SWITCH_GROUP = { showTranslation: true, showRomaji: false, enableWordEffect: true } as const;

/** 主窗口字体拆分的出厂值。 */
const MAIN_FONT_SPLIT_GROUP = { playerFontSplitEnabled: false } as const;

/** 主窗口渲染方式的出厂值。 */
const MAIN_RENDER_GROUP = { playerRenderMode: DEFAULT_PLAYER_RENDER_MODE, playerFontPreset: DEFAULT_PLAYER_FONT_PRESET } as const;

/** 主窗口文字度量的出厂值。 */
const MAIN_METRIC_GROUP = { playerFontScale: DEFAULT_PLAYER_FONT_SCALE, playerLineGap: DEFAULT_PLAYER_LINE_GAP } as const;

/** 主窗口位置微调的出厂值。 */
const MAIN_OFFSET_GROUP = { playerOffsetX: DEFAULT_PLAYER_OFFSET_X, playerOffsetY: DEFAULT_PLAYER_OFFSET_Y } as const;

/** 主窗口背景的出厂值。 */
const MAIN_BACKGROUND_GROUP = { backgroundBlur: DEFAULT_BACKGROUND_BLUR, customBackgroundImage: DEFAULT_CUSTOM_BACKGROUND_IMAGE } as const;

export const defaultLyricsSettings: LyricsSettings = {
  ...MAIN_SWITCH_GROUP,
  ...MAIN_FONT_SPLIT_GROUP,
  ...MAIN_RENDER_GROUP,
  ...MAIN_METRIC_GROUP,
  ...MAIN_OFFSET_GROUP,
  playerFontPresetCJK: DEFAULT_PLAYER_FONT_PRESET,
  playerFontPresetLatin: DEFAULT_PLAYER_FONT_PRESET,
  playerAlignment: DEFAULT_PLAYER_ALIGNMENT, // 主窗口只允许水平对齐
  ...MAIN_BACKGROUND_GROUP,
};

/** 桌面窗口行为开关的出厂值。 */
const DESKTOP_WINDOW_GROUP = {
  isAlwaysOnTop: true, alwaysShowShadowBackground: false, autoHideWhenFullscreen: false,
  autoHideWhenPaused: false, showDoubleLine: true, enableWordEffect: true, enableTextOutline: true,
} as const;

/** 桌面窗口锁定与摆放的出厂值。 */
const DESKTOP_LOCK_GROUP = { isLocked: false, persistLock: true, centerHorizontally: false } as const;

/** 桌面窗口配色方案的出厂值。 */
const DESKTOP_COLOR_GROUP = {
  colorScheme: 'auto' as LyricsColorScheme,
  customPlayedColor: DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR, customUnplayedColor: DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
  customRomajiPlayedColor: DEFAULT_DESKTOP_CUSTOM_ROMAJI_PLAYED_COLOR, customRomajiUnplayedColor: DEFAULT_DESKTOP_CUSTOM_ROMAJI_UNPLAYED_COLOR,
  customRomajiColor: DEFAULT_DESKTOP_CUSTOM_ROMAJI_COLOR, customTranslationColor: DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
} as const;

/** 桌面窗口文字可读性的出厂值。 */
const DESKTOP_READABILITY_GROUP = {
  textOpacity: DEFAULT_DESKTOP_TEXT_OPACITY, textShadowColor: DEFAULT_DESKTOP_TEXT_SHADOW_COLOR,
  firstLineTextShadowStrength: DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH, secondLineTextShadowStrength: DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH,
  textOutlineWidth: DEFAULT_DESKTOP_TEXT_OUTLINE_WIDTH, textOutlineColor: DEFAULT_DESKTOP_TEXT_OUTLINE_COLOR,
} as const;

/** 桌面窗口文字度量的出厂值。 */
const DESKTOP_TEXT_METRIC_GROUP = {
  playerFontScale: DEFAULT_PLAYER_FONT_SCALE, subFontScale: DEFAULT_SUB_FONT_SCALE,
  playerLineGap: DEFAULT_PLAYER_LINE_GAP, playerOffsetX: DEFAULT_PLAYER_OFFSET_X, playerOffsetY: DEFAULT_PLAYER_OFFSET_Y,
} as const;

export const defaultDesktopLyricsSettings: DesktopLyricsSettings = {
  ...DESKTOP_WINDOW_GROUP,
  ...DESKTOP_LOCK_GROUP,
  ...DESKTOP_COLOR_GROUP,
  ...DESKTOP_READABILITY_GROUP,
  ...DESKTOP_TEXT_METRIC_GROUP,
  playerAlignment: DEFAULT_DESKTOP_PLAYER_ALIGNMENT, // 桌面默认对角布局
  playerFontPreset: DEFAULT_PLAYER_FONT_PRESET,
};

/** 每次调用都返回一份全新快照，避免调用方互相污染。 */
export const createDefaultLyricsSettings = (): LyricsSettings => ({ ...defaultLyricsSettings });

/** 每次调用都返回一份全新快照，避免调用方互相污染。 */
export const createDefaultDesktopLyricsSettings = (): DesktopLyricsSettings => ({ ...defaultDesktopLyricsSettings });

/* ==================== 数值钳制 ==================== */

/** 区间三元组：回退默认值、下限、上限。 */
interface NumericRange {
  readonly fallback: number;
  readonly lower: number;
  readonly upper: number;
}

/** 非有限数值一律退回默认，其余收敛进 [lower, upper]。 */
function settleInRange(range: NumericRange, candidate: number): number {
  if (!Number.isFinite(candidate)) {
    return range.fallback;
  }
  return Math.min(range.upper, Math.max(range.lower, candidate));
}

const FONT_SCALE_RANGE: NumericRange = { fallback: DEFAULT_PLAYER_FONT_SCALE, lower: MIN_PLAYER_FONT_SCALE, upper: MAX_PLAYER_FONT_SCALE };
const SUB_FONT_SCALE_RANGE: NumericRange = { fallback: DEFAULT_SUB_FONT_SCALE, lower: MIN_SUB_FONT_SCALE, upper: MAX_SUB_FONT_SCALE };
const LINE_GAP_RANGE: NumericRange = { fallback: DEFAULT_PLAYER_LINE_GAP, lower: MIN_PLAYER_LINE_GAP, upper: MAX_PLAYER_LINE_GAP };
const OFFSET_X_RANGE: NumericRange = { fallback: DEFAULT_PLAYER_OFFSET_X, lower: MIN_PLAYER_OFFSET_X, upper: MAX_PLAYER_OFFSET_X };
const OFFSET_Y_RANGE: NumericRange = { fallback: DEFAULT_PLAYER_OFFSET_Y, lower: MIN_PLAYER_OFFSET_Y, upper: MAX_PLAYER_OFFSET_Y };
const BACKGROUND_BLUR_RANGE: NumericRange = { fallback: DEFAULT_BACKGROUND_BLUR, lower: MIN_BACKGROUND_BLUR, upper: MAX_BACKGROUND_BLUR };
const TEXT_OPACITY_RANGE: NumericRange = { fallback: DEFAULT_DESKTOP_TEXT_OPACITY, lower: MIN_DESKTOP_TEXT_OPACITY, upper: MAX_DESKTOP_TEXT_OPACITY };
const SHADOW_STRENGTH_RANGE: NumericRange = { fallback: DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH, lower: MIN_DESKTOP_TEXT_SHADOW_STRENGTH, upper: MAX_DESKTOP_TEXT_SHADOW_STRENGTH };
const OUTLINE_WIDTH_RANGE: NumericRange = { fallback: DEFAULT_DESKTOP_TEXT_OUTLINE_WIDTH, lower: MIN_DESKTOP_TEXT_OUTLINE_WIDTH, upper: MAX_DESKTOP_TEXT_OUTLINE_WIDTH };

export function clampPlayerFontScale(value: number): number {
  return settleInRange(FONT_SCALE_RANGE, value);
}

export function clampSubFontScale(value: number): number {
  return settleInRange(SUB_FONT_SCALE_RANGE, value);
}

export function clampPlayerLineGap(value: number): number {
  return settleInRange(LINE_GAP_RANGE, value);
}

export function clampPlayerOffsetX(value: number): number {
  return settleInRange(OFFSET_X_RANGE, value);
}

export function clampPlayerOffsetY(value: number): number {
  return settleInRange(OFFSET_Y_RANGE, value);
}

export function clampBackgroundBlur(value: number): number {
  return settleInRange(BACKGROUND_BLUR_RANGE, value);
}

export function clampDesktopTextOpacity(value: number): number {
  return settleInRange(TEXT_OPACITY_RANGE, value);
}

/** 阴影强度是整数档位：先取整再收敛。 */
export function clampDesktopTextShadowStrength(value: number): number {
  return settleInRange(SHADOW_STRENGTH_RANGE, Math.round(value));
}

/** 描边宽度按 0.1 步进取整后再收敛。 */
export function clampDesktopTextOutlineWidth(value: number): number {
  const stepped = Math.round(value * 10) / 10;
  return settleInRange(OUTLINE_WIDTH_RANGE, stepped);
}

/* ==================== 枚举字段归一化 ==================== */

/** 主窗口允许的三种水平对齐。 */
const PLAYER_ALIGNMENT_CHOICES: readonly LyricsPlayerAlignment[] = ['left', 'center', 'right'];

export function normalizePlayerAlignment(value: unknown, fallback: LyricsPlayerAlignment = DEFAULT_PLAYER_ALIGNMENT): LyricsPlayerAlignment {
  const allowed = PLAYER_ALIGNMENT_CHOICES.some((choice) => choice === value);
  return allowed ? (value as LyricsPlayerAlignment) : fallback;
}

export function normalizeDesktopPlayerAlignment(value: unknown, fallback: DesktopLyricsPlayerAlignment = DEFAULT_DESKTOP_PLAYER_ALIGNMENT): DesktopLyricsPlayerAlignment {
  // 对角布局是桌面窗口专属取值，直接放行。
  if (value === DEFAULT_DESKTOP_PLAYER_ALIGNMENT) {
    return value as DesktopLyricsPlayerAlignment;
  }
  // 回退值若是对角布局，先压回居中，再走水平对齐判定。
  const horizontalFallback = (fallback === DEFAULT_DESKTOP_PLAYER_ALIGNMENT ? 'center' : fallback) as LyricsPlayerAlignment;
  return normalizePlayerAlignment(value, horizontalFallback);
}

/** 桌面配色方案的全部合法取值。 */
const COLOR_SCHEME_SET: ReadonlySet<string> = new Set<LyricsColorScheme>(['default', 'pink', 'blue', 'green', 'white', 'custom']);

export function normalizeLyricsColorScheme(value: unknown): LyricsColorScheme {
  if (typeof value !== 'string' || !COLOR_SCHEME_SET.has(value)) {
    return 'auto';
  }
  return value as LyricsColorScheme;
}

/** 六位十六进制色值（#RRGGBB），大小写均可。 */
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const candidate = value.trim();
  if (!HEX_COLOR_PATTERN.test(candidate)) {
    return fallback;
  }
  return candidate.toUpperCase();
}

/** 字体名/标识统一清洗：去首尾空白、折叠连续空白、限长。 */
const FONT_TEXT_MAX_LENGTH = 160;

export function normalizeCustomFontName(value: string): string {
  const flattened = value.trim().replace(/\s+/g, ' ');
  return flattened.length > FONT_TEXT_MAX_LENGTH ? flattened.slice(0, FONT_TEXT_MAX_LENGTH) : flattened;
}

/** 已导入字体记录的清洗结果：四要素齐备才算有效。 */
function asImportedFontRecord(item: unknown): ImportedLyricsFont | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const raw = item as Partial<ImportedLyricsFont>;
  const id = typeof raw.id === 'string' ? normalizeCustomFontName(raw.id) : '';
  const name = typeof raw.name === 'string' ? normalizeCustomFontName(raw.name) : '';
  const family = typeof raw.family === 'string' ? normalizeCustomFontName(raw.family) : '';
  const filePath = typeof raw.filePath === 'string' ? raw.filePath.trim() : '';
  const importedAt = typeof raw.importedAt === 'number' && Number.isFinite(raw.importedAt) ? raw.importedAt : Date.now();
  const format = raw.format === 'opentype' ? 'opentype' : 'truetype';
  if (!id || !name || !family || !filePath) {
    return null;
  }
  return { id, name, family, filePath, importedAt, format };
}

/** 导入字体列表逐条补全字段；同族字体只保留最先出现的一条。 */
export function normalizeImportedLyricsFonts(value: unknown): ImportedLyricsFont[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const claimedFamilies = new Set<string>();
  const cleanedList: ImportedLyricsFont[] = [];
  for (const item of value) {
    const record = asImportedFontRecord(item);
    if (record === null) {
      continue;
    }
    const familyKey = record.family.toLocaleLowerCase();
    if (claimedFamilies.has(familyKey)) {
      continue;
    }
    claimedFamilies.add(familyKey);
    cleanedList.push(record);
  }
  return cleanedList;
}

/** 给字体名包上双引号并转义内部反斜杠与引号，用于拼进 font-family。 */
export function escapeFontFamilyName(value: string): string {
  const withEscapedBackslashes = value.replace(/\\/g, '\\\\');
  const withEscapedQuotes = withEscapedBackslashes.replace(/"/g, '\\"');
  return `"${withEscapedQuotes}"`;
}

export function normalizeLyricsFontPreset(value: unknown): LyricsFontPreset {
  const tidied = typeof value === 'string' ? normalizeCustomFontName(value) : '';
  return tidied === '' ? DEFAULT_PLAYER_FONT_PRESET : tidied;
}

/** 播放器渲染内核仅支持 amll 与 light 两种。 */
const RENDER_MODE_SET: ReadonlySet<string> = new Set<LyricsPlayerRenderMode>(['amll', 'light']);

export function normalizeLyricsPlayerRenderMode(value: unknown): LyricsPlayerRenderMode {
  if (typeof value === 'string' && RENDER_MODE_SET.has(value)) {
    return value as LyricsPlayerRenderMode;
  }
  return DEFAULT_PLAYER_RENDER_MODE;
}

/** 取 font-family 列表的第一个族名，并剥掉包裹的引号。 */
export function extractPrimaryFontFamily(fontFamily: string): string {
  const [firstCandidate = ''] = fontFamily.split(',');
  return firstCandidate.trim().replace(/^["']|["']$/g, '');
}

/* ==================== 补丁归一化 ==================== */

/** 布尔字段只认真正的 boolean，其余一律回退。 */
function keepBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

/** 字符串字段非 string 即回退。 */
function keepString(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw : fallback;
}

export function normalizeLyricsSettingsPatch(patch: Partial<LyricsSettings>): LyricsSettings {
  const merged = Object.assign({}, defaultLyricsSettings, patch) as LyricsSettings;
  // 逐字段重写为合法值：布尔严格判定、数值区间钳制、枚举白名单过滤。
  merged.showTranslation = keepBoolean(merged.showTranslation, defaultLyricsSettings.showTranslation);
  merged.showRomaji = keepBoolean(merged.showRomaji, defaultLyricsSettings.showRomaji);
  merged.enableWordEffect = keepBoolean(merged.enableWordEffect, defaultLyricsSettings.enableWordEffect);
  merged.playerRenderMode = normalizeLyricsPlayerRenderMode(merged.playerRenderMode);
  merged.playerFontScale = clampPlayerFontScale(merged.playerFontScale);
  merged.playerLineGap = clampPlayerLineGap(merged.playerLineGap);
  merged.playerOffsetX = clampPlayerOffsetX(merged.playerOffsetX);
  merged.playerOffsetY = clampPlayerOffsetY(merged.playerOffsetY);
  merged.playerAlignment = normalizePlayerAlignment(merged.playerAlignment, DEFAULT_PLAYER_ALIGNMENT);
  merged.playerFontPreset = normalizeLyricsFontPreset(merged.playerFontPreset);
  merged.playerFontSplitEnabled = keepBoolean(merged.playerFontSplitEnabled, false);
  merged.playerFontPresetCJK = normalizeLyricsFontPreset(merged.playerFontPresetCJK);
  merged.playerFontPresetLatin = normalizeLyricsFontPreset(merged.playerFontPresetLatin);
  merged.backgroundBlur = clampBackgroundBlur(merged.backgroundBlur);
  merged.customBackgroundImage = keepString(merged.customBackgroundImage, DEFAULT_CUSTOM_BACKGROUND_IMAGE);
  return merged;
}

/** 旧版桌面设置携带、如今已并入新字段的遗留键。 */
interface LegacyDesktopExtras {
  textShadowStrength?: number;
  customRomajiColor?: string;
}

export function normalizeDesktopLyricsSettingsPatch(
  patch: Partial<DesktopLyricsSettings>,
): DesktopLyricsSettings {
  const merged = Object.assign({}, defaultDesktopLyricsSettings, patch) as DesktopLyricsSettings;
  const legacy = patch as Partial<DesktopLyricsSettings> & LegacyDesktopExtras;
  // 更早版本只有单一阴影强度与单一罗马音颜色：新字段缺省时向下兼容。
  const carriedShadowStrength = legacy.textShadowStrength;
  const carriedRomajiColor = legacy.customRomajiColor;

  merged.isAlwaysOnTop = keepBoolean(merged.isAlwaysOnTop, defaultDesktopLyricsSettings.isAlwaysOnTop);
  merged.alwaysShowShadowBackground = keepBoolean(merged.alwaysShowShadowBackground, defaultDesktopLyricsSettings.alwaysShowShadowBackground);
  merged.autoHideWhenFullscreen = keepBoolean(merged.autoHideWhenFullscreen, defaultDesktopLyricsSettings.autoHideWhenFullscreen);
  merged.autoHideWhenPaused = keepBoolean(merged.autoHideWhenPaused, defaultDesktopLyricsSettings.autoHideWhenPaused);
  merged.showDoubleLine = keepBoolean(merged.showDoubleLine, defaultDesktopLyricsSettings.showDoubleLine);
  merged.enableWordEffect = keepBoolean(merged.enableWordEffect, defaultDesktopLyricsSettings.enableWordEffect);
  merged.enableTextOutline = keepBoolean(merged.enableTextOutline, defaultDesktopLyricsSettings.enableTextOutline);
  merged.textOutlineWidth = clampDesktopTextOutlineWidth(merged.textOutlineWidth);
  merged.textOutlineColor = normalizeHexColor(merged.textOutlineColor, DEFAULT_DESKTOP_TEXT_OUTLINE_COLOR);
  merged.isLocked = keepBoolean(merged.isLocked, defaultDesktopLyricsSettings.isLocked);
  merged.persistLock = keepBoolean(merged.persistLock, defaultDesktopLyricsSettings.persistLock);
  merged.centerHorizontally = keepBoolean(merged.centerHorizontally, defaultDesktopLyricsSettings.centerHorizontally);
  merged.colorScheme = normalizeLyricsColorScheme(merged.colorScheme);
  merged.customPlayedColor = normalizeHexColor(merged.customPlayedColor, DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR);
  merged.customUnplayedColor = normalizeHexColor(merged.customUnplayedColor, DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR);
  merged.customRomajiPlayedColor = normalizeHexColor(patch.customRomajiPlayedColor ?? carriedRomajiColor, DEFAULT_DESKTOP_CUSTOM_ROMAJI_PLAYED_COLOR);
  merged.customRomajiUnplayedColor = normalizeHexColor(patch.customRomajiUnplayedColor ?? carriedRomajiColor, DEFAULT_DESKTOP_CUSTOM_ROMAJI_UNPLAYED_COLOR);
  merged.customRomajiColor = normalizeHexColor(merged.customRomajiColor, DEFAULT_DESKTOP_CUSTOM_ROMAJI_COLOR);
  merged.customTranslationColor = normalizeHexColor(merged.customTranslationColor, DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR);
  merged.textOpacity = clampDesktopTextOpacity(merged.textOpacity);
  merged.textShadowColor = normalizeHexColor(merged.textShadowColor, DEFAULT_DESKTOP_TEXT_SHADOW_COLOR);
  merged.firstLineTextShadowStrength = clampDesktopTextShadowStrength(patch.firstLineTextShadowStrength ?? carriedShadowStrength ?? DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH);
  merged.secondLineTextShadowStrength = clampDesktopTextShadowStrength(patch.secondLineTextShadowStrength ?? carriedShadowStrength ?? DEFAULT_DESKTOP_TEXT_SHADOW_STRENGTH);
  merged.playerFontScale = clampPlayerFontScale(merged.playerFontScale);
  merged.subFontScale = clampSubFontScale(merged.subFontScale);
  merged.playerLineGap = clampPlayerLineGap(merged.playerLineGap);
  merged.playerOffsetX = clampPlayerOffsetX(merged.playerOffsetX);
  merged.playerOffsetY = clampPlayerOffsetY(merged.playerOffsetY);
  merged.playerAlignment = normalizeDesktopPlayerAlignment(merged.playerAlignment, DEFAULT_DESKTOP_PLAYER_ALIGNMENT);
  merged.playerFontPreset = normalizeLyricsFontPreset(merged.playerFontPreset);
  return merged;
}

export function mergeLyricsSettings(base: LyricsSettings, patch: Partial<LyricsSettings>): LyricsSettings {
  return normalizeLyricsSettingsPatch(Object.assign({}, base, patch));
}

export function mergeDesktopLyricsSettings(base: DesktopLyricsSettings, patch: Partial<DesktopLyricsSettings>): DesktopLyricsSettings {
  return normalizeDesktopLyricsSettingsPatch(Object.assign({}, base, patch));
}
