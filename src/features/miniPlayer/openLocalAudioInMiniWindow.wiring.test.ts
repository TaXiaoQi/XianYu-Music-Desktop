// mini 小窗默认打开：设置项 + 三段接线断言（沿用仓库 ?raw 断言风格，
// 与 useExternalPathBridge / useAppShell 的真实装配点一一对应）。
import { describe, expect, it } from 'vitest';

import { expectSourceContains } from '../../testing/sourceText';

import settingsAudioOutputSource from '../../components/settings/SettingsAudioOutput.vue?raw';
import settingsStoreSource from '../settings/store.ts?raw';
import settingsTypesSource from '../../types/index.ts?raw';
import appShellSource from '../../composables/useAppShell.ts?raw';
import externalPathSource from '../../composables/useExternalPathBridge.ts?raw';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRuntimeSource = readFileSync(
  resolve(process.cwd(), 'src-tauri/src/app_runtime.rs'),
  'utf8',
);

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
    const miniIdx = externalPathSource.indexOf(
      '// mini 小窗接管（打开本地音频文件 → 小窗形态）：主窗保持隐藏，跳过启动揭示',
    );
    const revealIdx = externalPathSource.indexOf('showMainWindowAfterStartup(getCurrentWindow()');

    expect(drainIdx).toBeGreaterThan(-1);
    expect(miniIdx).toBeGreaterThan(drainIdx);
    expect(revealIdx).toBeGreaterThan(miniIdx);
  });

  it('Rust 侧有打开路径时不抢先亮主窗（避免先闪主窗再被 mini 接管）', () => {
    expectSourceContains(appRuntimeSource, 'let has_open_paths = !open_paths.is_empty();');
    expectSourceContains(appRuntimeSource, 'if !has_open_paths {');
  });

  it('先出窗再播放：wrapper 先等 mini 窗显示，再入队播放', () => {
    expectSourceContains(appShellSource, 'await waitForMiniSurfaceShown();');
    const showIdx = appShellSource.indexOf('await waitForMiniSurfaceShown();');
    const playIdx = appShellSource.indexOf('await processExternalPaths(paths, options);');
    expect(showIdx).toBeGreaterThan(-1);
    expect(playIdx).toBeGreaterThan(showIdx);
  });

  it('迷你桥：show 先于状态推送；开关开启时预热隐藏窗口', () => {
    const bridgeSource = readFileSync(
      resolve(process.cwd(), 'src/composables/useMiniPlayerWindowBridge.ts'),
      'utf8',
    );
    expectSourceContains(bridgeSource, 'export function waitForMiniSurfaceShown');
    const showIdx = bridgeSource.indexOf('await surface.show();');
    const pushIdx = bridgeSource.indexOf('void pushStateSnapshot();');
    expect(showIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(showIdx);
    expectSourceContains(bridgeSource, '() => appSettings.value.openLocalAudioInMiniWindow,');
    expectSourceContains(bridgeSource, 'prewarmMiniWindow();');
  });

  it('运行期 app:open-paths 事件：未进入 mini 时由前端补揭示主窗', () => {
    const listenerIdx = externalPathSource.indexOf("listen('app:open-paths'");
    const revealIdx = externalPathSource.indexOf('revealMainWindowAfterExternalPaths();');
    expect(listenerIdx).toBeGreaterThan(-1);
    expect(revealIdx).toBeGreaterThan(listenerIdx);
    expectSourceContains(externalPathSource, 'async function revealMainWindowAfterExternalPaths()');
  });
});