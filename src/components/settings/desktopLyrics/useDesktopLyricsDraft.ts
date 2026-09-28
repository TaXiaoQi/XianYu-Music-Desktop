import { computed, nextTick, onMounted, onUnmounted, ref, toRaw, watch } from 'vue';

import {
  DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR,
  DEFAULT_DESKTOP_CUSTOM_ROMAJI_PLAYED_COLOR,
  DEFAULT_DESKTOP_CUSTOM_ROMAJI_UNPLAYED_COLOR,
  DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
  DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
  DEFAULT_DESKTOP_TEXT_OUTLINE_COLOR,
  DEFAULT_DESKTOP_TEXT_OUTLINE_WIDTH,
  DEFAULT_DESKTOP_TEXT_SHADOW_COLOR,
  LYRICS_FONT_OPTIONS,
  MAX_DESKTOP_TEXT_SHADOW_STRENGTH,
  MIN_DESKTOP_TEXT_SHADOW_STRENGTH,
  buildImportedLyricsFontOptions,
  createDefaultDesktopLyricsSettings,
  getLyricsFontFamily,
  normalizeDesktopPlayerAlignment,
  normalizeHexColor,
  normalizeLyricsFontPreset,
  systemLyricsFontOptions,
  useLyrics,
  type DesktopLyricsPlayerAlignment,
  type LyricsColorScheme,
  type LyricsFontPreset,
} from '../../../composables/lyrics';
import { buildDesktopLyricsPreviewWidgetStyle, buildGradientWordStyle, buildSolidWordStyle } from '../desktopLyricsPreview';
import { useSettings } from '../../../features/settings/useSettings';
import { useLyricsSettingsStore } from '../../../features/lyricsSettings/store';

/** 自定义配色作用的五个颜色槽位。 */
export type DesktopCustomColorTarget =
  | 'played'
  | 'unplayed'
  | 'romajiPlayed'
  | 'romajiUnplayed'
  | 'translation';

/** 本页面本地草稿的字段集合（与持久化补丁一一对应）。 */
export interface DesktopLyricsDraft {
  playerFontScale: number;
  subFontScale: number;
  playerLineGap: number;
  playerOffsetX: number;
  playerOffsetY: number;
  textOpacity: number;
  firstLineTextShadowStrength: number;
  secondLineTextShadowStrength: number;
  textShadowColor: string;
  playerAlignment: DesktopLyricsPlayerAlignment;
  playerFontPreset: LyricsFontPreset;
  colorScheme: LyricsColorScheme;
  customPlayedColor: string;
  customUnplayedColor: string;
  customRomajiPlayedColor: string;
  customRomajiUnplayedColor: string;
  customRomajiColor: string;
  customTranslationColor: string;
}

const DRAFT_KEYS = [
  'playerFontScale',
  'subFontScale',
  'playerLineGap',
  'playerOffsetX',
  'playerOffsetY',
  'textOpacity',
  'firstLineTextShadowStrength',
  'secondLineTextShadowStrength',
  'textShadowColor',
  'playerAlignment',
  'playerFontPreset',
  'colorScheme',
  'customPlayedColor',
  'customUnplayedColor',
  'customRomajiPlayedColor',
  'customRomajiUnplayedColor',
  'customRomajiColor',
  'customTranslationColor',
] as const;

type DraftKey = (typeof DRAFT_KEYS)[number];

/** 阴影色快捷色板。 */
export const SHADOW_SWATCHES: Array<{ label: string; value: string }> = [
  { label: '黑', value: '#000000' },
  { label: '白', value: '#FFFFFF' },
  { label: '红', value: DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR },
];

/** 配色方案候选。 */
export const SCHEME_CHOICES: Array<{
  value: LyricsColorScheme;
  label: string;
  hint: string;
  color?: string;
}> = [
  { value: 'default', label: '经典红', hint: '使用 XianYu Music 的默认红色方案', color: '#EC4141' },
  { value: 'pink', label: '柔粉', hint: '偏柔和、偏梦幻的粉色搭配', color: '#f472b6' },
  { value: 'blue', label: '澄蓝', hint: '更冷静的蓝色高亮', color: '#60a5fa' },
  { value: 'green', label: '青绿', hint: '更清爽的绿色高亮', color: '#34d399' },
  { value: 'custom', label: '自定义', hint: '手动选择已播放和未播放颜色' },
  { value: 'auto', label: '封面取色', hint: '跟随当前歌曲封面颜色' },
];

