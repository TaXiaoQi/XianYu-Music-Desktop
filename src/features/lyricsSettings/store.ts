import { computed } from 'vue';
import { defineStore } from 'pinia';

import type { DesktopLyricsSettings, LyricsSettings } from '../../types';
import { useSettingsStore } from '../settings/store';

export interface LyricsSettingsPatch extends Partial<LyricsSettings> {}

export interface DesktopLyricsSettingsPatch extends Partial<DesktopLyricsSettings> {}

export const useLyricsSettingsStore = defineStore('lyrics-settings', () => {
  const settingsStore = useSettingsStore();

  const lyricsSettings = computed(() => settingsStore.settings.lyrics);
  const desktopLyricsSettings = computed(() => settingsStore.settings.desktopLyrics);

  const patchLyricsSettings = (patch: LyricsSettingsPatch) => {
    settingsStore.patchSettings({
      lyrics: patch,
    });
  };

  const patchDesktopLyricsSettings = (patch: DesktopLyricsSettingsPatch) => {
    settingsStore.patchSettings({
      desktopLyrics: patch,
    });
  };

  const replaceLyricsSettings = (settings: LyricsSettings) => {
    settingsStore.patchSettings({
      lyrics: settings,
    });
  };

  const replaceDesktopLyricsSettings = (settings: DesktopLyricsSettings) => {
    settingsStore.patchSettings({
      desktopLyrics: settings,
    });
  };

  return {
    lyricsSettings,
    desktopLyricsSettings,
    patchLyricsSettings,
    patchDesktopLyricsSettings,
    replaceLyricsSettings,
    replaceDesktopLyricsSettings,
  };
});
