import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { EqualizerSettings } from '../../types';
import { mergeAppSettings, useSettingsStore } from './store';

type SettingsStore = ReturnType<typeof useSettingsStore>;

const bootPinia = () => setActivePinia(createPinia());
const freshStore = (): SettingsStore => useSettingsStore();

// 持久化数据里的均衡器字段允许缺省，测试中统一宽化后喂给补丁入口
const widenEq = (patch: Partial<EqualizerSettings>) => patch as EqualizerSettings;

const patchEqualizer = (store: SettingsStore, patch: Partial<EqualizerSettings>) => {
  store.patchSettings({ audio: { equalizer: widenEq(patch) } });
};

describe('settings store', () => {
  beforeEach(bootPinia);

  describe('defaults and persisted-value normalization', () => {
    it('starts with the system language and only accepts known app languages', () => {
      const store = freshStore();

      expect(store.settings.language).toBe('system');
      expect(mergeAppSettings(store.settings, { language: 'en-US' }).language).toBe('en-US');
      expect(mergeAppSettings(store.settings, { language: 'system' }).language).toBe('system');
      expect(mergeAppSettings(store.settings, {
        language: 'fr-FR' as unknown as 'zh-CN',
      }).language).toBe('system');
    });

    it('keeps sleep prevention on unless persisted data explicitly disabled it', () => {
      const store = freshStore();

      expect(store.settings.preventSleepWhilePlaying).toBe(true);

      const merged = mergeAppSettings(store.settings, {
        preventSleepWhilePlaying: false,
      });
      expect(merged.preventSleepWhilePlaying).toBe(false);
    });

    it('ships safe logging defaults and clamps the persisted retention window', () => {
      const store = freshStore();

      expect(store.settings.logging).toEqual({
        minimumLevel: 'info',
        retentionDays: 1,
        autoAnalyze: true,
      });

      const merged = mergeAppSettings(store.settings, {
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

    it('treats negative short-audio thresholds as the feature being off', () => {
      const store = freshStore();

      expect(store.settings.libraryMinDurationSeconds).toBe(0);

      const mergedPositive = mergeAppSettings(store.settings, {
        libraryMinDurationSeconds: 12,
      });
      expect(mergedPositive.libraryMinDurationSeconds).toBe(12);

      const mergedNegative = mergeAppSettings(store.settings, {
        libraryMinDurationSeconds: -5,
      });
      expect(mergedNegative.libraryMinDurationSeconds).toBe(0);
    });

    it('remembers whether desktop lyrics were open', () => {
      const store = freshStore();

      expect(store.settings.showDesktopLyrics).toBe(false);

      const merged = mergeAppSettings(store.settings, {
        showDesktopLyrics: true,
      });

      expect(merged.showDesktopLyrics).toBe(true);
    });

    it('enables the scroll-to-top button, song comments and tray-minimize by default', () => {
      const store = freshStore();

      expect(store.settings.enableScrollToTopButton).toBe(true);
      expect(store.settings.showSongComments).toBe(true);
      expect(store.settings.closeToTray).toBe(true);
    });

    it('drops the deprecated minimizeToTray flag while merging', () => {
      const store = freshStore();

      const merged = mergeAppSettings(store.settings, {
        minimizeToTray: true,
        closeToTray: true,
      });

      expect(merged.closeToTray).toBe(true);
      expect('minimizeToTray' in merged).toBe(false);
    });
  });

  describe('theme settings', () => {
    it('keeps nested custom background fields when patching the theme', () => {
      const store = freshStore();

      store.patchTheme({
        mode: 'custom',
        customBackground: {
          imagePath: '/covers/demo.jpg',
          blur: 32,
        },
      });

      expect(store.theme.mode).toBe('custom');
      expect(store.theme.customBackground.imagePath).toBe('/covers/demo.jpg');
      expect(store.theme.customBackground.blur).toBe(32);
      expect(store.theme.customBackground.maskColor).toBe('#000000');
    });

    it('uppercases valid accent colors and rejects malformed ones', () => {
      const store = freshStore();

      store.patchTheme({ accentColor: '#3b82f6' });
      expect(store.theme.accentColor).toBe('#3B82F6');

      store.patchTheme({ accentColor: 'not-a-color' });
      expect(store.theme.accentColor).toBe('#3B82F6');
    });

    it('tracks the player detail cover behavior and the last in-page choice', () => {
      const store = freshStore();

      expect(store.theme.playerDetailCoverBehavior).toBe('remember');
      expect(store.theme.lastPlayerDetailCoverVisible).toBe(true);
      store.patchTheme({
        playerDetailCoverBehavior: 'show',
        lastPlayerDetailCoverVisible: false,
      });
      expect(store.theme.playerDetailCoverBehavior).toBe('show');
      expect(store.theme.lastPlayerDetailCoverVisible).toBe(false);

      store.patchTheme({
        playerDetailCoverBehavior: 'invalid' as 'remember',
        lastPlayerDetailCoverVisible: 'invalid' as unknown as boolean,
      });
      expect(store.theme.playerDetailCoverBehavior).toBe('show');
      expect(store.theme.lastPlayerDetailCoverVisible).toBe(false);
    });

    it('migrates the legacy player detail cover boolean into hide behavior', () => {
      const store = freshStore();

      store.patchTheme({
        showPlayerDetailCoverByDefault: false,
      } as Parameters<typeof store.patchTheme>[0]);

      expect(store.theme.playerDetailCoverBehavior).toBe('hide');
    });

    it('normalizes player detail style values', () => {
      const store = freshStore();

      expect(store.theme.playerDetailStyle).toBe('classic');
      store.patchTheme({ playerDetailStyle: 'vinyl' });
      expect(store.theme.playerDetailStyle).toBe('vinyl');

      store.patchTheme({ playerDetailStyle: 'invalid' as 'classic' });
      expect(store.theme.playerDetailStyle).toBe('vinyl');
    });

    it('normalizes vinyl plinth material values and ignores unknown ones', () => {
      const store = freshStore();

      expect(store.theme.playerDetailVinylMaterial).toBe('light');
      store.patchTheme({ playerDetailVinylMaterial: 'matte' });
      expect(store.theme.playerDetailVinylMaterial).toBe('matte');
      store.patchTheme({ playerDetailVinylMaterial: 'oak' });
      expect(store.theme.playerDetailVinylMaterial).toBe('oak');

      // 非法值不得写入（回落为上一次的合法值）
      store.patchTheme({ playerDetailVinylMaterial: 'walnut' as 'oak' });
      expect(store.theme.playerDetailVinylMaterial).toBe('oak');
    });

    it('accepts the full polygon mesh speed range including standstill', () => {
      const store = freshStore();

      expect(store.theme.playerDetailMeshSpeed).toBe(1);
      store.patchTheme({ playerDetailMeshSpeed: 2.5 });
      expect(store.theme.playerDetailMeshSpeed).toBe(2.5);

      // 0 表示静止，是合法取值（渲染侧只做夹取，不排除 0）
      store.patchTheme({ playerDetailMeshSpeed: 0 });
      expect(store.theme.playerDetailMeshSpeed).toBe(0);
    });

    it('normalizes the polygon mesh anti-aliasing flag', () => {
      const store = freshStore();

      expect(store.theme.playerDetailMeshAntiAlias).toBe(true);
      store.patchTheme({ playerDetailMeshAntiAlias: false });
      expect(store.theme.playerDetailMeshAntiAlias).toBe(false);

      store.patchTheme({ playerDetailMeshAntiAlias: 'yes' as unknown as boolean });
      expect(store.theme.playerDetailMeshAntiAlias).toBe(false);
    });

    it('routes replaceTheme through the settings domain instead of mutating ui state', () => {
      const store = freshStore();

      store.replaceTheme({
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

      expect(store.settings.theme.windowMaterial).toBe('mica');
      expect(store.settings.theme.customBackground.foregroundStyle).toBe('light');
    });

    it('maps the legacy auto foreground style onto light', () => {
      const store = freshStore();

      store.replaceTheme({
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

      expect(store.settings.theme.customBackground.foregroundStyle).toBe('light');
    });
  });

  describe('shortcuts, lyrics and desktop lyrics domains', () => {
    it('merges shortcut settings without dropping untouched bindings', () => {
      const store = freshStore();

      store.patchSettings({
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

      expect(store.settings.shortcuts.enabled).toBe(false);
      expect(store.settings.shortcuts.local.togglePlay?.code).toBe('Enter');
      expect(store.settings.shortcuts.local.nextSong?.code).toBe('ArrowRight');
      expect(store.settings.shortcuts.global.togglePlay?.code).toBe('KeyP');
    });

    it('merges lyric preferences while keeping untouched display options', () => {
      const store = freshStore();

      store.patchSettings({
        lyrics: {
          showRomaji: true,
          playerOffsetX: 999,
        },
      });

      expect(store.settings.lyrics.showTranslation).toBe(true);
      expect(store.settings.lyrics.showRomaji).toBe(true);
      expect(store.settings.lyrics.playerOffsetX).toBe(30);
    });

    it('defaults the player lyrics renderer to the word-by-word mode and normalizes unknown modes', () => {
      const store = freshStore();

      expect(store.settings.lyrics.playerRenderMode).toBe('amll');

      const mergedLight = mergeAppSettings(store.settings, {
        lyrics: {
          playerRenderMode: 'light',
        },
      });
      expect(mergedLight.lyrics.playerRenderMode).toBe('light');

      const mergedInvalid = mergeAppSettings(store.settings, {
        lyrics: {
          playerRenderMode: 'canvas' as unknown as 'amll',
        },
      });
      expect(mergedInvalid.lyrics.playerRenderMode).toBe('amll');
    });

    it('merges desktop lyrics settings while keeping the desktop defaults intact', () => {
      const store = freshStore();

      store.patchSettings({
        desktopLyrics: {
          autoHideWhenFullscreen: false,
          colorScheme: 'pink',
        },
      });

      expect(store.settings.desktopLyrics.autoHideWhenFullscreen).toBe(false);
      expect(store.settings.desktopLyrics.colorScheme).toBe('pink');
      expect(store.settings.desktopLyrics.playerAlignment).toBe('split-corners');
    });

    it('keeps desktop romaji played and unplayed colors independent', () => {
      const store = freshStore();

      store.patchSettings({
        desktopLyrics: {
          customRomajiPlayedColor: '#123456',
          customRomajiUnplayedColor: '#ABCDEF',
        },
      });

      expect(store.settings.desktopLyrics.customRomajiPlayedColor).toBe('#123456');
      expect(store.settings.desktopLyrics.customRomajiUnplayedColor).toBe('#ABCDEF');
    });
  });

  describe('audio output mode and volume balance', () => {
    it('defaults to shared output with a zero gain offset', () => {
      const store = freshStore();

      expect(store.settings.audio.outputMode).toBe('shared');
      expect(store.settings.audio.volumeBalance.gainOffsetDb).toBe(0);
    });

    it('preserves a persisted exclusive output mode', () => {
      const store = freshStore();

      const merged = mergeAppSettings(store.settings, {
        audio: {
          outputMode: 'wasapiExclusive',
        },
      });

      expect(merged.audio.outputMode).toBe('wasapiExclusive');
    });

    it('switches output modes back and forth through patches', () => {
      const store = freshStore();

      store.patchSettings({
        audio: { outputMode: 'wasapiExclusive' },
      });
      expect(store.settings.audio.outputMode).toBe('wasapiExclusive');

      store.patchSettings({
        audio: { outputMode: 'shared' },
      });
      expect(store.settings.audio.outputMode).toBe('shared');
    });

    it('migrates legacy target LUFS balance settings into gain offset dB', () => {
      const store = freshStore();

      const merged = mergeAppSettings(store.settings, {
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
  });

  describe('equalizer coexistence with other audio settings', () => {
    it('keeps the output mode intact when only the equalizer is patched', () => {
      const store = freshStore();

      store.patchSettings({
        audio: {
          outputMode: 'wasapiExclusive',
        },
      });

      store.patchSettings({
        audio: {
          equalizer: {
            currentPresetId: 'preset_1',
          } as unknown as EqualizerSettings,
        },
      });

      expect(store.settings.audio.outputMode).toBe('wasapiExclusive');
    });

    it('keeps the output mode intact across sequential equalizer patches', () => {
      const store = freshStore();

      store.patchSettings({
        audio: {
          outputMode: 'wasapiExclusive',
          equalizer: widenEq({ enabled: true, preamp: 0, gains: Array(10).fill(0) }),
        },
      });

      patchEqualizer(store, { preamp: -3 });
      patchEqualizer(store, { gains: [1, 2, 3, 4, 5, 5, 4, 3, 2, 1] });
      patchEqualizer(store, { enabled: false });

      expect(store.settings.audio.outputMode).toBe('wasapiExclusive');
    });

    it('keeps the volume balance intact when patching only equalizer gains', () => {
      const store = freshStore();

      store.patchSettings({
        audio: {
          volumeBalance: { enabled: true, gainOffsetDb: 5, preventClipping: true },
        },
      });

      patchEqualizer(store, { gains: [1, 2, 3, 4, 5, 5, 4, 3, 2, 1] });

      expect(store.settings.audio.volumeBalance).toEqual({
        enabled: true,
        gainOffsetDb: 5,
        preventClipping: true,
      });
    });

    it('keeps the footer equalizer toggle intact through equalizer patches', () => {
      const store = freshStore();

      store.patchSettings({
        audio: { showEqualizerInFooter: false },
      });

      patchEqualizer(store, { enabled: true, gains: Array(10).fill(5) });

      expect(store.settings.audio.showEqualizerInFooter).toBe(false);
    });

    it('leaves every audio field untouched when an empty audio patch arrives', () => {
      const store = freshStore();

      store.patchSettings({
        audio: {
          outputMode: 'wasapiExclusive',
          equalizer: widenEq({ enabled: true, preamp: -3, gains: Array(10).fill(5) }),
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
  });

  describe('equalizer presets', () => {
    it('keeps the exclusive output mode through save, load and delete of a preset', () => {
      const store = freshStore();

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

    it('survives rapid save-delete-save preset sequences', () => {
      const store = freshStore();

      store.patchSettings({
        audio: { outputMode: 'wasapiExclusive' },
      });

      const firstPreset = store.saveEqualizerPreset('Preset 1');
      const secondPreset = store.saveEqualizerPreset('Preset 2');
      const thirdPreset = store.saveEqualizerPreset('Preset 3');

      store.deleteEqualizerPreset(secondPreset.id);
      store.deleteEqualizerPreset(firstPreset.id);

      const fourthPreset = store.saveEqualizerPreset('Preset 4');

      expect(store.userPresets).toHaveLength(2);
      expect(store.userPresets.map((preset) => preset.id)).toContain(thirdPreset.id);
      expect(store.userPresets.map((preset) => preset.id)).toContain(fourthPreset.id);
      expect(store.settings.audio.outputMode).toBe('wasapiExclusive');
    });

    it('round-trips extreme gain values through a preset', () => {
      const store = freshStore();

      store.patchSettings({
        audio: {
          equalizer: widenEq({
            preamp: -12,
            gains: [-12, -12, -12, -12, -12, 12, 12, 12, 12, 12],
          }),
        },
      });

      const preset = store.saveEqualizerPreset('Extreme');
      expect(preset.gains).toEqual([-12, -12, -12, -12, -12, 12, 12, 12, 12, 12]);
      expect(preset.preamp).toBe(-12);

      patchEqualizer(store, { gains: Array(10).fill(0), preamp: 0 });
      store.loadEqualizerPreset(preset.id);
      expect(store.settings.audio.equalizer.gains).toEqual([-12, -12, -12, -12, -12, 12, 12, 12, 12, 12]);
      expect(store.settings.audio.equalizer.preamp).toBe(-12);
    });

    it('round-trips decimal gain values through a preset', () => {
      const store = freshStore();

      store.patchSettings({
        audio: {
          equalizer: widenEq({
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

    it('captures the equalizer state at the moment a preset is updated', () => {
      const store = freshStore();

      patchEqualizer(store, { preamp: 0, gains: Array(10).fill(0) });
      const preset = store.saveEqualizerPreset('Original');

      patchEqualizer(store, { preamp: -5, gains: [5, 4, 3, 2, 1, -1, -2, -3, -4, -5] });
      store.updateEqualizerPreset(preset.id, 'Updated');

      patchEqualizer(store, { preamp: 0, gains: Array(10).fill(0) });
      store.loadEqualizerPreset(preset.id);

      expect(store.settings.audio.equalizer.preamp).toBe(-5);
      expect(store.settings.audio.equalizer.gains).toEqual([5, 4, 3, 2, 1, -1, -2, -3, -4, -5]);
    });

    it('loads a preset cleanly after manual equalizer adjustments', () => {
      const store = freshStore();

      const preset = store.saveEqualizerPreset('Initial');

      patchEqualizer(store, {
        preamp: -6,
        gains: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
        currentPresetId: null,
      });

      expect(store.settings.audio.equalizer.preamp).toBe(-6);
      expect(store.settings.audio.equalizer.currentPresetId).toBeNull();

      store.loadEqualizerPreset(preset.id);
      expect(store.settings.audio.equalizer.preamp).toBe(0);
      expect(store.settings.audio.equalizer.gains).toEqual(Array(10).fill(0));
      expect(store.settings.audio.equalizer.currentPresetId).toBe(preset.id);
    });

    it('does not disturb the current equalizer when deleting another preset', () => {
      const store = freshStore();

      const firstPreset = store.saveEqualizerPreset('Preset 1');
      const secondPreset = store.saveEqualizerPreset('Preset 2');

      store.loadEqualizerPreset(secondPreset.id);

      store.deleteEqualizerPreset(firstPreset.id);

      expect(store.settings.audio.equalizer.currentPresetId).toBe(secondPreset.id);
      expect(store.settings.audio.equalizer.enabled).toBe(true);
    });

    it('accepts special characters in preset names', () => {
      const store = freshStore();

      const rockPreset = store.saveEqualizerPreset('摇滚 & Bass');
      const anglePreset = store.saveEqualizerPreset('预设 <1>');
      const quotePreset = store.saveEqualizerPreset('Test "Quote"');

      expect(rockPreset.name).toBe('摇滚 & Bass');
      expect(anglePreset.name).toBe('预设 <1>');
      expect(quotePreset.name).toBe('Test "Quote"');

      expect(store.userPresets).toHaveLength(3);
    });

    it('accepts an empty preset name', () => {
      const store = freshStore();

      const preset = store.saveEqualizerPreset('');
      expect(preset.name).toBe('');
      expect(store.userPresets).toHaveLength(1);
    });

    it('gives each preset an independent copy of the gains', () => {
      const store = freshStore();

      patchEqualizer(store, { gains: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] });
      const firstPreset = store.saveEqualizerPreset('P1');

      patchEqualizer(store, { gains: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2] });
      const secondPreset = store.saveEqualizerPreset('P2');

      expect(firstPreset.gains).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
      expect(secondPreset.gains).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);

      store.loadEqualizerPreset(firstPreset.id);
      expect(store.settings.audio.equalizer.gains).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    });

    it('clears all equalizer state including custom presets on reset', () => {
      const store = freshStore();

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
});
