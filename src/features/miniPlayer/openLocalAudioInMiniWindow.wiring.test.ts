// mini 小窗默认打开：设置项 + 三段接线断言（沿用仓库 ?raw 断言风格，
// 与 useExternalPathBridge / useAppShell 的真实装配点一一对应）。
import { describe, expect, it } from 'vitest';

import { expectSourceContains } from '../../testing/sourceText';

import settingsAudioOutputSource from '../../components/settings/SettingsAudioOutput.vue?raw';
import settingsStoreSource from '../settings/store.ts?raw';
import settingsTypesSource from '../../types/index.ts?raw';
import appShellSource from '../../composables/useAppShell.ts?raw';
import externalPathSource from '../../composables/useExternalPathBridge.ts?raw';

describe('打开本地音频默认 mini 小窗：设置项', () => {
  it('AppSettings 类型新增 openLocalAudioInMiniWindow（boolean）', () => {
    expectSourceContains(settingsTypesSource, 'openLocalAudioInMiniWindow: boolean;');
  });

  it('设置默认值为 false（不改变既有用户行为）', () => {
    expectSourceContains(settingsStoreSource, 'openLocalAudioInMiniWindow: false,');
  });

  it('播放栏存在开关行，且用 patchSettings 翻转该字段', () => {
    expectSourceContains(
      settingsAudioOutputSource,
      '打开本地音频文件时默认使用 mini 小窗',
    );
    expectSourceContains(
      settingsAudioOutputSource,
      ":class=\"{ 'is-checked': settings.openLocalAudioInMiniWindow }\"",
    );
    expectSourceContains(
      settingsAudioOutputSource,
      'patchSettings({ openLocalAudioInMiniWindow: !settings.openLocalAudioInMiniWindow })',
    );
  });
});

describe('打开本地音频默认 mini 小窗：打开链路接线', () => {
  it('useAppShell 用包装函数注入外部路径，判定通过后置 isMiniMode', () => {
    expectSourceContains(appShellSource, 'shouldUseMiniForOpen({');
    expectSourceContains(appShellSource, 'uiStore.isMiniMode = true;');
    expectSourceContains(
      appShellSource,
      'handleExternalPaths: handleExternalPathsWithMini,',
    );
    // 判定用的开关字段必须是真实设置字段，避免接错同名变量
    expectSourceContains(
      appShellSource,
      'enabled: shellSettings.value.openLocalAudioInMiniWindow,',
    );
  });

  it('冷启动 drain 之后、主窗揭示之前检查 isMiniMode 并提前返回', () => {
    const drainIdx = externalPathSource.indexOf(
      'await drainPendingOpenPaths({ startup: true });',
    );
    const miniIdx = externalPathSource.indexOf('if (uiStore.isMiniMode)');
    const revealIdx = externalPathSource.indexOf('showMainWindowAfterStartup(getCurrentWindow()');

    expect(drainIdx).toBeGreaterThan(-1);
    expect(miniIdx).toBeGreaterThan(drainIdx);
    expect(revealIdx).toBeGreaterThan(miniIdx);
  });
});