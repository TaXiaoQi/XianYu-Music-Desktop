import { normalizeHexColor, type LyricsColorScheme } from '../../composables/lyrics';

export interface DesktopLyricsPreviewSettings {
  colorScheme: LyricsColorScheme;
  customPlayedColor: string;
  customUnplayedColor: string;
  customRomajiPlayedColor: string;
  customRomajiUnplayedColor: string;
  customTranslationColor: string;
  textOpacity: number;
  textShadowColor: string;
  firstLineTextShadowStrength: number;
  secondLineTextShadowStrength: number;
  playerAlignment: string;
}

export const PREVIEW_FIXED_PALETTES = {
  auto: ['#8ec5ff', '#ff8cab', '#88f3c2', '#ffe07d'],
  default: ['#EC4141', '#ff8364', '#f7b267', '#ffd166'],
  pink: ['#f472b6', '#fb7185', '#f9a8d4', '#fbcfe8'],
  blue: ['#60a5fa', '#38bdf8', '#93c5fd', '#bfdbfe'],
  green: ['#34d399', '#22c55e', '#6ee7b7', '#bbf7d0'],
  white: ['#ffffff', '#f3f4f6', '#d1d5db', '#9ca3af'],
} as const;

export function hexToRgbTriplet(value: string) {
  const normalized = normalizeHexColor(value, '#000000');
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(normalized);
  if (!match) return '0 0 0';

  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16),
  ].join(' ');
}

export const resolvePreviewPalette = (settings: DesktopLyricsPreviewSettings) => {
  if (settings.colorScheme === 'custom') {
    return [
      settings.customPlayedColor,
      settings.customPlayedColor,
      settings.customPlayedColor,
      settings.customUnplayedColor,
    ];
  }

  return PREVIEW_FIXED_PALETTES[settings.colorScheme] || PREVIEW_FIXED_PALETTES.default;
};

export const buildDesktopLyricsPreviewWidgetStyle = (
  settings: DesktopLyricsPreviewSettings,
  options: {
    enableTextOutline: boolean;
    textOutlineWidth: number;
    textOutlineColor: string;
  },
): Record<string, string> => {
  const isCustom = settings.colorScheme === 'custom';
  const palette = resolvePreviewPalette(settings);
  const opacityPercent = `calc(var(--desktop-text-opacity, 1) * 100%)`;
  const wrap = (color: string) => `color-mix(in srgb, ${color} ${opacityPercent}, transparent)`;

  return {
    '--desktop-accent-a': wrap(palette[0]),
    '--desktop-accent-b': wrap(palette[1]),
    '--desktop-accent-c': wrap(palette[2]),
    '--desktop-accent-d': wrap(palette[3]),
    '--desktop-lyric-solid-color': isCustom
      ? wrap(settings.customPlayedColor)
      : 'var(--desktop-accent-a)',
    '--desktop-text-primary': isCustom
      ? wrap(settings.customUnplayedColor)
      : wrap('rgba(255, 255, 255, 0.98)'),
    '--desktop-romaji-color': isCustom
      ? wrap(settings.customRomajiUnplayedColor)
      : `color-mix(in srgb, var(--desktop-accent-d) 42%, ${wrap('rgba(255, 255, 255, 0.88)')})`,
    '--desktop-romaji-played-color': isCustom
      ? wrap(settings.customRomajiPlayedColor)
      : 'color-mix(in srgb, var(--desktop-accent-b) 58%, var(--desktop-romaji-color))',
    '--desktop-romaji-unplayed-color': isCustom
      ? wrap(settings.customRomajiUnplayedColor)
      : 'var(--desktop-romaji-color)',
    '--desktop-translation-color': isCustom
      ? wrap(settings.customTranslationColor)
      : `color-mix(in srgb, var(--desktop-accent-c) 28%, ${wrap('rgba(255, 255, 255, 0.76)')})`,
    '--desktop-text-opacity': settings.textOpacity.toString(),
    '--desktop-text-shadow-color': hexToRgbTriplet(settings.textShadowColor),
    '--desktop-text-outline-width': options.enableTextOutline ? `${options.textOutlineWidth}px` : '0px',
    '--desktop-text-outline-color': options.textOutlineColor,
    '--desktop-first-line-text-shadow-alpha': (settings.firstLineTextShadowStrength / 100).toString(),
    '--desktop-first-line-text-shadow-blur': `${Math.round(settings.firstLineTextShadowStrength * 0.24)}px`,
    '--desktop-second-line-text-shadow-alpha': (settings.secondLineTextShadowStrength / 100).toString(),
    '--desktop-second-line-text-shadow-blur': `${Math.round(settings.secondLineTextShadowStrength * 0.24)}px`,
    textAlign: settings.playerAlignment === 'right'
      ? 'right'
      : settings.playerAlignment === 'left'
        ? 'left'
        : 'center',
  };
};

export const buildSolidWordStyle = (color: string, stroke: string) => ({
  color,
  textShadow: 'none',
  WebkitTextStroke: stroke,
  paintOrder: 'fill stroke',
});

export const buildGradientWordStyle = (
  playedColor: string,
  unplayedColor: string,
  stroke: string,
) => ({
  backgroundImage: `linear-gradient(90deg, ${playedColor} 0%, ${playedColor} 50%, ${unplayedColor} 50%, ${unplayedColor} 100%)`,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  WebkitTextFillColor: 'transparent',
  textShadow: 'none',
  WebkitTextStroke: stroke,
  paintOrder: 'fill stroke',
});
