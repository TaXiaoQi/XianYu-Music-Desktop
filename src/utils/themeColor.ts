export const DEFAULT_THEME_COLOR = '#EC4141';

const HEX_COLOR_PATTERN = /^#?([0-9a-f]{6})$/i;

export function normalizeThemeColor(value: unknown, fallback = DEFAULT_THEME_COLOR): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const match = value.trim().match(HEX_COLOR_PATTERN);
  return match ? `#${match[1].toUpperCase()}` : fallback;
}

export function themeColorToRgb(value: unknown): string {
  const color = normalizeThemeColor(value);
  return [1, 3, 5]
    .map(offset => Number.parseInt(color.slice(offset, offset + 2), 16))
    .join(' ');
}

export function applyThemeColorToDocument(value: unknown): string {
  const color = normalizeThemeColor(value);
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--theme-color', color);
    document.documentElement.style.setProperty('--theme-color-rgb', themeColorToRgb(color));
  }
  return color;
}