const CUSTOM_COLOR_FALLBACKS: Record<DesktopCustomColorTarget, string> = {
  played: DEFAULT_DESKTOP_CUSTOM_PLAYED_COLOR,
  unplayed: DEFAULT_DESKTOP_CUSTOM_UNPLAYED_COLOR,
  romajiPlayed: DEFAULT_DESKTOP_CUSTOM_ROMAJI_PLAYED_COLOR,
  romajiUnplayed: DEFAULT_DESKTOP_CUSTOM_ROMAJI_UNPLAYED_COLOR,
  translation: DEFAULT_DESKTOP_CUSTOM_TRANSLATION_COLOR,
};

/** 每种对齐取值最终落到预览卡上的布局类。 */
const PREVIEW_ALIGNMENT_CLASS: Record<DesktopLyricsPlayerAlignment, string> = {
  left: 'pv-align-l',
  center: 'pv-align-c',
  right: 'pv-align-r',
  'split-corners': 'pv-align-l',
};

const PREVIEW_WORD_OUTLINE =
  'var(--desktop-text-outline-width, 0px) var(--desktop-text-outline-color, #000000)';

/**
 * 桌面歌词设置页的本地草稿：读入口与出口都收敛在这里。
 * store → 草稿用镜像标记抑制回写，草稿 → store 用深度侦听打补丁。
 */
