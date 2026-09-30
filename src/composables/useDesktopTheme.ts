import { computed, watch } from 'vue';
import { useThemeSettings } from './useThemeSettings';
import type { DesktopThemeVisuals } from '../types';

type ThemeAssetKind = 'icons' | 'stickers';

const cssName = (slot: string) => slot.replace(/[^a-z0-9-]/gi, '-');

export function applyDesktopThemeCssVariables(theme: DesktopThemeVisuals) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const radius = theme.quickEntryShape === 'circle'
    ? '9999px'
    : theme.quickEntryShape === 'square' ? '6px' : '14px';
  root.style.setProperty('--desktop-quick-entry-radius', radius);
  for (const [slot, surface] of Object.entries(theme.surfaces)) {
    root.style.setProperty(`--desktop-surface-${cssName(slot)}`, `color-mix(in srgb, ${surface.color} ${Math.round(surface.opacity * 100)}%, transparent)`);
  }
}

export function useDesktopTheme() {
  const { theme } = useThemeSettings();
  const desktopTheme = computed(() => theme.value.desktopTheme);
  const asset = (kind: ThemeAssetKind, slot: string) => desktopTheme.value[kind][slot] ?? '';
  const icon = (slot: string) => asset('icons', slot);
  const sticker = (slot: string) => asset('stickers', slot);
  const surfaceStyle = (slot: string) => {
    const surface = desktopTheme.value.surfaces[slot];
    return surface ? { backgroundColor: `color-mix(in srgb, ${surface.color} ${Math.round(surface.opacity * 100)}%, transparent)` } : undefined;
  };

  watch(desktopTheme, value => applyDesktopThemeCssVariables(value), { deep: true, immediate: true });

  return { desktopTheme, icon, sticker, surfaceStyle };
}
