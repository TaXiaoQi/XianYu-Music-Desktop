import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { mergeAppSettings, useSettingsStore } from './store';
import type { EqualizerSettings } from '../../types';

const partialEq = (patch: Partial<EqualizerSettings>) => patch as EqualizerSettings;

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('uses system language by default and validates persisted app languages', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.language).toBe('system');
    expect(mergeAppSettings(settingsStore.settings, { language: 'en-US' }).language).toBe('en-US');
    expect(mergeAppSettings(settingsStore.settings, { language: 'system' }).language).toBe('system');
    expect(mergeAppSettings(settingsStore.settings, {
      language: 'fr-FR' as unknown as 'zh-CN',
    }).language).toBe('system');
  });

  it('enables sleep prevention by default and preserves an explicit disabled value', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.preventSleepWhilePlaying).toBe(true);

    const merged = mergeAppSettings(settingsStore.settings, {
      preventSleepWhilePlaying: false,
    });
    expect(merged.preventSleepWhilePlaying).toBe(false);
  });

  it('patches theme settings without losing nested custom background fields', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchTheme({
      mode: 'custom',
      customBackground: {
        imagePath: '/covers/demo.jpg',
        blur: 32,
      },
    });

    expect(settingsStore.theme.mode).toBe('custom');
    expect(settingsStore.theme.customBackground.imagePath).toBe('/covers/demo.jpg');
    expect(settingsStore.theme.customBackground.blur).toBe(32);
    expect(settingsStore.theme.customBackground.maskColor).toBe('#000000');
  });

  it('normalizes theme colors and rejects invalid persisted values', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchTheme({ accentColor: '#3b82f6' });
    expect(settingsStore.theme.accentColor).toBe('#3B82F6');

    settingsStore.patchTheme({ accentColor: 'not-a-color' });
    expect(settingsStore.theme.accentColor).toBe('#3B82F6');
  });

  it('stores the player detail cover behavior and last in-page choice', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.theme.playerDetailCoverBehavior).toBe('remember');
    expect(settingsStore.theme.lastPlayerDetailCoverVisible).toBe(true);
    settingsStore.patchTheme({
      playerDetailCoverBehavior: 'show',
      lastPlayerDetailCoverVisible: false,
    });
    expect(settingsStore.theme.playerDetailCoverBehavior).toBe('show');
    expect(settingsStore.theme.lastPlayerDetailCoverVisible).toBe(false);

    settingsStore.patchTheme({
      playerDetailCoverBehavior: 'invalid' as 'remember',
      lastPlayerDetailCoverVisible: 'invalid' as unknown as boolean,
    });
    expect(settingsStore.theme.playerDetailCoverBehavior).toBe('show');
    expect(settingsStore.theme.lastPlayerDetailCoverVisible).toBe(false);
  });

  it('migrates the previous player detail cover boolean', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchTheme({
      showPlayerDetailCoverByDefault: false,
    } as Parameters<typeof settingsStore.patchTheme>[0]);

    expect(settingsStore.theme.playerDetailCoverBehavior).toBe('hide');
  });

  it('stores the player detail style with normalization', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.theme.playerDetailStyle).toBe('classic');
    settingsStore.patchTheme({ playerDetailStyle: 'vinyl' });
    expect(settingsStore.theme.playerDetailStyle).toBe('vinyl');

    settingsStore.patchTheme({ playerDetailStyle: 'invalid' as 'classic' });
    expect(settingsStore.theme.playerDetailStyle).toBe('vinyl');
  });

  it('stores the polygon mesh flow speed multiplier', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.theme.playerDetailMeshSpeed).toBe(1);
    settingsStore.patchTheme({ playerDetailMeshSpeed: 2.5 });
    expect(settingsStore.theme.playerDetailMeshSpeed).toBe(2.5);

    // 0 表示静止，是合法取值（渲染侧只做夹取，不排除 0）
    settingsStore.patchTheme({ playerDetailMeshSpeed: 0 });
    expect(settingsStore.theme.playerDetailMeshSpeed).toBe(0);
  });

  it('stores the polygon mesh anti-aliasing flag with normalization', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.theme.playerDetailMeshAntiAlias).toBe(true);
    settingsStore.patchTheme({ playerDetailMeshAntiAlias: false });
    expect(settingsStore.theme.playerDetailMeshAntiAlias).toBe(false);

    settingsStore.patchTheme({ playerDetailMeshAntiAlias: 'yes' as unknown as boolean });
    expect(settingsStore.theme.playerDetailMeshAntiAlias).toBe(false);
  });
  it('replaces theme through the settings domain instead of mutating ui state', () => {
    const settingsStore = useSettingsStore();

    settingsStore.replaceTheme({
      mode: 'dark',
      dynamicBgType: 'blur',
      windowMaterial: 'mica',
      flowColorBoost: 62,
      flowDepth: 54,
      flowSpeed: 48,
      flowTexture: 28,
      windowBlurTint: 50,
      customBgPath: '',
      opacity: 0.75,
      blur: 18,
      customBackground: {
        imagePath: '/covers/fallback.jpg',
        blur: 24,
        opacity: 0.85,
        maskColor: '#101010',
        maskAlpha: 0.45,
        scale: 1.08,
        foregroundStyle: 'light',
      },
    });

    expect(settingsStore.settings.theme.windowMaterial).toBe('mica');
    expect(settingsStore.settings.theme.customBackground.foregroundStyle).toBe('light');
  });

  it('normalizes legacy auto foreground style to light', () => {
    const settingsStore = useSettingsStore();

    settingsStore.replaceTheme({
      mode: 'custom',
      dynamicBgType: 'none',
      windowMaterial: 'none',
      flowColorBoost: 25,
      flowDepth: 30,
      flowSpeed: 52,
      flowTexture: 34,
      windowBlurTint: 50,
      customBgPath: '',
      opacity: 0.8,
      blur: 20,
      customBackground: {
        imagePath: '/covers/legacy.jpg',
        blur: 20,
        opacity: 1,
        maskColor: '#000000',
        maskAlpha: 0.4,
        scale: 1,
        foregroundStyle: 'auto' as unknown as 'light',
      },
    });

    expect(settingsStore.settings.theme.customBackground.foregroundStyle).toBe('light');
  });

  it('merges shortcut settings without dropping untouched bindings', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchSettings({
      shortcuts: {
        enabled: false,
        local: {
          togglePlay: {
            code: 'Enter',
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
          },
        },
      },
    });

    expect(settingsStore.settings.shortcuts.enabled).toBe(false);
    expect(settingsStore.settings.shortcuts.local.togglePlay?.code).toBe('Enter');
    expect(settingsStore.settings.shortcuts.local.nextSong?.code).toBe('ArrowRight');
    expect(settingsStore.settings.shortcuts.global.togglePlay?.code).toBe('KeyP');
  });

  it('ignores deprecated minimizeToTray when merging persisted settings', () => {
    const settingsStore = useSettingsStore();

    const merged = mergeAppSettings(settingsStore.settings, {
      minimizeToTray: true,
      closeToTray: true,
    });

    expect(merged.closeToTray).toBe(true);
    expect('minimizeToTray' in merged).toBe(false);
  });

  it('enables the scroll to top button by default', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.enableScrollToTopButton).toBe(true);
  });

  it('shows song comments by default', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.showSongComments).toBe(true);
  });

  it('minimizes to tray on close by default', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.closeToTray).toBe(true);
  });

  it('uses safe logging defaults and normalizes persisted log settings', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.logging).toEqual({
      minimumLevel: 'info',
      retentionDays: 1,
      autoAnalyze: true,
    });

    const merged = mergeAppSettings(settingsStore.settings, {
      logging: {
        minimumLevel: 'error',
        retentionDays: 999,
        autoAnalyze: false,
      },
    });

    expect(merged.logging).toEqual({
      minimumLevel: 'error',
      retentionDays: 1,
      autoAnalyze: false,
    });
  });

  it('disables short audio exclusion by default and preserves persisted threshold', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.libraryMinDurationSeconds).toBe(0);

    const merged = mergeAppSettings(settingsStore.settings, {
      libraryMinDurationSeconds: 12,
    });

    expect(merged.libraryMinDurationSeconds).toBe(12);
  });

  it('normalizes invalid short audio thresholds to disabled', () => {
    const settingsStore = useSettingsStore();

    const merged = mergeAppSettings(settingsStore.settings, {
      libraryMinDurationSeconds: -5,
    });

    expect(merged.libraryMinDurationSeconds).toBe(0);
  });

  it('remembers whether desktop lyrics were open', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.showDesktopLyrics).toBe(false);

    const merged = mergeAppSettings(settingsStore.settings, {
      showDesktopLyrics: true,
    });

    expect(merged.showDesktopLyrics).toBe(true);
  });

  it('uses shared audio output by default and preserves persisted output mode', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.audio.outputMode).toBe('shared');
    expect(settingsStore.settings.audio.volumeBalance.gainOffsetDb).toBe(0);

    const merged = mergeAppSettings(settingsStore.settings, {
      audio: {
        outputMode: 'wasapiExclusive',
      },
    });

    expect(merged.audio.outputMode).toBe('wasapiExclusive');
  });

  it('migrates legacy target LUFS volume balance settings to gain offset dB', () => {
    const settingsStore = useSettingsStore();

    const merged = mergeAppSettings(settingsStore.settings, {
      audio: {
        volumeBalance: {
          enabled: true,
          targetLufs: -14,
          preventClipping: false,
        },
      },
    });

    expect(merged.audio.volumeBalance).toEqual({
      enabled: true,
      gainOffsetDb: 4,
      preventClipping: false,
    });
  });

  it('merges lyrics settings without dropping untouched display preferences', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchSettings({
      lyrics: {
        showRomaji: true,
        playerOffsetX: 999,
      },
    });

    expect(settingsStore.settings.lyrics.showTranslation).toBe(true);
    expect(settingsStore.settings.lyrics.showRomaji).toBe(true);
    expect(settingsStore.settings.lyrics.playerOffsetX).toBe(30);
  });

  it('uses AMLL as the default player lyrics render mode', () => {
    const settingsStore = useSettingsStore();

    expect(settingsStore.settings.lyrics.playerRenderMode).toBe('amll');
  });

  it('preserves a persisted light player lyrics render mode', () => {
    const settingsStore = useSettingsStore();

    const merged = mergeAppSettings(settingsStore.settings, {
      lyrics: {
        playerRenderMode: 'light',
      },
    });

    expect(merged.lyrics.playerRenderMode).toBe('light');
  });

  it('normalizes invalid player lyrics render modes to AMLL', () => {
    const settingsStore = useSettingsStore();

    const merged = mergeAppSettings(settingsStore.settings, {
      lyrics: {
        playerRenderMode: 'canvas' as unknown as 'amll',
      },
    });

    expect(merged.lyrics.playerRenderMode).toBe('amll');
  });

  it('merges desktop lyrics settings while keeping the desktop defaults intact', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchSettings({
      desktopLyrics: {
        autoHideWhenFullscreen: false,
        colorScheme: 'pink',
      },
    });

    expect(settingsStore.settings.desktopLyrics.autoHideWhenFullscreen).toBe(false);
    expect(settingsStore.settings.desktopLyrics.colorScheme).toBe('pink');
    expect(settingsStore.settings.desktopLyrics.playerAlignment).toBe('split-corners');
  });

  it('merges desktop romaji played and unplayed custom colors independently', () => {
    const settingsStore = useSettingsStore();

    settingsStore.patchSettings({
      desktopLyrics: {
        customRomajiPlayedColor: '#123456',
        customRomajiUnplayedColor: '#ABCDEF',
      },
    });

    expect(settingsStore.settings.desktopLyrics.customRomajiPlayedColor).toBe('#123456');
    expect(settingsStore.settings.desktopLyrics.customRomajiUnplayedColor).toBe('#ABCDEF');
  });

  it('preserves outputMode when patching only equalizer', () => {
    const store = useSettingsStore();

    store.patchSettings({
      audio: {
        outputMode: 'wasapiExclusive',
      },
    });

    store.patchSettings({
      audio: {
        equalizer: {
          currentPresetId: 'preset_1',
        } as unknown as import('../../types').EqualizerSettings,
      },
    });

    expect(store.settings.audio.outputMode).toBe('wasapiExclusive');
  });

  it('save/load/delete preset preserve wasapiExclusive output mode', () => {
    const store = useSettingsStore();

    store.patchSettings({
      audio: {
        outputMode: 'wasapiExclusive',
      },
    });

    const preset = store.saveEqualizerPreset('Custom');
    expect(store.settings.audio.outputMode).toBe('wasapiExclusive');

    store.loadEqualizerPreset(preset.id);
    expect(store.settings.audio.outputMode).toBe('wasapiExclusive');

    store.deleteEqualizerPreset(preset.id);
    expect(store.settings.audio.outputMode).toBe('wasapiExclusive');
  });

  // ============================================================
  // ============================================================

  it('preserves outputMode through multiple sequential equalizer patches', () => {
    const store = useSettingsStore();

    store.patchSettings({
      audio: {
        outputMode: 'wasapiExclusive',
        equalizer: partialEq({ enabled: true, preamp: 0, gains: Array(10).fill(0) }),
      },
    });

    store.patchSettings({
      audio: { equalizer: partialEq({ preamp: -3 }) },
    });
    store.patchSettings({
      audio: { equalizer: partialEq({ gains: [1, 2, 3, 4, 5, 5, 4, 3, 2, 1] }) },
    });
    store.patchSettings({
      audio: { equalizer: partialEq({ enabled: false }) },
    });

    expect(store.settings.audio.outputMode).toBe('wasapiExclusive');
  });

  it('preserves volumeBalance when patching only equalizer gains', () => {
    const store = useSettingsStore();

    store.patchSettings({
      audio: {
        volumeBalance: { enabled: true, gainOffsetDb: 5, preventClipping: true },
      },
    });

    store.patchSettings({
      audio: {
        equalizer: partialEq({ gains: [1, 2, 3, 4, 5, 5, 4, 3, 2, 1] }),
      },
    });

    expect(store.settings.audio.volumeBalance).toEqual({
      enabled: true,
      gainOffsetDb: 5,
      preventClipping: true,
    });
  });

  it('handles rapid save-delete-save preset operations', () => {
    const store = useSettingsStore();

    store.patchSettings({
      audio: { outputMode: 'wasapiExclusive' },
    });

    const preset1 = store.saveEqualizerPreset('Preset 1');
    const preset2 = store.saveEqualizerPreset('Preset 2');
    const preset3 = store.saveEqualizerPreset('Preset 3');

    store.deleteEqualizerPreset(preset2.id);
    store.deleteEqualizerPreset(preset1.id);

    const preset4 = store.saveEqualizerPreset('Preset 4');

    expect(store.userPresets).toHaveLength(2);
    expect(store.userPresets.map(p => p.id)).toContain(preset3.id);
    expect(store.userPresets.map(p => p.id)).toContain(preset4.id);
    expect(store.settings.audio.outputMode).toBe('wasapiExclusive');
  });

  it('handles preset operations with extreme gain values', () => {
    const store = useSettingsStore();

    store.patchSettings({
      audio: {
        equalizer: partialEq({
          preamp: -12,
          gains: [-12, -12, -12, -12, -12, 12, 12, 12, 12, 12],
        }),
      },
    });

    const preset = store.saveEqualizerPreset('Extreme');
    expect(preset.gains).toEqual([-12, -12, -12, -12, -12, 12, 12, 12, 12, 12]);
    expect(preset.preamp).toBe(-12);

    store.patchSettings({
      audio: { equalizer: partialEq({ gains: Array(10).fill(0), preamp: 0 }) },
    });
    store.loadEqualizerPreset(preset.id);
    expect(store.settings.audio.equalizer.gains).toEqual([-12, -12, -12, -12, -12, 12, 12, 12, 12, 12]);
    expect(store.settings.audio.equalizer.preamp).toBe(-12);
  });

  it('handles preset operations with decimal gain values', () => {
    const store = useSettingsStore();

    store.patchSettings({
      audio: {
        equalizer: partialEq({
          preamp: -3.5,
          gains: [1.5, 2.5, -0.5, 3.75, -1.25, 0, 4.5, -2.75, 1.125, -0.875],
        }),
      },
    });

    const preset = store.saveEqualizerPreset('Decimal');
    expect(preset.gains).toEqual([1.5, 2.5, -0.5, 3.75, -1.25, 0, 4.5, -2.75, 1.125, -0.875]);

    store.loadEqualizerPreset(preset.id);
    expect(store.settings.audio.equalizer.gains).toEqual([1.5, 2.5, -0.5, 3.75, -1.25, 0, 4.5, -2.75, 1.125, -0.875]);
  });

  it('preserves showEqualizerInFooter through equalizer patches', () => {
    const store = useSettingsStore();

    store.patchSettings({
      audio: { showEqualizerInFooter: false },
    });

    store.patchSettings({
      audio: {
        equalizer: partialEq({ enabled: true, gains: Array(10).fill(5) }),
      },
    });

    expect(store.settings.audio.showEqualizerInFooter).toBe(false);
  });

  it('handles loading preset after manual equalizer adjustments', () => {
    const store = useSettingsStore();

    const preset = store.saveEqualizerPreset('Initial');

    store.patchSettings({
      audio: {
        equalizer: partialEq({
          preamp: -6,
          gains: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
          currentPresetId: null,
        }),
      },
    });

    expect(store.settings.audio.equalizer.preamp).toBe(-6);
    expect(store.settings.audio.equalizer.currentPresetId).toBeNull();

    store.loadEqualizerPreset(preset.id);
    expect(store.settings.audio.equalizer.preamp).toBe(0);
    expect(store.settings.audio.equalizer.gains).toEqual(Array(10).fill(0));
    expect(store.settings.audio.equalizer.currentPresetId).toBe(preset.id);
  });

  it('deleting non-current preset does not affect current equalizer state', () => {
    const store = useSettingsStore();

    const preset1 = store.saveEqualizerPreset('Preset 1');
    const preset2 = store.saveEqualizerPreset('Preset 2');

    store.loadEqualizerPreset(preset2.id);

    store.deleteEqualizerPreset(preset1.id);

    expect(store.settings.audio.equalizer.currentPresetId).toBe(preset2.id);
    expect(store.settings.audio.equalizer.enabled).toBe(true);
  });

  it('handles save preset with special characters in name', () => {
    const store = useSettingsStore();

    const preset1 = store.saveEqualizerPreset('摇滚 & Bass');
    const preset2 = store.saveEqualizerPreset('预设 <1>');
    const preset3 = store.saveEqualizerPreset('Test "Quote"');

    expect(preset1.name).toBe('摇滚 & Bass');
    expect(preset2.name).toBe('预设 <1>');
    expect(preset3.name).toBe('Test "Quote"');

    expect(store.userPresets).toHaveLength(3);
  });

  it('handles save preset with empty name', () => {
    const store = useSettingsStore();

    const preset = store.saveEqualizerPreset('');
    expect(preset.name).toBe('');
    expect(store.userPresets).toHaveLength(1);
  });

  it('preset gains are independent copies - modifying one does not affect others', () => {
    const store = useSettingsStore();

    store.patchSettings({
      audio: { equalizer: partialEq({ gains: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }) },
    });
    const preset1 = store.saveEqualizerPreset('P1');

    store.patchSettings({
      audio: { equalizer: partialEq({ gains: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2] }) },
    });
    const preset2 = store.saveEqualizerPreset('P2');

    expect(preset1.gains).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(preset2.gains).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);

    store.loadEqualizerPreset(preset1.id);
    expect(store.settings.audio.equalizer.gains).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('updateEqualizerPreset captures current settings at update time', () => {
    const store = useSettingsStore();

    store.patchSettings({
      audio: { equalizer: partialEq({ preamp: 0, gains: Array(10).fill(0) }) },
    });
    const preset = store.saveEqualizerPreset('Original');

    store.patchSettings({
      audio: { equalizer: partialEq({ preamp: -5, gains: [5, 4, 3, 2, 1, -1, -2, -3, -4, -5] }) },
    });
    store.updateEqualizerPreset(preset.id, 'Updated');

    store.patchSettings({ audio: { equalizer: partialEq({ preamp: 0, gains: Array(10).fill(0) }) } });
    store.loadEqualizerPreset(preset.id);

    expect(store.settings.audio.equalizer.preamp).toBe(-5);
    expect(store.settings.audio.equalizer.gains).toEqual([5, 4, 3, 2, 1, -1, -2, -3, -4, -5]);
  });

  it('outputMode resets correctly from wasapiExclusive to shared', () => {
    const store = useSettingsStore();

    store.patchSettings({
      audio: { outputMode: 'wasapiExclusive' },
    });
    expect(store.settings.audio.outputMode).toBe('wasapiExclusive');

    store.patchSettings({
      audio: { outputMode: 'shared' },
    });
    expect(store.settings.audio.outputMode).toBe('shared');
  });

  it('mergeAudioSettings handles undefined patch gracefully', () => {
    const store = useSettingsStore();

    store.patchSettings({
      audio: {
        outputMode: 'wasapiExclusive',
        equalizer: partialEq({ enabled: true, preamp: -3, gains: Array(10).fill(5) }),
      },
    });

    const before = { ...store.settings.audio };
    store.patchSettings({ audio: {} });
    const after = store.settings.audio;

    expect(after.outputMode).toBe(before.outputMode);
    expect(after.equalizer.enabled).toBe(before.equalizer.enabled);
    expect(after.equalizer.preamp).toBe(before.equalizer.preamp);
    expect(after.equalizer.gains).toEqual(before.equalizer.gains);
  });

  it('resetSettings clears all equalizer state including custom presets', () => {
    const store = useSettingsStore();

    store.patchSettings({ audio: { outputMode: 'wasapiExclusive' } });
    store.saveEqualizerPreset('Custom 1');
    store.saveEqualizerPreset('Custom 2');

    store.resetSettings();

    expect(store.settings.audio.outputMode).toBe('shared');
    expect(store.settings.audio.equalizer.enabled).toBe(false);
    expect(store.settings.audio.equalizer.preamp).toBe(0);
    expect(store.settings.audio.equalizer.gains).toEqual(Array(10).fill(0));
  });
});