export function useDesktopLyricsDraft() {
  const { lyricsSettings, desktopLyricsSettings } = useLyrics();
  const { settings } = useSettings();

  const snapshotDraft = (): DesktopLyricsDraft => {
    const partial = {} as Record<DraftKey, unknown>;
    for (const key of DRAFT_KEYS) {
      partial[key] = desktopLyricsSettings[key];
    }
    return partial as DesktopLyricsDraft;
  };

  const draft = ref<DesktopLyricsDraft>(snapshotDraft());

  let mirroringFromStore = false;

  watch(
    () => DRAFT_KEYS.map((key) => desktopLyricsSettings[key]),
    () => {
      mirroringFromStore = true;
      draft.value = snapshotDraft();
      nextTick(() => {
        mirroringFromStore = false;
      });
    },
  );

  watch(
    draft,
    () => {
      if (mirroringFromStore) return;
      useLyricsSettingsStore().patchDesktopLyricsSettings(toRaw(draft.value));
    },
    { deep: true },
  );

  /** 全部排版/配色字段回到出厂（窗口行为开关不受影响）。 */
  function restoreDefaults() {
    const factory = createDefaultDesktopLyricsSettings();
    const next = {} as Record<DraftKey, unknown>;
    for (const key of DRAFT_KEYS) {
      next[key] = factory[key];
    }
    draft.value = next as DesktopLyricsDraft;
  }

  /* ---------- 草稿写入 ---------- */

  function applyShadowStrength(raw: number) {
    const bounded = Math.min(MAX_DESKTOP_TEXT_SHADOW_STRENGTH, Math.max(MIN_DESKTOP_TEXT_SHADOW_STRENGTH, raw));
    const whole = Number(bounded.toFixed(0));
    draft.value.firstLineTextShadowStrength = whole;
    draft.value.secondLineTextShadowStrength = whole;
  }

  function applyShadowColor(hex: string) {
    draft.value.textShadowColor = normalizeHexColor(hex, DEFAULT_DESKTOP_TEXT_SHADOW_COLOR);
  }

  function applyAlignment(value: DesktopLyricsPlayerAlignment) {
    draft.value.playerAlignment = normalizeDesktopPlayerAlignment(value);
  }

  function applyFontPreset(value: LyricsFontPreset) {
    draft.value.playerFontPreset = normalizeLyricsFontPreset(value);
  }

  function applyScheme(value: LyricsColorScheme) {
    draft.value.colorScheme = value;
  }

  /** 写入某个颜色槽位；罗马音未播放会联动罗马音基础色，并把方案切到自定义。 */
  function applyCustomColor(target: DesktopCustomColorTarget, hex: string) {
    const stable = normalizeHexColor(hex, CUSTOM_COLOR_FALLBACKS[target]);
    switch (target) {
      case 'played':
        draft.value.customPlayedColor = stable;
        break;
      case 'unplayed':
        draft.value.customUnplayedColor = stable;
        break;
      case 'romajiPlayed':
        draft.value.customRomajiPlayedColor = stable;
        break;
      case 'romajiUnplayed':
        draft.value.customRomajiUnplayedColor = stable;
        draft.value.customRomajiColor = stable;
        break;
      case 'translation':
        draft.value.customTranslationColor = stable;
        break;
    }
    draft.value.colorScheme = 'custom';
  }

  function readCustomColor(target: DesktopCustomColorTarget): string {
    switch (target) {
      case 'played':
        return draft.value.customPlayedColor;
      case 'unplayed':
        return draft.value.customUnplayedColor;
      case 'romajiPlayed':
        return draft.value.customRomajiPlayedColor;
      case 'romajiUnplayed':
        return draft.value.customRomajiUnplayedColor;
      case 'translation':
        return draft.value.customTranslationColor;
    }
  }

  /* ---------- 预览卡 ---------- */

  const previewPlayerVars = computed(() => ({
    '--pv-font-scale': String(draft.value.playerFontScale),
    '--pv-sub-scale': String(draft.value.subFontScale),
    '--pv-line-gap': String(draft.value.playerLineGap),
    '--pv-font-family': getLyricsFontFamily(draft.value.playerFontPreset),
  }));

  const previewAlignClass = computed(() => PREVIEW_ALIGNMENT_CLASS[draft.value.playerAlignment]);

  const previewWidgetVars = computed(() =>
    buildDesktopLyricsPreviewWidgetStyle(draft.value, {
      enableTextOutline: desktopLyricsSettings.enableTextOutline,
      textOutlineWidth: DEFAULT_DESKTOP_TEXT_OUTLINE_WIDTH,
      textOutlineColor: DEFAULT_DESKTOP_TEXT_OUTLINE_COLOR,
    }),
  );

  const wordPlayed = computed(() =>
    buildSolidWordStyle('var(--desktop-lyric-solid-color)', PREVIEW_WORD_OUTLINE),
  );
  const wordActive = computed(() =>
    buildGradientWordStyle('var(--desktop-lyric-solid-color)', 'var(--desktop-text-primary)', PREVIEW_WORD_OUTLINE),
  );
  const wordUnplayed = computed(() =>
    buildSolidWordStyle('var(--desktop-text-primary)', PREVIEW_WORD_OUTLINE),
  );
  const romajiPlayed = computed(() =>
    buildSolidWordStyle('var(--desktop-romaji-played-color)', PREVIEW_WORD_OUTLINE),
  );
  const romajiActive = computed(() =>
    buildGradientWordStyle('var(--desktop-romaji-played-color)', 'var(--desktop-romaji-unplayed-color)', PREVIEW_WORD_OUTLINE),
  );
  const romajiUnplayed = computed(() =>
    buildSolidWordStyle('var(--desktop-romaji-unplayed-color)', PREVIEW_WORD_OUTLINE),
  );

  /* ---------- 选择态 ---------- */

  const fontChoices = computed(() => [
    ...buildImportedLyricsFontOptions(settings.value.customLyricsFonts),
    ...LYRICS_FONT_OPTIONS,
    ...systemLyricsFontOptions.value,
  ]);

  const matchedFont = computed(() =>
    fontChoices.value.find((choice) => choice.value === draft.value.playerFontPreset),
  );
  const activeFontLabel = computed(
    () => matchedFont.value?.label ?? normalizeLyricsFontPreset(draft.value.playerFontPreset),
  );
  const activeFontFamily = computed(
    () => matchedFont.value?.fontFamily ?? getLyricsFontFamily(draft.value.playerFontPreset),
  );

  const selectedColorScheme = computed(
    () => SCHEME_CHOICES.find((choice) => choice.value === draft.value.colorScheme) ?? SCHEME_CHOICES[0],
  );

  const isCustomShadowColor = computed(
    () => !SHADOW_SWATCHES.some((swatch) => swatch.value === draft.value.textShadowColor),
  );

  /* ---------- 明暗主题跟踪（预览卡配色切换用） ---------- */

  const isDarkTheme = ref(document.documentElement.classList.contains('dark'));
  const previewTheme = computed<'dark' | 'light'>(() => (isDarkTheme.value ? 'dark' : 'light'));

  let themeWatcher: MutationObserver | null = null;

  onMounted(() => {
    isDarkTheme.value = document.documentElement.classList.contains('dark');
    themeWatcher = new MutationObserver(() => {
      isDarkTheme.value = document.documentElement.classList.contains('dark');
    });
    themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  });

  onUnmounted(() => {
    themeWatcher?.disconnect();
    themeWatcher = null;
  });

  return {
    draft,
    lyricsSettings,
    desktopLyricsSettings,
    fontChoices,
    activeFontLabel,
    activeFontFamily,
    selectedColorScheme,
    isCustomShadowColor,
    previewTheme,
    previewPlayerVars,
    previewAlignClass,
    previewWidgetVars,
    wordPlayed,
    wordActive,
    wordUnplayed,
    romajiPlayed,
    romajiActive,
    romajiUnplayed,
    restoreDefaults,
    applyShadowStrength,
    applyShadowColor,
    applyAlignment,
    applyFontPreset,
    applyScheme,
    applyCustomColor,
    readCustomColor,
  };
}
